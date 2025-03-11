import Blowfish, { MODE, PADDING, TYPE } from "blowfish-node";
import { BaseDecryptor } from "./BaseDecryptor";

export class JSDecryptor extends BaseDecryptor {
    bfDecryptor: Blowfish

    constructor(...args: ConstructorParameters<typeof BaseDecryptor>) {
        super(...args)
        this.bfDecryptor = new Blowfish(new Uint8Array(this.key), MODE.CBC, PADDING.NULL)
        this.bfDecryptor.setIv(new Uint8Array(this.iv))
    }

    async decrypt(chunk: Buffer): Promise<Buffer> {
        const chunkUint = new Uint8Array(chunk)
        const decoded = this.bfDecryptor.decode(chunkUint, TYPE.UINT8_ARRAY)
        return Buffer.from(decoded)
    }
}