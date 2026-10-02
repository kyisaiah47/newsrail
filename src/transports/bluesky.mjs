// Bluesky over the AT Protocol (XRPC). Official endpoints only.
//
//   bluesky({ identifier, password, expectedHandle })
//
// `password` is an app password (Settings, Privacy and security, App passwords), never the
// account password. identifier and password fall back to BLUESKY_IDENTIFIER and
// BLUESKY_APP_PASSWORD. When `expectedHandle` or `expectedDid` is set, a session for any other
// account stops the platform with a PlatformSignal before anything is sent.
//
// verify() reads the record back from the account's own repository and compares the text, so a
// post counts as sent only when the network returns it.

import fs from 'node:fs';
import { PlatformSignal, SlotStillOwed, platformError } from '../signals.mjs';

const MAX_BLOB = 976_000;
const enc = new TextEncoder();

/** Link and hashtag facets for a post, with UTF-8 byte offsets. */
export function facetsFor(text) {
  const t = String(text || '');
  const at = (i) => enc.encode(t.slice(0, i)).length;
  const facets = [];
  for (const m of t.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const uri = m[0].replace(/[.,;:!?]+$/, '');
    facets.push({ index: { byteStart: at(m.index), byteEnd: at(m.index + uri.length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] });
  }
  for (const m of t.matchAll(/(^|\s)#([A-Za-z][A-Za-z0-9_]{0,63})/g)) {
    const start = m.index + m[1].length;
    facets.push({ index: { byteStart: at(start), byteEnd: at(start + 1 + m[2].length) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  return facets;
}

const rkeyOf = (uri) => String(uri).split('/').pop();

export function bluesky(opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  const service = (opts.service || 'https://bsky.social').replace(/\/$/, '');
  let session = null;

  async function xrpc(method, nsid, { body, query, headers = {}, raw = false } = {}) {
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    const r = await f(`${service}/xrpc/${nsid}${qs}`, {
      method,
      headers: {
        ...(session ? { authorization: `Bearer ${session.accessJwt}` } : {}),
        ...(body && !raw ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    if (!r.ok) throw platformError('bluesky', r.status, text);
    return text ? JSON.parse(text) : {};
  }

  async function login() {
    if (session) return session;
    const identifier = opts.identifier ?? process.env.BLUESKY_IDENTIFIER;
    const password = opts.password ?? process.env.BLUESKY_APP_PASSWORD;
    if (!identifier || !password) throw new PlatformSignal('no Bluesky credentials', 'set identifier and password, or BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD', { platform: 'bluesky' });
    session = await xrpc('POST', 'com.atproto.server.createSession', { body: { identifier, password } });
    const wantHandle = opts.expectedHandle && String(opts.expectedHandle).replace(/^@/, '').toLowerCase();
    if (wantHandle && String(session.handle).toLowerCase() !== wantHandle) {
      const got = session.handle;
      session = null;
      throw new PlatformSignal('identity mismatch', `signed in as ${got}, expected ${wantHandle}`, { platform: 'bluesky' });
    }
    if (opts.expectedDid && session.did !== opts.expectedDid) {
      const got = session.did;
      session = null;
      throw new PlatformSignal('identity mismatch', `signed in as ${got}, expected ${opts.expectedDid}`, { platform: 'bluesky' });
    }
    return session;
  }

  const permalink = (uri) => `https://bsky.app/profile/${session.handle}/post/${rkeyOf(uri)}`;

  async function createPost(record) {
    const s = await login();
    const res = await xrpc('POST', 'com.atproto.repo.createRecord', {
      body: { repo: s.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', createdAt: new Date().toISOString(), langs: opts.langs || ['en'], ...record } },
    });
    return { id: res.uri, uri: res.uri, cid: res.cid, url: permalink(res.uri), text: record.text };
  }

  return {
    platform: 'bluesky',

    async post({ text, card = null, alt = '' }) {
      await login();
      const record = { text, facets: facetsFor(text) };
      if (card && card.path) {
        if (!/^image\/(png|jpeg|webp)$/.test(card.mime || '')) throw new SlotStillOwed(`Bluesky cannot take a ${card.mime || 'card of unknown type'}; install @resvg/resvg-js for PNG cards`);
        const bytes = fs.readFileSync(card.path);
        if (bytes.length > MAX_BLOB) throw new SlotStillOwed(`card is ${bytes.length} bytes, over the Bluesky image limit`);
        const up = await xrpc('POST', 'com.atproto.repo.uploadBlob', { body: bytes, raw: true, headers: { 'content-type': card.mime } });
        record.embed = {
          $type: 'app.bsky.embed.images',
          images: [{ alt: alt || text.slice(0, 280), image: up.blob, ...(card.width && card.height ? { aspectRatio: { width: card.width, height: card.height } } : {}) }],
        };
      }
      return createPost(record);
    },

    async reply(parent, { text }) {
      return createPost({
        text,
        facets: facetsFor(text),
        reply: { root: { uri: parent.uri, cid: parent.cid }, parent: { uri: parent.uri, cid: parent.cid } },
      });
    },

    async verify(result) {
      const s = await login();
      const got = await xrpc('GET', 'com.atproto.repo.getRecord', { query: { repo: s.did, collection: 'app.bsky.feed.post', rkey: rkeyOf(result.uri) } });
      return Boolean(got?.value && String(got.value.text) === String(result.text) && got.cid === result.cid);
    },
  };
}
