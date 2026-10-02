import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { bluesky, facetsFor, x, oauth1Header, threads, webhook, signBody, verifySignature, isTheirs } from '../src/index.mjs';
import { fakeFetch, tmpdir } from './helpers.mjs';

const PDS = 'https://pds.test';

test('Bluesky facets use UTF-8 byte offsets for links and tags', () => {
  const text = 'Ünïcode → https://example.com/a. #dev';
  const f = facetsFor(text);
  const enc = new TextEncoder();
  const link = f.find((x) => x.features[0].$type.endsWith('#link'));
  assert.equal(link.features[0].uri, 'https://example.com/a');
  assert.equal(Buffer.from(enc.encode(text)).subarray(link.index.byteStart, link.index.byteEnd).toString(), 'https://example.com/a');
  const tag = f.find((x) => x.features[0].$type.endsWith('#tag'));
  assert.equal(tag.features[0].tag, 'dev');
  assert.equal(Buffer.from(enc.encode(text)).subarray(tag.index.byteStart, tag.index.byteEnd).toString(), '#dev');
});

function blueskyRoutes(state, { handle = 'wire.test', did = 'did:plc:test' } = {}) {
  return {
    [`POST ${PDS}/xrpc/com.atproto.server.createSession`]: () => ({ body: { accessJwt: 'jwt', did, handle } }),
    [`POST ${PDS}/xrpc/com.atproto.repo.uploadBlob`]: () => ({ body: { blob: { $type: 'blob', ref: { $link: 'b' }, mimeType: 'image/png', size: 4 } } }),
    [`POST ${PDS}/xrpc/com.atproto.repo.createRecord`]: ({ init }) => {
      const b = JSON.parse(init.body);
      state.records.push(b.record);
      return { body: { uri: `at://${did}/app.bsky.feed.post/rk${state.records.length}`, cid: `cid${state.records.length}` } };
    },
    [`GET ${PDS}/xrpc/com.atproto.repo.getRecord`]: ({ url }) => {
      const n = Number(new URL(url).searchParams.get('rkey').slice(2));
      return { body: { uri: 'u', cid: `cid${n}`, value: state.records[n - 1] } };
    },
  };
}

