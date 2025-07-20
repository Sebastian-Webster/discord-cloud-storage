import express from 'express';
import { rateLimit } from 'express-rate-limit';
import os from 'os';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { Server } from 'http';

export const testServerStorageFolder = os.tmpdir() + '/dcstestserver'

fs.mkdirSync(testServerStorageFolder, {recursive: true})

const app = express();

app.use(express.json())
app.use(express.raw({type: 'application/octet-stream'}))

const messages = new Map();
const attachments = new Set();

const channelId = "1"

const rateLimitSettings = {
    windowMs: 1000,
    limit: 2,
    message: {
        retry_after: 1000
    }
}

const POSTMessageLimiter = rateLimit(rateLimitSettings)
const DELMessageLimiter = rateLimit(rateLimitSettings)
const GETMessageLimiter = rateLimit(rateLimitSettings)

app.post('/api/v10/channels/:channelId/attachments', (req, res) => {
    if (req.params.channelId !== channelId) {
        return res.status(404).send('Could not find channel')
    }

    const attachments = req.body.files.map((item, index) => {
        const filename = crypto.randomUUID()
        return {
            id: index,
            upload_url: 'http://' + req.host + '/upload/' + filename,
            uploaded_filename: filename
        }
    })

    res.json({attachments})
})

app.put('/upload/:filename', async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
        return res.status(400).send('Body must be a Buffer.')
    }

    const filename = req.params.filename.replaceAll('/', '').replaceAll('\\', '');
    const storePath = `${testServerStorageFolder}/${filename}`;

    if (fs.existsSync(storePath)) {
        return res.status(400).send('File already exists.')
    }

    await fsPromises.writeFile(`${testServerStorageFolder}/${req.params.filename}`, req.body)

    attachments.add(filename)

    res.status(200)
})

app.post('/api/v10/channels/:channelId/messages', POSTMessageLimiter, (req, res) => {
    if (req.params.channelId !== channelId) {
        return res.status(404).send('Could not find channel')
    }

    const body = req.body;

    const files = body.map(item => item.upload_filename)

    for (const file of files) {
        if (!attachments.has(file)) {
            return res.status(404).send(`File ${file} does not exist.`)
        }
    }

    const messageId = crypto.randomUUID();

    messages.set(messageId, files)

    res.status(200).json({id: messageId})
})

app.delete('/api/v10/chhannels/:channelId/messages/:messageId', DELMessageLimiter, async (req, res) => {
    if (req.params.channelId !== channelId) {
        return res.status(404).send('Could not find channel')
    }

    const messageId = req.params.messageId;

    const messageAttachments = messages.get(messageId)

    if (!messageAttachments) {
        res.status(404).send('Could not find message')
    }

    for (const attachment of messageAttachments) {
        await fsPromises.rm(`${testServerStorageFolder}/${attachment}`)
        attachments.delete(attachment)
    }

    res.status(204)
})

app.get('/api/v10/channels/:channelId/messages/:messageId', GETMessageLimiter, (req, res) => {
    if (req.params.channelId !== channelId) {
        return res.status(404).send('Could not find channel')
    }

    const messageId = req.params.messageId;
    const messageAttachments = messages.get(messageId)

    if (!messageAttachments) {
        return res.status(404).send('Could not find message')
    }

    const toSend = messageAttachments.map(attachment => {
        return {
            url: 'http://' + req.host + '/download/' + attachment
        }
    })

    res.status(200).json(toSend)
})

app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename.replaceAll('/', '').replaceAll('\\', '')

    if (!attachments.has(filename)) {
        return res.status(404).send('Could not find file')
    }

    res.sendFile(`${testServerStorageFolder}/${filename}`)
})

app.get('/everything-deleted', (req, res) => {
    console.log('Attachments:', attachments)
    console.log('Messages:', messages)

    if (attachments.size !== 0 && messages.size !== 0) return res.json(false);

    res.json(true);
})

export default new Promise<Server>((resolve, reject) => {
    const server = app.listen(0, (err) => {
        if (err) {
            return reject(err)
        }

        resolve(server)
    })
})

