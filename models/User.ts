import mongoose from "mongoose";

const userSchema = new mongoose.Schema<IUserSchema>({
    username: {
        type: String,
        unique: true,
        required: true
    },
    password: {
        type: String,
        required: true
    }
})

const UserModel = mongoose.model<IUserSchema>('User', userSchema);

export default UserModel;