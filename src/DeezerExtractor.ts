import {
	Playlist as DeezerPlaylist,
	Track as DeezerTrack,
} from "@mithron/deezer-music-metadata";
import {
	BaseExtractor,
	Util as DPUtil,
	ExtractorInfo,
	ExtractorSearchContext,
	ExtractorStreamable,
	Playlist,
	SearchQueryType,
	Track,
} from "discord-player";
import { setTimeout } from "node:timers/promises";
import { BaseDecryptor } from "./Crypto/BaseDecryptor";
import {
	buildTrackFromSearch,
	deezerRegex,
	getCrypto,
	isUrl,
	search,
	searchOneTrack,
	streamTrack,
	validate,
} from "./utils/util";

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
	createStream?: (
	  track: Track,
	  ext: DeezerExtractor
	) => Promise<ExtractorStreamable>;
	searchLimit?: number;
	reloadUserInterval?: number;
	priority?: number;
	arl: string;
	decryptor?: typeof BaseDecryptor;
  };
  export type DeezerUserInfo = {
	cookie: string;
	licenseToken: string;
	csrfToken: string;
	mediaUrl: string;
  };

  export const Warnings = {
	MissingDecryption:
	  "Decryption Key missing! This is needed for extracting streams.",
  } as const;
  export type Warnings = (typeof Warnings)[keyof typeof Warnings];

  function parseCookie(obj: Record<string, string>) {
	let str = "";
	for (const key of Object.keys(obj)) {
	  str += ` ${key}=${obj[key]};`;
	}

	return str.trim();
  }

  async function fetchDeezerUser(ext: DeezerExtractor): Promise<DeezerUserInfo> {
	// extract deezer username
	// dynamically load crypto because some might not want streaming
	const crypto = await getCrypto();
	const randomToken = crypto.randomBytes(16).toString("hex");
	const deezerUsrDataUrl = `https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData&input=3&api_version=1.0&api_token=${randomToken}`;

	const usrDataRes = await ext.fetch(deezerUsrDataUrl);
	const usrData = await usrDataRes.json();

	const licenseToken = usrData.results.USER.OPTIONS.license_token;
	if (typeof licenseToken !== "string")
	  throw new Error("Unable to get licenseToken");

	const csrfToken = usrData.results.checkForm;
	if (typeof csrfToken !== "string")
	  throw new Error(
		"Unable to get csrf token which is required for decryption"
	  );

	return {
	  cookie: usrDataRes.headers.get("set-cookie")!,
	  licenseToken,
	  csrfToken,
	  mediaUrl: usrData.results.URL_MEDIA || "https://media.deezer.com",
	};
  }

  export class DeezerExtractor extends BaseExtractor<DeezerExtractorOptions> {
	static readonly identifier: string =
	  "com.retrouser955.discord-player.deezr-ext";
	userInfo!: DeezerUserInfo;
	/* tslint:disable-next-line */
	__interval?: ReturnType<typeof setInterval>;

	async fetch(
	  input: Parameters<typeof fetch>[0],
	  options?: Parameters<typeof fetch>[1]
	) {
	  if (!options) options = {};
	  options.headers = {
		Cookie: parseCookie({ arl: this.options.arl }),
		"User-Agent":
		  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
		DNT: "1",
		Origin: "https://www.deezer.com",
		Connection: "keep-alive",
		Referer: "https://www.deezer.com/login",
		...options?.headers,
	  };
	  return fetch(input, options);
	}

	async activate(): Promise<void> {
	  this.protocols = ["deezer"];
	  if (!this.options.decryptionKey)
		process.emitWarning(Warnings.MissingDecryption);
	  else {
		this.userInfo = await fetchDeezerUser(this);

		this.context.player.debug(
		  "USER INFO EXT: " + JSON.stringify(this.userInfo)
		);
	  }

	  if (this.options.priority) {
		this.priority = this.options.priority;
	  }

	  this.__interval = setInterval(async () => {
		try {
		  this.userInfo = await fetchDeezerUser(this);
		} catch {
		  this.context.player.debug(
			"[DEEZER_EXTRACTOR_ERR]: Unable to fetch user information from Deezer. Retrying in 3 seconds ..."
		  );
		  await setTimeout(3000 /* 3 seconds */);
		  try {
			this.userInfo = await fetchDeezerUser(this);
		  } catch (err) {
			this.context.player.debug(
			  "[DEEZER_EXTRACTOR_ERR]: Retry failed. Using old user ..."
			);
		  }
		}
	  }, this.options.reloadUserInterval || 8.64e7 /* one day */).unref();
	}

	async deactivate() {
	  if (this.__interval) clearInterval(this.__interval);
	  this.protocols = [];
	}

	async validate(
	  query: string,
	  type: SearchQueryType & "deezer"
	): Promise<boolean> {
	  return validate(query) || type === "deezer" || !isUrl(query);
	}

	buildPlaylistData(
	  data: DeezerPlaylist,
	  handleContext: ExtractorSearchContext
	) {
	  const raw: string[] = data.url.split("/");
	  const identifier: string = raw[raw.length - 1].split("?")[0];

	  return new Playlist(this.context.player, {
		title: data.name,
		thumbnail: data.thumbnail[0].url,
		author: {
		  name: data.artist.name,
		  url: data.artist.url,
		},
		type: data.type,
		tracks: data.tracks.map((v) => this.buildTrack(v, handleContext)),
		description: "",
		source: "arbitrary",
		id: identifier,
		url: data.url,
	  });
	}

	async handle(
	  query: string,
	  context: ExtractorSearchContext
	): Promise<ExtractorInfo> {
	  if (!isUrl(query)) {
		const rawSearch = await search(query);
		const tracks = buildTrackFromSearch(
		  rawSearch,
		  this.context.player,
		  context.requestedBy
		);
		return this.createResponse(null, tracks);
	  }

	  if (deezerRegex.share.test(query)) {
		const redirect = await this.fetch(query);
		query = redirect.url; // follow the redirect of deezer page links
	  }

	  const metadata = await this.fetch(query);
	  const text = await metadata.text();
	  const match = text.match(
		/<script>window.__DZR_APP_STATE__ = (.*?)<\/script>/
	  );
	  if (!match) throw new Error("Unable to retrieve Deezer data");

	  const metadataParsed = JSON.parse(match[1]);
	  if (!metadataParsed) throw new Error("Invalid Deezer data");

	  return metadataParsed?.SONGS?.data?.length > 0
		? this.handlePlaylist(metadataParsed, context)
		: this.handleTrack(metadataParsed, context);
	}

	private handlePlaylist(
	  metadataParsed: any,
	  context: ExtractorSearchContext
	): ExtractorInfo {
	  const playlistData: DeezerPlaylist = {
		name: metadataParsed.DATA.TITLE,
		url: `https://www.deezer.com/playlist/${metadataParsed.DATA.PLAYLIST_ID}`,
		description: metadataParsed.DATA.DESCRIPTION || "",
		type: "playlist",
		artist: {
		  name: metadataParsed.DATA.PARENT_USERNAME,
		  url: `https://www.deezer.com/profile/${metadataParsed.DATA.PARENT_USER_ID}`,
		  image: metadataParsed.DATA.PARENT_USER_PICTURE || undefined,
		},
		thumbnail: this.buildThumbnails(metadataParsed.DATA.PLAYLIST_PICTURE),
		tracks: metadataParsed.SONGS.data.map((song: any) =>
		  this.buildTrackData(song)
		),
	  };

	  const playlist = this.buildPlaylistData(playlistData, context);
	  return this.createResponse(playlist, playlist.tracks);
	}

	private handleTrack(
	  metadataParsed: any,
	  context: ExtractorSearchContext
	): ExtractorInfo {
	  const trackData: DeezerTrack = this.buildTrackData(metadataParsed.DATA);
	  return this.createResponse(null, [this.buildTrack(trackData, context)]);
	}

	private buildTrackData(song: any): DeezerTrack {
	  return {
		name: song.SNG_TITLE,
		url: `https://www.deezer.com/track/${song.SNG_ID}`,
		duration: parseInt(song.DURATION, 10),
		type: "song",
		author: [
		  {
			name: song.ART_NAME,
			url: `https://www.deezer.com/artist/${song.ART_ID}`,
			image: song.ART_PICTURE
			  ? `https://e-cdns-images.dzcdn.net/images/artist/${song.ART_PICTURE}/500x500-000000-80-0-0.jpg`
			  : undefined,
		  },
		],
		thumbnail: this.buildThumbnails(song.ALB_PICTURE),
	  };
	}

	private buildThumbnails(imageId?: string) {
	  if (!imageId) return [];
	  return [1000, 500, 250, 56].map((size) => ({
		width: size,
		height: size,
		url: `https://e-cdns-images.dzcdn.net/images/cover/${imageId}/${size}x${size}-000000-80-0-0.jpg`,
	  }));
	}

	buildTrack(track: DeezerTrack, { requestedBy }: ExtractorSearchContext) {
	  return new Track(this.context.player, {
		title: track.name,
		author: track.author.map((v) => v.name).join(", "),
		url: track.url,
		source: "arbitrary",
		thumbnail: track.thumbnail[0].url,
		duration: DPUtil.buildTimeCode(DPUtil.parseMS(track.duration)),
		requestedBy,
	  });
	}

	async bridge(track: Track): Promise<ExtractorStreamable | null> {
	  const deezerTrack = await searchOneTrack(
		`${track.author} ${track.source === "youtube" ? track.cleanTitle : track.title}`
	  );

	  if (!deezerTrack) return null;
	  const dpTrack = buildTrackFromSearch(
		deezerTrack,
		this.context.player,
		track.requestedBy
	  );

	  const stream = this.stream(dpTrack[0]);

	  return stream;
	}

	stream(info: Track): Promise<ExtractorStreamable> {
	  return streamTrack(info, this);
	}
  }
