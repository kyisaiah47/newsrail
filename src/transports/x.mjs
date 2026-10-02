// X through the official X API v2. No browser.
//
//   x({ accessToken })                                            OAuth 2.0 user context
//   x({ consumerKey, consumerSecret, token, tokenSecret })        OAuth 1.0a user context
//
// The values fall back to X_ACCESS_TOKEN, or to X_CONSUMER_KEY, X_CONSUMER_SECRET,
// X_ACCESS_TOKEN_KEY and X_ACCESS_TOKEN_SECRET. Posting needs a write-enabled app; the OAuth 2.0
// token needs the tweet.write, tweet.read, users.read and media.write scopes.
//
// verify() checks the create response: X returns the post's id and text only when the post was
// created. With `readBack: true` it also reads the post back with GET /2/tweets/:id, which costs a
// read on the account's plan.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { PlatformSignal, platformError } from '../signals.mjs';

const pct = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * An OAuth 1.0a Authorization header (HMAC-SHA1). `params` holds form-encoded body parameters,
 * which are signed; a JSON or multipart body is not.
 */
export function oauth1Header({ method, url, consumerKey, consumerSecret, token, tokenSecret, params = {}, nonce, timestamp }) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const all = [...Object.entries(oauth), ...u.searchParams.entries(), ...Object.entries(params)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const signature = crypto.createHmac('sha1', `${pct(consumerSecret)}&${pct(tokenSecret || '')}`).update(base).digest('base64');
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ')}`;
}

export function x(opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  const api = (opts.api || 'https://api.x.com').replace(/\/$/, '');
  let username = opts.expectedHandle ? String(opts.expectedHandle).replace(/^@/, '') : null;
  let checked = false;

  function auth(method, url) {
    const bearer = opts.accessToken ?? process.env.X_ACCESS_TOKEN;
    if (bearer) return `Bearer ${bearer}`;
    const k = {
      consumerKey: opts.consumerKey ?? process.env.X_CONSUMER_KEY,
      consumerSecret: opts.consumerSecret ?? process.env.X_CONSUMER_SECRET,
      token: opts.token ?? process.env.X_ACCESS_TOKEN_KEY,
      tokenSecret: opts.tokenSecret ?? process.env.X_ACCESS_TOKEN_SECRET,
    };
    if (!k.consumerKey || !k.consumerSecret || !k.token || !k.tokenSecret) {
      throw new PlatformSignal('no X credentials', 'set accessToken, or the four OAuth 1.0a values', { platform: 'x' });
    }
    return oauth1Header({ method, url, ...k });
  }

  async function call(method, path, { json, form } = {}) {
    const url = `${api}${path}`;
    const r = await f(url, {
      method,
      headers: { authorization: auth(method, url), ...(json ? { 'content-type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
      signal: AbortSignal.timeout(60000),
    });
    const text = await r.text();
    if (!r.ok) throw platformError('x', r.status, text);
    return text ? JSON.parse(text) : {};
  }

  async function checkIdentity() {
    if (checked || !opts.expectedHandle) return;
    const me = await call('GET', '/2/users/me');
    const got = String(me?.data?.username || '');
    if (got.toLowerCase() !== String(opts.expectedHandle).replace(/^@/, '').toLowerCase()) {
      throw new PlatformSignal('identity mismatch', `signed in as @${got}, expected ${opts.expectedHandle}`, { platform: 'x' });
    }
    username = got;
    checked = true;
  }

  const permalink = (id) => (username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`);

  async function create(body) {
    const res = await call('POST', '/2/tweets', { json: body });
    const id = res?.data?.id;
    return { id, url: id ? permalink(id) : null, text: body.text, returnedText: res?.data?.text ?? null };
  }

  return {
    platform: 'x',

    async post({ text, card = null }) {
      await checkIdentity();
      const body = { text };
      if (card && card.path) {
        const form = new FormData();
        form.append('media', new Blob([fs.readFileSync(card.path)], { type: card.mime || 'image/png' }), 'card.png');
        form.append('media_category', 'tweet_image');
        const up = await call('POST', '/2/media/upload', { form });
        const mediaId = up?.data?.id || up?.media_id_string;
        if (!mediaId) throw new Error(`x: media upload returned no id: ${JSON.stringify(up).slice(0, 200)}`);
        body.media = { media_ids: [String(mediaId)] };
      }
      return create(body);
    },

    async reply(parent, { text }) {
      return create({ text, reply: { in_reply_to_tweet_id: parent.id } });
    },

    async verify(result) {
      if (!result?.id) return false;
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      if (result.returnedText != null && norm(result.returnedText) !== norm(result.text)) return false;
      if (!opts.readBack) return true;
      const got = await call('GET', `/2/tweets/${encodeURIComponent(result.id)}`);
      return got?.data?.id === result.id;
    },
  };
}
