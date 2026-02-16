import bcrypt from 'bcrypt';
import User from '../models/User';
import HTTP from './HTTP';
import mongoose from 'mongoose';
import {randomUUID} from 'crypto';

export default class UserLibrary {
    static async signin(username: string, password: string): Promise<mongoose.Types.ObjectId | IHTTPForbidden | IHTTPServerError | IHTTPNotFound> {
        let user: IUser | null;
    
        try {
            user = await User.findOne({username: {$eq: username}}).lean();
        } catch (error) {
            return HTTP.ServerError(error)
        }
    
        if (!user) {
            return HTTP.NotFound('Cannot find user with specified username!')
        }
    
        const canLogin = await bcrypt.compare(password, user.password);
    
        if (!canLogin) {
            return HTTP.Forbidden('Incorrect password!')
        }
    
        return user._id
    }

    static async createUser(username: string, password: string): Promise<mongoose.Types.ObjectId | IHTTPServerError | IHTTPBadInput> {
        if (!/^[a-z0-9]+$/.test(username)) {
            return HTTP.BadInput('Username must only contain numbers and lowercase characters')
        }

        if (password.length < 8) {
            return HTTP.BadInput('Password must be 8 or more characters')
        }
        
        let hashedPassword: string;
        try {
            hashedPassword = await bcrypt.hash(password, 12);
        } catch (error) {
            return HTTP.ServerError(error)
        }
    
        const newUser = {
            username,
            password: hashedPassword,
            secondId: randomUUID()
        }
    
        try {
            const document = await new User(newUser).save()
            return document._id
        } catch (error) {
            return HTTP.ServerError(error)
        }
    }
}