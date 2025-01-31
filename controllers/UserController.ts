const chunkSize = 9.5 * 1024 * 1024 //9.5MB - Discord limit is 10MB, so having each file 0.5MB less than the limit ensures the limit is never reached

import { Router } from "express";
import { validateAuth } from "../middleware/HTTPAuth";
import multer from "multer";
import path from "path";
import crypto from 'crypto';
import fs from 'fs';
import Uploader from "../libraries/Uploader";
import { v4 } from "uuid";
import File from "../models/File";
import Downloader from "../libraries/Downloader";
import fsPromises from 'fs/promises';
import UserModel from "../models/User";
import { DeleteFile } from "../libraries/Deleter";
import mongoose from "mongoose";
import { validateUUIDV4 } from "../libraries/UUID";
import { fileActionAlreadyOccurring, removeFileAction, setFileActionText, startFileAction } from "../socketHandler";
import HTTP from "../libraries/HTTP";

const userController = Router()

userController.all('*', [validateAuth])

const storage = multer.diskStorage({
    filename: (req, file, cb) => {
        console.log('Deciding on filename:', file.originalname)
        const extname = path.extname(file.originalname);
        const filename = v4() + extname
        console.log('new filename:', filename)
        cb(null, filename)
    },
    destination: (req, file, cb) => {
        console.log('Finding destination...')
        cb(null, '/temp')
    }
})

const upload = multer({storage, limits: { fieldSize: 1000 * 1000 * 1000 * 1000, fileSize: 1000 * 1000 * 1000 * 1000, fieldNameSize: 1000 * 1000 * 1000 * 1000}})

const hashedEncryptionKey = crypto.createHash('sha512').update(process.env.encryptionKey).digest('base64').slice(0, 32);

function encryptBuffer(buffer: Buffer): Buffer {
    const iv = crypto.randomBytes(16);
    console.log('iv:', iv)
    const cipher = crypto.createCipheriv(process.env.encryptionAlgorithm, hashedEncryptionKey, iv);
    return Buffer.concat([iv, cipher.update(buffer), cipher.final()])
}

function writeStreamPromise(stream: fs.WriteStream, chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(chunk, (err) => {
            if (err) {
                reject(err)
            }

            resolve()
        })
    })
}

userController.post('/file', upload.single('file'), (req, res) => {
    if (!req.file) {
        return HTTP.SendHTTP(req, res, 400, 'A file must be provided.')
    }

    if (!validateUUIDV4(req.body.fileId)) {
        console.log('Invalid UUIDv4', req.body.fileId)
        return HTTP.SendHTTP(req, res, 400, 'fileId must be a UUIDv4')
    }

    UserModel.findOne({_id: {$eq: req.cookies.auth}}).then((user) => {
        if (!user) return HTTP.SendHTTP(req, res, 404, {redirect: '/'}, {clearCookie: 'auth'})

        console.log('Initiating file upload...')

        const filename = req.file.filename;
        const filenameWithoutExt = filename.slice(0, filename.indexOf('.'));

        const folderPath = `/temp/${filenameWithoutExt}-enc`

        fs.mkdirSync(folderPath);

        const uploader = new Uploader(folderPath, Math.ceil(req.file.size / chunkSize), req, res, req.cookies.auth, req.file.originalname, req.file.size, req.body.fileId)

        let count = 0;

        const stream = fs.createReadStream(req.file.path, {highWaterMark: chunkSize})

        stream.on('data', (chunk) => {
            count++;
            console.log('Received chunk', count, 'of length:', chunk.length)
            const buffer = Buffer.from(chunk);
            const encrypted = encryptBuffer(buffer);
            const bufferCount = count;
            const newFilePath = `/temp/${filenameWithoutExt}-enc/${count}`
            fs.writeFile(newFilePath, encrypted, (err) => {
                if (err) {
                    console.error('An error occurred:', err)
                    stream.close();
                    return HTTP.SendHTTP(req, res, 500, String(err) || 'An unknown error occurred')
                }
                console.log('Written buffer', bufferCount, 'to disk.')
                uploader.uploadChunk(bufferCount);
            })
        })

        stream.on('error', (err) => {
            console.error('An error occurred:', err)
            return HTTP.SendHTTP(req, res, 500, String(err) || 'An unknown error occurred')
        })

        stream.on('end', () => {
            console.log('Stream ended.')
            fs.rm(req.file.path, (err => {
                if (err) {
                    console.error('ERROR deleting file with path:', req.file.path, err)
                }
                console.log('Successfully deleted unneeded file:', req.file.path)
            }))
        })
    }).catch(error => {
        console.error('An error occurred while finding one user with id:', req.cookies.auth, '. The error was:', error)
        return HTTP.SendHTTP(req, res, 500, String (error) || 'An unknown error occurred while finding user. Please try again.')
    })
})

