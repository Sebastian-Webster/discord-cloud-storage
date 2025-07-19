import { parentPort, workerData } from "worker_threads";
import fs from 'fs';
import crypto from 'crypto';
import { authHeaders, FileChunkSize } from "../constants";
import axios from "axios";

let {filePath}: {filePath: string} = workerData;

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

    if (!fileBuffer) {
        parentPort.postMessage({event: 'FAILED_SENDING_MESSAGE', chunkNumber})
        return
    }

    const encryptedBuffer = encryptBuffer(fileBuffer)

    let attachmentResponse;

    try {
        attachmentResponse = await axios.post(`${process.env.discordURL}/api/v10/channels/${process.env.discordChannelId}/attachments`, {
            files: [
                {
                    filename: 'file',
                    file_size: encryptedBuffer.byteLength,
                    id: 0
                }
            ]
        }, {
            headers: authHeaders
        })
    } catch (error) {
        console.error('An error occurred while getting attachment upload URLs:', error?.response?.data?.errors || String(error))
    }

    if (!attachmentResponse?.data?.attachments) {
        console.error('Sending FAILED_SENDING_MESSAGE event because attachments could not be found.')
        parentPort.postMessage({event: 'FAILED_SENDING_MESSAGE', chunkNumber})
        return
    }

    const attachments = attachmentResponse.data.attachments;
    const upload_url = attachments[0].upload_url
    const uploaded_filename = attachments[0].upload_filename

    let uploadAttachmentError;

    try {
        await axios.put(upload_url, encryptedBuffer, {
            headers: authHeaders
        })
    } catch (error) {
        uploadAttachmentError = error;
    }

    if (uploadAttachmentError) {
        console.error('An error occurred while uploading attachment:', uploadAttachmentError?.response?.data?.errors || String(uploadAttachmentError))
        parentPort.postMessage({event: 'FAILED_SENDING_MESSAGE', chunkNumber})
        return
    }

    const toUpload = [
        {
            id: "0",
            filename: 'file',
            uploaded_filename
        }
    ]

    let messageResponse;

    try {
        messageResponse = await axios.post(`${process.env.discordURL}/api/v10/channels/${process.env.discordChannelId}/messages`, {
            attachments: toUpload,
            content: ""
        }, {
            headers: authHeaders
        })
    } catch (error) {
        console.error('An error occurred while creating Discord message:', error?.response?.data?.errors || String(error))
    }


    if (!messageResponse?.data?.id) {
        parentPort.postMessage({event: 'FAILED_SENDING_MESSAGE', chunkNumber})
        return
    }


    parentPort.postMessage({event: 'MESSAGE_SENT', messageId: messageResponse.data.id, chunkNumber})
})