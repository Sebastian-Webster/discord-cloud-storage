import { getURI } from './database';
import crypto from 'crypto';

async function main() {
    process.env.dbURI = await getURI();
    process.env.port = '0'
    process.env.encryptionAlgorithm = 'aes-256-ctr'
    process.env.encryptionKey = crypto.randomBytes(128).toString('hex')
    process.env.discordBotToken = 'token'
    process.env.discordChannelId = '1'
    process.env.cookieSecret = crypto.randomBytes(128).toString('hex')
    process.env.NoHTTPS = 'true'

    await import('./test')
}

main()