userController.get('/files', (req, res) => {
    UserModel.findOne({_id: {$eq: req.cookies.auth}}).lean().then(user => {
        if (!user) return HTTP.SendHTTP(req, res, 404, {redirect: '/'}, {clearCookie: 'auth'})

        File.find({userId: {$eq: req.cookies.auth}}, 'fileName dateCreated fileSize').lean().then(files => {
            if (files.length === 0) return HTTP.SendHTTP(req, res, 200, {files: []})

            let storageBytesUsed = 0;
            for (let i = 0; i < files.length; i++) {
                storageBytesUsed += files[i].fileSize
            }
    
            HTTP.SendHTTP(req, res, 200, {files, storageBytesUsed})
        }).catch(error => {
            console.error('An error occurred while getting all Files with userId:', req.cookies.auth, '. The error was:', error)
            HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred.');
        })
    }).catch(error => {
        console.error('An error occurred while finding one user with id:', req.cookies.auth, '. THe error was:', error)
        HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred while finding user. Please try again.')
    })
})

userController.get('/file/:id', (req, res) => {
    const fileId = req.params.id;
    const userId = req.cookies.auth;

    console.log(fileId)
    if (!mongoose.isObjectIdOrHexString(fileId)) {
        return HTTP.SendHTTP(req, res, 400, 'fileId must be an ObjectId.');
    }

    if (fileActionAlreadyOccurring(userId, fileId)) {
        return HTTP.SendHTTP(req, res, 409, 'File action is already occurring. Please wait.')
    }

    UserModel.findOne({_id: {$eq: userId}}).then(user => {
        if (!user) return HTTP.SendHTTP(req, res, 404, {redirect: '/'}, {clearCookie: 'auth'})

        console.log('Starting download for file:', fileId)
        File.findOne({_id: {$eq: fileId}}).lean().then(file => {
            if (!file) {
                return HTTP.SendHTTP(req, res, 404, 'File not found')
            }

            if (file.userId != req.cookies.auth) {
                return HTTP.SendHTTP(req, res, 401, 'You are not allowed to access this resource.')
            }

            console.log('Initiating download...')

            Downloader(user._id, file._id, file.fileName, file.fileSize, file.messageIds).then(async (folderPath) => {
                setFileActionText(userId, fileId, 'Waiting for server...', -1, -1);

                console.log('Successfully downloaded all chunks')

                let filename = file.fileName;

                const dotIndex = filename.indexOf('.')
                if (dotIndex > -1) {
                    filename = filename.slice(0, dotIndex)
                }

                const newFolderPath = `/temp/recreate-${v4()}`;
                fs.mkdir(newFolderPath, {recursive: true}, async (err) => {
                    if (err) {
                        console.error('Error creating folder with path:', newFolderPath, '. The error was:', err)
                        removeFileAction(userId, fileId, true);
                        return HTTP.SendHTTP(req, res, 500, String(err) || 'An unknown error occurred while creating temporary folder. Please try again.');
                    }

                    console.log('Created temporary folder')

                    const downloadableFilePath = `${newFolderPath}/${file.fileName}`
                    const stream = fs.createWriteStream(downloadableFilePath);

                    const messageIdCount = file.messageIds.length;

                    setFileActionText(userId, fileId, `Concatenated 0/${messageIdCount} chunks.`, 0, messageIdCount);

                    for (let i = 1; i < messageIdCount + 1; i++) {
                        const chunkFilepath = `${folderPath}/${i}`;
                        let chunk: Buffer;

                        try {
                            console.log('Reading file:', chunkFilepath)
                            chunk = await fsPromises.readFile(chunkFilepath)
                            console.log('Chunk length in bytes:', chunk.byteLength)
                            console.log('Written chunk', i)
                        } catch (error) {
                            console.error('An error occurred while reading file from filepath:', chunkFilepath, '. The error was:', err)
                            stream.close();
                            removeFileAction(userId, fileId, true);
                            return HTTP.SendHTTP(req, res, 500, String(err) || 'An unknown error occurred while reading temporary files. Please try again');
                        }

                        try {
                            await writeStreamPromise(stream, chunk)
                        } catch (error) {
                            console.error('An error occurred while writing to chunk stream. The error was:', error)
                            stream.close();
                            removeFileAction(userId, fileId, true);
                            return HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred while writing to temporary file. Please try again.');
                        }

                        setFileActionText(userId, fileId, `Concatenated ${i}/${messageIdCount} chunks.`, i, messageIdCount);

                        try {
                            await fsPromises.rm(chunkFilepath);
                        } catch (error) {
                            console.error('An error occurred while deleting file from filepath:', chunkFilepath)
                        }
                    }

                    stream.close();

                    console.log('Sending downloaded file...')
                    removeFileAction(userId, fileId, false);
                    HTTP.SendDownloadableFile(req, res, downloadableFilePath, () => {
                        Promise.all([
                            fsPromises.rm(folderPath, {recursive: true, force: true}),
                            fsPromises.rm(newFolderPath, {recursive: true, force: true})
                        ]).then(() => {
                            console.log('Deleted temporary folder structure for file:', fileId)
                        }).catch(error => {
                            console.error('An error occurred while deleting temporary folders:', error)
                        })
                    })
                });
            }).catch(error => {
                console.error('An error occurred while downloading Discord file:', error)
                HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred.')
            })
        }).catch(error => {
            console.error('An error occurred while finding a File with _id:', fileId, '. The error was:', error)
            HTTP.SendHTTP(req, res, 500, String (error) || 'An unknown error occurred.')
        })
    }).catch(error => {
        console.error('An error occurred while finding one user with id:', req.cookies.auth, '. The error was:', error)
        HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred while finding user. Please try again.');
    })
})

