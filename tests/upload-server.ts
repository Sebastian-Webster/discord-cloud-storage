import express from 'express';
import rateLimit from 'express-rate-limit';
import os from 'os';
import fs from 'fs';
import fsPromises from 'fs/promises';

const storageFolder = os.tmpdir() + '/dcstestserver'

const app = express();

app.use(express.json())
app.use(express.raw({type: 'application/octet-stream'}))

const messages = new Map();
const attachments = new Set();

app.post('/api/v10/channels/:channelId/messages/attachments', (req, res) => {
    const response = req.body.files.map((item, index) => {
        const filename = crypto.randomUUID()
        return {
            id: index,
            upload_url: 'http://' + req.host + '/upload/' + filename,
            uploaded_filename: filename
        }
    })

    res.json(response)
})

app.put('/upload/:filename', async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
        return res.status(400).send('Body must be a Buffer.')
    }

    const filename = req.params.filename;
    const storePath = `${storageFolder}/${filename}`;

    if (fs.existsSync(storePath)) {
        return res.status(400).send('File already exists.')
    }

    await fsPromises.writeFile(`${storageFolder}/${req.params.filename}`, req.body)

    attachments.add(filename)

    res.status(200)
})

app.post('/api/v10/channels/:channelId/messages', (req, res) => {
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

app.delete('/api/v10/chhannels/:channelId/messages/:messageId', async (req, res) => {
    const messageId = req.params.messageId;

    const messageAttachments = messages.get(messageId)

    if (!messageAttachments) {
        res.status(404).send('Could not find message')
    }

    for (const attachment of messageAttachments) {
        await fsPromises.rm(`${storageFolder}/${attachment}`)
        attachments.delete(attachment)
    }

    res.status(204)
})

