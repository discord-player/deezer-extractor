import { BaseExtractor, ExtractorSearchContext, ExtractorStreamable, Track, Playlist, Util as DPUtil, ExtractorInfo } from "discord-player"
import { Playlist as DeezerPlaylist, Track as DeezerTrack, getData } from "@mithron/deezer-music-metadata";
import { buildTrackFromSearch, getCrypto, searchOneTrack, streamTrack, validate } from "./utils/util";

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

export class DeezerExtractor extends BaseExtractor<DeezerExtractorOptions> {
    static identifier: string = "com.retrouser955.discord-player.deezr-ext"
    userInfo!: DeezerUserInfo

    async activate(): Promise<void> {
        if(!this.options.decryptionKey) process.emitWarning("Decryption Key missing! This is needed for extracting streams.")
        else {
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
        if(!deezerTrack || !deezerTrack?.data[0]) return null
        const dpTrack = buildTrackFromSearch(deezerTrack, this.context.player, track.requestedBy)

        const stream = this.stream(dpTrack[0])

        return stream
    }

    stream(info: Track): Promise<ExtractorStreamable> {
        return streamTrack(info, this)
    }
}