import { Request, Response } from "express";
import File from "../models/File";
import mongoose from "mongoose";
import fs from 'fs';
import { removeFileAction, setFileActionText, startFileAction } from "../socketHandler";
import HTTP from "./HTTP";
import { Worker } from "worker_threads";
import path from "path";


export default class Uploader {
    #concurrentLimit = 10;
    #runningPromises = 0;
    #chunksUploaded = 0;
    #promiseQueue: number[] = [];
    #messageIds: string[] = [];
    #sentHTTPHeaders = false;
    #maxUploadRetries = 250;
    #uploadWorkers: {worker: Worker, status: 'NOT_READY' | 'READY' | 'WORKING' | 'FAILED' | 'CRASHED', workingOnChunkNumber: null | number}[] = []
    #uploadRetries: {[chunkNumber: number]: number} = {}

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

            this.#uploadWorkers.push({worker: uploadWorker, status: 'NOT_READY', workingOnChunkNumber: null})
            
            uploadWorker.on('message', (event: UploadWorkerEvent) => {
                console.log('Received event from worker', i, ':', event)
                if (event.event === 'READY') {
                    const worker = this.#uploadWorkers[i]
                    if (this.#chunksUploaded < this.#chunksToUpload && this.#promiseQueue.length > 0) {
                        const chunkNumber = this.#promiseQueue.splice(0, 1)[0]
                        worker.status = 'WORKING'
                        worker.worker.postMessage(chunkNumber)
                        worker.workingOnChunkNumber = chunkNumber
                    } else {
                        worker.status = 'READY'
                    }
                }

                if (event.event === 'FAILED_GETTING_READY') {
                    const worker = this.#uploadWorkers[i]
                    worker.status = 'FAILED'
                    worker.workingOnChunkNumber = null
                    uploadWorker.terminate();
                    if (this.#uploadWorkers.filter(worker => worker.status === 'FAILED' || worker.status === 'CRASHED').length === this.#concurrentLimit) {
                        console.error('Max number of threads:', this.#concurrentLimit, '| Number of threads that have failed to initialise:', this.#uploadWorkers.filter(worker => worker.status === 'FAILED'), '| Number of threads that have crashed:', this.#uploadWorkers.filter(worker => worker.status === 'CRASHED'))
                        console.error('All upload workers have either failed to initialise or have crashed. Logging workers:', this.#uploadWorkers)
                        this.#cancelDueToError('All upload workers have either failed to initialise or have crashed.')
                    }
                }

                if (event.event === 'FAILED_SENDING_MESSAGE') {
                    const worker = this.#uploadWorkers[i]

                    if (this.#uploadRetries[event.chunkNumber]) {
                        this.#uploadRetries[event.chunkNumber]++
                    } else {
                        this.#uploadRetries[event.chunkNumber] = 1
                    }


                    if (this.#uploadRetries[event.chunkNumber] <= this.#maxUploadRetries) {
                        worker.workingOnChunkNumber = null
                        worker.status = 'READY'
                        this.uploadChunk(event.chunkNumber)
                    } else {
                        this.#cancelDueToError(`Failed to upload after ${this.#maxUploadRetries} tries.`)
                    }
                }

                if (event.event === 'MESSAGE_SENT') {
                    const deletableFilePath = `${this.#folderpath}/${event.chunkNumber}`
                    fs.rm(deletableFilePath, {force: true, retryDelay: 100, maxRetries: 50}, (err) => {
                        if (err) {
                            console.error('An error occurred after deleting file at path:', deletableFilePath, ' after successful Discord upload. The error was:', err)
                        } else {
                            console.log('Successfully deleted chunk number:', event.chunkNumber, 'after successful Discord upload.')
                        }
                    })
                    
                    this.#messageIds[event.chunkNumber - 1] = event.messageId
                    this.#handleFinishUpload()
                    const worker = this.#uploadWorkers[i]
                    if (this.#chunksUploaded < this.#chunksToUpload && this.#promiseQueue.length > 0) {
                        const chunkNumber = this.#promiseQueue.splice(0, 1)[0]
                        worker.workingOnChunkNumber = chunkNumber
                        worker.worker.postMessage(chunkNumber)
                    } else {
                        worker.status = 'READY'
                        worker.workingOnChunkNumber = null
                    }
                }
            })

            uploadWorker.on('error', (err) => {
                console.error('A worker thread crashed on uploading file because of error:', err)

                const worker = this.#uploadWorkers[i]
                worker.status = 'CRASHED'
                uploadWorker.terminate()

                console.error('Max number of threads:', this.#concurrentLimit, '| Number of threads that have failed to initialise:', this.#uploadWorkers.filter(worker => worker.status === 'FAILED'), '| Number of threads that have crashed:', this.#uploadWorkers.filter(worker => worker.status === 'CRASHED'))

                if (this.#uploadWorkers.filter(worker => worker.status === 'FAILED' || worker.status === 'CRASHED').length === this.#concurrentLimit) {
                    console.error('All upload workers have either failed to initialise or have crashed. Logging workers:', this.#uploadWorkers)
                    this.#cancelDueToError('All upload workers have either failed to initialise or have crashed.')
                } else {
                    this.uploadChunk(worker.workingOnChunkNumber)
                }

                worker.workingOnChunkNumber = null
            })
        }
    }

    #terminateAllWorkers: () => Promise<number[]> = () => {
        const promises = this.#uploadWorkers.map(worker => worker.worker.terminate());
        return Promise.all(promises)
    }

    #cancelDueToError(err: string) {
        fs.rm(this.#folderpath, {recursive: true, force: true, retryDelay: 100, maxRetries: 50}, (err) => {
            if (err) {
                console.error('An error occurred while deleting temp folder path:', this.#folderpath, ' after an error was caused while uploading a file. The error was:', err)
            }
            console.log('Successfully deleted temp folder after an error occurred.')
        })

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
            potentialWorker.workingOnChunkNumber = chunkNumber
            potentialWorker.worker.postMessage(chunkNumber)

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
            }).catch(error => {
                console.error('An error occurred while saving file to MongoDB:', error)
                this.#sendHTTP(500, String(error) || 'An unknown error occurred while saving file to MongoDB. Please try again.')
            }).finally(() => {
                fs.rm(this.#folderpath, {recursive: true, force: true, retryDelay: 100, maxRetries: 50}, (err) => {
                    if (err) {
                        console.error('An error occurred while deleting temp folder path:', this.#folderpath, '. The error was:', err)
                    }
                    console.log('Successfully deleted temp folder')
                })
                this.#terminateAllWorkers()
            })
        }
    }
}