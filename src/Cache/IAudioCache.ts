import type { Readable, Writable } from "node:stream";

/**
 * Storage backend for decrypted audio.
 *
 * A cache is read before the track is fetched and written while the track is
 * being streamed, so implementations should support concurrent streams.
 */
export interface IAudioCache {
    /**
     * Returns a readable stream for the cached track, or `null` when the key
     * is not present.
     */
    read(key: string): Promise<Readable | null>;

    /**
     * Opens a writable for the given key. The entry is committed when the
     * writable finishes and discarded if it is destroyed first.
     */
    write(key: string): Promise<Writable>;

    /** Removes a single entry. Missing entries are ignored. */
    delete(key: string): Promise<void>;

    /** Applies the cache's age and size limits. */
    cleanup(): Promise<void>;

    /** Stops any background maintenance. Optional. */
    close?(): void | Promise<void>;
}
