/// <reference path="./types/index.d.ts" />

const timeoutTime = 24 * 60 * 60 * 1000; //1 day in millseconds

import mongoose from 'mongoose';
import express, {Request, Response} from 'express';
import UserLibrary from './libraries/User';
import cookieParser from 'cookie-parser';
import path from 'path';
import userController from './controllers/UserController';
import {Server} from 'socket.io';
import http from 'http';
import https from 'https';
import { handleSocketConnection, handleSocketDisconnect } from './socketHandler';
import fs from 'fs';
import { config } from 'dotenv';

import { validateSocketAuth } from './middleware/SocketAuth';
import HTTP from './libraries/HTTP';
import { verifyEnvVarCorrectness } from './envChecks';
config()

const app = express();

let server: http.Server | https.Server;

verifyEnvVarCorrectness()

if (process.env.NoHTTPS === 'true') {
    server = http.createServer(app)
} else {
    const SSLFolderLocation = process.env.SSLFolderLocation
    const options = {
        key: fs.readFileSync(`${SSLFolderLocation}/private.key`),
        cert: fs.readFileSync(`${SSLFolderLocation}/server.crt`),
        ca: [
            fs.readFileSync(`${SSLFolderLocation}/intermediate.crt`),
            fs.readFileSync(`${SSLFolderLocation}/root.crt`)
        ]
    };
    
    server = https.createServer(options, app)
}

server.timeout = timeoutTime;
server.headersTimeout = timeoutTime;

const io = new Server(server)

app.use(cookieParser(process.env.cookieSecret))
app.use(express.json())

app.use('/auth', userController)

function sendMainHTML(req: Request, res: Response) {
    console.log(req.cookies)
    if ('auth' in req.cookies) {
        HTTP.SendFile(req, res, path.resolve('public/index.html'))
    } else {
        HTTP.redirect(req, res, '/signin.html')
    }
}

app.all('/', sendMainHTML)
app.all('/index.html', sendMainHTML)

app.use(express.static('public'))

function isObjectId(arg: any): arg is mongoose.Types.ObjectId {
    return mongoose.isObjectIdOrHexString(arg)
}

const oneYearMs = 1000 * 60 * 60 * 24 * 365

app.post('/signup', async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    
    if (typeof username !== 'string') {
        return HTTP.SendHTTP(req, res, 400, `username must be a string. Type provided: ${typeof username}`)
    }
    
    if (typeof password !== 'string') {
        return HTTP.SendHTTP(req, res, 400, `password must be a string. Type provided: ${typeof password}`)
    }
    
    if (!/^[A-Za-z0-9]*$/.test(username)) {
        return HTTP.SendHTTP(req, res, 400, 'username must only contain numbers and lowercase letters.')
    }
    
    if (password.length < 8) {
        return HTTP.SendHTTP(req, res, 400, 'password must be more than 8 characters.')
    }
    
    const result = await UserLibrary.createUser(username, password);
    
    if (isObjectId(result)) {
        const options: SendHTTPOptions = {
            setCookies: [
                {
                    name: 'auth',
                    val: result.toString(),
                    cookieOptions: {
                        maxAge: oneYearMs
                    }
                }
            ]
        }
        HTTP.SendHTTP(req, res, 200, 'Success', options);
    } else {
        HTTP.SendHTTP(req, res, result.status, result.data)
    }
})

app.post('/login', async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    
    if (typeof username !== 'string') {
        return HTTP.SendHTTP(req, res, 400, `username must be a string. Type provided: ${typeof username}`);
    }
    
    if (typeof password !== 'string') {
        return HTTP.SendHTTP(req, res, 400, `password must be a string. Type provided: ${typeof password}`);
    }
    
    const result = await UserLibrary.signin(username, password);
    
    if (isObjectId(result)) {
        const options: SendHTTPOptions = {
            setCookies: [
                {
                    name: 'auth',
                    val: result.toString(),
                    cookieOptions: {
                        maxAge: oneYearMs
                    }
                }
            ]
        }
        HTTP.SendHTTP(req, res, 200, 'Success', options)
    } else {
        HTTP.SendHTTP(req, res, result.status, result.data)
    }
})


io.use(validateSocketAuth);
io.on('connection', (socket) => {
    handleSocketConnection(socket)
    
    socket.on('disconnect', () => {
        handleSocketDisconnect(socket)
    })
})

setInterval(() => {
    console.time('Calculating memory usage')
    console.log('Server memory usage:', process.memoryUsage())
    console.timeEnd('Calculating memory usage')
}, 60 * 2 * 1000).unref(); // Every 2 minutes

export default new Promise<http.Server | https.Server>((resolve, reject) => {
    mongoose.connect(process.env.dbURI).then(() => {
        console.log('Successfully connected to database')
        server.listen(process.env.port, () => {
            console.log(`Successfully started listening on ${server.address()}`)
            resolve(server)
        })
    }).catch(error => {
        console.error('An error occurred:', error)
        reject(error)
        process.exit(1)
    })
})