test('Bluesky posts with an image, verifies by reading the record back, and replies with the source', async () => {
  const dir = tmpdir();
  const card = path.join(dir, 'c.png');
  fs.writeFileSync(card, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const state = { records: [] };
  const t = bluesky({ identifier: 'wire.test', password: 'test', service: PDS, expectedHandle: 'wire.test', fetch: fakeFetch(blueskyRoutes(state)) });
  const res = await t.post({ text: 'Runtime v5 drops Node 18. #dev', card: { path: card, mime: 'image/png', width: 1200, height: 630 } });
  assert.equal(res.url, 'https://bsky.app/profile/wire.test/post/rk1');
  assert.equal(state.records[0].embed.$type, 'app.bsky.embed.images');
  assert.equal(await t.verify(res), true);
  const reply = await t.reply(res, { text: 'Source: https://example.com/r' });
  assert.equal(state.records[1].reply.parent.uri, res.uri);
  assert.ok(reply.url);
});

test('Bluesky stops on an identity mismatch and on a 429', async () => {
  const state = { records: [] };
  const t = bluesky({ identifier: 'a', password: 'b', service: PDS, expectedHandle: 'wire.test', fetch: fakeFetch(blueskyRoutes(state, { handle: 'someone.else' })) });
  await assert.rejects(t.post({ text: 'hi' }), (e) => isTheirs(e) && /identity mismatch/.test(e.message));
  const limited = bluesky({ identifier: 'a', password: 'b', service: PDS, fetch: fakeFetch({ [`POST ${PDS}/xrpc/com.atproto.server.createSession`]: () => ({ status: 429, body: { error: 'RateLimitExceeded' } }) }) });
  await assert.rejects(limited.post({ text: 'hi' }), (e) => isTheirs(e) && /429/.test(e.message));
});

test('OAuth 1.0a signs the sorted, percent-encoded base string with HMAC-SHA1', () => {
  const header = oauth1Header({
    method: 'POST',
    url: 'https://api.example.test/1.1/statuses/update.json?include_entities=true',
    consumerKey: 'test-consumer',
    consumerSecret: 'test-consumer-secret',
    token: 'test-token',
    tokenSecret: 'test-token-secret',
    nonce: 'test-nonce',
    timestamp: 1318622958,
    params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
  });
  // The base string, written out by hand from RFC 5849 section 3.4.1.
  const base = 'POST&https%3A%2F%2Fapi.example.test%2F1.1%2Fstatuses%2Fupdate.json&'
    + 'include_entities%3Dtrue%26oauth_consumer_key%3Dtest-consumer%26oauth_nonce%3Dtest-nonce'
    + '%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3Dtest-token'
    + '%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521';
  const want = crypto.createHmac('sha1', 'test-consumer-secret&test-token-secret').update(base).digest('base64');
  const got = decodeURIComponent(header.match(/oauth_signature="([^"]+)"/)[1]);
  assert.equal(got, want);
  assert.match(header, /^OAuth oauth_consumer_key="test-consumer", /);
});

test('X posts through the v2 API, uploads the card, and verifies from the create response', async () => {
  const dir = tmpdir();
  const card = path.join(dir, 'c.png');
  fs.writeFileSync(card, Buffer.from([1, 2, 3]));
  const calls = [];
  const f = fakeFetch({
    'POST https://api.x.test/2/media/upload': () => ({ body: { data: { id: '77' } } }),
    'POST https://api.x.test/2/tweets': ({ init }) => { const b = JSON.parse(init.body); return { status: 201, body: { data: { id: b.reply ? '2' : '1', text: b.text } } }; },
    'GET https://api.x.test/2/users/me': () => ({ body: { data: { username: 'wire' } } }),
  }, calls);
  const t = x({ accessToken: 'test', api: 'https://api.x.test', expectedHandle: '@wire', fetch: f });
  const res = await t.post({ text: 'Runtime v5 drops Node 18.', card: { path: card, mime: 'image/png' } });
  assert.equal(res.url, 'https://x.com/wire/status/1');
  assert.equal(await t.verify(res), true);
  const tweet = calls.find((c) => c.url.endsWith('/2/tweets'));
  assert.deepEqual(JSON.parse(tweet.body).media, { media_ids: ['77'] });
  assert.equal(tweet.headers.authorization, 'Bearer test');
  assert.equal(await t.verify({ ...res, returnedText: 'something else' }), false);
});

test('Threads creates a container, waits for it, publishes and verifies', async () => {
  const dir = tmpdir();
  const card = path.join(dir, 'c.png');
  fs.writeFileSync(card, Buffer.from([1]));
  let polls = 0;
  const f = fakeFetch({
    'POST https://graph.threads.test/me/threads_publish': () => ({ body: { id: 'm1' } }),
    'POST https://graph.threads.test/me/threads': ({ init }) => ({ body: { id: new URLSearchParams(init.body).get('media_type') === 'IMAGE' ? 'c1' : 'c2' } }),
    'GET https://graph.threads.test/c': () => { polls += 1; return { body: { status: polls > 1 ? 'FINISHED' : 'IN_PROGRESS' } }; },
    'GET https://graph.threads.test/m1': () => ({ body: { id: 'm1', permalink: 'https://www.threads.com/@wire/post/1', text: 'Runtime v5 drops Node 18.' } }),
  });
  const t = threads({ accessToken: 'test', api: 'https://graph.threads.test', hostImage: async () => 'https://img.test/c.png', sleep: async () => {}, fetch: f });
  const res = await t.post({ text: 'Runtime v5 drops Node 18.', card: { path: card, mime: 'image/png' } });
  assert.equal(res.url, 'https://www.threads.com/@wire/post/1');
  assert.equal(await t.verify(res), true);
  const noHost = threads({ accessToken: 'test', api: 'https://graph.threads.test', fetch: f });
  await assert.rejects(noHost.post({ text: 'x', card: { path: card, mime: 'image/png' } }), /hostImage/);
});

test('the webhook signs its body and the receiver can check it', async () => {
  let got;
  const f = fakeFetch({ 'POST https://hook.test/in': ({ init }) => { got = init; return { body: { id: 'h1', url: 'https://site.test/p/h1' } }; } });
  const t = webhook({ url: 'https://hook.test/in', secret: 'shh', fetch: f });
  const res = await t.post({ text: 'hello', link: 'https://example.com', wire: 'w' });
  assert.equal(res.id, 'h1');
  assert.equal(await t.verify(res), true);
  assert.equal(verifySignature(got.body, got.headers['x-newsrail-signature'], 'shh'), true);
  assert.equal(verifySignature(got.body, got.headers['x-newsrail-signature'], 'wrong'), false);
  assert.equal(verifySignature(got.body, signBody(got.body, 'shh', 1), 'shh'), false, 'an old timestamp is refused');
});
