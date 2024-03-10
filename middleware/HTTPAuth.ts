import { Request, Response, NextFunction } from "express";

export function validateAuth(req: Request, res: Response, next: NextFunction) {
    if ('auth' in req.cookies) {
        next()
    } else {
        res.status(401).json({redirect: '/'})
    }
}