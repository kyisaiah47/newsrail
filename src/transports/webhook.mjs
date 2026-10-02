// A webhook transport: POST each post as JSON to a URL you own. Use it to feed a Slack or Discord
// relay, a CMS, a queue, or anything that should publish the post itself.
//
//   webhook({ url, secret })
//
// With `secret`, each request carries `x-newsrail-signature: t=<unix seconds>,v1=<hex>`, where the
// hex is HMAC-SHA256 over `${t}.${body}`. verifySignature() checks it on the receiving side.
//
// The receiver's 2xx answer is the verification: it says the post was accepted. Pass `verify` to
// replace that with your own check (for example, fetching the published URL).

import crypto from 'node:crypto';
import fs from 'node:fs';
import { platformError } from '../signals.mjs';

export function signBody(body, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** Check a signature header against the raw body. Rejects anything older than `toleranceS`. */
export function verifySignature(body, header, secret, { toleranceS = 300, now = Date.now() } = {}) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > toleranceS) return false;
  const want = Buffer.from(signBody(body, secret, t).split('v1=')[1], 'hex');
  const got = Buffer.from(parts.v1, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export function webhook(opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  if (!opts.url) throw new Error('webhook: `url` is required');
  const platform = opts.platform || 'webhook';

  async function send(payload) {
    const body = JSON.stringify(payload);
    const r = await f(opts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.secret ? { 'x-newsrail-signature': signBody(body, opts.secret) } : {}),
        ...(opts.headers || {}),
      },
      body,
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    if (!r.ok) throw platformError(platform, r.status, text);
    let j = {};
    try { j = text ? JSON.parse(text) : {}; } catch { j = {}; }
    return {
      id: String(j[opts.idField || 'id'] || `${platform}-${Date.now()}`),
      url: j[opts.urlField || 'url'] || null,
      status: r.status,
      text: payload.text,
    };
  }

  return {
    platform,
    async post({ text, card = null, link = null, item = null, wire = null }) {
      return send({
        event: 'post', wire, platform, text, link,
        item: item ? { url: item.url, title: item.title, source: item.source, publishedAt: item.publishedAt } : null,
        card: card && card.path && opts.includeCard !== false
          ? { mime: card.mime, base64: fs.readFileSync(card.path).toString('base64') }
          : null,
      });
    },
    async reply(parent, { text }) {
      return send({ event: 'reply', platform, parent: parent.id, text });
    },
    async verify(result) {
      if (typeof opts.verify === 'function') return Boolean(await opts.verify(result));
      return result.status >= 200 && result.status < 300;
    },
  };
}
