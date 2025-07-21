## Discord Cloud Storage
This project was made for fun. It allows users to create their own accounts and upload/download/delete files in the cloud. This uses Discord to store files.

## How it works
Discord has a 10MB file size limit, but this project allows an unlimited file size. How this works is it splits every file up into 9.5MB chunks (to stay just below the 10MB limit), and then uploads each of these chunks. When downloading a file, the backend server downloads each of the file's chunks, stitches them together into one file, and then sends the file to the client.

## Security
Each file chunk is encrypted so Discord cannot read your data.

## Out of Scope Functionality
This project has a socket that handles file actions (uploads/downloads/deletions). Although multiple users can login to the same account, this project is not designed for 2 clients to be logged in to the same account at the same time. I could change this in the future, but for now it is only designed to have 1 client logged into one account at a time.

## Environment Variables

The **REQUIRED** environment variables used by this project are as follows:

```
dbURI=URI-HERE #Replace URI-HERE with a URI to a MongoDB database. The database is where the Discord message IDs are stored
encryptionAlgorithm=ALGO #Replace ALGO with an encryption algorithm that is supported by Node.js' crypto module
encryptionKey=KEY #Replace KEY with a random sequence of characters that will be used as the encryption key
discordBotToken=TOKEN #Replace TOKEN with your Discord Bot Token. You will get this from the Discord Developer Portal
discordChannelId=CHANNEL-ID #Replace CHANNEL-ID with your Discord Channel Id. This is where your file chunks will be uploaded to. Learn how to get that here: https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID
tempFileLocation=LOCATION #Replace LOCATION with the location of the folder you want the temp files to go into on your computer. Make sure this is a fresh folder, i.e only discord-cloud-storage will add/modify/delete/store files in this folder
cookieSecret=SECRET #Replace SECRET with a random sequence of characters that will be used as the secret for the browser cookies
```

The optional (but still important) environment variables used by this project are as follows:

```
NoHTTPS=BOOLEAN #Replace BOOLEAN with either true or false. If you do not want discord-cloud-storage to use SSL, set to true. If this is set to false or is unset, you must have the SSLFolderLocation environment variable set (see the next environment variable for information on this)
SSLFolderLocation=LOCATION #Replace LOCATION with the location for the SSL folder. This is only required if the NoHTTPS environment variable is set to false or is unset. If you are using SSL, this folder must have a private key file named private.key, a server certificate named server.crt, a root certificate called root.crt, and an intermediate certificate called intermediate.crt
port=PORT #Replace PORT with the port you want the Node.js server to run on (defaults to 25565 if unset or is not a number between and including 0 - 65535)
```

The following are **TESTING ONLY** environment variables. Please do not add these to your environment variables unless you know what you are doing. Leaving them unset is best:

```
discordURL=https://discord.com
```

## How To Run Locally (natively)

Make sure you have Node.js 19.0.0 or newer installed. ```discord-cloud-storage``` requires Node.js >= 19.0.0.

Create a file named .env in the root folder of this project. Read the *environment variables* section above for what to put in the .env file.

Once that is done, simply run the following command in the root folder of the project:

```
npm start
```

A server will be spun up on port 25565 by default, or if you set a port in the environment variables, then it'll be spun up on the specified port.

Go to http://localhost:25565 and create an account. Now start uploading files!
(Replace 25565 with whatever port you chose if you changed the port the server starts up on)

## How To Run Locally (with Docker Compose)

Create a file named docker-compose.yml in the root folder of this project. Below is an example docker-compose.yml file. Read the *environment variables* section above and change the variables in the **environment** section of the docker-compose.yml file to have the server run with your specifications. This example docker-compose.yml file also includes spinning up a MongoDB database for you so you do not have to worry about creating a database yourself.

```
services:
  server:
    image: 'sebastianweb/discord-cloud-storage'
    ports:
      - 3000:25565 #Change the 3000 to whatever port you want to access the frontend from. If you changed the port in the environment variables, change 25565 to whatever port you specified.
    depends_on:
      - messagedb
    environment:
        # The dbURI environment variable does not need to be changed. This will use the database that is automatically spun up in the Docker Compose file
      - dbURI=mongodb://messagedb:27017/datadb 
        # The rest of the environment variables need to be changed according to the **environment variables** section above
      - cookieSecret=SECRET
      - encryptionAlgorithm=ALGO
      - encryptionKey=KEY
      - discordBotToken=TOKEN
      - discordChannelId=CHANNEL-ID
      - NoHTTPS=BOOLEAN
      - tempFileFolderLocation=LOCATION #The folder location specified here will be the folder in the Docker container. This will NOT be on your computer
      - SSLFolderLocation=LOCATION #The folder location specified here will be the folder in the Docker container. This will NOT be on your computer
    volumes:
      - LOCATION-ONE:LOCATION-TWO #Replace LOCATION-ONE with the location for the SSL folder on your computer. Replace LOCATION-TWO with what you set for SSLFolderLocation, or delete this line if you left SSLFolderLocation unset and NoHTTPS is set to true. LOCATION-ONE is the location on your computer while LOCATION-TWO is the location within the Docker container
      - LOCATION-ONE:LOCATION-TWO #Replace LOCATION-ONE with the location for the temp file folder on your computer. Replace LOCATION-TWO with what you set for tempFileFolderLocation. LOCATION-ONE is the location on your computer while LOCATION-TWO is the location within the Docker container
    restart: always

  messagedb:
    image: 'mongo'
    expose:
      - "27017"
    volumes:
      - LOCATION:/data/db #Replace LOCATION with the location on your computer to store the MongoDB data directory.
    restart: always
```

Make sure Docker is running, and then inside the root folder of the project, run the following command:

```
docker compose up
```

Once Docker has downloaded the discord-cloud-storage image and MongoDB image and started up both containers, head to http://localhost:3000 (or if you changed the port 3000 in the docker-compose.yml file, replace 3000 with whatever port you chose to use).

Now create an account and you are ready to start uploading files!
