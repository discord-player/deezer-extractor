"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_player_1 = require("discord-player");
const deezer_music_metadata_1 = require("@mithron/deezer-music-metadata");
const youtube_sr_1 = require("youtube-sr");
const yt_stream_1 = require("yt-stream");
const soundcloud_ts_1 = __importDefault(require("soundcloud.ts"));
class DeezerExtractor extends discord_player_1.BaseExtractor {
    constructor() {
        super(...arguments);
        this._stream = yt_stream_1.stream;
        this.protocols = ["deezer", "dzsearch"];
        this.client = new soundcloud_ts_1.default({
            clientId: this.options.soundcloud?.clientId,
            oauthToken: this.options.soundcloud?.oauthToken,
            proxy: this.options.soundcloud?.proxy
        });
        this.deezerRegex = {
            track: /(^https:)\/\/(www\.)?deezer.com\/([a-zA-Z]+\/)?track\/[0-9]+/,
            playlistNalbums: /(^https:)\/\/(www\.)?deezer.com\/[a-zA-Z]+\/(playlist|album)\/[0-9]+(\?)?(.*)/,
            share: /(^https:)\/\/deezer\.page\.link\/[A-Za-z0-9]+/
        };
    }
    async activate() {
        /* tslint:disable-next-line */
        if (!this.options.bridgeFrom)
            this.options.bridgeFrom === "YouTube";
    }
    async validate(query, _type) {
        if (typeof query !== "string")
            return false;
        return this.deezerRegex.track.test(query) || this.deezerRegex.playlistNalbums.test(query) || this.deezerRegex.share.test(query);
    }
    async handle(query, context) {
        if (this.deezerRegex.share.test(query)) {
            const fetchRes = await fetch(query);
            query = fetchRes.url.split("?")[0];
        }
        const data = await (0, deezer_music_metadata_1.getData)(query);
        if (data?.type === "song") {
            const returnData = {
                playlist: null,
                tracks: [
                    new discord_player_1.Track(this.context.player, {
                        title: data?.name,
                        raw: data,
                        description: "",
                        author: data.author.map((artist) => artist.name).join(" "),
                        url: data.url,
                        source: "arbitrary",
                        thumbnail: data.thumbnail[0].url,
                        duration: discord_player_1.Util.buildTimeCode(discord_player_1.Util.parseMS(data.duration * 1000)),
                        views: 0,
                        requestedBy: context.requestedBy
                    })
                ]
            };
            return returnData;
        }
        if (data?.type === "playlist" || data?.type === "album") {
            const raw = data.url.split("/");
            const identifier = raw[raw.length - 1];
            const playlist = new discord_player_1.Playlist(this.context.player, {
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
            });
            const tracks = data.tracks.map(track => {
                return new discord_player_1.Track(this.context.player, {
                    title: track.name,
                    raw: track,
                    description: "",
                    author: track.author.map((artist) => artist.name).join(" "),
                    url: track.url,
                    source: "arbitrary",
                    thumbnail: track.thumbnail[0].url,
                    duration: discord_player_1.Util.buildTimeCode(discord_player_1.Util.parseMS(track.duration * 1000)),
                    views: 0,
                    requestedBy: context.requestedBy
                });
            });
            playlist.tracks = tracks;
            return {
                playlist,
                tracks
            };
        }
        return { playlist: null, tracks: [] };
    }
    async brdgeProvider(track) {
        const query = this.createBridgeQuery(track);
        if (this.options.bridgeFrom === "YouTube") {
            try {
                const serachResults = await youtube_sr_1.YouTube.search(query, {
                    limit: 1,
                    type: "video"
                });
                const ytStream = await this._stream(serachResults[0].url, {
                    quality: 'high',
                    type: 'audio',
                    highWaterMark: 1048576 * 32
                });
                return ytStream.url;
            }
            catch (error) {
                throw new Error(`Could not find a source to bridge from. The error is as follows.\n\n${error}`);
            }
        }
        const res = await this.client.tracks.searchV2({
            q: query
        });
        if (res.collection.length === 0)
            throw new Error("Could not find a suitable source to stream from.");
        const str = this.client.util.streamLink(res.collection[0].permalink_url);
        return str;
    }
    async stream(info) {
        if (this.options.onBeforeCreateStream && typeof this.options.onBeforeCreateStream === "function") {
            return await this.options.onBeforeCreateStream(info);
        }
        return this.brdgeProvider(info);
    }
}
DeezerExtractor.identifier = "com.discord-player.deezerextractor";
exports.default = DeezerExtractor;
