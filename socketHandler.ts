import { Socket } from "socket.io";

const socketMap = new Map<string, Socket>();
const fileActionMap = new Map<string, ISocketFileActions>();

export function handleSocketConnection(socket: Socket): void {
    const userId = socket.handshake.auth.userId

    console.log('Socket successfully connected')
    socketMap.set(userId, socket);

    const currentActions = fileActionMap.get(userId);
    if (currentActions) {
        socket.emit('initial-file-actions', currentActions)
    } else {
        fileActionMap.set(userId, [])
        socket.emit('initial-file-actions', [])
    }
}

export function handleSocketDisconnect(socket: Socket): void {
    const userId = socket.handshake.auth.userId;

    socketMap.delete(userId)
}

function emitFileAction(userId: string, action: ISocketFileAction): void {
    const socket = socketMap.get(userId);

    socket?.emit('file-action', action);
}

export function startFileAction(userId: string, fileId: string, fileName: string, fileSize: number, text: string, actionType: FileActionType, currentChunk: number, chunkCount: number): void {
    const fileActions = fileActionMap.get(userId);

    const action = {
        fileId,
        fileName,
        fileSize,
        text,
        actionType,
        currentChunk,
        chunkCount
    }

    if (fileActions === undefined) {
        fileActionMap.set(userId, [action])
    } else {
        fileActions.push(action)
    }

    emitFileAction(userId, action);
}

export function setFileActionText(userId: string, fileId: string, text: string, currentChunk: number, chunkCount: number): void {
    const fileActions = fileActionMap.get(userId);

    const action = fileActions.find(action => action.fileId === fileId)

    if (action) {
        action.text = text;
        action.currentChunk = currentChunk;
        action.chunkCount = chunkCount;

        emitFileAction(userId, action);
    }
}

export function removeFileAction(userId: string, fileId: string, error: boolean): void {
    console.log('Removing file action...')

    const fileActions = fileActionMap.get(userId) || [];

    const index = fileActions.findIndex(action => action.fileId === fileId);

    if (index !== -1) {
        const deleted = fileActions.splice(index, 1)[0];

        const toSend = {...deleted, error};

        if (fileActions.length === 0) {
            fileActionMap.delete(userId);
        }

        const socket = socketMap.get(userId);
    
        socket?.emit('remove-file-action', toSend);
    }
}

export function fileActionAlreadyOccurring(userId: string, fileId: string): boolean {
    const fileActions = fileActionMap.get(userId);

    if (!fileActions) return false;

    const actionIndex = fileActions.findIndex(action => action.fileId === fileId);

    return actionIndex !== -1;
}