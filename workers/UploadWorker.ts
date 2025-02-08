import { workerData, parentPort } from "worker_threads";

import type { TextChannel } from "discord.js";

const {channel, folderPath, chunkNumber}: {channel: TextChannel, folderPath: string, chunkNumber: number} = workerData;

async function send() {
    const message = await channel.send({
        files: [{
            attachment: `${folderPath}/${chunkNumber}`,
            name: `${chunkNumber}`,
            description: 'A cool file'
        }]
    })

    parentPort.postMessage(message.id)
}

send();