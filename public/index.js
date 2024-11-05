function getParsedCookies() {
    const cookie = document.cookie;
    const splitCookies = cookie.split(';');
    const cookies = {};
    for (const cookie of splitCookies) {
        const splitCookie = cookie.split('=');
        const key = splitCookie[0];
        const value = splitCookie[1];

        cookies[key] = value;
    }
    return cookies;
}

let fileActionsShowing = false;
const fileActions = document.getElementById('action-progress');
const fileActionContainer = document.getElementById('action-progress-items-container');
const fileList = document.getElementById('files-list')
const fileTemplate = document.getElementById('file-template');
const fileActionErrorTemplate = document.getElementById('file-action-error-template');
const lostConnectionDiv = document.getElementById('lost-connection');
const socketReconnectButton = document.getElementById('socket-reconnect');
const pulsatingAnimation = 'pulsating 1.5s infinite';
const fileContextScreenBlocker = document.getElementById('file-context-screen-blocker');
const fileShareTemplate = document.getElementById('file-share-template');
const fileShareUserTemplate = document.getElementById('file-share-user-template');

function showFileActions() {
    if (fileActionsShowing === false) {
        fileActionsShowing = true;

        fileActions.classList.remove('invisible');
    }
}

function hideFileActions() {
    fileActionsShowing = false;

    fileActions.classList.add('invisible')
}

function removeFileActionFromList(id) {
    document.getElementById(`file-action-${id}`)?.remove();

    if (fileActionContainer.childElementCount === 0) {
        hideFileActions()
    }
}

axios.interceptors.response.use(response => {
    return response
}, (error) => {
    const redirect = error?.response?.data?.redirect;
    if (redirect) {
        window.location.href = redirect;
    }
    return Promise.reject(error)
})

const socket = io({
    auth: {
        userId: getParsedCookies().auth
    }
});

socket.on('connect', () => {
    console.log('Socket connected')
    hideLostConnection()
})

socket.on('disconnect', (reason) => {
    console.log('Socket disconnected for reason:', reason)
    showLostConnection();
})

socket.on('connect_error', (errorObj) => {
    console.error('An error occurred while connecting to socket:', errorObj)
    showLostConnection();
})

function createActionDiv(action) {
    const actionDiv = document.getElementById('file-action-template').content.cloneNode(true);
    actionDiv.querySelector('.file-action-filename').textContent = action.fileName;
    actionDiv.querySelector('.file-action-item').id = `file-action-${action.fileId}`;
    actionDiv.querySelector('.progress-bar-text').textContent = action.text;

    const progressBar = actionDiv.querySelector('.progress-bar');
    if (action.currentChunk === -1 && action.chunkCount === -1) {
        progressBar.style.animation = pulsatingAnimation;
        progressBar.style.width = '100%'
    } else {
        progressBar.style.animation = 'none';
        progressBar.style.width = `${action.currentChunk / action.chunkCount * 100}%`;
    }

    showFileActions();
    fileActionContainer.appendChild(actionDiv);
}

function removeChildrenFromElement(element) {
    while (element?.firstElementChild) {
        element.lastElementChild.remove()
    }
}

socket.on('initial-file-actions', (fileActions) => {
    console.log('Initial file actions:', fileActions)
    removeChildrenFromElement(fileActionContainer)
    if (fileActions.length > 0) {
        showFileActions()

        for (const action of fileActions) {
            createActionDiv(action)
        }
    } else {
        hideFileActions();
    }
})

socket.on('file-action', (action) => {
    console.log('Action received:', action)
    const actionDiv = document.getElementById(`file-action-${action.fileId}`)

    if (actionDiv) {
        const progressBar = actionDiv.querySelector('.progress-bar');
        actionDiv.querySelector('.progress-bar-text').textContent = action.text;
        progressBar.style.width = `${action.currentChunk / action.chunkCount * 100}%`

        if (action.currentChunk === -1 && action.chunkCount === -1) {
            progressBar.style.animation = pulsatingAnimation;
        } else {
            progressBar.style.animation = 'none';
        }

        return
    }

    createActionDiv(action);
})

