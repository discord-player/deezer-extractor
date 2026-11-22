# Discord Player Deezer

Discord Player Deezer is a Deezer platform plugin for discord-player

# Installation

```bash
$ npm install discord-player-deezer
```

# Register the extractor

```ts
import { DeezerExtractor } from "discord-player-deezer"
import { Player } from "discord-player"

const player = new Player(...)

await player.extractors.register(DeezerExtractor, {})
```

# Extracting Streams

As Deezer sends DMCA to repositories containing the hard-coded decryption key, it is not provided. You can find this key in the code of related projects (deezer downloaders) and your client-side JavaScript code.

```ts
import { DeezerExtractor } from "discord-player-deezer"
import { Player } from "discord-player"

const player = new Player(...)

await player.extractors.register(DeezerExtractor, {
    decryptionKey: "master-decryption-key"
})
```

# Caching (optional)

Pass a `cache` to store decrypted tracks on disk. Caching is disabled unless you provide one; cached tracks skip both the download and the decryption step on repeat plays.

```ts
import { DeezerExtractor, DiskAudioCache } from "discord-player-deezer"

const cache = new DiskAudioCache({
    directory: "./deezer-cache",          // default: <tmp>/discord-player-deezer-cache
    maxSongs: 100,                        // oldest entries are removed first
    maxAge: 7 * 24 * 60 * 60 * 1000,      // expire entries after 7 days (0 = never)
    cleanupInterval: 60 * 60 * 1000       // run cleanup hourly (0 = only after writes)
})

await player.extractors.register(DeezerExtractor, {
    decryptionKey: "master-decryption-key",
    cache
})
```

You can also implement `IAudioCache` to use a different storage backend.