userController.delete('/file/:id', (req, res) => {
    const fileId = req.params.id;
    const userId = req.cookies.auth;

    if (!mongoose.isObjectIdOrHexString(fileId)) {
        return HTTP.SendHTTP(req, res, 400, 'fileId must be an ObjectId.')
    }

    if (fileActionAlreadyOccurring(userId, fileId)) {
        return HTTP.SendHTTP(req, res, 409, 'File action is already occurring. Please wait.')
    }

    UserModel.findOne({_id: {$eq: userId}}).lean().then(user => {
        if (!user) return HTTP.SendHTTP(req, res, 404, {redirect: '/'}, {clearCookie: 'auth'});

        File.findOne({_id: {$eq: fileId}}).lean().then(file => {
            if (!file) return HTTP.SendHTTP(req, res, 200, 'File does not exist'); //The file does not exist. Since the user is trying to delete it, we may as well say it was a success

            File.deleteOne({_id: {$eq: fileId}}).then(() => {
                DeleteFile(user._id, fileId, file.fileName, file.fileSize, file.messageIds).catch(() => {
                    //Errors are logged in the DeleteFile function so nothing is needed here.
                }).finally(() => {
                    HTTP.SendHTTP(req, res, 200, 'Success');
                })
            }).catch(error => {
                console.error('An error occurred while deleting one file with id:', fileId, '. The error was:', error)
                HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred while deleting the file. Please try again.');
            })
        })
    }).catch(error => {
        console.error('An error occurred while finding one user with id:', userId, '. The error was:', error)
        HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred.');
    })
})

export default userController;