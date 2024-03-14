import { Errback, Request, Response } from "express"

export default class HTTP {
    static ServerError(message: string): IHTTPServerError {
        return {
            status: 500,
            data: {
                message
            }
        }
    }

    static OK(data?: string | object): IHTTPOK {
        return {
            status: 200,
            data: {
                data
            }
        }
    }

    static NotFound(message: string): IHTTPNotFound {
        return {
            status: 404,
            data: {
                message
            }
        }
    }

    static Forbidden(message: string): IHTTPForbidden {
        return {
            status: 403,
            data: {
                message
            }
        }
    }

    static BadInput(message: string): IHTTPBadInput {
        return {
            status: 400,
            data: {
                message
            }
        }
    }

    static #CanSendHTTP(req: Request, res: Response): boolean {
        if (res.headersSent) {
            console.log('Returning early because headers have already been sent')
            return false
        }

        return true
    }

    static SendHTTP(req: Request, res: Response, status: number, data: object | any[] | string, options?: SendHTTPOptions): void {
        if (!this.#CanSendHTTP(req, res)) return

        if (options?.clearCookie) {
            res.clearCookie(options.clearCookie);
        }

        if (options?.setCookies) {
            for (const cookie of options.setCookies) {
                res.cookie(cookie.name, cookie.val, cookie.cookieOptions);
            }
        }

        if (typeof data === 'object' && data !== null) {
            res.status(status).json(data)
            return
        }

        res.status(status).send(data)
    }

    static SendDownloadableFile(req: Request, res: Response, filePath: string, callback?: Errback): void {
        if (!this.#CanSendHTTP(req, res)) return

        res.download(filePath, callback)
    }

    static SendFile(req: Request, res: Response, filePath: string): void {
        if (!this.#CanSendHTTP(req, res)) return

        res.sendFile(filePath)
    }

    static redirect(req: Request, res: Response, path: string): void {
        if (!this.#CanSendHTTP(req, res)) return

        res.redirect(path);
    }
}