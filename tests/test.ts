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
        baseURL: realServerURL
    })

    // Signup

    await axios.post('/signup', {username: 'test', password: 'testingapp'})

    console.log('Signed up')

    // Login

    const cookie = (await axios.post('/login', {username: 'test', password: 'testingapp'})).headers['set-cookie'][0]

    console.log('Logged in')

    // Uploading file

    const sendingBytes = crypto.randomBytes(2**30);

    const sendFormData = new FormData();
    sendFormData.append('file', new Blob([sendingBytes]), 'test.lol')
    sendFormData.append('fileId', crypto.randomUUID())

    const fileId = (await axios.post('/auth/file', sendFormData, {headers: {'Cookie': cookie}})).data

    console.log('Uploaded file')

    if ((await axiosPackage.get(`${testURL}/everything-deleted`)).data !== false) {
        throw 'No files exist in test server'
    }


    // Get file list

    const filesData = (await axios.get('/auth/files', {headers: {'Cookie': cookie}})).data

    if (filesData.storageBytesUsed !== 2**30) throw `Received incorrect storage bytes used. Expecting 1,073,741,824 but received ${filesData.storageBytesUsed}.`;
    if (filesData.files[0].fileName !== 'test.lol') throw `Received incorrect file name. Expecting test.lol but received ${filesData.files[0].filename}.`;
    if (filesData.files[0].fileSize !== 2**30) throw `Received incorrect file size. Expecting 1,073,741,824 but received ${filesData.files[0].fileSize}`;

    console.log('Found files')

    // Download file

    const receivedArrayBuffer = (await axios.get(`/auth/file/${fileId}`, {responseType: 'arraybuffer', maxContentLength: 2**40, headers: {'Cookie': cookie}})).data
    const receivedBuffer = Buffer.from(receivedArrayBuffer)

    console.log('Downloaded file')

    if (Buffer.compare(sendingBytes, receivedBuffer) !== 0) throw 'Buffers uploaded and downloaded are not the same.';

    // Delete file

    await axios.delete(`/auth/file/${fileId}`, {headers: {'Cookie': cookie}})

    if ((await axiosPackage.get(`${testURL}/everything-deleted`)).data === false) throw 'Not all messages were deleted.';
    
    console.log('Deleted file')

    // Get now empty file list

    const emptyFilesData = (await axios.get('/auth/files', {headers: {'Cookie': cookie}})).data
    const emptyFilesKeys = Object.keys(emptyFilesData)

    if (emptyFilesKeys.length !== 1 || emptyFilesKeys[0] !== 'files' || !Array.isArray(emptyFilesData.files) || emptyFilesData.files.length !== 0) throw `Received incorrect files data. Expecting empty data. Received: ${JSON.stringify(emptyFilesData)}`

    console.log('Successfully got empty files list')

    // Delete test files

    await fsPromises.rm(testServerStorageFolder, {recursive: true, force: true, maxRetries: 100, retryDelay: 50})
    await fsPromises.rm(DCSServerTempLocation, {recursive: true, force: true, maxRetries: 100, retryDelay: 50})

    console.log('Test is complete')
}

test()