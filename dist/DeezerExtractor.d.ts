/// <reference types="node" />
import { BaseExtractor, ExtractorInfo, ExtractorSearchContext, SearchQueryType, Track } from "discord-player";
import { Readable } from "stream";
import { default as SoundCloud } from "soundcloud.ts";
interface DeezerOptions {
    bridgeFrom?: "YouTube" | "SoundCloud";
    soundcloud?: {
        clientId?: string;
        oauthToken?: string;
        proxy?: string;
    };
    onBeforeCreateStream?: (track: Track) => Promise<string | Readable>;
}
export default class DeezerExtractor extends BaseExtractor<DeezerOptions> {
    static identifier: string;
    private _stream;
    protocols: string[];
    client: SoundCloud;
    private deezerRegex;
    activate(): Promise<void>;
    validate(query: string, _type?: SearchQueryType | null | undefined): Promise<boolean>;
    handle(query: string, context: ExtractorSearchContext): Promise<ExtractorInfo>;
    brdgeProvider(track: Track): Promise<string>;
    stream(info: Track): Promise<string | Readable>;
}
export {};