function createBeforeFilesContainer() {
    const beforeContainer = document.getElementById('before-files-container');
    if (beforeContainer) beforeContainer.remove();

    const beforeFilesContainer = document.createElement('div');
    beforeFilesContainer.id = 'before-files-container';
    document.querySelector('main').appendChild(beforeFilesContainer);
    return beforeFilesContainer;
}

function changeFileActionToError(fileId) {
    const fileAction = document.getElementById(`file-action-${fileId}`)
    fileAction.querySelector('.file-action-container').remove();

    const errorItem = document.getElementById('file-action-error-template').content.cloneNode(true);
    errorItem.id = `file-action-${fileId}`
    errorItem.querySelector('.file-action-error-ok-text').setAttribute('onclick', `removeFileActionFromList('${fileId}')`)

    fileAction.appendChild(errorItem)
}

socket.on('remove-file-action', (data) => {
    console.log('Removed file action:', data)
    if (data.error) {
        changeFileActionToError(data.fileId)
        return
    }

    if (data.actionType === 'Upload') {
        getFiles()
    } else if (data.actionType === 'Delete') {
        document.getElementById(`file-${data.fileId}`).remove()
        if (document.getElementById('files-list').childElementCount === 0) {
            const container = createBeforeFilesContainer();

            const text = document.createElement('h1')
            text.textContent =  'No files. Press the + button to upload something!'

            container.appendChild(text);
        }
    }

    removeFileActionFromList(data.fileId)
})

function toggleFileActionView() {
    const caret = document.getElementById('action-progress-caret');

    console.log(caret.textContent)

    const up = '\uE607';
    const down = '\uE606';

    if (caret.textContent === up) {
        caret.textContent = down;
        fileActionContainer.style.display = 'block';
        caret.style.marginBottom = '0px';
        caret.style.marginTop = '-7px';
        return
    }

    caret.textContent = up;
    caret.style.marginBottom = '-7px';
    caret.style.marginTop = '0px';
    fileActionContainer.style.display = 'none';
}

function onUploadProgress(fileId) {
    const fileActionDiv = document.getElementById(`file-action-${fileId}`);
    const progressBar = fileActionDiv.querySelector('.progress-bar');
    const progressBarText = fileActionDiv.querySelector('.progress-bar-text');

    return function(progressEvent) {
        if (progressEvent.progress === 1) {
            progressBarText.textContent = 'Waiting for server...';
            progressBar.style.width = '100%';
            progressBar.style.animation = pulsatingAnimation;
            return
        }
    
        console.log(progressEvent);
        progressBar.style.width = `${progressEvent.progress * 100}%`;
        progressBar.style.animation = 'none'
        progressBarText.textContent = `${(progressEvent.progress * 100).toFixed(1)}% uploaded...`
    }
}

document.getElementById('file-upload').addEventListener('change', uploadFile);
function uploadFile(e) {
    e.preventDefault();

    const formData = new FormData();

    const fileId = crypto.randomUUID()

    formData.append('file', e.target.files[0])
    formData.append('fileId', fileId)

    createFileAction(fileId, e.target.files[0].name, 'Starting upload...')

    document.getElementById('file-upload-form').reset();

    axios.post('/auth/file', formData, {onUploadProgress: onUploadProgress(fileId)}).catch(error => {
        console.error(error)
        changeFileActionToError(fileId)
    })
}

const byteArray = ['B', 'KB', 'MB', "GB", 'TB', 'PB', 'EB', 'ZB', 'YB', 'BB', 'GEB']

function SizeCalculator(bytes) {
    let byteIndex = 0;
    do {
        if (bytes < 1000) {
            break
        }

        bytes /= 1000;
        byteIndex++;
    } while (bytes >= 1000)

    return `${parseFloat(bytes.toFixed(2))}${byteArray[byteIndex]}`
}

