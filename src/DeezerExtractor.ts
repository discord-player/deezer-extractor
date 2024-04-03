import { BaseExtractor, ExtractorInfo, ExtractorSearchContext, Playlist, SearchQueryType, Track, Util } from "discord-player"
import { getData } from "@mithron/deezer-music-metadata"
import { YouTube } from "youtube-sr";
import { Readable } from "stream";
import { stream } from "yt-stream";
import { default as SoundCloud } from "soundcloud.ts"

interface DeezerOptions {
    bridgeFrom?: "YouTube" | "SoundCloud",
    soundcloud?: {
        clientId?: string;
        oauthToken?: string;
        proxy?: string;
    };
    onBeforeCreateStream?: (track: Track) => Promise<string | Readable>
}

interface DeezerRegex {
    track: RegExp; 
    playlistNalbums: RegExp; 
    share: RegExp
}

export default class DeezerExtractor extends BaseExtractor<DeezerOptions> {
    public static identifier: string = "com.discord-player.deezerextractor" as const
    private _stream = stream
    protocols = ["deezer", "dzsearch"]

    client = new SoundCloud({
        clientId: this.options.soundcloud?.clientId,
        oauthToken: this.options.soundcloud?.oauthToken,
        proxy: this.options.soundcloud?.proxy
    })

    private deezerRegex: DeezerRegex = {
        track: /(^https:)\/\/(www\.)?deezer.com\/([a-zA-Z]+\/)?track\/[0-9]+/,
        playlistNalbums: /(^https:)\/\/(www\.)?deezer.com\/[a-zA-Z]+\/(playlist|album)\/[0-9]+(\?)?(.*)/,
        share: /(^https:)\/\/deezer\.page\.link\/[A-Za-z0-9]+/
    };

    public async activate(): Promise<void> {
        /* tslint:disable-next-line */
        if(!this.options.bridgeFrom) this.options.bridgeFrom === "YouTube"
    }

    public async validate(query: string, _type?: SearchQueryType | null | undefined): Promise<boolean> {
        if (typeof query !== "string") return false

        return this.deezerRegex.track.test(query) || this.deezerRegex.playlistNalbums.test(query) || this.deezerRegex.share.test(query)
    }

    public async handle(query: string, context: ExtractorSearchContext): Promise<ExtractorInfo> {
        if(this.deezerRegex.share.test(query)) {
            const fetchRes = await fetch(query)

            query = fetchRes.url.split("?")[0]
        }

        const data = await getData(query)

        if (data?.type === "song") {
            const returnData = {
                playlist: null,
                tracks: [
                    new Track(this.context.player, {
                        title: data?.name as string,
                        raw: data,
                        description: "",
                        author: data.author.map((artist) => artist.name).join(" "),
                        url: data.url,
                        source: "arbitrary",
                        thumbnail: data.thumbnail[0].url,
                        duration: Util.buildTimeCode(Util.parseMS(data.duration * 1000)),
                        views: 0,
                        requestedBy: context.requestedBy
                    })
                ]
            }

            return returnData
        }

        if (data?.type === "playlist" || data?.type === "album") {
            const raw: string[] = data.url.split("/")
            const identifier: string = raw[raw.length - 1]

            const playlist = new Playlist(this.context.player, {
                title: data.name,
                thumbnail: data.thumbnail[0].url,
                author: {
                    name: data.artist.name,
                    url: data.artist.url
                },
                type: data.type,
                rawPlaylist: data,
                tracks: [],
                description: "",
                source: "arbitrary",
                id: identifier,
                url: data.url
            })

            const tracks = data.tracks.map(track => {
                return new Track(this.context.player, {
                    title: track.name as string,
                    raw: track,
                    description: "",
                    author: track.author.map((artist) => artist.name).join(" "),
                    url: track.url,
                    source: "arbitrary",
                    thumbnail: track.thumbnail[0].url,
                    duration: Util.buildTimeCode(Util.parseMS(track.duration * 1000)),
                    views: 0,
                    requestedBy: context.requestedBy
                })
            })

            playlist.tracks = tracks

            return {
                playlist,
                tracks
            }
        }

        return { playlist: null, tracks: [] }
    }

    public async brdgeProvider(track: Track) {
        const query = this.createBridgeQuery(track)

        if(this.options.bridgeFrom === "YouTube") {
            try {    
                const serachResults = await YouTube.search(query, {
                    limit: 1,
                    type: "video"
                })
    
                const ytStream = await this._stream(serachResults[0].url, {
                    quality: 'high',
                    type: 'audio',
                    highWaterMark: 1048576 * 32
                })
    
                return ytStream.url
            } catch (error) {
                throw new Error(`Could not find a source to bridge from. The error is as follows.\n\n${error}`)
            }
        }

        const res = await this.client.tracks.searchV2({
            q: query
        })

        if(res.collection.length === 0) throw new Error("Could not find a suitable source to stream from.")

        const str = this.client.util.streamLink(res.collection[0].permalink_url)

        return str
    }

    public async stream(info: Track): Promise<string | Readable> {
        if(this.options.onBeforeCreateStream && typeof this.options.onBeforeCreateStream === "function") {
            return await this.options.onBeforeCreateStream(info)
        }

        return this.brdgeProvider(info)
    }
}