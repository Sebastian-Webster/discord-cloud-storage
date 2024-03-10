import { Client, GatewayIntentBits, Message, TextChannel } from "discord.js";
import { startFileAction, setFileActionText, removeFileAction } from "../socketHandler";
import mongoose from "mongoose";

function promiseFactory(messageId: string, channel: TextChannel): Promise<void> {
    return new Promise(async (resolve, reject) => {
        let message: Message;

        try {
            message = await channel.messages.fetch(messageId);
        } catch (error) {
            console.error('An error occurred while finding message with id:', messageId, '. The error was:', error)
            reject(error)
        }

        try {
            await message.delete();
        } catch (error) {
            console.error('An error occurred while deleting message with id:', messageId, '. The error was:', error)
            reject(error)
        }

        resolve();
    })
}

export function DeleteFile(userId: mongoose.Types.ObjectId, fileId: string, fileName: string, fileSize: number, messageIds: string[]): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const messagesToDelete = messageIds.length;
        const maxConcurrentPromises = 10;
        let promisesRunning = 0;
        let errorOccurred = false;
        let channel: TextChannel;
        let messagesDeleted = 0;

        const client = new Client({intents: [GatewayIntentBits.MessageContent]});

        startFileAction(String(userId), fileId, fileName, fileSize, 'Logging into Discord client...', 'Delete', -1, -1);

        console.log('Deleting file...')

        try {
            await client.login(process.env.discordBotToken);
        } catch (error) {
            console.error('An error occurred while logging into Discord client:', error)
            removeFileAction(String(userId), fileId, true)
            reject(error)
        }

        console.log('Successfully logged in to Discord client to delete file')

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
            promiseFactory(messageId, channel).then(() => handleFinishedDeletion()).catch((error) => {
                errorOccurred = true;
                removeFileAction(String(userId), fileId, true);
                reject(error);
            })
        }

        client.on('ready', async () => {
            try {
                setFileActionText(String(userId), fileId, 'Fetching Discord channel...', -1, -1);
                channel = await client.channels.fetch(process.env.discordChannelId) as TextChannel;
                console.log('Client is ready for file deletion')
            } catch (error) {
                console.error('An error occurred while fetching Discord channel:', error)
                removeFileAction(String(userId), fileId, true);
                reject(error);
            }

            setFileActionText(String(userId), fileId, `Deleted chunk 0/${messagesToDelete}`, 0, messagesToDelete);

            for (const messageId of messageIds.splice(0, maxConcurrentPromises)) {
                startPromiseExecution(messageId)
            }
        })

        client.on('error', (error) => {
            console.error('Discord client encountered an error:', error);
            removeFileAction(String(userId), fileId, true);
            reject(error)
        })
    })
}