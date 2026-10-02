# NewsRail

NewsRail is a news agent. It polls sources, filters what it finds, writes a post with your model, renders a card, publishes to the platforms you choose, and stores a record of every post. Each wire is one config file.

## What makes it NewsRail

**Hard filters come first, and the score never overrides them.** A wire declares its filters: maximum age, the sources on its beat, score and star floors, deny patterns and your own predicates. An item that fails one is dropped before anything ranks it. A story with ten thousand points from last week is still last week's story. The score only orders the items that passed.

**The model's yes is checked by code.** One model call drafts a batch of posts. Each draft then goes through a code gate: the length limit for every platform, no links in the body, the hashtag rule, no emoji, no first-person claims, no repeat of a story the wire already covered, the lead must name the source's company or project, and optional noise and prose checks. A draft that fails any check is refused and the reason is logged.

**A post is recorded only after the platform confirms it.** After each send, the transport verifies the post. On Bluesky it reads the record back. On Threads it reads the published post back. On X it checks the post id and text that the API returned. Only a verified send marks the story as posted, and the store writes only verified posts. A send that cannot be verified keeps the story reserved and reports the slot as still owed.

**One config file per wire.** Sources, filters, prompt, gate, card, platforms, cadence and storage are all declared in one file. `runTick(config)` runs one tick of that wire.

## Install

```sh
npm install newsrail
```

NewsRail needs Node 22.5 or newer. It has no required dependencies. `@resvg/resvg-js` installs as an optional dependency and turns cards into PNG files. Without it, cards are SVG, which is enough for a dry run and for a website but not for a platform upload.

## Try it without posting anything

The repository includes The Standup as a worked example. The Standup is a developer wire published by Compound Labs. Its beat is releases, CVEs, outages and breaking changes. The example polls public feeds only and needs no key.

```sh
git clone https://github.com/kyisaiah47/newsrail
cd newsrail
npm install
node src/cli.mjs tick examples/standup/wire.mjs --dry --provider stub
```

`--dry` replaces every transport with a dry one that sends nothing, keeps separate state files, and writes only to local stores. `--provider stub` writes each post from the item's title, so no model is called. The tick polls about 1,400 items from vendor changelogs, status pages, GitHub release feeds and GitHub security advisories. It drops everything older than 12 hours, drafts a batch, gates it, renders a card, publishes to two dry transports and writes `.newsrail/standup/site/feed.json`.

## A wire config

```js
import { defineWire, rssFeeds, githubAdvisories, bluesky, jsonFeedStore } from 'newsrail';

export default defineWire({
  slug: 'my-wire',
  beat: 'security advisories for the npm packages our readers depend on',
  sources: [
    githubAdvisories({ severities: ['critical', 'high'], ecosystem: 'npm' }),
    rssFeeds({ feeds: [{ url: 'https://nodejs.org/en/feed/blog.xml', name: 'Node.js' }] }),
  ],
  filters: { maxAgeH: 12 },
  score: (item) => -item.ageH,
  batch: 8,
  compile: 'on-demand',
  model: { type: 'gemini', model: 'gemini-2.5-flash' },
  gate: 'default',
  copyGates: ['noise', 'prose'],
  card: { mode: 'software', publication: 'My Wire', credit: 'mywire.example', accent: '#5c74ff' },
  platforms: ['bluesky'],
  platformRules: { bluesky: { maxChars: 300, tags: 'one' } },
  transports: { bluesky: bluesky({ expectedHandle: 'mywire.example' }) },
  cadence: { activeHours: [8, 22], gapMinutes: 120 },
  stores: [jsonFeedStore({ path: 'site/public/feed.json', title: 'My Wire' })],
  armFlag: './ARMED',
});
```

Run one tick from the command line or from code.

```sh
npx newsrail tick my-wire.mjs
npx newsrail tick my-wire.mjs --platform bluesky
```

```js
import { runTick } from 'newsrail';
import wire from './my-wire.mjs';

const { posted, held, owed } = await runTick(wire, { dry: false });
```

