# NewsRail

NewsRail polls sources, filters items, writes posts with your model, renders cards, publishes to selected platforms, and stores every post. Each wire uses one config file.

## What makes it NewsRail

**Hard filters run before scoring.** A wire declares a maximum age, source allow-list, score floor, star floor, deny patterns, and custom predicates. NewsRail drops an item that fails any filter before ranking items. A story with ten thousand points from last week remains last week's story. The score orders only items that pass the filters.

**Code checks every model draft.** One model call drafts a batch of posts. Each draft passes through checks for every platform's length limit, links in the body, hashtag rules, emoji, first-person claims, repeated stories, and a lead that names the source's company or project. Optional noise and prose checks also run. NewsRail refuses a draft that fails any check and logs the reason.

**NewsRail records a post after the platform confirms it.** The transport verifies every send. On Bluesky, it reads the record back. On Threads, it reads the published post back. On X, it checks the post id and text returned by the API. A verified send marks the story as posted, and the store writes only verified posts. An unverified send keeps the story reserved and reports the slot as still owed.

**One config file per wire.** Sources, filters, prompt, gate, card, platforms, cadence and storage are all declared in one file. `runTick(config)` runs one tick of that wire.

## Install

```sh
npm install newsrail
```

NewsRail requires Node 22.5 or newer. NewsRail has no required dependencies. `@resvg/resvg-js` is optional and converts cards to PNG files. Without it, NewsRail outputs SVG cards. SVG cards work for dry runs and websites, but platform uploads require PNG cards.

## Try it without posting anything

The repository includes The Standup as a worked example. Compound Labs publishes The Standup as a developer wire. The wire covers releases, CVEs, outages, and breaking changes. The example polls only public feeds and needs no key.

```sh
git clone https://github.com/kyisaiah47/newsrail
cd newsrail
npm install
node src/cli.mjs tick examples/standup/wire.mjs --dry --provider stub
```

`--dry` replaces every transport with a dry transport that sends nothing. It keeps separate state files and writes only to local stores. `--provider stub` writes each post from the item's title, so it calls no model. The tick polls about 1,400 items from vendor changelogs, status pages, GitHub release feeds, and GitHub security advisories. It drops items older than 12 hours. It drafts a batch, gates the drafts, renders a card, publishes to two dry transports, and writes `.newsrail/standup/site/feed.json`.

## Video tutorial

The video tutorial is at https://youtu.be/xArPj7liCm0. It runs the dry tick of The Standup from a fresh clone. It reads the wire config line by line. It shows the files you change to build a different wire, and it creates the site with `new-app`.

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

You can run one tick from the command line or from code.

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

1. **poll** runs every source adapter and merges items by canonical URL key.
2. **select** applies the hard filters, drops stories already claimed by the wire, ranks the remaining stories by score, and cuts the batch.
3. **write** sends the batch to the model in one call. Each draft passes through the code gate. NewsRail reserves and queues a draft that passes.
4. **illustrate** renders a card for the freshest queued draft. If no card exists, the draft stays queued and the tick reports the slot as owed.
5. **publish** posts to each due platform, adds the source reply, verifies each post, and records it.
6. **store** writes rows from verified post records. A store error does not fail the tick. NewsRail logs the error and writes the same rows on the next tick.

`runTick` returns `{ posted, held, owed }`. `posted` lists `{ platform, url, id }` for each verified post. `held` states why nothing or not everything went out. `owed` is true when the wire caused the hold, such as when no fresh story exists or a draft is refused. The next tick should try again when `owed` is true. A platform signal can report an auth failure, rate limit, suspension, or identity mismatch. The signal stops that platform for the tick and appears in `signals`.

The command line exits 0 when the tick posts, owes a slot, or stops on a platform signal. It exits 75 when cadence or the arm flag holds the tick. It exits 1 when the agent itself has a fault.

## Sources

| Adapter | What it reads |
| --- | --- |
| `rssFeeds({ feeds })` | RSS 2.0 and Atom feeds. `titlePrefix: true` puts the feed's name in front of each title, which status-page feeds need. |
| `hackerNews({ lists, minScore })` | The Hacker News API. The thread is the item's identity and the linked article is the reader's link. |
| `githubTopics({ topics, minStars })` | GitHub repository search by topic. Forks, templates and archived repositories are skipped. |
| `githubReleases({ repos })` | Release feeds for a list of repositories. Canary, nightly and prerelease tags are dropped. |
| `githubAdvisories({ severities })` | Reviewed GitHub security advisories that name a package. |
| `jsonFeed({ url })` | JSON Feed 1.1 by default. Any JSON API works with `itemsPath` and `map`. |

