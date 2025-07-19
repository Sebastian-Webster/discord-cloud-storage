import express from 'express'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import os from 'os'
import fs from 'fs';
import path from 'path';

const storageFolder = path.normalize(os.tmpdir() + '/dcstestserver')

const app = express();

app.use(express.json())

const storage = multer.diskStorage({
    filename: (req, file, cb) => {
        const filename = req.params.filename
        if (!filename) {
            cb(new Error('Filename not provided'), null)
        }

        if (fs.existsSync(`${storageFolder}/filename`)) {
            cb(new Error('file already exists'), null)
        }

        cb(null, filename)
    },
    destination: (req, file, cb) => {
        cb(null, storageFolder)
    }
})

const upload = multer({storage, limits: { fieldSize: 1000 * 1000 * 1000 * 1000, fileSize: 1000 * 1000 * 1000 * 1000, fieldNameSize: 1000 * 1000 * 1000 * 1000}})

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

