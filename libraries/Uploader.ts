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
    #messageIds: string[] = [];
    #sentHTTPHeaders = false;
    #maxUploadRetries = 10;
    #uploadWorkers: {worker: Worker, status: 'NOT_READY' | 'READY' | 'WORKING' | 'FAILED', messageRetryAttempts: number}[] = []

    #folderpath: string;
    #req: Request
    #res: Response;
    #chunksToUpload: number;
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

        for (let i = 0; i < this.#concurrentLimit; i++) {
            const uploadWorker = new Worker(path.resolve('workers', 'UploadWorker.js'), {
                workerData: {
                    folderPath: folderpath
                }
            })

            this.#uploadWorkers.push({worker: uploadWorker, status: 'NOT_READY', messageRetryAttempts: 0})
            
            uploadWorker.on('message', (event: UploadWorkerEvent) => {
                console.log('Received event from worker', i, ':', event)
                if (event.event === 'READY') {
                    const worker = this.#uploadWorkers[i]
                    if (this.#chunksUploaded < this.#chunksToUpload && this.#promiseQueue.length > 0) {
                        worker.status = 'WORKING'
                        worker.worker.postMessage(this.#promiseQueue.splice(0, 1)[0])
                    } else {
                        worker.status = 'READY'
                    }
                }

                if (event.event === 'FAILED_GETTING_READY') {
                    uploadWorker.terminate();
                    this.#uploadWorkers.splice(i, 1)
                    if (this.#uploadWorkers.length === 0) {
                        this.#sendHTTP(500, 'All upload workers failed to initialise.')
                    }
                }

                if (event.event === 'FAILED_SENDING_MESSAGE') {
                    this.#uploadWorkers[i].messageRetryAttempts++
                    if (this.#uploadWorkers[i].messageRetryAttempts <= this.#maxUploadRetries) {
                        this.uploadChunk(event.chunkNumber)
                    } else {
                        this.#cancelDueToError(`Failed to upload after ${this.#maxUploadRetries} tries.`)
                    }
                }

                if (event.event === 'MESSAGE_SENT') {
                    this.#messageIds[event.chunkNumber - 1] = event.messageId
                    console.log('messageIds:', this.#messageIds)
                    this.#handleFinishUpload()
                    if (this.#chunksUploaded < this.#chunksToUpload && this.#promiseQueue.length > 0) {
                        this.#uploadWorkers[i].worker.postMessage(this.#promiseQueue.splice(0, 1)[0])
                    } else {
                        this.#uploadWorkers[i].status = 'READY'
                    }
                }
            })
        }
    }

    #terminateAllWorkers: () => Promise<number[]> = () => {
        const promises = this.#uploadWorkers.map(worker => worker.worker.terminate());
        return Promise.all(promises)
    }

    #cancelDueToError(err: string) {
        this.#terminateAllWorkers().then(() => {
            this.#sendHTTP(500, `An error occurred while uploading file. The error was: ${err}`)
        })
    }

    #sendHTTP(status: number, message: string) {
        if (!this.#sentHTTPHeaders) {
            console.log('Setting HTTP with status:', status, 'and message:', message)
            this.#sentHTTPHeaders = true;
            HTTP.SendHTTP(this.#req, this.#res, status, message)
            const error = status < 200 || status > 299;
            removeFileAction(String(this.#userId), this.#fileId, error);
        }
    }

    uploadChunk(chunkNumber: number) {
        const potentialWorker = this.#uploadWorkers.filter(worker => worker.status === 'READY')[0]
        if (potentialWorker) {
            potentialWorker.status = 'WORKING'
            potentialWorker.worker.postMessage(this.#promiseQueue.splice(0, 1)[0])
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
            }).finally(this.#terminateAllWorkers)
        }
    }
}