import { Request, Response, NextFunction } from "express";
import HTTP from "../libraries/HTTP";

export function validateAuth(req: Request, res: Response, next: NextFunction) {
    if ('auth' in req.cookies) {
        next()
    } else {
        HTTP.SendHTTP(req, res, 401, {redirect: '/'})
    }
}