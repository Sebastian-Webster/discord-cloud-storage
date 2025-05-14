import { Client, TextChannel } from "discord.js";
import { parentPort, workerData } from "worker_threads";
import fs from 'fs';
import crypto from 'crypto';
import { FileChunkSize } from "../constants";

let {filePath}: {filePath: string} = workerData;

let client: Client<true>
let channel: TextChannel

function promisifiedClientConnect(): Promise<Client<true>> {
    return new Promise((resolve, reject) => {
        const client = new Client({intents: []});
        client.on('error', reject)
        client.on('ready', resolve)
        client.login(process.env.discordBotToken).catch(reject)
    })
}

async function getReady(): Promise<void> {
    try {
        client = await promisifiedClientConnect();
        channel = await client.channels.fetch(process.env.discordChannelId) as TextChannel;
        parentPort.postMessage({event: 'READY'})
    } catch (e) {
        console.error('An error occurred while getting worker thread ready:', e)
        parentPort.postMessage({event: 'FAILED_GETTING_READY'})
    }
}

getReady();

function partialReadFile(start: number, end: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, {start, end})
        const buffers = [];

        stream.on('data', (chunk) => {
            buffers.push(chunk)
        })

        stream.on('error', (err) => {
            reject(err)
        })

        stream.on('end', () => {
            resolve(Buffer.concat(buffers))
        })
    })
}

const hashedEncryptionKey = crypto.createHash('sha512').update(process.env.encryptionKey).digest('base64').slice(0, 32);

function encryptBuffer(buffer: Buffer): Buffer {
    const iv = crypto.randomBytes(16);
    console.log('iv:', iv)
    const cipher = crypto.createCipheriv(process.env.encryptionAlgorithm, hashedEncryptionKey, iv);
    return Buffer.concat([iv, cipher.update(buffer), cipher.final()])
}

parentPort.on('message', async (chunkNumber: number) => {
    let event: UploadWorkerEvent

    const startReadPosition = chunkNumber * FileChunkSize + (chunkNumber === 0 ? 0 : 1)
    const endReadPosition = (chunkNumber + 1) * FileChunkSize

    let fileBuffer: Buffer

    try {
        fileBuffer = await partialReadFile(startReadPosition, endReadPosition)
    } catch (e) {
        console.error('An error occurred while reading chunk number', chunkNumber, 'on file:', filePath, '. The error was:', e)   
    }

    const encryptedBuffer = encryptBuffer(fileBuffer)

    try {
        const message = await channel.send({
            files: [{
                attachment: encryptedBuffer,
                name: `file`,
                description: 'A cool file'
            }]
        })
        event = {event: 'MESSAGE_SENT', messageId: message.id, chunkNumber}
    } catch (error) {
        console.error('An error occurred while sending message:', error)
        event = {event: 'FAILED_SENDING_MESSAGE', chunkNumber}
    }

    parentPort.postMessage(event)
})