import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defineWire, select, hardFilter, Claims, codeGate, parseDrafts, noiseIssues, proseIssues, keyOf } from '../src/index.mjs';
import { fixedSource, sampleItems, tmpdir } from './helpers.mjs';

const base = (over = {}) => defineWire({
  slug: 'test-wire', beat: 'test beat', sources: [fixedSource([])], platforms: ['bluesky'], ...over,
});
const prep = (items, now = Date.now()) => items.map((i) => ({ ...i, key: keyOf(i.url), ageH: (now - Date.parse(i.publishedAt)) / 3.6e6 }));

test('a hard filter is never traded against the score', () => {
  const cfg = base({ filters: { maxAgeH: 12 }, score: (i) => i.score ?? 0 });
  const items = prep(sampleItems());
  const { batch, dropped } = select(items, cfg);
  assert.ok(!batch.some((i) => i.url.endsWith('old-news')), 'the 9999-score item older than 12h must be gone');
  assert.equal(dropped['too-old'], 1);
});

test('the beat is an allow-list, and minScore applies only to items that carry a score', () => {
  const cfg = base({ filters: { maxAgeH: 48, sources: ['advisory', 'feed'], minScore: 50 } });
  const items = prep(sampleItems());
  const { passed, dropped } = select(items, cfg);
  assert.deepEqual(passed.map((i) => i.source).sort(), ['advisory', 'feed']);
  assert.equal(dropped['off-beat'], 2);
});

test('deny patterns, custom predicates, missing dates and claimed items are dropped', () => {
  const dir = tmpdir();
  const claims = new Claims(path.join(dir, 'claims.json'));
  const items = prep(sampleItems());
  claims.reserve(items[0], 'test-wire');
  const cfg = base({ filters: { maxAgeH: 12, deny: [/runtime/i], custom: [(i) => (i.source === 'status' ? 'no outages today' : true)] } });
  assert.equal(hardFilter(items[0], cfg, { claims }), 'claimed');
  assert.equal(hardFilter(items[1], cfg, { claims }), 'no outages today');
  assert.equal(hardFilter(items[2], cfg, { claims }), 'denied');
  assert.equal(hardFilter({ ...items[2], ageH: null }, cfg, { claims }), 'no-date');
});

test('select ranks by score inside what passed and cuts the batch', () => {
  const cfg = base({ filters: { maxAgeH: 12 }, batch: 2, score: (i) => (i.source === 'release' ? 10 : 1) });
  const { batch } = select(prep(sampleItems()), cfg);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].source, 'release');
});

const item = { title: 'HIGH: left-pad: Prototype pollution in left-pad before 2.0.1', author: 'left-pad', text: 'left-pad before 2.0.1 allows prototype pollution.', metrics: 'high, npm, CVE-2026-0001' };
const rules = { bluesky: { maxChars: 300, tags: 'none' }, threads: { maxChars: 500, tags: 'none' } };

test('the code gate refuses what the model said yes to', () => {
  const ok = { text: 'left-pad before 2.0.1 has a prototype pollution bug. Anything merging untrusted keys with it is exposed until it upgrades.' };
  assert.equal(codeGate(ok, item, { rules }), null);
  assert.match(codeGate({ text: `${ok.text} https://x.example` }, item, { rules }), /link/);
  assert.match(codeGate({ text: `${ok.text} #security` }, item, { rules }), /hashtag/);
  assert.match(codeGate({ text: 'x'.repeat(301) }, item, { rules }), /too long for bluesky/);
  assert.match(codeGate({ text: 'We tested left-pad 2.0.1 and it is fine.' }, item, { rules }), /first-person/);
  assert.match(codeGate({ text: 'A popular package has a bug that matters.' }, item, { rules }), /missing source entity/);
  assert.match(codeGate(ok, item, { rules, covered: ['Prototype pollution in left-pad before 2.0.1'] }), /already covered/);
  assert.match(codeGate({ text: 'left-pad matters to ExampleCo users.' }, item, { rules, ownNames: ['ExampleCo'] }), /names ExampleCo/);
  assert.match(codeGate({ text: 'left-pad has a bug 🔥' }, item, { rules }), /emoji/);
});

test('a platform that needs one tag refuses a draft without a valid tag, and counts the tag in the length', () => {
  const r = { bluesky: { maxChars: 60, tags: 'one' } };
  assert.match(codeGate({ text: 'left-pad before 2.0.1 has a bug.' }, item, { rules: r }), /needs one topic tag/);
  assert.equal(codeGate({ text: 'left-pad before 2.0.1 has a bug.', tag: 'security' }, item, { rules: r }), null);
  assert.match(codeGate({ text: 'left-pad before 2.0.1 has a prototype pollution bug today.', tag: 'security' }, item, { rules: r }), /too long/);
});

test('the verbatim gate refuses a figure the source does not carry', () => {
  assert.equal(codeGate({ text: 'left-pad before 2.0.1 is affected (CVE-2026-0001).' }, item, { rules, gates: ['default', 'verbatim'] }), null);
  assert.match(codeGate({ text: 'left-pad before 2.0.1 is used by 40000 projects.' }, item, { rules, gates: ['verbatim'] }), /figure not in the source: 40000/);
});

test('a custom gate function can refuse', () => {
  const g = (text) => (/before/.test(text) ? 'no "before" allowed' : null);
  assert.match(codeGate({ text: 'left-pad before 2.0.1 is affected.' }, item, { rules, gates: ['default', g] }), /no "before"/);
});

test('the noise and prose copy gates catch filler and captions', () => {
  assert.ok(noiseIssues('This seamlessly integrates with your workflow.').length > 0);
  assert.equal(noiseIssues('left-pad 2.0.1 fixes a prototype pollution bug.').length, 0);
  assert.ok(proseIssues('The full report:\nhttps://example.com/report').length > 0);
  assert.match(codeGate({ text: 'left-pad before 2.0.1 seamlessly fixes a pollution bug.' }, item, { rules, copyGates: ['noise'] }), /^noise:/);
});

test('parseDrafts reads an array inside a code fence and rejects anything else', () => {
  assert.deepEqual(parseDrafts('```json\n[{"id":1,"post":true,"text":"a"}]\n```'), [{ id: 1, post: true, text: 'a' }]);
  assert.throws(() => parseDrafts('no json here'));
});
