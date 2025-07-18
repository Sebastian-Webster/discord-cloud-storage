import { startFileAction, setFileActionText, removeFileAction } from "../socketHandler";
import mongoose from "mongoose";
import axios from "axios";

const authHeaders = {
    'Authorization': `Bot ${process.env.discordBotToken}`
}

function promiseFactory(messageId: string): Promise<void> {
    return new Promise((resolve, reject) => {
        axios.delete(`https://discord.com/api/v10/channels/${process.env.discordChannelId}/messages/${messageId}`, {
            headers: authHeaders
        }).then(response => {
            if (response.status !== 204) {
                reject( `Status code is not 204 as expected. Received status code ${response.status}.`)
                return
            }
            resolve()
        }).catch(error => {
            const retry = error?.response?.data?.retry_after
            // If we have been rate limited, retry after the set amount of time
            if (typeof retry === 'number') {
                console.log('Waiting', retry, 'seconds before deleting next message.')
                setTimeout(() => {
                    reject('Rate limited.')
                }, retry * 1000);
            } else {
                reject(error)
            }
        })
    })
    
}

export function DeleteFile(userId: mongoose.Types.ObjectId, fileId: string, fileName: string, fileSize: number, messageIds: string[]): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const messagesToDelete = messageIds.length;
        const maxConcurrentPromises = 2;
        const maxDeletionRetries = messageIds.length * 5;
        let promisesRunning = 0;
        let errorOccurred = false;
        let messagesDeleted = 0;
        let deletionRetries = 0;

        startFileAction(String(userId), fileId, fileName, fileSize, `Deleted chunk 0/${messagesToDelete}`, 'Delete', 0, messagesToDelete);

        for (const messageId of messageIds.splice(0, maxConcurrentPromises)) {
            startPromiseExecution(messageId)
        }

        console.log('Deleting file...')

        function handleFinishedDeletion() {
            promisesRunning--;
            console.log('Completed message deletion')

            if (errorOccurred) return

            messagesDeleted++

            setFileActionText(String(userId), fileId, `Deleted chunks ${messagesDeleted}/${messagesToDelete}`, messagesDeleted, messagesToDelete);

            if (messageIds.length > 0) {
                return startPromiseExecution(messageIds.splice(0, 1)[0])
            }

            if (promisesRunning !== 0) return

            removeFileAction(String(userId), fileId, false);
            resolve()
        }

        function startPromiseExecution(messageId: string) {
            promisesRunning++;
            
            promiseFactory(messageId).then(() => handleFinishedDeletion()).catch((error) => {
                deletionRetries++
                promisesRunning--

                console.error(`Error caught from deletion promiseFactory. Max deletion retries: ${maxDeletionRetries}. Deletion retries so far: ${deletionRetries}`)
                if (deletionRetries++ <= maxDeletionRetries) {
                    startPromiseExecution(messageId)
                } else {
                    errorOccurred = true;
                    removeFileAction(String(userId), fileId, true);
                    reject(error);
                }
            })
        }
    })
}