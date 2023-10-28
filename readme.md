# Discord Player Deezer Extractor

Discord Player Deezer Extractor. An extractor made for discord-player for **Deezer** support. Deezer extractor works by either making a request to the Deezer API or extracting metadata from the Deezer site. Because we cannot get streams from deezer itself, the extractor uses the extracted data to stream from youtube!

## Installing the extractor

```bash
npm install discord-player-deezer
# or
yarn add discord-player-deezer
```

## Loading the extractor

### CJS
```js
const DeezerExtractor = require("discord-player-deezer").default // or const { default: DeezerExtractor } = require("discord-player-deezer")
const player = getMainPlayerSomehow()

player.extractors.register(DeezerExtractor)
```

### ESM
```js
import { default as DeezerExtractor } from "discord-player-deezer"

const player = getMainPlayerSomehow()

player.extractors.register(DeezerExtractor)
```

### Typescript
```ts
import DeezerExtractor from "discord-player-deezer"

const player = getMainPlayerSomehow()

player.extractors.register(DeezerExtractor)
```

*note: be sure to register it before loading the default extractors to make sure any conflicts with discord-player's default attachment extractor is resolved!*

That's it! See the magic happen as you bot is now able to play from Deezer URLs
