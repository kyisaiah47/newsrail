import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Claims, keyOf } from '../src/index.mjs';
import { tmpdir } from './helpers.mjs';

const item = (url) => ({ url, key: keyOf(url), title: 'T', source: 'feed' });

test('keyOf drops tracking parameters, hash, www and trailing slash', () => {
  assert.equal(keyOf('https://www.Example.com/a/?utm_source=x&id=2#top'), 'example.com/a?id=2');
});

test('a reservation blocks a re-draft by the same wire only', () => {
  const c = new Claims(path.join(tmpdir(), 'claims.json'));
  const it = item('https://e.example/1');
  assert.equal(c.reserve(it, 'wire-a'), true);
  assert.equal(c.reserve(it, 'wire-a'), false);
  assert.equal(c.reserve(it, 'wire-b'), true);
});

test('a story is posted only when markPosted is called, one row per platform', () => {
  const c = new Claims(path.join(tmpdir(), 'claims.json'));
  const it = item('https://e.example/2');
  c.reserve(it, 'w');
  assert.equal(c.posted('w').length, 0);
  assert.equal(c.postedOn(it.key, 'w', 'bluesky'), false);
  c.markPosted(it.key, { wire: 'w', platform: 'bluesky', permalink: 'https://bsky.app/x', text: 'hi' });
  c.markPosted(it.key, { wire: 'w', platform: 'threads', permalink: 'https://threads.net/y', text: 'hi' });
  assert.equal(c.posted('w').length, 2);
  assert.equal(c.postedOn(it.key, 'w', 'bluesky'), true);
  assert.equal(c.posted('w')[0].item.title, 'T');
});

test('two writers on one file merge instead of overwriting each other', () => {
  const file = path.join(tmpdir(), 'claims.json');
  const a = new Claims(file);
  const b = new Claims(file);
  a.reserve(item('https://e.example/a'), 'w');
  b.reserve(item('https://e.example/b'), 'w');
  const c = new Claims(file);
  assert.ok(c.rows(keyOf('https://e.example/a')).length === 1);
  assert.ok(c.rows(keyOf('https://e.example/b')).length === 1);
});

test('old reservations are pruned and posted rows are kept', () => {
  const file = path.join(tmpdir(), 'claims.json');
  let now = Date.now() - 40 * 864e5;
  const c = new Claims(file, { now: () => now, ttlDays: 30 });
  c.reserve(item('https://e.example/old'), 'w');
  c.reserve(item('https://e.example/kept'), 'w');
  c.markPosted(keyOf('https://e.example/kept'), { wire: 'w', platform: 'x', text: 't' });
  now = Date.now();
  c.write();
  const d = new Claims(file);
  assert.equal(d.rows(keyOf('https://e.example/old')).length, 0);
  assert.ok(d.rows(keyOf('https://e.example/kept')).some((r) => r.postedAt));
});
