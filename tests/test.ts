import testExpressServer, {testServerStorageFolder} from './upload-server';
import discordServer from '../index'
import crypto from 'crypto'
import axiosPackage from 'axios';
import fsPromises from 'fs/promises'
import os from 'os'

const DCSServerTempLocation = os.tmpdir() + '/dcsserver'

async function test() {
    await fsPromises.mkdir(DCSServerTempLocation, {recursive: true})
    const testServer = await testExpressServer;
    const realServer = await discordServer;

    const testAddress = testServer.address()
    const realAddress = realServer.address()

    if (typeof testAddress === 'string') throw 'test address is string'
    if (typeof realAddress === 'string') throw 'real address is string'

    const testURL = `http://127.0.0.1:${testAddress.port}`
    const realServerURL = `http://127.0.0.1:${realAddress.port}`

    process.env.discordURL = testURL
    process.env.tempFileFolderLocation = DCSServerTempLocation

    const axios = axiosPackage.create({
        baseURL: realServerURL,
        withCredentials: true
    })

    // Signup

    await axios.post('/signup', {username: 'test', password: 'testingapp'})

    // Login

    const cookie = (await axios.post('/login', {username: 'test', password: 'testingapp'})).headers['set-cookie'][0]

    // Uploading file

    const sendingBytes = crypto.randomBytes(2**30);
    const fileId = crypto.randomUUID();

    const sendFormData = new FormData();
    sendFormData.append('file', new Blob([sendingBytes]), 'test.lol')
    sendFormData.append('fileId', fileId)

    await axios.post('/auth/file', sendFormData, {headers: {'Cookie': cookie}})

    if ((await axiosPackage.get(`${testURL}/everything-deleted`)).data !== false) {
        throw 'No files exist in test server'
    }


    // Get file list

    const filesData = (await axios.get('/auth/files')).data

    if (filesData.storageBytesUsed !== 2**30) throw `Received incorrect storage bytes used. Expecting 1,073,741,824 but received ${filesData.storageBytesUsed}.`;
    if (filesData.files[0].filename !== 'test.lol') throw `Received incorrect file name. Expecting test.lol but received ${filesData.files[0].filename}.`;
    if (filesData.files[0].fileSize !== 2**30) throw `Received incorrect file size. Expecting 1,073,741,824 but received ${filesData.files[0].fileSize}`;

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

    // Delete test files

    await fsPromises.rm(testServerStorageFolder, {recursive: true, force: true, maxRetries: 100, retryDelay: 50})
    await fsPromises.rm(DCSServerTempLocation, {recursive: true, force: true, maxRetries: 100, retryDelay: 50})
}

test()