import mongoose from "mongoose";

const fileSchema = new mongoose.Schema<IFileSchema>({
    userId: mongoose.Types.ObjectId,
    messageIds: Array,
    fileName: String,
    dateCreated: Number,
    fileSize: Number
})

const File = mongoose.model<IFileSchema>('File', fileSchema);

export default File;