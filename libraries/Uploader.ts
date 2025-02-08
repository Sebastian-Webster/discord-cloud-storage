import { Client, Message, TextChannel } from "discord.js";
import { Request, Response } from "express";
import File from "../models/File";
import mongoose from "mongoose";
import fs from 'fs';
import fsPromises from 'fs/promises'
import { removeFileAction, setFileActionText, startFileAction } from "../socketHandler";
import HTTP from "./HTTP";
import { Worker } from "worker_threads";
import path from "path";


export default class Uploader {
    #concurrentLimit = 25;
    #runningPromises = 0;
    #chunksUploaded = 0;
    #promiseQueue: number[] = [];
    #clientReady = false;
    #messageIds: string[] = [];
    #sentHTTPHeaders = false;
    #maxUploadRetries = 10;
    #uploadWorkers: {[key: number]: Worker} = {}

    #folderpath: string;
    #req: Request
    #res: Response;
    #chunksToUpload: number;
    #channel: TextChannel;
    #client: Client;
    #userId: mongoose.Types.ObjectId;
    #filename: string;
    #fileSize: number;
    #fileId: string;

    constructor(folderpath: string, chunks: number, req: Request, res: Response, userId: mongoose.Types.ObjectId, filename: string, fileSize: number, fileId: string) {
        this.#folderpath = folderpath;
        this.#res = res;
        this.#chunksToUpload = chunks;
        this.#userId = userId;
        this.#filename = filename;
        this.#fileSize = fileSize;
        this.#fileId = fileId;
        this.#req = req;

        startFileAction(String(this.#userId), this.#fileId, this.#filename, this.#fileSize, `Connecting to Discord...`, 'Upload', -1, -1);

        this.#client = new Client({intents: []});
        this.#client.on('ready', () => {
            this.#setupUploader()
        })
        this.#client.on('error', (err) => {
            this.#clientReady = false;
            console.error(err)
            this.#sendHTTP(500, String(err) || 'An unknown error occurred. Please try again.')
        })

        this.#client.login(process.env.discordBotToken).catch(error => {
            this.#clientReady = false;
            console.error('Error logging into Discord uploader client:', error)
            this.#sendHTTP(500, String(error) || 'An unknown error occurred while logging in to Discord. Please try again.')
        })
    }

    #sendHTTP(status: number, message: string) {
        if (!this.#sentHTTPHeaders) {
            this.#sentHTTPHeaders = true;
            HTTP.SendHTTP(this.#req, this.#res, status, message)
            const error = status < 200 || status > 299;
            removeFileAction(String(this.#userId), this.#fileId, error);
        }
    }

    async #setupUploader() {
        setFileActionText(String(this.#userId), this.#fileId, 'Fetching Discord channel to upload data to...', -1, -1);
        try {
            this.#channel = await this.#client.channels.fetch(process.env.discordChannelId) as TextChannel
        } catch (error) {
            console.error('An error occurred while fetching Discord channel:', error)
            this.#sendHTTP(500, String(error) || 'An unknown error occurred while fetching Discord channel data. Please try again.')
        }
        this.#clientReady = true;

        setFileActionText(String(this.#userId), this.#fileId, `0/${this.#chunksToUpload} chunks uploaded.`, 0, this.#chunksToUpload);

        for (const chunk of this.#promiseQueue.splice(0, this.#concurrentLimit)) {
            this.#startUpload(chunk)
        }
    }

    uploadChunk(chunkNumber: number) {
        if (this.#runningPromises < this.#concurrentLimit && this.#clientReady) {
            this.#startUpload(chunkNumber)
        } else {
            this.#promiseQueue.push(chunkNumber)
        }
    }

    #handleFinishUpload() {
        this.#runningPromises--
        this.#chunksUploaded++

        console.log(this.#chunksUploaded, this.#chunksToUpload)

        setFileActionText(String(this.#userId), this.#fileId, `${this.#chunksUploaded}/${this.#chunksToUpload} chunks uploaded.`, this.#chunksUploaded, this.#chunksToUpload)

        if (this.#chunksToUpload === this.#chunksUploaded) {
            console.log('All chunks have been uploaded.')
            const newFile = new File<IFileSchema>({
                userId: this.#userId,
                messageIds: this.#messageIds,
                fileName: this.#filename,
                dateCreated: Date.now(),
                fileSize: this.#fileSize
            })

            newFile.save().then(() => {
                this.#sendHTTP(200, 'Success')
                fs.rm(this.#folderpath, {recursive: true, force: true}, (err) => {
                    if (err) {
                        console.error('An error occurred while deleting temp folder path:', this.#folderpath, '. The error was:', err)
                    }
                    console.log('Successfully deleted temp folder')
                })
            }).catch(error => {
                console.error('An error occurred while saving file to MongoDB:', error)
                this.#sendHTTP(500, String(error) || 'An unknown error occurred while saving file to MongoDB. Please try again.')
            })
        }

        if (this.#chunksUploaded < this.#chunksToUpload && this.#clientReady && this.#promiseQueue.length > 0) {
            this.#startUpload(this.#promiseQueue.splice(0, 1)[0])
        }
    }

    #upload(chunkNumber: number): Promise<Message<true>['id']> {
        return new Promise((resolve, reject) => {
            const uploadWorker = new Worker(path.resolve('workers', 'UploadWorker.ts'), {
                workerData: {
                    channel: this.#channel,
                    folderPath: this.#folderpath,
                    chunkNumber
                }
            })
            this.#uploadWorkers[chunkNumber] = uploadWorker

            uploadWorker.on('message', (messageId: Message<true>['id']) => {
                delete this.#uploadWorkers[chunkNumber]
                resolve(messageId)
            })

            uploadWorker.on('error', (err) => {
                delete this.#uploadWorkers[chunkNumber]
                reject(err)
            })
        })
    }

    async #startUpload(chunkNumber: number) {
        this.#runningPromises++

        let uploadRetryCount = 0

        console.log('Starting upload for chunk:', chunkNumber)

        do {
            uploadRetryCount++

            let messageId: Message<true>['id']

            try {
                messageId = await this.#upload(chunkNumber)
            } catch (e) {
                console.error('An error occurred while sending a message file:', e)

                if (uploadRetryCount <= this.#maxUploadRetries) {
                    console.warn('Retrying upload:', uploadRetryCount, '/', this.#maxUploadRetries)
                    continue
                } else {
                    console.error('Exceeded upload retries. Aborting.')
                    this.#clientReady = false

                    try {
                        await Promise.all(Object.values(this.#uploadWorkers).map(worker => worker.terminate()))
                    } catch (e) {
                        console.error('An error occurred while terminating worker processes after an upload abortion after exhaustion of all upload retries. The error was:', e)
                    }

                    try {
                        await fsPromises.rm(this.#folderpath, {recursive: true, force: true, retryDelay: 100, maxRetries: 50})
                    } catch (e) {
                        console.error('An error occurred while deleting folderpath after all download retries have been exhausted. The error was:', e)
                    }

                    this.#sendHTTP(500, `Tried uploading ${this.#maxUploadRetries} times and all attempts failed. The upload has been aborted.`)
                    return
                }
            }

            this.#messageIds[chunkNumber - 1] = messageId;
            this.#handleFinishUpload()
        } while (uploadRetryCount <= this.#maxUploadRetries)
    }
}