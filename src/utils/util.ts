import { type Player, Track, Util } from "discord-player";
import { PassThrough, Readable } from "stream";
import { JSDecryptor } from "../Crypto/JSDecryptor";
import type { DeezerExtractor } from "../DeezerExtractor";

const IV = Buffer.from(Array.from({ length: 8 }, (_, x) => x));

let rawCrypto: typeof import("crypto");

export async function getCrypto() {
  if (!rawCrypto) {
    rawCrypto = await import("crypto");
    return rawCrypto;
  }

  return rawCrypto;
}

export function isUrl(query: string) {
  try {
    const url = new URL(query);
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

const DeezerAPIRoutes = {
  searchTrack(query: string, limit?: number) {
    const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&${limit ? `limit=${limit}` : ""}`;

    return url;
  },
} as const;

export async function search(query: string, limit: number = 10) {
  const route = DeezerAPIRoutes.searchTrack(query, limit);

  const response = await fetch(route);

  if (!response.status.toString().startsWith("2"))
    throw new Error("Server responded with a non 2xx status.");

  const jsonTrack = await response.json();

  if (
    !jsonTrack.data ||
    !Array.isArray(jsonTrack.data) ||
    jsonTrack.data.length === 0
  )
    throw new Error(
      "Unable get tracks from Deezer for the query '" + query + "'"
    );

  return jsonTrack as DeezerSearchTrackResponse;
}

export type ArrayOrObject<T> = T | T[];

export interface DeezerSearchTrackResponse {
  data: {
    link: string;
    title: string;
    album: {
      cover_xl?: string;
      cover_medium?: string;
      cover_small?: string;
      cover?: string;
    };
    artist: {
      name: string;
    };
    duration: number; // in seconds
    type: "track";
  }[];
}

export function buildTrackFromSearch(
  track: DeezerSearchTrackResponse,
  player: Player,
  requestedBy?: Track["requestedBy"]
) {
  const tracks = track.data.map(
    (v) =>
      new Track(player, {
        source: "arbitrary",
        duration: Util.buildTimeCode(Util.parseMS(v.duration * 1000)),
        author: Array.isArray(v.artist)
          ? v.artist.map((a) => a.name).join(", ")
          : v.artist.name,
        url: v.link,
        title: v.title,
        thumbnail:
          v.album.cover_xl ||
          v.album.cover_medium ||
          v.album.cover ||
          v.album.cover_small ||
          "https://play-lh.googleusercontent.com/xtIOV8iPeAY4GrldTDo3CbLAEpbea2DqnfxaB4Nn2p5qz6KAiumY74qH86pgu1HA1A",
        live: false,
        requestedBy,
      })
  );

  return tracks;
}

export function extractTrackId(query: string) {
  if (!validate(query)) throw new Error("Invalid track url");
  const trackIdWithUrlParams = query.split("/").at(-1);
  if (!trackIdWithUrlParams) throw new Error("Cannot find track ID");
  return trackIdWithUrlParams.split("?")[0];
}

// used for bridging
export async function searchOneTrack(query: string) {
  const url = DeezerAPIRoutes.searchTrack(query, 1);

  const trackRes = await fetch(url);
  if (trackRes.status !== 200) throw new Error("Fetch failed");

  const trackData = (await trackRes.json()) as
    | DeezerSearchTrackResponse
    | undefined;
  return trackData;
}

export async function streamTrack(track: Track, ext: DeezerExtractor) {
  const decryptionKey = ext.options.decryptionKey;
  if (!decryptionKey) throw new Error("MISSING DEEZER DECRYPTION KEY"); // cant decrypt due to missing key

  const crypto = await getCrypto();
  const trackId = extractTrackId(track.url);

  const trackHash = crypto
    .createHash("md5")
    .update(trackId, "ascii")
    .digest("hex");
  const trackKey = Buffer.alloc(16);

  const Decryptor = ext.options.decryptor || JSDecryptor;

  for (let iter = 0; iter < 16; iter++)
    /* tslint:disable-next-line no-bitwise */
    trackKey.writeInt8(
      trackHash[iter].charCodeAt(0) ^
        trackHash[iter + 16].charCodeAt(0) ^
        decryptionKey[iter].charCodeAt(0),
      iter
    );

  const trackInfoRes = await ext.fetch(
    `https://www.deezer.com/ajax/gw-light.php?method=song.getListData&input=3&api_version=1.0&api_token=${ext.userInfo.csrfToken}`,
    {
      method: "POST",
      headers: {
        Cookie: `${ext.userInfo.cookie}; arl=${ext.options.arl}`,
        "User-Agent":
          "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
        DNT: "1",
      },
      body: JSON.stringify({
        sng_ids: [trackId],
      }),
    }
  );

  const songInfo = (await trackInfoRes.json()).results.data[0];

  const streamInfoRes = await fetch("https://media.deezer.com/v1/get_url", {
    method: "POST",
    body: JSON.stringify({
      license_token: ext.userInfo.licenseToken,
      media: [
        {
          type: "FULL",
          formats: [
            {
              cipher: "BF_CBC_STRIPE",
              format: "FLAC",
            },
            {
              cipher: "BF_CBC_STRIPE",
              format: "MP3_256",
            },
            {
              cipher: "BF_CBC_STRIPE",
              format: "MP3_128",
            },
            {
              cipher: "BF_CBC_STRIPE",
              format: "MP3_MISC",
            },
          ],
        },
      ],
      track_tokens: [songInfo.TRACK_TOKEN],
    }),
  });
  const streamInfo = await streamInfoRes.json();

  const trackMediaUrl = streamInfo.data[0].media[0].sources[0].url;

  ext.context.player.debug("DEEZER FOUND MEDIA URL " + trackMediaUrl);

  const trackReq = await ext.fetch(trackMediaUrl);
  // @ts-ignore
  const readable = Readable.fromWeb(trackReq.body);
  let buffer = Buffer.alloc(0);
  let i = 0;

  const bufferSize = 2048; // 2mb

  const passThrough = new PassThrough();

  const decryptor = new Decryptor(trackKey, IV);

  readable.on("readable", async () => {
    let chunk = null;
    while (true) {
      chunk = readable.read(bufferSize);

      if (!chunk) {
        if (readable.readableLength) {
          chunk = readable.read(readable.readableLength);
          buffer = Buffer.concat([buffer, chunk]);
        }
        break;
      } else {
        buffer = Buffer.concat([buffer, chunk]);
      }

      while (buffer.length >= bufferSize) {
        const bufferSized = buffer.subarray(0, bufferSize);

        if (i % 3 === 0) {
          const decipher = await decryptor.decrypt(bufferSized);
          passThrough.write(decipher);
        } else {
          passThrough.write(bufferSized);
        }

        i++;

        buffer = buffer.subarray(bufferSize);
      }
    }
  });

  return passThrough;
}

export const deezerRegex = {
  track: /(^https:)\/\/(www\.)?deezer.com\/([a-zA-Z]+\/)?track\/[0-9]+/,
  playlistNalbums:
    /(^https:)\/\/(www\.)?deezer.com\/[a-zA-Z]+\/(playlist|album)\/[0-9]+(\?)?(.*)/,
  share: /(^https:)\/\/dzr\.page\.link\/[A-Za-z0-9]+/,
} as const;

export function validate(query: string) {
  return (
    deezerRegex.track.test(query) ??
    deezerRegex.playlistNalbums.test(query) ??
    deezerRegex.share.test(query)
  );
}
