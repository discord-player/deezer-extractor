import { getCrypto } from "../utils/util";
import { BaseDecryptor } from "./BaseDecryptor";

export class NodeDecryptor extends BaseDecryptor {
    constructor(...args: ConstructorParameters<typeof BaseDecryptor>) {
        super(...args);
        (async () => {
            if(!(await getCrypto()).getCiphers().includes("bf-cbc")) throw new Error("Cannot find bf-cbc")
        })()
    }
    async decrypt(chunk: Buffer): Promise<Buffer> {
        const crypto = await getCrypto()
        const decipher = crypto.createDecipheriv("bf-cbc", this.key, this.iv).setAutoPadding(false)
        return Buffer.concat([decipher.update(chunk), decipher.final()])
    }
}