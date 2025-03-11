import { getCrypto } from "../utils/util";
import { BaseDecryptor } from "./BaseDecryptor";
import type { CipherGCMTypes, CipherKey, BinaryLike, Decipher } from "node:crypto"

export class NodeDecryptor extends BaseDecryptor {
    constructor(...args: ConstructorParameters<typeof BaseDecryptor>) {
        super(...args);
        (async () => {
            if(!(await getCrypto()).getCiphers().includes("bf-cbc")) throw new Error("Cannot find bf-cbc")
        })()
    }
    async decrypt(chunk: Buffer): Promise<Buffer> {
        const crypto = await getCrypto()
        const decipher = crypto.createDecipheriv("bf-cbc" as unknown as CipherGCMTypes, this.key as unknown as CipherKey, this.iv as unknown as BinaryLike).setAutoPadding(false) as unknown as Decipher
        return Buffer.concat([decipher.update(chunk as unknown as NodeJS.ArrayBufferView) as unknown as Uint8Array, decipher.final() as unknown as Uint8Array])
    }
}