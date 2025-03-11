export class BaseDecryptor {
    key: Buffer
    iv: Buffer
    constructor(decryptionKey: Buffer, iv: Buffer) {
        this.key = decryptionKey
        this.iv = iv
    }

    async decrypt(chunk: Buffer): Promise<Buffer> {
        throw new Error("Not implemented")
    }
}