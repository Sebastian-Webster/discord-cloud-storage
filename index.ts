/// <reference path="./types/index.d.ts" />

import mongoose from 'mongoose';
import express, {Request, Response} from 'express';
import UserLibrary from './libraries/User';
import cookieParser from 'cookie-parser';
import path from 'path';
import userController from './controllers/UserController';
import {Server} from 'socket.io';
import http from 'http';
import { handleSocketConnection, handleSocketDisconnect } from './socketHandler';

import { config } from 'dotenv';
import { validateSocketAuth } from './middleware/SocketAuth';
config()

const app = express();

const server = http.createServer(app)
const io = new Server(server)

app.use(cookieParser(process.env.cookieSecret))
app.use(express.json())

app.use('/auth', userController)

function sendMainHTML(req: Request, res: Response) {
    console.log(req.cookies)
    if ('auth' in req.cookies) {
        res.sendFile(path.resolve('public/index.html'))
    } else {
        res.redirect('/signin.html')
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
        return res.status(400).send(`username must be a string. Type provided: ${typeof username}`)
    }

    if (typeof password !== 'string') {
        return res.status(400).send(`password must be a string. Type provided: ${typeof password}`)
    }

    if (!/^[A-Za-z0-9]*$/.test(username)) {
        return res.status(400).send('username must only contain numbers and lowercase letters.')
    }

    if (password.length < 8) {
        return res.status(400).send('password must be more than 8 characters.')
    }

    const result = await UserLibrary.createUser(username, password);

    if (isObjectId(result)) {
        res.cookie('auth', result.toString(), {maxAge: oneYearMs}).status(200)
        res.send('Success')
    } else {
        res.status(result.status).json(result.data)
    }
})

app.post('/login', async (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    if (typeof username !== 'string') {
        return res.status(400).send(`username must be a string. Type provided: ${typeof username}`)
    }

    if (typeof password !== 'string') {
        return res.status(400).send(`password must be a string. Type provided: ${typeof password}`)
    }

    const result = await UserLibrary.signin(username, password);

    if (isObjectId(result)) {
        res.cookie('auth', result.toString(), {maxAge: oneYearMs})
        res.send('Success')
    } else {
        res.status(result.status).json(result.data)
    }
})

mongoose.connect(process.env.dbURI).then(() => {
    console.log('Successfully connected to database')
    server.listen(25565, () => {
        console.log('Successfully started listening on port 25565.')
    })
}).catch(error => {
    console.error('An error occurred:', error)
    process.exit(1)
})


io.use(validateSocketAuth);
io.on('connection', (socket) => {
    handleSocketConnection(socket)

    socket.on('disconnect', () => {
        handleSocketDisconnect(socket)
    })
})