import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import axios from "axios";
import { v4 } from "uuid";
import fs from 'fs';
import crypto from 'crypto';
import { removeFileAction, setFileActionText, startFileAction } from "../socketHandler";
import mongoose from "mongoose";

const hashedEncryptionKey = crypto.createHash('sha512').update(process.env.encryptionKey).digest('base64').slice(0, 32);

function getAttachmentUrl(messageId: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
        console.log('Getting client ready...')
        const client = new Client({intents: [GatewayIntentBits.MessageContent]});
        try {
            await client.login(process.env.discordBotToken);
        } catch (error) {
            console.error('An error occurred while logging into client:', error)
            reject(error)
        }
        client.on('ready', async () => {
            console.log('Client is ready')
            const channel = await client.channels.fetch(process.env.discordChannelId) as TextChannel;
            console.log(messageId)
            const message = await channel.messages.fetch(messageId);
            const attachment = message.attachments.first();
            resolve(attachment.url)
            console.log('Found attachment url...')
        })
        client.on('error', (err) => {
            reject(err)
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

function downloadAttachment(messageId: string, chunkNumber: number, folderPath: string, callback: (err?: any) => void) {
    getAttachmentUrl(messageId).then(url => {
        console.log('Getting attachment data from url:', url)
        axios.get(url, {responseType: 'arraybuffer', maxContentLength: 30_000_000}).then(response => {
            const data = Buffer.from(response.data);
            console.log('Decrypting data:', data)
            const decryptedBuffer = decryptBuffer(data);
            fs.writeFile(`${folderPath}/${chunkNumber}`, decryptedBuffer, (err) => {
                if (err) {
                    callback(err)
                }

                console.log('Successfully wrote to temp file')
                callback()
            })
        }).catch(callback)
    }).catch(callback)
}

export default function Downloader(userId: mongoose.Types.ObjectId, fileId: mongoose.Types.ObjectId, fileName: string, fileSize: number, messageIdArray: string[]): Promise<string> {
    const messageIds = [...messageIdArray]
    const chunksToDownload = messageIdArray.length;
    console.log('Message ids:', messageIds)

    console.log('Downloading', messageIdArray.length, 'chunks.')

    startFileAction(String(userId), String(fileId), fileName, fileSize, 'Setting up download...', 'Download', -1, -1);

    return new Promise((resolve, reject) => {
        const concurrencyLimit = 10;
        const folderPath = `/temp/${v4()}`
    
        let chunkNumber = 0;
        let errored = false;
        let chunksConcurrentDownloading = 0;
    
        function handleFinishedDownload(err: any) {
            chunksConcurrentDownloading--;

            if (err) {
                errored = true;
                removeFileAction(String(userId), String(fileId), true);
                return reject(err)
            }

            console.log(`Downloaded chunk ${chunkNumber - chunksConcurrentDownloading}/${messageIdArray.length}`)

            if (errored) {
                //Would've rejected with error above
                //We do not want any subsequent Promise completions to trigger the other if statements, so we return here to prevent that from happening
                return
            }

            const chunksDownloaded = chunkNumber - chunksConcurrentDownloading;

            setFileActionText(String(userId), String(fileId), `Downloaded ${chunksDownloaded}/${chunksToDownload} chunks.`, chunksDownloaded, chunksToDownload);

            if (messageIds.length > 0) {
                chunkNumber++
                chunksConcurrentDownloading++
                downloadAttachment(messageIds.splice(0, 1)[0], chunkNumber, folderPath, handleFinishedDownload)
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

            for (const id of messageIds.splice(0, concurrencyLimit)) {
                console.log('Started download for message with id:', id)
                chunkNumber++
                chunksConcurrentDownloading++
                downloadAttachment(id, chunkNumber, folderPath, handleFinishedDownload)
            }
        })
    })
}