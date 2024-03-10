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
}