### Config fields

| Field | What it does |
| --- | --- |
| `slug` | The wire's id. It names the state directory and the claim rows. |
| `beat` | One sentence that says what the wire covers. The writer prompt uses it. |
| `voice` | The wire's register, as text. The writer follows it. |
| `sources` | Source adapters. Every adapter runs on each poll. |
| `filters` | Hard filters: `maxAgeH`, `sources` (the beat as an allow-list), `minScore`, `minStars`, `deny`, `denyHosts`, `custom`. |
| `score` | A function of an item. It ranks only what passed the filters. The default puts the freshest first. |
| `batch` | How many items go to the model in one call. |
| `compile` | `on-demand` writes only when the queue has no fresh draft. `every-tick` writes on every tick and fills the queue. |
| `prompt` | Extra instructions as a string, or a function that returns the whole prompt. |
| `model`, `purpose` | The provider, and the purpose name passed to it. A provider can map each purpose to its own model. |
| `gate` | `default`, `verbatim` (every figure in the post must appear in the source), your own function, or a list of these. |
| `copyGates` | `noise` and `prose`: optional checks for filler phrases and captions in place of sentences. |
| `ownNames` | Names the wire must never mention. The gate refuses a draft that does. |
| `card` | `mode` (`software` or `news`), `publication`, `credit`, `accent`, and functions for the kicker, the object image and the photograph. |
| `platforms`, `platformRules` | Where the wire posts, with each platform's `maxChars`, `targetChars` and tag rule (`none` or `one`). |
| `transports` | One transport per platform. |
| `cite` | When true (the default), a reply carries the source link. |
| `cadence` | `activeHours`, `gapMinutes` and `timezone`. Outside the window or inside the gap, the tick holds. |
| `stateDir`, `claims` | Where the queue, the posted log and the claim ledger live. Several wires can share one claims file. |
| `stores`, `table`, `row`, `bucket` | Where verified posts are written, and the function that turns a posted record into a row. |
| `mirrorPolicy` | `{ delete: true }` removes stored rows that have no verified post behind them. The default keeps every row. |
| `armFlag` | A file path. A real tick holds until the file exists. |
| `launchd` | The scheduler label. `newsrail schedule` uses it. |

## How a tick runs

1. **poll** runs every source adapter and merges the items on a canonical URL key.
2. **select** applies the hard filters, drops stories the wire already claimed, ranks the rest by score and cuts the batch.
3. **write** sends the batch to the model in one call. Each draft goes through the code gate. A draft that passes is reserved in the claim ledger and queued.
4. **illustrate** renders the card for the freshest queued draft. No card means no post: the draft stays queued and the tick reports the slot as owed.
5. **publish** posts to each due platform, adds the source reply, verifies the post, and records it.
6. **store** writes rows from the record of verified posts. It never fails the tick. A store error is logged and the next tick writes the same rows again.

`runTick` returns `{ posted, held, owed }`. `posted` lists `{ platform, url, id }` for each verified post. `held` says why nothing, or not everything, went out. `owed` is true when the reason is on the wire's side, such as no fresh story or a refused draft, and the next tick should try again. A platform signal (an auth failure, a rate limit, a suspension or an identity mismatch) stops that platform for the tick and is listed in `signals`.

The command line exits 0 when the tick posted, owed a slot, or stopped on a platform signal. It exits 75 when the tick held for cadence or the arm flag, and 1 on a fault in the agent itself.

## Sources

| Adapter | What it reads |
| --- | --- |
| `rssFeeds({ feeds })` | RSS 2.0 and Atom feeds. `titlePrefix: true` puts the feed's name in front of each title, which status-page feeds need. |
| `hackerNews({ lists, minScore })` | The Hacker News API. The thread is the item's identity and the linked article is the reader's link. |
| `githubTopics({ topics, minStars })` | GitHub repository search by topic. Forks, templates and archived repositories are skipped. |
| `githubReleases({ repos })` | Release feeds for a list of repositories. Canary, nightly and prerelease tags are dropped. |
| `githubAdvisories({ severities })` | Reviewed GitHub security advisories that name a package. |
| `jsonFeed({ url })` | JSON Feed 1.1 by default. Any JSON API works with `itemsPath` and `map`. |