An adapter is any object with a `poll(ctx)` function that returns items. A failing adapter logs an error and returns nothing. One broken feed therefore does not end a tick.

## Transports

Every public transport uses the platform's official API.

| Transport | API | Verification |
| --- | --- | --- |
| `bluesky({ identifier, password, expectedHandle })` | AT Protocol XRPC with an app password | Reads the record back and compares the text and CID |
| `x({ accessToken })` or `x({ consumerKey, consumerSecret, token, tokenSecret })` | X API v2, OAuth 2.0 or OAuth 1.0a user context | Checks the id and text the API returned. `readBack: true` also reads the post back. |
| `threads({ accessToken, hostImage })` | Threads API, container then publish | Reads the published post back |
| `webhook({ url, secret })` | A JSON POST to your endpoint, signed with HMAC-SHA256 | The receiver's 2xx answer, or your own `verify` function |

An `expectedHandle` makes the transport refuse posts from other accounts. Threads requires a public URL for each image. `hostImage(file)` uploads the card and returns its URL. `supabaseImageHost({ bucket })` provides one implementation.

## Stores

| Store | What it writes |
| --- | --- |
| `jsonFeedStore({ path })` | A JSON Feed 1.1 file, with the cards copied into a `cards/` folder beside it |
| `sqliteStore({ path, table })` | A SQLite table through `node:sqlite`, keyed by slug |
| `supabaseStore({ table, bucket, columns })` | A Supabase table upserted on slug, with cards uploaded to a Storage bucket |

## Models

NewsRail uses one provider interface for every model. You provide the model key.

```js
import { createProvider } from 'newsrail';

createProvider({ type: 'openai', model: 'your-model' });                 // OPENAI_API_KEY
createProvider({ type: 'anthropic', model: 'your-model' });              // ANTHROPIC_API_KEY
createProvider({ type: 'gemini', model: 'gemini-2.5-flash' });           // GEMINI_API_KEY
createProvider({ type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'llama3.1' });
createProvider({ type: 'command', command: 'my-model-cli', args: ['--model', '{model}'] });
createProvider({ type: 'stub' });                                        // no model, for tests and dry runs
```

`models: { compose: 'bigger-model' }` maps a wire's `purpose` to a model. NewsRail reads a key from the environment only when a call runs and no `apiKey` was passed.

## Cards

`renderCard()` draws one of two layouts. The `software` card measures 1200 by 630 pixels and uses a dark grid plate, a small kicker with the wire's accent mark, a headline, an optional object image, and the publication and source along the bottom. The `news` card measures 1080 by 1350 pixels and uses a photograph, a dark scrim, a kicker pill in the accent colour, a large headline, and a bar with the source and photo credit. A news card requires a photograph. Without one, the draft stays queued.

## A site for the wire

```sh
npx newsrail new-app --app both --dir ./site --name "My Wire"
```

`new-app` writes a Next.js site that reads the wire's JSON feed from `public/feed.json` or from a URL passed with `--feed`. `--app console` creates a dense view with filters, a table of posts, and a detail panel. `--app simple` creates a roomier view with the newest post first and details behind disclosures. `--app both` creates both views, a Start here dialog, and a switch in the footer. The site saves the visitor's choice. `?view=simple` or `?view=console` overrides that choice.

## Scheduling

`npx newsrail schedule my-wire.mjs --every 600` prints a crontab line and a launchd job for the wire. Each platform can also run on its own schedule with `--platform`.

You are responsible for following each platform's rules on automated posting.

## Development

```sh
npm test
node scripts/scrub-gate.mjs
```

The tests run offline with a stub model and fake HTTP. No test reads a paid model key. The scrub gate fails on private addresses, private identifiers, account handles, key-shaped strings, and bot-detection bypass code. CI runs both test commands on every push.

## License

NewsRail uses the MIT license. Compound Labs owns the copyright. Compound Labs makes NewsRail: [Compound Labs](https://thecompound.tech).
