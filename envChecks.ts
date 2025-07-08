function t(message: string): void {
    throw `SERVER STARTUP FAILED. REASON: ${message}`
}

export function verifyEnvVarCorrectness(): void {
    const dbURI = process.env.dbURI
    const encryptionAlgorithm = process.env.encryptionAlgorithm
    const encryptionKey = process.env.encryptionKey
    const botToken = process.env.discordBotToken
    const channelId = process.env.discordChannelId
    const NoHTTPS = process.env.NoHTTPS
    const tempLocation = process.env.tempFileFolderLocation
    const SSLLocation = process.env.SSLFolderLocation

    if (typeof dbURI !== 'string' || String(dbURI).length === 0) {
        t('The dbURI environment variable must be set and must be a string that is not empty.')
    }

    if (typeof encryptionAlgorithm !== 'string' || String(encryptionAlgorithm).length === 0) {
        t('The encryptionAlgorithm environment variable must be set and must be a string that is not empty.')
    }

    if (typeof encryptionKey !== 'string' || String(encryptionKey).length === 0) {
        t('The encryptionKey environment variable must be set and must be a string that is not empty.')
    }

    if (typeof botToken !== 'string' || String(botToken).length === 0) {
        t('The discordBotToken environment variable must be set and must be a string that is not empty.')
    }

    if (typeof channelId !== 'string' || String(channelId).length === 0) {
        t('The discordChannelId environment variable must be set and must be a string that is not empty.')
    }

    if (typeof NoHTTPS !== 'undefined' && NoHTTPS !== 'false' && NoHTTPS !== 'true') {
        t('The NoHTTPS environment variable must either be unset, or set to "false" or "true".')
    }

    if (typeof tempLocation !== 'string' && String(tempLocation).length === 0) {
        t('The tempFileFolderLocation environment variable must be set and must be a string that is not empty.')
    }

    if (NoHTTPS !== 'true' && (typeof SSLLocation !== 'string' || String(SSLLocation).length === 0)) {
        t('NoHTTPS is not set to true and an SSLFolderLocation environment variable has not been set. Either unset NoHTTPS or set it to "false", or make SSLFolderLocation a non-empty string.')
    }
}