An adapter is any object with a `poll(ctx)` function that returns items. A failing adapter logs and returns nothing, so one broken feed never ends a tick.

## Transports

Every public transport uses the platform's official API.

| Transport | API | Verification |
| --- | --- | --- |
| `bluesky({ identifier, password, expectedHandle })` | AT Protocol XRPC with an app password | Reads the record back and compares the text and CID |
| `x({ accessToken })` or `x({ consumerKey, consumerSecret, token, tokenSecret })` | X API v2, OAuth 2.0 or OAuth 1.0a user context | Checks the id and text the API returned. `readBack: true` also reads the post back. |
| `threads({ accessToken, hostImage })` | Threads API, container then publish | Reads the published post back |
| `webhook({ url, secret })` | A JSON POST to your endpoint, signed with HMAC-SHA256 | The receiver's 2xx answer, or your own `verify` function |

An `expectedHandle` makes the transport refuse to post from any other account. Threads needs a public URL for each image, so `hostImage(file)` uploads the card and returns its URL. `supabaseImageHost({ bucket })` is one implementation.

## Stores

| Store | What it writes |
| --- | --- |
| `jsonFeedStore({ path })` | A JSON Feed 1.1 file, with the cards copied into a `cards/` folder beside it |
| `sqliteStore({ path, table })` | A SQLite table through `node:sqlite`, keyed by slug |
| `supabaseStore({ table, bucket, columns })` | A Supabase table upserted on slug, with cards uploaded to a Storage bucket |

## Models

One provider interface covers every model. You bring your own key.

```js
import { createProvider } from 'newsrail';

createProvider({ type: 'openai', model: 'your-model' });                 // OPENAI_API_KEY
createProvider({ type: 'anthropic', model: 'your-model' });              // ANTHROPIC_API_KEY
createProvider({ type: 'gemini', model: 'gemini-2.5-flash' });           // GEMINI_API_KEY
createProvider({ type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'llama3.1' });
createProvider({ type: 'command', command: 'my-model-cli', args: ['--model', '{model}'] });
createProvider({ type: 'stub' });                                        // no model, for tests and dry runs
```

`models: { compose: 'bigger-model' }` maps a wire's `purpose` to a model. A key is read from the environment only when a call runs and no `apiKey` was passed.

## Cards

`renderCard()` draws one of two layouts. The `software` card is a 1200 by 630 landscape card: a dark grid plate, a small kicker with the wire's accent mark, the headline, an optional object image, and the publication and source along the bottom. The `news` card is a 1080 by 1350 portrait card: a photograph, a dark scrim, a kicker pill in the accent colour, a large headline and a bar with the source and the photo credit. A news card needs a photograph; without one the draft stays queued.

## A site for the wire

```sh
npx newsrail new-app --app both --dir ./site --name "My Wire"
```

`new-app` writes a Next.js site that reads the wire's JSON feed from `public/feed.json`, or from a URL with `--feed`. `--app console` gives a dense view with filters, a table of posts and a detail panel. `--app simple` gives a roomier view with the newest post first and details behind disclosures. `--app both` gives both views, a Start here dialog and a switch in the footer. The visitor's choice is saved, and `?view=simple` or `?view=console` overrides it.

## Scheduling

`npx newsrail schedule my-wire.mjs --every 600` prints a crontab line and a launchd job for the wire. Each platform can also run on its own schedule with `--platform`.

You are responsible for following each platform's rules on automated posting.

## Development

```sh
npm test
node scripts/scrub-gate.mjs
```

The tests run offline with a stub model and fake HTTP. No test reads a paid model key. The scrub gate fails on private addresses, private identifiers, account handles, key-shaped strings and bot-detection bypass code. CI runs both on every push.

## License

MIT. Copyright Compound Labs. NewsRail is made by [Compound Labs](https://thecompound.tech).
