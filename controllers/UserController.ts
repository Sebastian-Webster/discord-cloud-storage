import { Router } from "express";
import { validateAuth } from "../middleware/HTTPAuth";
import multer from "multer";
import path from "path";
import fs from 'fs';
import Uploader from "../libraries/Uploader";
import File from "../models/File";
import Downloader from "../libraries/Downloader";
import fsPromises from 'fs/promises';
import UserModel from "../models/User";
import { DeleteFile } from "../libraries/Deleter";
import mongoose from "mongoose";
import { validateUUIDV4 } from "../libraries/UUID";
import { fileActionAlreadyOccurring, removeFileAction, setFileActionText } from "../socketHandler";
import HTTP from "../libraries/HTTP";
import { FileChunkSize } from "../constants";
import crypto from 'crypto';

const userController = Router()

userController.all('/{*splat}', [validateAuth])

const storage = multer.diskStorage({
    filename: (req, file, cb) => {
        console.log('Deciding on filename:', file.originalname)
        const extname = path.extname(file.originalname);
        const filename = crypto.randomUUID() + extname
        console.log('new filename:', filename)
        cb(null, filename)
    },
    destination: (req, file, cb) => {
        console.log('Finding destination...')
        cb(null, process.env.tempFileFolderLocation)
    }
})

const upload = multer({storage, limits: { fieldSize: 1000 * 1000 * 1000 * 1000, fileSize: 1000 * 1000 * 1000 * 1000, fieldNameSize: 1000 * 1000 * 1000 * 1000}})

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

        const chunkCount = Math.ceil(req.file.size / FileChunkSize)

        const uploader = new Uploader(req.file.path, chunkCount, req, res, req.cookies.auth, req.file.originalname, req.file.size, req.body.fileId)

        for (let i = 0; i < chunkCount; i++) {
            uploader.uploadChunk(i)
        }
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

                const newFolderPath = `${process.env.tempFileFolderLocation}/recreate-${crypto.randomUUID()}`;
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
                DeleteFile(user._id, fileId, file.fileName, file.fileSize, file.messageIds).catch((error) => {
                    console.error('Received fatal error from file deleter:', error)
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

userController.get('/users/:username', (req, res) => {
    //User pagination has purposefully not been added because I think it is unneccesary as I'll only have few people use this
    //The user could just type a more accurate username instead of searching through a long list of users

    const username = req.params.username;
    const userId = req.cookies.auth;

    UserModel.find({_id: {$ne: userId}, username: {$regex: `^${username}`, $options: 'i'}}, 'secondId username').limit(10).then(users => {
        HTTP.SendHTTP(req, res, 200, users);
    }).catch(error => {
        console.error('An error occurred while finding users with username:', username, '. The error was:', error)
        HTTP.SendHTTP(req, res, 500, String(error) || 'An error occurred while finding users. Please try again')
    })
})

userController.get('/file/sharedwith/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const userId = req.cookies.auth;

    if (!mongoose.isObjectIdOrHexString(fileId)) {
        return HTTP.SendHTTP(req, res, 400, 'fileId must be an ObjectId.')
    }

    UserModel.findOne({_id: {$eq: userId}}, 'secondId').lean().then(user => {
        if (!user) return HTTP.SendHTTP(req, res, 400, {redirect: '/'}, {clearCookie: 'auth'})

        File.findOne({_id: {$eq: fileId}}, 'sharedWith userId').lean().then(file => {
            if (!file) return HTTP.SendHTTP(req, res, 404, 'File could not be found.')

            if (String(file.userId) !== userId && !file.sharedWith.includes(user.secondId)) return HTTP.SendHTTP(req, res, 403, 'This file is not shared with you.')

            if (!Array.isArray(file.sharedWith) || file.sharedWith.length === 0) return HTTP.SendHTTP(req, res, 200, [])

            UserModel.find({secondId: {$in: file.sharedWith}}, 'secondId username').then(users => {
                return HTTP.SendHTTP(req, res, 200, users)
            }).catch(error => {
                console.error('An error occurred while finding users that have secondIds in this array:', file.sharedWith, '. The error was:', error)
                return HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occured. Please try again.')
            })
        }).catch(error => {
            console.error('An error occurred while finding one file with id:', fileId, '. The error was:', error)
            HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred.')
        })
    }).catch(error => {
        console.error('An error occurred while finding one user with id:', userId, '. The error was:', error)
        HTTP.SendHTTP(req, res, 500, String(error) || 'An unknown error occurred.')
    })
})

export default userController;