import { Track } from "discord-player";
import type { DeezerExtractor } from "../DeezerExtractor";
import { Readable, PassThrough } from 'stream'
import type { BinaryLike, CipherGCMTypes, CipherKey, Decipher } from "crypto";

const IV = Buffer.from(Array.from({ length: 8 }, (_, x) => x))

let rawCrypto: typeof import("crypto")

export async function getCrypto() {
    if (!rawCrypto) {
        rawCrypto = await import("crypto")
        return rawCrypto
    }

    return rawCrypto
}

export async function streamTrack(track: Track, ext: DeezerExtractor) {
    const trackIdWithUrlParams = track.url.split("/").at(-1)
    if (!trackIdWithUrlParams || !validate(track.url)) throw new Error("INVALID TRACK") // not a deezer track

    const decryptionKey = ext.options.decryptionKey
    if (!decryptionKey) throw new Error("MISSING DEEZER DECRYPTION KEY") // cant decrypt due to missing key

    const crypto = await getCrypto()
    const trackId = trackIdWithUrlParams.split("?")[0]

    const trackHash = crypto.createHash("md5").update(trackId, "ascii").digest("hex")
    const trackKey = Buffer.alloc(16)

    for (let iter = 0; iter < 16; iter++)
        /* tslint:disable-next-line no-bitwise */
        trackKey.writeInt8(trackHash[iter].charCodeAt(0) ^ trackHash[iter + 16].charCodeAt(0) ^ decryptionKey[iter].charCodeAt(0), iter)

    const trackInfoRes = await fetch(`https://www.deezer.com/ajax/gw-light.php?method=song.getListData&input=3&api_version=1.0&api_token=${ext.userInfo.csrfToken}`, {
        method: "POST",
        headers: {
            Cookie: ext.userInfo.cookie,
            'User-Agent': "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
            'DNT': '1'
        },
        body: JSON.stringify({
            sng_ids: [trackId]
        })
    })

    const trackInfo = await trackInfoRes.json()

    // no streaming data found
    if (Array.isArray(trackInfo.error) && (trackInfo.error as unknown[]).length !== 0) throw new Error("Unable to extract track\n" + JSON.stringify(trackInfo.error))
    if (typeof trackInfo.error === "object" && Object.keys(trackInfo.error).length !== 0) throw new Error("Unable to extract track\n" + JSON.stringify(trackInfo.error))

    const info = trackInfo.data[0]

    const streamInfoRes = await fetch(`${ext.userInfo.mediaUrl}/v1/get-url`, {
        method: "POST",
        body: JSON.stringify({
            license_token: ext.userInfo.licenseToken,
            media: [{
                type: 'FULL',
                formats: [{
                    cipher: 'BF_CBC_STRIPE',
                    format: 'FLAC'
                }, {
                    cipher: 'BF_CBC_STRIPE',
                    format: 'MP3_256'
                }, {
                    cipher: 'BF_CBC_STRIPE',
                    format: 'MP3_128'
                }, {
                    cipher: 'BF_CBC_STRIPE',
                    format: 'MP3_MISC'
                }]
            }],
            track_tokens: [info.TRACK_TOKEN]
        })
    })

    const streamInfo = await streamInfoRes.json()

    const trackMediaUrl = streamInfo.data[0].media[0].sources[0].url

    const trackReq = await fetch(trackMediaUrl)
    // @ts-ignore
    const readable = Readable.fromWeb(trackReq.body)
    let buffer = Buffer.alloc(0)
    let i = 0

    const bufferSize = 2048 // 2mb

    const passThrough = new PassThrough()

    readable.on("readable", () => {
        let chunk = null;
        while (true) {
            chunk = readable.read(bufferSize)

            if (!chunk) {
                if (readable.readableLength) {
                    chunk = readable.read(readable.readableLength)
                    buffer = Buffer.concat([buffer, chunk])
                }
                break;
            } else {
                buffer = Buffer.concat([buffer, chunk])
            }

            while (buffer.length >= bufferSize) {
                const bufferSized = buffer.subarray(0, bufferSize)

                if (i % 3 === 0) {
                    const decipher = crypto.createDecipheriv(
                        'bf-cbc' as unknown as CipherGCMTypes,
                        trackKey as unknown as CipherKey,
                        IV as unknown as BinaryLike
                    ).setAutoPadding(false) as unknown as Decipher

                    // @ts-ignore
                    passThrough.write(decipher.update(bufferSized as unknown as ArrayBufferView))
                    passThrough.write(decipher.final())
                } else {
                    passThrough.write(bufferSized)
                }

                i++

                buffer = buffer.subarray(bufferSize)
            }
        }
    })

    return passThrough
}

export const deezerRegex = {
    track: /(^https:)\/\/(www\.)?deezer.com\/([a-zA-Z]+\/)?track\/[0-9]+/,
    playlistNalbums: /(^https:)\/\/(www\.)?deezer.com\/[a-zA-Z]+\/(playlist|album)\/[0-9]+(\?)?(.*)/,
    share: /(^https:)\/\/deezer\.page\.link\/[A-Za-z0-9]+/
} as const;

export function validate(query: string) {
    return deezerRegex.track.test(query) ?? deezerRegex.playlistNalbums.test(query) ?? deezerRegex.share.test(query)
}