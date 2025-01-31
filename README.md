## Discord Cloud Storage
This project was made for fun. It allows users to create their own accounts and upload/download/delete files in the cloud. This uses Discord to store files.

## How it works
Discord has a 10MB file size limit, but this project allows an unlimited file size. How this works is it splits every file up into 9.5MB chunks (to stay just below the 25MB limit), and then uploads each of these chunks. When downloading a file, the backend server downloads each of the file's chunks, stitches them together into one file, and then sends the file to the client.

## Security
Each file chunk is encrypted so Discord cannot read your data.

## Out of Scope Functionality
This project has a socket that handles file actions (uploads/downloads/deletions). Although multiple users can login to the same account, this project is not designed for 2 clients to be logged in to the same account at the same time. I could change this in the future, but for now it is only designed to have 1 client logged into one account at a time.

## Extra Notes
This repository intentionally has no instructions on how to get this up and running for yourself to prevent misuse. This was made for fun. If you do get this up and running, do not store important data as Discord may delete it at any time.