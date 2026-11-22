/* tslint:disable:no-bitwise */
import Blowfish, { MODE, PADDING } from "blowfish-node";
import { BaseDecryptor } from "./BaseDecryptor";

/**
 * `blowfish-node` does not expose the expanded key schedule in its typings,
 * but the tables are available on the instance after construction.
 */
type BlowfishInternals = Blowfish & {
    p: number[];
    s: number[][];
};

/**
 * Blowfish-CBC decryptor for Deezer's BF_CBC_STRIPE streams.
 *
 * `blowfish-node`'s `decode()` allocates (and copies) several times per call
 * and runs the block cipher through helper functions and array destructuring.
 * Since this is the hot path for every encrypted 2048-byte stripe, we use the
 * library only to run the key schedule once and then decrypt in place with a
 * tight loop.
 */
export class JSDecryptor extends BaseDecryptor {
    private readonly p: Uint32Array;
    private readonly s0: Uint32Array;
    private readonly s1: Uint32Array;
    private readonly s2: Uint32Array;
    private readonly s3: Uint32Array;
    private readonly iv0: number;
    private readonly iv1: number;

    constructor(...args: ConstructorParameters<typeof BaseDecryptor>) {
        super(...args);

        const schedule = new Blowfish(
            new Uint8Array(this.key),
            MODE.CBC,
            PADDING.NULL
        ) as BlowfishInternals;

        this.p = Uint32Array.from(schedule.p);
        this.s0 = Uint32Array.from(schedule.s[0]);
        this.s1 = Uint32Array.from(schedule.s[1]);
        this.s2 = Uint32Array.from(schedule.s[2]);
        this.s3 = Uint32Array.from(schedule.s[3]);

        this.iv0 =
            (this.iv[0] << 24) |
            (this.iv[1] << 16) |
            (this.iv[2] << 8) |
            this.iv[3];
        this.iv1 =
            (this.iv[4] << 24) |
            (this.iv[5] << 16) |
            (this.iv[6] << 8) |
            this.iv[7];
    }

    async decrypt(chunk: Buffer): Promise<Buffer> {
        if (chunk.length % 8 !== 0) {
            throw new Error("Decoded data should be multiple of 8 bytes");
        }

        // Work on a copy so callers never observe a mutated input buffer.
        const out = Buffer.from(chunk);
        const view = new DataView(
            out.buffer as ArrayBuffer,
            out.byteOffset,
            out.byteLength
        );
        const { p, s0, s1, s2, s3 } = this;

        // Each Deezer stripe is an independent CBC stream starting from the
        // same IV, so the chain restarts for every call.
        let prevL = this.iv0;
        let prevR = this.iv1;

        for (let offset = 0; offset < out.length; offset += 8) {
            let l = view.getUint32(offset, false);
            let r = view.getUint32(offset + 4, false);

            const cipherL = l;
            const cipherR = r;

            for (let round = 17; round > 1; round--) {
                l ^= p[round];

                let f =
                    (((s0[(l >>> 24) & 0xff] + s1[(l >>> 16) & 0xff]) | 0) ^
                        s2[(l >>> 8) & 0xff]);
                f = (f + s3[l & 0xff]) | 0;

                r ^= f;

                const tmp = l;
                l = r;
                r = tmp;
            }

            const swap = l;
            l = r;
            r = swap;

            r ^= p[1];
            l ^= p[0];

            l ^= prevL;
            r ^= prevR;

            prevL = cipherL;
            prevR = cipherR;

            view.setUint32(offset, l, false);
            view.setUint32(offset + 4, r, false);
        }

        return out;
    }
}
