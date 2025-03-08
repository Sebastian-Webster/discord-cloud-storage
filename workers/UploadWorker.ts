import { Client, TextChannel } from "discord.js";
import { parentPort, workerData } from "worker_threads";

let {folderPath}: {folderPath: string} = workerData;

let client: Client<true>
let channel: TextChannel

function promisifiedClientConnect(): Promise<Client<true>> {
    return new Promise((resolve, reject) => {
        const client = new Client({intents: []});
        client.on('error', reject)
        client.on('ready', resolve)
        client.login(process.env.discordBotToken).catch(reject)
    })
}

async function getReady(): Promise<void> {
    try {
        client = await promisifiedClientConnect();
        channel = await client.channels.fetch(process.env.discordChannelId) as TextChannel;
        parentPort.postMessage({event: 'READY'})
    } catch (e) {
        console.error('An error occurred while getting worker thread ready:', e)
        parentPort.postMessage({event: 'FAILED_GETTING_READY'})
    }
}

getReady();

parentPort.on('message', (chunkNumber: number) => {
    channel.send({
        files: [{
            attachment: `${folderPath}/${chunkNumber}`,
            name: `${chunkNumber}`,
            description: 'A cool file'
        }]
    }).then(message => {
        parentPort.postMessage({event: 'MESSAGE_SENT', messageId: message.id})
    }).catch(error => {
        console.error('An error occurred while sending message:', error)
        parentPort.postMessage({event: 'FAILED_SENDING_MESSAGE', chunkNumber})
    })
})