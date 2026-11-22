import { Transform, type TransformCallback } from "node:stream";
import type { BaseDecryptor } from "./BaseDecryptor";

/** Deezer's BF_CBC_STRIPE cipher encrypts every 3rd 2048-byte stripe. */
const STRIPE_SIZE = 2048;
const ENCRYPTED_STRIPE_INTERVAL = 3;

/**
 * Decrypts a Deezer stripe stream as it flows through.
 *
 * Using a `Transform` means the HTTP body is only pulled when the consumer
 * actually reads: if playback/ffmpeg slows down, backpressure pauses the
 * download instead of buffering the whole track in memory.
 */
export class StripeDecryptStream extends Transform {
    private stripeIndex = 0;
    private remainder: Buffer = Buffer.alloc(0);
    private readonly decryptor: BaseDecryptor;

    constructor(decryptor: BaseDecryptor) {
        super();
        this.decryptor = decryptor;
    }

    async _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
    ): Promise<void> {
        try {
            const data = this.remainder.length
                ? Buffer.concat([this.remainder, chunk])
                : chunk;

            let offset = 0;

            while (data.length - offset >= STRIPE_SIZE) {
                const stripe = data.subarray(offset, offset + STRIPE_SIZE);
                offset += STRIPE_SIZE;
                this.push(await this.decodeStripe(stripe));
            }

            // Copy the tail: the incoming chunk may be reused by the source.
            this.remainder = Buffer.from(data.subarray(offset));

            callback();
        } catch (error) {
            callback(error as Error);
        }
    }

    async _flush(callback: TransformCallback): Promise<void> {
        try {
            if (this.remainder.length) {
                this.push(await this.decodeStripe(this.remainder));
                this.remainder = Buffer.alloc(0);
            }

            callback();
        } catch (error) {
            callback(error as Error);
        }
    }

    private async decodeStripe(stripe: Buffer): Promise<Buffer> {
        const encrypted = this.stripeIndex++ % ENCRYPTED_STRIPE_INTERVAL === 0;

        // A trailing partial stripe cannot be a valid CBC block.
        if (!encrypted || stripe.length % 8 !== 0) return stripe;

        return this.decryptor.decrypt(stripe);
    }
}
