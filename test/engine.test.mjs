import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runTick, defineWire, jsonFeedStore, stubProvider, PlatformSignal, exitCode, Claims } from '../src/index.mjs';
import { statePaths } from '../src/state.mjs';
import { fixedSource, sampleItems, tmpdir } from './helpers.mjs';

const quiet = () => {};

function wire(dir, over = {}) {
  return defineWire({
    slug: 'unit',
    beat: 'releases, incidents and advisories',
    sources: [fixedSource(sampleItems())],
    filters: { maxAgeH: 12 },
    batch: 4,
    platforms: ['bluesky', 'threads'],
    platformRules: { bluesky: { maxChars: 300, tags: 'one' }, threads: { maxChars: 500 } },
    card: { mode: 'software', publication: 'Unit Wire', credit: 'unit.example' },
    stateDir: path.join(dir, 'state'),
    stores: [jsonFeedStore({ path: path.join(dir, 'site', 'feed.json'), title: 'Unit Wire' })],
    ...over,
  });
}

/** A transport double that records sends and verifies as told. */
function recorder(platform, { verify = true, fail = null } = {}) {
  const sent = [];
  return {
    platform, sent,
    async post({ text, card }) {
      if (fail) throw fail;
      sent.push({ text, card });
      return { id: `${platform}-${sent.length}`, url: `https://${platform}.example/p/${sent.length}`, text };
    },
    async reply(parent, { text }) { sent.push({ reply: parent.id, text }); return { id: 'r' }; },
    async verify() { return verify; },
  };
}

test('a dry tick polls, selects, writes with the stub, renders a card, publishes dry and stores a JSON feed', async () => {
  const dir = tmpdir();
  const r = await runTick(wire(dir), { dry: true, log: quiet });
  assert.equal(r.posted.length, 2);
  assert.deepEqual(r.posted.map((p) => p.platform).sort(), ['bluesky', 'threads']);
  assert.equal(r.owed, false);
  const feed = JSON.parse(fs.readFileSync(path.join(dir, 'site', 'feed.json'), 'utf8'));
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0]._newsrail.posts.length, 2);
  assert.ok(fs.existsSync(path.join(dir, 'site', feed.items[0].image)), 'the card is copied beside the feed');
  // dry state is separate: the real claims file was never written
  assert.equal(fs.existsSync(statePaths(wire(dir)).claims), false);
});

test('the freshest event goes first and the 40 hour old item never reaches the writer', async () => {
  const dir = tmpdir();
  let seen = [];
  const provider = stubProvider({ respond: ({ items }) => { seen = items; return items.map((i) => ({ id: i.id, post: false, why: 'test' })); } });
  await runTick(wire(dir), { dry: true, provider, log: quiet });
  assert.ok(seen.length === 3);
  assert.ok(!seen.some((i) => /deprecates the legacy/.test(i.title)));
});

test('a claim is marked posted only after verify() returns true', async () => {
  const dir = tmpdir();
  const bad = recorder('bluesky', { verify: false });
  const good = recorder('threads');
  const cfg = wire(dir, { transports: { bluesky: bad, threads: good }, model: stubProvider() });
  const r = await runTick(cfg, { log: quiet });
  assert.deepEqual(r.posted.map((p) => p.platform), ['threads']);
  assert.equal(r.owed, true);
  assert.match(r.held, /bluesky: the send was not verified/);
  const claims = new Claims(statePaths(cfg).claims);
  const posted = claims.posted('unit');
  assert.deepEqual(posted.map((p) => p.platform), ['threads']);
});

