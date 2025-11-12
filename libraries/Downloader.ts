import axios from "axios";
import fs from 'fs';
import crypto from 'crypto';
import { removeFileAction, setFileActionText, startFileAction } from "../socketHandler";
import mongoose from "mongoose";
import { authHeaders } from "../constants";

const hashedEncryptionKey = crypto.createHash('sha512').update(process.env.encryptionKey).digest('base64').slice(0, 32);

type Message = {
    id: string,
    chunkNumber: number
}

function getAttachmentUrl(messageId: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
        axios.get(`${process.env.discordURL}/api/v10/channels/${process.env.discordChannelId}/messages/${messageId}`, {headers: authHeaders}).then(response => {
            const url = response?.data?.attachments?.[0]?.url
            if (url) {
                resolve(url)
            } else {
                reject('No URL found. Data:' + JSON.stringify(response.data))
            }
        }).catch(error => {
            const retry = error?.response?.data?.retry_after
            // If we have been rate limited, retry after the set amount of time
            if (typeof retry === 'number') {
                console.log('Waiting', retry, 'seconds before downloading next message.')
                setTimeout(() => {
                    reject('Rate limited.')
                }, retry * 1100);
            } else {
                reject(error?.response?.data || error)
            }
        })
    })
}

function decryptBuffer(buffer: Buffer): Buffer {
    const iv = buffer.slice(0, 16);
    console.log('decrypting iv:', iv)
    const encrypted = buffer.slice(16);
    const decipher = crypto.createDecipheriv(process.env.encryptionAlgorithm, hashedEncryptionKey, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function downloadAttachment(message: Message, folderPath: string, callback: (message: Message, err?: any) => void) {
    getAttachmentUrl(message.id).then(url => {
        console.log('Getting attachment data from url:', url)
        axios.get(url, {responseType: 'arraybuffer', maxContentLength: 30_000_000}).then(response => {
            const data = Buffer.from(response.data);
            console.log('Decrypting data:', data)
            const decryptedBuffer = decryptBuffer(data);
            fs.writeFile(`${folderPath}/${message.chunkNumber}`, decryptedBuffer, (err) => {
                if (err) {
                    callback(message, err)
                }

                console.log('Successfully wrote to temp file')
                callback(message)
            })
        }).catch((err) => callback(message, err))
    }).catch((err) => callback(message, err))
}

export default function Downloader(userId: mongoose.Types.ObjectId, fileId: mongoose.Types.ObjectId, fileName: string, fileSize: number, messageIdArray: string[]): Promise<string> {
    const messages: Message[] = messageIdArray.map((item, index) => {
        return {
            id: item,
            chunkNumber: index + 1
        }
    })
    const chunksToDownload = messageIdArray.length;
    const maxDownloadRetries = chunksToDownload * 3;
    let chunksDownloaded = 0;
    let downloadRetries = 0;
    console.log('Messages:', messages)

    console.log('Downloading', messageIdArray.length, 'chunks.')

    startFileAction(String(userId), String(fileId), fileName, fileSize, 'Setting up download...', 'Download', -1, -1);

    return new Promise((resolve, reject) => {
        const concurrencyLimit = 3;
        const folderPath = `${process.env.tempFileFolderLocation}/${crypto.randomUUID()}`

        let errored = false;
        let chunksConcurrentDownloading = 0;
    
        function handleFinishedDownload(message: Message, err?: any) {
            chunksConcurrentDownloading--;

            if (err) {
                if (downloadRetries++ <= maxDownloadRetries) {
                    // Retry download by adding it to the queue
                    messages.push(message)
                } else {
                    errored = true;
                    removeFileAction(String(userId), String(fileId), true);
                    return reject(err)
                }
            } else {
                chunksDownloaded++
            }

            if (errored) {
                //Would've rejected with error above
                //We do not want any subsequent Promise completions to trigger the other if statements, so we return here to prevent that from happening
                return
            }

            setFileActionText(String(userId), String(fileId), `Downloaded ${chunksDownloaded}/${chunksToDownload} chunks.`, chunksDownloaded, chunksToDownload);

            if (messages.length > 0) {
                chunksConcurrentDownloading++
                downloadAttachment(messages.splice(0, 1)[0], folderPath, handleFinishedDownload)
            }

            if (chunksConcurrentDownloading === 0) {
                console.log('Resolving:', folderPath)
                return resolve(folderPath)
            }
        }
    
        fs.mkdir(folderPath, (err) => {
            if (err) {
                removeFileAction(String(userId), String(fileId), true);
                reject(err)
            }


            console.log('Created temp download folder...')

            setFileActionText(String(userId), String(fileId), `Downloaded 0/${chunksToDownload} chunks.`, 0, chunksToDownload);

            for (const message of messages.splice(0, concurrencyLimit)) {
                console.log('Started download for message with id:', message.id)
                chunksConcurrentDownloading++
                downloadAttachment(message, folderPath, handleFinishedDownload)
            }
        })
    })
}