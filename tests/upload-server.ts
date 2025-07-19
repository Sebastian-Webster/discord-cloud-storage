import express from 'express'
import rateLimit from 'express-rate-limit'
import os from 'os'
import fs from 'fs';
import path from 'path';

const storageFolder = path.normalize(os.tmpdir() + '/dcstestserver')

const app = express();

app.use(express.json())

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

app.put('/upload/:filename', (req, res) => {

})

