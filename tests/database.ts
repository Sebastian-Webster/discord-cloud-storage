import { MongoMemoryServer } from "mongodb-memory-server";

let db: MongoMemoryServer;

export async function getURI(): Promise<string> {
    if (!db) {
        db = await MongoMemoryServer.create();
        return db.getUri();
    }

    return db.getUri();
}

export async function stopDB() {
    if (db) {
        await db.stop();
        db = undefined;
    }
}