test('on-demand compile reuses a queued draft; every-tick compile polls and writes on every tick', async () => {
  for (const [compile, expectPolls] of [['on-demand', 1], ['every-tick', 2]]) {
    const dir = tmpdir();
    let polls = 0;
    const src = { name: 'count', async poll() { polls += 1; return sampleItems(); } };
    const cfg = wire(dir, { compile, sources: [src], model: stubProvider(), transports: { bluesky: recorder('bluesky'), threads: recorder('threads') } });
    const a = await runTick(cfg, { platform: 'bluesky', log: quiet });
    const b = await runTick(cfg, { platform: 'threads', log: quiet });
    assert.equal(polls, expectPolls, `${compile}: polls`);
    assert.equal(a.posted.length, 1);
    assert.equal(b.posted.length, 1);
    if (compile === 'on-demand') assert.equal(b.posted[0].platform, 'threads');
  }
});

test('a platform signal stops that platform and is reported, and the exit code stays 0', async () => {
  const dir = tmpdir();
  const cfg = wire(dir, {
    model: stubProvider(),
    transports: { bluesky: recorder('bluesky', { fail: new PlatformSignal('identity mismatch', 'signed in as someone else') }), threads: recorder('threads') },
  });
  const r = await runTick(cfg, { log: quiet });
  assert.equal(r.signals.length, 1);
  assert.equal(r.signals[0].platform, 'bluesky');
  assert.deepEqual(r.posted.map((p) => p.platform), ['threads']);
  assert.equal(exitCode(r), 0);
});

test('cadence and the arm flag hold the tick with exit code 75', async () => {
  const dir = tmpdir();
  const t = { bluesky: recorder('bluesky'), threads: recorder('threads') };
  const armed = path.join(dir, 'ARMED');
  const cfg = wire(dir, { model: stubProvider(), transports: t, armFlag: armed, cadence: { gapMinutes: 60 } });
  const notArmed = await runTick(cfg, { log: quiet });
  assert.equal(notArmed.hold, true);
  assert.equal(exitCode(notArmed), 75);
  fs.writeFileSync(armed, '');
  const first = await runTick(cfg, { log: quiet });
  assert.equal(first.posted.length, 2);
  const second = await runTick(cfg, { log: quiet });
  assert.equal(second.hold, true);
  assert.match(second.held, /gap/);
  const outside = await runTick(wire(tmpdir(), { model: stubProvider(), transports: t, cadence: { activeHours: [3, 4] } }), { now: new Date(2026, 0, 1, 12).getTime(), log: quiet });
  assert.match(outside.held, /outside active hours/);
});

test('no card means no post: the draft stays queued and the slot is owed', async () => {
  const dir = tmpdir();
  const cfg = wire(dir, { model: stubProvider(), card: { mode: 'news', publication: 'Unit', photo: () => null }, transports: { bluesky: recorder('bluesky'), threads: recorder('threads') } });
  const r = await runTick(cfg, { log: quiet });
  assert.equal(r.posted.length, 0);
  assert.equal(r.owed, true);
  assert.match(r.held, /no card/);
  const queue = JSON.parse(fs.readFileSync(statePaths(cfg).queue, 'utf8'));
  assert.equal(queue.length >= 1, true);
});

test('when every draft is refused the tick reports the slot as owed', async () => {
  const dir = tmpdir();
  const provider = stubProvider({ respond: ({ items }) => items.map((i) => ({ id: i.id, post: true, text: 'See https://example.com for details', tag: 'x' })) });
  const r = await runTick(wire(dir), { dry: true, provider, log: quiet });
  assert.equal(r.posted.length, 0);
  assert.equal(r.owed, true);
});

test('a store failure never fails the tick', async () => {
  const dir = tmpdir();
  const broken = { name: 'broken', local: true, async upsert() { throw new Error('disk full'); } };
  const r = await runTick(wire(dir, { stores: [broken] }), { dry: true, log: quiet });
  assert.equal(r.posted.length, 2);
});

test('defineWire refuses a config without the required fields', () => {
  assert.throws(() => defineWire({ slug: 'x' }), /beat/);
  assert.throws(() => defineWire({ slug: 'x', beat: 'b', sources: [fixedSource([])], platforms: [] }), /platforms/);
  assert.throws(() => defineWire({ slug: 'x', beat: 'b', sources: [fixedSource([])], platforms: ['x'], compile: 'sometimes' }), /compile/);
});
