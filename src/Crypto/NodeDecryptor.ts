/* tslint:disable:no-bitwise */
import { getCrypto } from "../utils/crypto";
import { BaseDecryptor } from "./BaseDecryptor";
import type {
    CipherGCMTypes,
    CipherKey,
    BinaryLike,
    Decipher,
} from "node:crypto";

/**
 * Native (`bf-cbc`) decryptor.
 *
 * A `Decipher` keeps its expanded key schedule for as long as it lives, but
 * `createDecipheriv()` rebuilds that schedule on every call. Creating one per
 * 2048-byte stripe is therefore slower than the pure-JS decryptor. Instead we
 * keep a single cipher for the whole track and repair the CBC chain at stripe
 * boundaries: Deezer restarts every stripe from the same IV, while the cipher
 * carries the previous stripe's last ciphertext block forward. Only the first
 * block of each stripe differs, and it can be fixed with one XOR.
 */
export class NodeDecryptor extends BaseDecryptor {
    private decipher?: Decipher;
    private previousCipherBlock?: Buffer;
    private firstChunk = true;

    async decrypt(chunk: Buffer): Promise<Buffer> {
        if (chunk.length % 8 !== 0) {
            throw new Error("Decoded data should be multiple of 8 bytes");
        }

        if (chunk.length === 0) return Buffer.alloc(0);

        const crypto = await getCrypto();

        if (!this.decipher) {
            try {
                this.decipher = crypto
                    .createDecipheriv(
                        "bf-cbc" as unknown as CipherGCMTypes,
                        this.key as unknown as CipherKey,
                        this.iv as unknown as BinaryLike
                    )
                    .setAutoPadding(false) as unknown as Decipher;
            } catch {
                throw new Error(
                    "Cannot find bf-cbc. Start Node with --openssl-legacy-provider or use JSDecryptor."
                );
            }

            this.previousCipherBlock = Buffer.alloc(8);
        }

        const out = this.decipher.update(chunk);

        if (!this.firstChunk && this.previousCipherBlock && out.length >= 8) {
            // Undo the CBC chaining left over from the previous stripe.
            for (let i = 0; i < 8; i++) {
                out[i] ^= this.previousCipherBlock[i] ^ this.iv[i];
            }
        }

        this.firstChunk = false;
        this.previousCipherBlock = Buffer.from(
            chunk.subarray(chunk.length - 8)
        );

        return out;
    }
}
