export const FileChunkSize = 9 * 1024 * 1024 //9MB - Discord limit is 10MB, so having each file 1MB less than the limit ensures the limit is never reached
export const authHeaders = {
    'Authorization': `Bot ${process.env.discordBotToken}`
}