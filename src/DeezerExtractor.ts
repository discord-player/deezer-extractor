import { BaseExtractor, ExtractorInfo, ExtractorSearchContext, Playlist, SearchQueryType, Track } from "discord-player"
import { Engine, Util } from "./utils/util"
import { Util as DPUtil } from "discord-player";
import { Readable } from "stream";
import { AsyncLocalStorage } from "node:async_hooks"
import { getData, Track as DeezerTrack, Playlist as DeezerPlaylist } from "@mithron/deezer-music-metadata";

export enum EngineType {
    YTStream = "yt-stream",
    DisTubeYTDL = "@distube/ytdl-core",
    YTDL = "ytdl-core",
    YoutubeEXT = "youtube-ext",
    PlayDL = "play-dl"
}

export interface DeezerOptions {
    forceEngine?: EngineType;
    createStream?: () => Promise<string|Readable>;
    beforeCreateStream?: () => Promise<unknown>|unknown;
}

const ERR_NO_YT_LIB = new Error("Cannot find a youtube library. Please install one of " + Object.values(EngineType).join(", "))

const context = new AsyncLocalStorage<Track>()

export function useTrack(): Track {
    const store = context.getStore()
    
    if(!store) throw new Error("INVALID INVOKATION")

    return store
}

export class DeezerExtractor extends BaseExtractor<DeezerOptions> {
    engine!: Engine

    public static identifier: string = "app.vercel.retrouser955.deezerextractor";

    public async activate(): Promise<void> {
        this.debug("Getting the engine for Deezer extractor")
        const validEngine = await Util.findYoutubeEngine(this.options.forceEngine)

        if(!validEngine) throw ERR_NO_YT_LIB

        this.engine = validEngine
    }
    
    async validate(query: string, _type?: SearchQueryType | null | undefined): Promise<boolean> {
        return Util.validateDeezerURL(query)
    }

    async handle(query: string, handleContext: ExtractorSearchContext): Promise<ExtractorInfo> {
        const metadata = await getData(query)

        if(metadata?.type === "song") return this.getReturnData([this.buildTrack(metadata, handleContext)], null)
        if(metadata?.type === "playlist" || metadata?.type === "album") {
            const playlist = this.buildPlaylistData(metadata, handleContext)

            return this.getReturnData(playlist.tracks, playlist)
        }

        throw new Error("Unable to get data from Deezer")
    }

    buildPlaylistData(data: DeezerPlaylist, handleContext: ExtractorSearchContext) {
        const raw: string[] = data.url.split("/")
        const identifier: string = raw[raw.length - 1]

        return new Playlist(this.context.player, {
            title: data.name,
            thumbnail: data.thumbnail[0].url,
            author: {
                name: data.artist.name,
                url: data.artist.url
            },
            type: data.type,
            rawPlaylist: data,
            tracks: data.tracks.map((v) => this.buildTrack(v, handleContext)),
            description: "",
            source: "arbitrary",
            id: identifier,
            url: data.url
        })
    }

    getReturnData(tracks: Track[], playlist: Playlist|null) {
        return {
            playlist,
            tracks
        }
    }

    buildTrack(track: DeezerTrack, handleContext: ExtractorSearchContext) {
        return new Track(this.context.player, {
            title: track.name,
            raw: track,
            author: track.author.map((v) => v.name).join(", "),
            url: track.url,
            source: "arbitrary",
            thumbnail: track.thumbnail[0].url,
            duration: DPUtil.buildTimeCode(DPUtil.parseMS(track.duration)),
            requestedBy: handleContext.requestedBy
        })
    }

    async stream(info: Track<unknown>): Promise<string | Readable> {
        if(this.options.beforeCreateStream && typeof this.options.beforeCreateStream === "function") {
            context.run(info, this.options.beforeCreateStream)
        }

        if(this.options.createStream && typeof this.options.createStream === 'function') {
            const stream = await context.run(info, this.options.createStream)
            
            return stream
        }

        return await this.engine.stream(info)
    }
}