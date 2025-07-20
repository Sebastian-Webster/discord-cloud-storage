import testExpressServer, {storageFolder} from './upload-server';
import discordServer from '../index'
import crypto from 'crypto'
import axiosPackage from 'axios';
import { MongoMemoryServer } from 'mongodb-memory-server'
import fsPromises from 'fs/promises'

process.env.port = '0'

async function main() {
    const testServer = await testExpressServer;
    const realServer = await discordServer;
    const mongod = await MongoMemoryServer.create();

    const mongoURI = mongod.getUri();

    const testAddress = testServer.address()
    const realAddress = realServer.address()

    if (typeof testAddress === 'string') throw 'test address is string'
    if (typeof realAddress === 'string') throw 'real address is string'

    const testURL = `http://127.0.0.1:${testAddress.port}`
    const realServerURL = `http://127.0.0.1:${realAddress.port}`

    process.env.discordURL = testURL
    process.env.dbURI = mongoURI

    const axios = axiosPackage.create({
        baseURL: realServerURL,
        withCredentials: true
    })

    // Signup

    await axios.post('/signup', {username: 'test', password: 'testingapp'})

    // Login

    await axios.post('/login', {username: 'test', password: 'testingapp'})

    // Uploading file

    const sendingBytes = crypto.randomBytes(2**31 - 1);

    const sendFormData = new FormData();
    sendFormData.append('file', new Blob([sendingBytes]), 'test.lol')

    const fileId = (await axios.post('/auth/file', sendFormData)).data

    if ((await axiosPackage.get(`${testURL}/everything-deleted`)).data !== false) {
        throw 'No files exist in test server'
    }


    // Get file list

    const filesData = (await axios.get('/auth/files')).data

    if (filesData.storageBytesUsed !== 2**31 - 1) throw `Received incorrect storage bytes used. Expecting 2,147,483,647 but received ${filesData.storageBytesUsed}.`;
    if (filesData.files[0].filename !== 'test.lol') throw `Received incorrect file name. Expecting test.lol but received ${filesData.files[0].filename}.`;
    if (filesData.files[0].fileSize !== 2**31 - 1) throw `Received incorrect file size. Expecting 2,147,483,647 but received ${filesData.files[0].fileSize}`;

    // Download file

    const receivedArrayBuffer = (await axios.get(`/auth/file/${fileId}`, {responseType: 'arraybuffer', maxContentLength: 2**40})).data
    const receivedBuffer = Buffer.from(receivedArrayBuffer)

    if (Buffer.compare(sendingBytes, receivedBuffer) !== 0) throw 'Buffers uploaded and downloaded are not the same.';

    // Delete file

    await axios.delete(`/auth/file/${fileId}`)

    if ((await axiosPackage.get(`${testURL}/everything-deleted`)).data === false) throw 'Not all messages were deleted.';

    // Get now empty file list

    const emptyFilesData = (await axios.get('/auth/files')).data
    const emptyFilesKeys = Object.keys(emptyFilesData)

    if (emptyFilesKeys.length !== 1 || emptyFilesData[0] !== 'files') throw `Received incorrect files data. Expecting empty data. Received: ${emptyFilesData}`

    // Delete temp files from upload server

    await fsPromises.rm(storageFolder, {recursive: true, force: true, maxRetries: 100, retryDelay: 50})
}

main()