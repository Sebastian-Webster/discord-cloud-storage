import {validate as validateUUID, version as UUIDVersion} from 'uuid';

export function validateUUIDV4(uuid: string): boolean {
    return validateUUID(uuid) && UUIDVersion(uuid) === 4
}