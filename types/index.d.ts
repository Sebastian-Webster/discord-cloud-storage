import mongoose from 'mongoose';
import { CookieOptions } from 'express';

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            dbURI: string,
            cookieSecret: string,
            encryptionAlgorithm: string,
            encryptionKey: string,
            discordBotToken: string,
            discordChannelId: string
            tempFileFolderLocation: string,
            NoHTTPS?: undefined | "false" | "true",
            SSLFolderLocation?: string,
            discordURL: string
        }
    }
    
    interface IUserSchema {
        username: string,
        password: string
    }
    
    interface IUser extends IUserSchema {
        _id: mongoose.Types.ObjectId
    }
    
    interface IFileSchema {
        userId: mongoose.Types.ObjectId,
        messageIds: string[],
        fileName: string,
        dateCreated: number,
        fileSize: number
    }
    
    interface IFile extends IFileSchema {
        _id: mongoose.Types.ObjectId
    }
    
    interface IHTTPOK {
        status: 200,
        data?: {
            data: string | object | undefined
        }
    }
    
    interface IHTTPServerError {
        status: 500,
        data: {
            message: string
        }
    }
    
    interface IHTTPForbidden {
        status: 403,
        data: {
            message: string
        }
    }
    
    interface IHTTPNotFound {
        status: 404,
        data?: {
            message: string
        }
    }
    
    interface IHTTPBadInput {
        status: 400,
        data: {
            message: string
        }
    }
    
    type FileActionType = 'Upload' | 'Download' | 'Delete'
    
    type ISocketFileAction = {
        fileId: string,
        fileName: string,
        text: string,
        fileSize: number,
        actionType: FileActionType,
        currentChunk: number,
        chunkCount: number
    }
    
    type ISocketFileActions = ISocketFileAction[]

    interface HTTPCookie {
        name: string,
        val: string,
        cookieOptions?: CookieOptions
    }

    interface SendHTTPOptions {
        clearCookie?: string,
        setCookies?: HTTPCookie[]
    }

    type UploadWorkerEvent =
        | {event: 'READY' | 'FAILED_GETTING_READY', messageId?: never, chunkNumber?: never}
        | {event: 'MESSAGE_SENT', messageId: string, chunkNumber: number}
        | {event: 'FAILED_SENDING_MESSAGE', messageId?: never, chunkNumber: number}
}