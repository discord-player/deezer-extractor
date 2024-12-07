import { BaseExtractor, ExtractorSearchContext, ExtractorStreamable, Track, Playlist, Util as DPUtil, ExtractorInfo } from "discord-player"
import { Playlist as DeezerPlaylist, Track as DeezerTrack, getData } from "@mithron/deezer-music-metadata";
import { buildTrackFromSearch, deezerRegex, getCrypto, searchOneTrack, streamTrack, validate } from "./utils/util";

/**
 * -------------------------------NOTICE-------------------------------------
 * STREAMING CODE IS MAINLY TAKEN FROM https://github.com/PerformanC/NodeLink
 * WHICH HAS THE "BSD 2-Clause "Simplified" License"
 * 
 * PLEASE SHOW THE ORIGINAL AUTHOR SUPPORT BY STARING HIS GITHUB REPO
 * --------------------------------------------------------------------------
 */

export type DeezerExtractorOptions = {
    decryptionKey?: string; // needed for decrypting deezer songs
    createStream?: (track: Track, ext: DeezerExtractor) => Promise<ExtractorStreamable>
}

export type DeezerUserInfo = {
    cookie: string;
    licenseToken: string;
    csrfToken: string;
    mediaUrl: string;
}

export const Warnings = {
    LegacyOpenSSL: "OpenSSL legacy provider is needed for decrypting streams. Rerun your code with `node --openssl-legacy-provider` or set the environment variable NODE_OPTIONS to include `-openssl-legacy-provider`. Stream extraction has been disabled.",
    MissingDecryption: "Decryption Key missing! This is needed for extracting streams."
} as const
export type Warnings = (typeof Warnings)[keyof typeof Warnings]

export class DeezerExtractor extends BaseExtractor<DeezerExtractorOptions> {
    static identifier: string = "com.retrouser955.discord-player.deezr-ext"
    userInfo!: DeezerUserInfo

    async activate(): Promise<void> {
        if(!this.options.decryptionKey) process.emitWarning(Warnings.MissingDecryption)
        else {
            if(typeof process.env.NODE_OPTIONS === "string" && !process.env.NODE_OPTIONS.includes("--openssl-legacy-provider")) {
                process.emitWarning(Warnings.LegacyOpenSSL)
                this.options.decryptionKey = undefined
                return;
            }
            if(!process.execArgv.includes("--openssl-legacy-provider")) {
                process.emitWarning(Warnings.LegacyOpenSSL)
                this.options.decryptionKey = undefined;
                return
            }
            // extract deezer username
            // dynamically load crypto because some might not want streaming
            const crypto = await getCrypto()
            const randomToken = crypto.randomBytes(16).toString("hex")
            const deezerUsrDataUrl = `https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData&input=3&api_version=1.0&api_token=${randomToken}`

            const usrDataRes = await fetch(deezerUsrDataUrl)
            const usrData = await usrDataRes.json()

            const licenseToken = usrData.results.USER.OPTIONS.license_token
            if(typeof licenseToken !== "string") throw new Error("Unable to get licenseToken")

            const csrfToken = usrData.results.checkForm
            if(typeof csrfToken !== "string") throw new Error("Unable to get csrf token which is required for decryption")

            this.userInfo = {
                mediaUrl: usrData.results.URL_MEDIA || "https://media.deezer.com",
                cookie: usrDataRes.headers.get("set-cookie")!,
                licenseToken,
                csrfToken
            }

            this.context.player.debug('USER INFO EXT: ' + JSON.stringify(this.userInfo))
        }
    }

    async validate(query: string): Promise<boolean> {
        return validate(query)
    }

    buildPlaylistData(data: DeezerPlaylist, handleContext: ExtractorSearchContext) {
        const raw: string[] = data.url.split("/")
        const identifier: string = raw[raw.length - 1].split("?")[0]

        return new Playlist(this.context.player, {
            title: data.name,
            thumbnail: data.thumbnail[0].url,
            author: {
                name: data.artist.name,
                url: data.artist.url
            },
            type: data.type,
            tracks: data.tracks.map((v) => this.buildTrack(v, handleContext)),
            description: "",
            source: "arbitrary",
            id: identifier,
            url: data.url
        })
    }
    
    async handle(query: string, context: ExtractorSearchContext): Promise<ExtractorInfo> {
        if (deezerRegex.share.test(query)) {
            const redirect = await fetch(query);
            query = redirect.url; // follow the redirect of deezer page links
        }
        const metadata = await getData(query)

        if(metadata?.type === "song") return this.createResponse(null, [this.buildTrack(metadata, context)])
        if(metadata?.type === "playlist" || metadata?.type === "album") {
            const playlist = this.buildPlaylistData(metadata, context)

            return this.createResponse(playlist, playlist.tracks)
        }

        throw new Error("Unable to get data from Deezer")
    }

    buildTrack(track: DeezerTrack, { requestedBy }: ExtractorSearchContext) {
        return new Track(this.context.player, {
            title: track.name,
            author: track.author.map((v) => v.name).join(", "),
            url: track.url,
            source: "arbitrary",
            thumbnail: track.thumbnail[0].url,
            duration: DPUtil.buildTimeCode(DPUtil.parseMS(track.duration)),
            requestedBy
        })
    }

    async bridge(track: Track): Promise<ExtractorStreamable | null> {
        const deezerTrack = await searchOneTrack(`${track.author} ${track.source === "youtube" ? track.cleanTitle : track.title}`)

        if(!deezerTrack) return null
        const dpTrack = buildTrackFromSearch(deezerTrack, this.context.player, track.requestedBy)

        const stream = this.stream(dpTrack[0])

        return stream
    }

    stream(info: Track): Promise<ExtractorStreamable> {
        return streamTrack(info, this)
    }
}