function createFile(file) {
    //Would be _id if getting it from GET /auth/files API
    //Would be fileId if getting it from fileAction Socket
    const fileId = file.fileId || file._id

    const beforeFilesContainer = document.getElementById('before-files-container');

    if (beforeFilesContainer) {
        beforeFilesContainer.remove();
    }

    const fileElement = fileTemplate.content.cloneNode(true)
    fileElement.querySelector('.file').id = `file-${fileId}`
    fileElement.querySelector('.file-filename').textContent = file.fileName;
    fileElement.querySelector('.file-filesize').textContent = SizeCalculator(file.fileSize);
    fileElement.querySelector('.file-context-button').setAttribute('onclick', `openContextMenu('${fileId}', '${file.fileName}')`)

    fileList.appendChild(fileElement)
}

function openContextMenu(fileId, fileName) {
    document.querySelector('.file-context-menu')?.remove();
    fileContextScreenBlocker.style.display = 'block';

    const boundingRect = document.getElementById(`file-${fileId}`).querySelector('div').getBoundingClientRect()
    console.log(boundingRect);
    const box = document.getElementById('file-menu-template').content.cloneNode(true);
    const div = box.querySelector('.file-context-menu');
    div.querySelector('.file-delete-button').setAttribute('onclick', `deleteFile('${fileId}', '${fileName}')`)
    div.querySelector('.file-download-button').setAttribute('onclick', `downloadFile('${fileId}', '${fileName}')`)
    div.querySelector('.file-share-button').setAttribute('onclick', `openShareBox('${fileId}', '${fileName}')`)
    div.style.top = `${boundingRect.top}px`;
    div.style.left = `${boundingRect.right}px`;
    document.body.append(box)
}

function closeFileContextMenu() {
    document.querySelector('.file-context-menu')?.remove();
    fileContextScreenBlocker.style.display = 'none';
}

function retryGettingFiles() {
    changeFilesLoadingContainerContent(false);
    getFiles();
}

function changeFilesLoadingContainerContent(error) {
    const container = createBeforeFilesContainer();

    const text = document.createElement('h1');

    if (error) {
        text.textContent = `An error occurred while loading files.`
        text.classList.add('error');
        const tryAgain = document.createElement('h2');
        tryAgain.textContent = 'Try Again'
        tryAgain.setAttribute('onclick', 'retryGettingFiles()')
        tryAgain.style.color = 'var(--link-color)';
        tryAgain.style.cursor = 'pointer';
        container.appendChild(text);
        container.appendChild(tryAgain);
    } else {
        const text = document.createElement('h1');
        text.textContent = 'Loading files...';
        container.appendChild(text)
    }
}

function getFiles() {
    axios.get('/auth/files').then(response => {
        const data = response.data;
        console.log(data);

        if (data.files.length === 0) {
            const container = createBeforeFilesContainer();

            document.getElementById('storage-usage').textContent = 'None'

            const text = document.createElement('h1');
            text.textContent = 'No files. Press the + button to upload something!'
            container.appendChild(text);
            return
        }

        document.getElementById('before-files-container')?.remove();

        removeChildrenFromElement(document.getElementById('files-list'));

        document.getElementById('storage-usage').textContent = SizeCalculator(data.storageBytesUsed);

        for (const file of data.files) {
            createFile(file)
        }
    }).catch(error => {
        console.error(error)
        changeFilesLoadingContainerContent(true)
    })
}
getFiles()

function createFileAction(fileId, filename, progressBarText) {
    showFileActions();
    
    const actionDiv = document.getElementById('file-action-template').content.cloneNode(true);
    actionDiv.querySelector('.file-action-filename').textContent = filename;
    actionDiv.querySelector('.file-action-item').id = `file-action-${fileId}`;
    actionDiv.querySelector('.progress-bar-text').textContent = progressBarText;

    const progressBar = actionDiv.querySelector('.progress-bar');
    progressBar.style.width = '100%';
    progressBar.style.animation = pulsatingAnimation;

    fileActionContainer.appendChild(actionDiv);
}

