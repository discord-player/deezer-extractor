import { Transform, type TransformCallback } from "node:stream";
import type { Writable } from "node:stream";

/**
 * Passes audio through while mirroring it into a cache writable.
 *
 * The readable side is driven by the consumer, so enabling the cache does not
 * make the download eager: if playback stalls or is aborted, the source is
 * not drained into the cache.
 */
export class CacheTapStream extends Transform {
    private readonly sink: Writable;
    private sinkFailed = false;
    private flushed = false;

    constructor(sink: Writable) {
        super();
        this.sink = sink;

        // Keep a permanent listener so a cache failure cannot become an
        // unhandled 'error' event.
        this.sink.once("error", () => {
            this.sinkFailed = true;
        });
    }

    _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
    ): void {
        this.push(chunk);

        if (this.sinkFailed || this.sink.destroyed || this.sink.writableEnded) {
            callback();
            return;
        }

        if (this.sink.write(chunk)) {
            callback();
            return;
        }

        const done = () => {
            this.sink.off("drain", done);
            this.sink.off("error", done);
            callback();
        };

        this.sink.once("drain", done);
        this.sink.once("error", done);
    }

    _flush(callback: TransformCallback): void {
        this.flushed = true;

        if (this.sinkFailed || this.sink.destroyed || this.sink.writableEnded) {
            callback();
            return;
        }

        const done = () => {
            this.sink.off("finish", done);
            this.sink.off("error", done);
            callback();
        };

        this.sink.once("finish", done);
        this.sink.once("error", done);
        this.sink.end();
    }

    _destroy(
        error: Error | null,
        callback: (error?: Error | null) => void
    ): void {
        // Only discard the cache entry when the audio stream did not finish.
        if (!this.flushed && !this.sink.destroyed) this.sink.destroy();
        callback(error);
    }
}
