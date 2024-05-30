import { Track } from "discord-player"
import { EngineType } from "../DeezerExtractor"
import { YouTube } from "youtube-sr"

export interface Engine {
    name: EngineType;
    getEngine: () => Promise<unknown>;
    stream: (track: Track) => Promise<string>;
}

const deezerRegex = {
    track: /(^https:)\/\/(www\.)?deezer.com\/([a-zA-Z]+\/)?track\/[0-9]+/,
    playlistNalbums: /(^https:)\/\/(www\.)?deezer.com\/[a-zA-Z]+\/(playlist|album)\/[0-9]+(\?)?(.*)/,
    share: /(^https:)\/\/deezer\.page\.link\/[A-Za-z0-9]+/
};

export class Util {
    static async defaultSearch(track: Track) {
        const search = await YouTube.searchOne(`${track.title} - ${track.author} audio`)

        return search.url
    }

    static async findYoutubeEngine(overwrite?: string) {
        const engines: Engine[] = [
            {
                name: EngineType.YTStream,
                getEngine: async () => {
                    const lb = await import("yt-stream")
                    return lb.default
                },
                stream: async (track: Track) => {
                    const ytStream = await import("yt-stream")

                    const search = await ytStream.search(`${track.author} - ${track.title} audio`)

                    const stream = await ytStream.stream(search[0].url, {
                        quality: 'high',
                        type: 'audio',
                        highWaterMark: 1048576 * 32,
                        download: false
                    })

                    return stream.url
                }
            },
            {
                name: EngineType.DisTubeYTDL,
                getEngine: async () => {
                    const lb = await import('@distube/ytdl')
                    return lb
                },
                stream: async (track: Track) => {
                    const ytdl = await import("@distube/ytdl")

                    const search = await this.defaultSearch(track)

                    const stream = await ytdl.getInfo(search)

                    const audioFormat = stream.formats.filter((v) => {
                        return v.hasAudio
                    }).sort((a, b) => Number(b.audioBitrate) - Number(a.audioBitrate) ?? Number(a.bitrate) - Number(b.bitrate))[0]

                    if(!audioFormat.url) throw new Error("Unable to find stream url for this song")

                    return audioFormat.url
                }
            },
            {
                name: EngineType.YTDL,
                getEngine: async () => {
                    const lb = await import('ytdl-core')
                    return lb
                },
                stream: async (track: Track) => {
                    const ytdl = await import("ytdl-core")

                    const search = await this.defaultSearch(track)

                    const stream = await ytdl.getInfo(search)

                    const audioFormat = stream.formats.filter((v) => {
                        return v.hasAudio
                    }).sort((a, b) => Number(b.audioBitrate) - Number(a.audioBitrate) ?? Number(a.bitrate) - Number(b.bitrate))[0]

                    if(!audioFormat.url) throw new Error("Unable to find stream url for this song")

                    return audioFormat.url
                }
            },
            {
                name: EngineType.YoutubeEXT,
                getEngine: async () => {
                    const lb = await import("youtube-ext")
                    return lb
                },
                stream: async (track: Track) => {
                    const ytEXT = await import("youtube-ext")

                    const search = await ytEXT.search(`${track.author} - ${track.title} audio`, {
                        filterType: "video"
                    })

                    const info = await ytEXT.videoInfo(search.videos[0].url)

                    const formats = (await ytEXT.getFormats(info.stream)).filter((v) => {
                        if(!v.url) return false
                        return typeof v.bitrate === "number"
                    })

                    if(!formats[0].url) throw new Error("Unable to find stream url using youtube-ext")

                    return formats[0].url
                }
            },
            {
                name: EngineType.PlayDL,
                async getEngine() {
                    const lb = await import("play-dl")
                    return lb
                },
                async stream(track) {
                    const play = await import("play-dl")
                    
                    const info = await play.video_info((await play.search(`${track.author} - ${track.title} audio`))[0].url)

                    const fmt = info.format.filter((val) => {
                        if(!val.url) return false

                        return typeof val.bitrate === "number"
                    }).sort((a, b) => Number(b.bitrate) - Number(a.bitrate))[0]

                    if(!fmt.url) throw new Error("Unable to find stream url")
                    
                    return fmt.url
                },
            }
        ]

        if(overwrite) {
            const engine = engines.filter((eng) => eng.name === overwrite)[0]

            if(!engine) throw new Error("Not a valid youtube engine. Please install one of " + Object.values(EngineType).join(", "))

            return engine
        }

        let i = 0

        for(; i < engines.length; i++) {
            const engine = engines[i]

            if(await engine.getEngine()) break;
        }

        const validEngine = engines[i]

        return validEngine
    }

    static validateDeezerURL(str: string) {
        return deezerRegex.share.test(str) ?? deezerRegex.playlistNalbums.test(str) ?? deezerRegex.track.test(str)
    }
}