function deleteFile(fileId, fileName) {
    if (document.getElementById(`file-action-${fileId}`)) return

    closeFileContextMenu()

    createFileAction(fileId, fileName, 'Waiting for server...')
    axios.delete(`/auth/file/${fileId}`).catch(error => {
        console.error(error)
        changeFileActionToError(fileId)
    })
}

function downloadFile(fileId, fileName) {
    if (document.getElementById(`file-action-${fileId}`)) return
    
    closeFileContextMenu()
    
    createFileAction(fileId, fileName, 'Waiting for server...')
    axios.get(`/auth/file/${fileId}`, {responseType: 'blob'}).then(response => {
        const href = URL.createObjectURL(response.data);
        const a = document.createElement('a');
        a.href = href;
        a.setAttribute('download', fileName);
        a.click();
        a.remove();
        URL.revokeObjectURL(href)
    }).catch(error => {
        console.error('Error downloading file:', error)
        changeFileActionToError(fileId)
    })
}

function openShareBox(fileId, fileName) {
    closeFileContextMenu()
    const fileShareContainer = fileShareTemplate.content.cloneNode(true);
    fileShareContainer.getElementById('file-share-file-name').textContent = fileName;
    document.body.appendChild(fileShareContainer)

    getSharedWith(fileId);
}

function getSharedWith(fileId) {
    const container = document.getElementById('file-share-file-shared-with-container')

    axios.get(`/auth/file/sharedwith/${fileId}`).then(response => {
        const sharedWith = response.data;

        if (!Array.isArray(sharedWith)) {
            container.style.overflowX = 'hidden';
            container.style.overflowY = 'auto';
            container.innerHTML = '<b style="text-align: center; color: red">sharedWith is not an array. This is an error.</b>';
        } else if (sharedWith.length === 0) {
            container.style.overflowX = 'hidden';
            container.style.overflowY = 'auto';
            container.innerHTML = '<b style="text-align: center">This has file been shared with no one.</b>'
        } else {
            container.innerHTML = '';
            container.style.justifyContent = 'flex-start';
            for (const user of sharedWith) {
                const userItem = fileShareUserTemplate.content.cloneNode(true);
                const userContainer = userItem.querySelector('.file-share-user');
                const id = `file-share-user-second-id-${user.secondId}`;

                userContainer.id = id;
                userContainer.querySelector('.file-share-user-x').setAttribute('onclick', `document.getElementById(${id}).remove()`);
                userContainer.querySelector('.file-share-user-username').textContent = user.username;
                container.appendChild(userContainer);
            }
        }
    }).catch(error => {
        console.error('An error occurred while getting users that this file is shared with. The error was:', error)
        container.style.overflowX = 'hidden';
        container.style.overflowY = 'auto';
        container.innerHTML = `<b style="text-align: center; color: red;">${error?.response?.data || 'An error occurred. Please check the browser console for details.'}</b>`
    })
}

function closeShareBox() {
    document.getElementById('file-share-outer-container').remove()
}

function changeSocketReconnectText(reconnecting) {
    const text = reconnecting ? 'Reconnecting...' : 'Try Reconnecting';
    socketReconnectButton.textContent = text;
    
    if (reconnecting) {
        socketReconnectButton.classList.add('reconnecting')
    } else {
        socketReconnectButton.classList.remove('reconnecting')
    }
}

function manualSocketConnect() {
    changeSocketReconnectText(true)
    socket.connect();
}

function showLostConnection() {
    lostConnectionDiv.classList.remove('invisible');

    changeSocketReconnectText(false)
}

function hideLostConnection() {
    lostConnectionDiv.classList.add('invisible');
}