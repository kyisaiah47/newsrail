import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard, renderCardToFile, canRenderPng, jsonFeedStore, sqliteStore, supabaseStore } from '../src/index.mjs';
import { wrap, fitText } from '../src/card/render.mjs';
import { newApp } from '../src/scaffold/new-app.mjs';
import { scanText, scrub } from '../scripts/scrub-gate.mjs';
import { fakeFetch, tmpdir } from './helpers.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('text wraps inside its width and shrinks before it truncates', () => {
  assert.equal(wrap('one two three', 40, 2000, 1).length, 1);
  assert.equal(wrap('word '.repeat(40), 60, 600, 2), null);
  const fit = fitText('A headline that is long enough to need wrapping onto more than one line', { max: 64, min: 36, maxPx: 640, maxLines: 4 });
  assert.ok(fit.size <= 64 && fit.size >= 36);
  assert.ok(fit.lines.length <= 4);
});

test('the software card renders SVG, and PNG at 1200 by 630 when resvg is installed', async () => {
  const c = await renderCard({ mode: 'software', headline: 'Runtime v5.0.0 drops Node 18 & makes ESM the default', kicker: 'release', publication: 'Unit Wire', source: 'example/runtime', credit: 'unit.example' });
  assert.match(c.svg, /Runtime v5\.0\.0 drops Node 18 &amp;/);
  assert.match(c.svg, /RELEASE/);
  if (await canRenderPng()) {
    assert.equal(c.png.subarray(1, 4).toString(), 'PNG');
    assert.equal(c.png.readUInt32BE(16), 1200);
    assert.equal(c.png.readUInt32BE(20), 630);
  }
});

test('the news card needs a photograph and renders at 1080 by 1350', async () => {
  await assert.rejects(renderCard({ mode: 'news', headline: 'x', publication: 'P' }), /photo/);
  const c = await renderCard({ mode: 'news', headline: 'A magnitude 5.1 earthquake struck off the coast', kicker: 'breaking', publication: 'Unit News', photo: PIXEL, photoCredit: 'Example / CC0' });
  assert.match(c.svg, /PHOTO: Example/);
  if (c.png) assert.equal(c.png.readUInt32BE(20), 1350);
  const f = await renderCardToFile({ mode: 'software', headline: 'h', publication: 'p' }, tmpdir(), 'card');
  assert.ok(fs.existsSync(f.path));
});

const row = (slug, extra = {}) => ({ slug, title: `T ${slug}`, dek: 'd', post: 'p', source: 's', tag: 'release', url: `https://e.example/${slug}`, ts: new Date().toISOString(), posts: [{ platform: 'bluesky', url: 'https://b/1' }], ...extra });

test('the JSON feed store writes JSON Feed 1.1, copies cards and keeps items across ticks', async () => {
  const dir = tmpdir();
  const card = path.join(dir, 'c.png');
  fs.writeFileSync(card, 'png');
  const s = jsonFeedStore({ path: path.join(dir, 'out', 'feed.json'), title: 'W' });
  await s.upsert([row('a', { card })], { wire: 'w' });
  await s.upsert([row('b')], { wire: 'w' });
  const feed = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'feed.json'), 'utf8'));
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items.find((i) => i.id === 'a').image, 'cards/a.png');
  await s.upsert([row('b')], { wire: 'w', deleteMissing: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'out', 'feed.json'), 'utf8')).items.length, 1);
});

test('the SQLite store upserts on slug', async () => {
  const dir = tmpdir();
  const s = sqliteStore({ path: path.join(dir, 'w.db'), table: 'posts' });
  await s.upsert([row('a'), row('b')], { wire: 'w' });
  const r = await s.upsert([row('a', { title: 'changed' })], { wire: 'w' });
  assert.equal(r.count, 2);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'w.db'));
  assert.equal(db.prepare('SELECT title FROM posts WHERE slug = ?').get('a').title, 'changed');
  db.close();
});

test('the Supabase store upserts with merge-duplicates and projects to the declared columns', async () => {
  const calls = [];
  const f = fakeFetch({ 'POST https://sb.test/rest/v1/wire_posts': () => ({ status: 201, body: '' }) }, calls);
  const s = supabaseStore({ url: 'https://sb.test', key: 'test', table: 'wire_posts', columns: ['slug', 'title', 'url', 'ts'], fetch: f });
  await s.upsert([row('a')], { wire: 'w' });
  assert.match(calls[0].url, /on_conflict=slug/);
  assert.match(calls[0].headers.prefer, /merge-duplicates/);
  assert.deepEqual(Object.keys(JSON.parse(calls[0].body)[0]).sort(), ['slug', 'title', 'ts', 'url']);
});

test('new-app scaffolds console, simple and both, and refuses a non-empty directory', () => {
  for (const app of ['console', 'simple', 'both']) {
    const dir = path.join(tmpdir(), 'site');
    const out = newApp({ app, dir, name: 'Unit Wire' });
    assert.ok(out.files.includes('app/page.tsx'));
    assert.ok(out.files.includes('lib/feed.ts'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'newsrail.config.json'), 'utf8')).slug, 'unit-wire');
    assert.ok(fs.existsSync(path.join(dir, 'public', 'feed.json')));
    assert.equal(out.files.includes('components/site-view/Welcome.tsx'), app === 'both');
    assert.equal(out.files.includes('components/ConsoleView.tsx'), app !== 'simple');
    assert.equal(out.files.includes('components/SimpleView.tsx'), app !== 'console');
    assert.ok(!fs.readFileSync(path.join(dir, 'package.json'), 'utf8').includes('__'));
    assert.throws(() => newApp({ app, dir }), /not empty/);
  }
});

test('the scrub gate finds planted values and passes on this repository', () => {
  const s = (...p) => p.join('');
  assert.ok(scanText(s('/Users', '/admin/x')).length);
  assert.ok(scanText(s('compound', '-secret KEY')).length);
  assert.ok(scanText(s('acct', '_1TabcdEFGH')).length);
  assert.ok(scanText(s('did:plc:', 'abcdefghijklmnopqrstuvwx')).length);
  assert.ok(scanText(s('AKIA', 'ABCDEFGHIJKLMNOP')).length);
  assert.ok(scanText(s('puppeteer-ext', 'ra-plugin-', 'stealth')).length);
  assert.ok(scanText(s('Object.defineProperty(navigator, ', "'web", "driver'")).length);
  assert.equal(scanText('https://github.com/kyisaiah47/newsrail and https://thecompound.tech').length, 0);
  const { files, findings } = scrub(ROOT);
  assert.ok(files > 10);
  assert.deepEqual(findings, []);
});
