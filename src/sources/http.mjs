// Shared HTTP for the source adapters: one User-Agent, one timeout, bounded fan-out.
//
// Every adapter takes an optional `fetch` so tests can run offline. A failing source is logged and
// returns nothing; one 503 from one feed must never cost a wire its tick.

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const DEFAULT_UA = `newsrail/${pkg.version} (+${pkg.homepage})`;

export async function get(url, { accept = 'application/json', fetch: f = globalThis.fetch, userAgent = DEFAULT_UA, headers = {}, timeoutMs = 20000 } = {}) {
  const r = await f(url, {
    headers: { 'User-Agent': userAgent, Accept: accept, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return /json/.test(accept) ? r.json() : r.text();
}

/** Run `fn` over `list` with at most `limit` calls in flight. */
export async function mapLimit(list, limit, fn) {
  const items = [...list];
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const n = i++;
      await fn(items[n], n);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

/** Plain text from an HTML or XML fragment. Feeds often carry entity-encoded HTML, so the text is
 *  decoded, stripped of tags, and decoded once more. */
export function plainText(s) {
  return decode(decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** ISO timestamp or null. */
export function isoOrNull(v) {
  const t = typeof v === 'number' ? v : Date.parse(v || '');
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

/** The common item shape every adapter returns. `url` is the identity; `link` is what a reader is sent to. */
export function item(fields) {
  return {
    source: fields.source,
    url: fields.url,
    link: fields.link || null,
    title: String(fields.title || '').trim(),
    text: String(fields.text || '').slice(0, 800),
    author: fields.author || null,
    publishedAt: fields.publishedAt || null,
    score: fields.score ?? null,
    stars: fields.stars ?? null,
    comments: fields.comments ?? null,
    severity: fields.severity ?? null,
    tag: fields.tag || null,
    metrics: fields.metrics || '',
    image: fields.image || null,
    extra: fields.extra || undefined,
  };
}
