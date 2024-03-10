import mongoose from "mongoose";
import { Socket } from "socket.io";
import { ExtendedError } from "socket.io/dist/namespace";

export function validateSocketAuth(socket: Socket, next: (err?: ExtendedError) => void) {
    const userId = socket.handshake.auth.userId;

    if (!mongoose.isObjectIdOrHexString(userId)) {
        console.log('Disconnecting due to invalid auth:', userId)
        next(new Error('userId must be an ObjectId.'))
    }

    next()
}