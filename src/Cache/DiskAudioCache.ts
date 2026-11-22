import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
    mkdir,
    open,
    readdir,
    rename,
    stat,
    unlink,
    utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { IAudioCache } from "./IAudioCache";

const CACHE_EXTENSION = ".audio";
const TEMP_EXTENSION = ".part";
const TEMP_MAX_AGE = 24 * 60 * 60 * 1000;

const DEFAULT_MAX_SONGS = 100;
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL = 60 * 60 * 1000;

export interface DiskAudioCacheOptions {
    /** Directory used to store decrypted tracks. */
    directory?: string;
    /**
     * Maximum number of cached songs. Oldest entries are removed first.
     * Set to `0` to disable the count limit.
     */
    maxSongs?: number;
    /**
     * Remove entries older than this many milliseconds.
     * Set to `0` to disable age-based expiry.
     */
    maxAge?: number;
    /**
     * How often background cleanup runs, in milliseconds.
     * Set to `0` to only clean up after writes.
     */
    cleanupInterval?: number;
}

/**
 * Disk-backed audio cache. Keys are hashed, so arbitrary strings can be used
 * without risking path traversal. Audio is written to a temporary file and
 * renamed into place once complete, so partially downloaded tracks are never
 * served.
 */
export class DiskAudioCache implements IAudioCache {
    readonly directory: string;
    readonly maxSongs: number;
    readonly maxAge: number;
    readonly cleanupInterval: number;

    private readonly ready: Promise<void>;
    private cleaning?: Promise<void>;
    private timer?: NodeJS.Timeout;
    private closed = false;

    constructor(options: DiskAudioCacheOptions = {}) {
        this.directory =
            options.directory ??
            join(tmpdir(), "discord-player-deezer-cache");
        this.maxSongs = options.maxSongs ?? DEFAULT_MAX_SONGS;
        this.maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
        this.cleanupInterval =
            options.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;

        this.ready = mkdir(this.directory, { recursive: true }).then(
            () => undefined
        );

        if (this.cleanupInterval > 0) {
            this.timer = setInterval(() => {
                void this.cleanup().catch(() => undefined);
            }, this.cleanupInterval);
            this.timer.unref();
        }

        // Run once on startup so stale entries are removed even if the cache
        // is never written to.
        void this.cleanup().catch(() => undefined);
    }

    async read(key: string): Promise<Readable | null> {
        await this.ready;

        const file = this.pathFor(key);

        try {
            const handle = await open(file, "r");

            // Touch the entry so cleanup treats it as recently used.
            const now = new Date();
            await utimes(file, now, now).catch(() => undefined);

            // `filehandle.createReadStream()` does not close the handle for
            // us, so release it explicitly when the stream is done.
            const stream = handle.createReadStream({ autoClose: false });
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                void handle.close().catch(() => undefined);
            };

            stream.once("end", release);
            stream.once("error", release);
            stream.once("close", release);

            return stream;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
        }
    }

    async write(key: string): Promise<Writable> {
        if (this.closed) throw new Error("DiskAudioCache is closed");

        await this.ready;

        const target = this.pathFor(key);
        const temp = `${target}.${randomBytes(8).toString("hex")}${TEMP_EXTENSION}`;
        const out = createWriteStream(temp);
        let committed = false;

        // Always observe errors so a broken cache cannot crash the caller.
        out.on("error", () => {
            void unlink(temp).catch(() => undefined);
        });

        out.once("finish", () => {
            committed = true;

            void rename(temp, target)
                .then(() => this.cleanup())
                .catch(async () => {
                    await unlink(temp).catch(() => undefined);
                });
        });

        out.once("close", () => {
            if (!committed) void unlink(temp).catch(() => undefined);
        });

        return out;
    }

    async delete(key: string): Promise<void> {
        await this.ready;

        await unlink(this.pathFor(key)).catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
    }

    cleanup(): Promise<void> {
        if (!this.cleaning) {
            this.cleaning = this.runCleanup().finally(() => {
                this.cleaning = undefined;
            });
        }

        return this.cleaning;
    }

    async close(): Promise<void> {
        this.closed = true;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }

        if (this.cleaning) await this.cleaning.catch(() => undefined);
    }

    private pathFor(key: string): string {
        const hash = createHash("sha256").update(key).digest("hex");
        return join(this.directory, hash + CACHE_EXTENSION);
    }

    private async runCleanup(): Promise<void> {
        await this.ready;

        const now = Date.now();
        const entries = await readdir(this.directory, { withFileTypes: true });
        const songs: { file: string; mtimeMs: number }[] = [];

        for (const entry of entries) {
            if (!entry.isFile()) continue;

            const isSong = entry.name.endsWith(CACHE_EXTENSION);
            const isTemp = entry.name.endsWith(TEMP_EXTENSION);
            if (!isSong && !isTemp) continue;

            const file = join(this.directory, entry.name);

            let info;
            try {
                info = await stat(file);
            } catch {
                continue;
            }

            if (isTemp) {
                if (now - info.mtimeMs > TEMP_MAX_AGE) {
                    await unlink(file).catch(() => undefined);
                }
                continue;
            }

            if (this.maxAge > 0 && now - info.mtimeMs > this.maxAge) {
                await unlink(file).catch(() => undefined);
                continue;
            }

            songs.push({ file, mtimeMs: info.mtimeMs });
        }

        if (this.maxSongs > 0 && songs.length > this.maxSongs) {
            songs.sort((a, b) => b.mtimeMs - a.mtimeMs);

            for (let i = this.maxSongs; i < songs.length; i++) {
                await unlink(songs[i].file).catch(() => undefined);
            }
        }
    }
}
