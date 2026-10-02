// Step 6, store: write the wire's rows from the record of what posted.
//
// The rows come only from verified sends in the claims ledger, so a store never shows a post that
// did not happen. This step spends nothing and never fails the tick: a store error is logged and
// the next tick writes the same rows again.

import crypto from 'node:crypto';

export function slugFor(key, title) {
  const words = String(title || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-+$/, '');
  return `${words || 'post'}-${crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 6)}`;
}

/** One record per story: the item, the text that went out, and every verified platform post. */
export function records(claims, wire) {
  const by = new Map();
  for (const r of claims.posted(wire)) {
    const rec = by.get(r.key) || { key: r.key, wire, item: r.item || {}, text: r.draft || r.text, card: r.card, postedAt: r.postedAt, updatedAt: r.postedAt, posts: [] };
    rec.posts.push({ platform: r.platform, url: r.permalink || null, id: r.id || null, at: r.postedAt });
    if (Date.parse(r.postedAt) < Date.parse(rec.postedAt)) rec.postedAt = r.postedAt;
    if (Date.parse(r.postedAt) >= Date.parse(rec.updatedAt)) { rec.updatedAt = r.postedAt; rec.card = r.card || rec.card; rec.text = r.draft || r.text || rec.text; }
    by.set(r.key, rec);
  }
  return [...by.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

/** The default row. A wire's `row` function replaces it. `card` is a local path the store uploads. */
export function defaultRow(rec) {
  const it = rec.item || {};
  return {
    slug: slugFor(rec.key, it.title),
    title: it.title || '',
    dek: String(it.text || '').slice(0, 260),
    post: String(rec.text || ''),
    source: it.author || it.source || '',
    source_kind: it.source || '',
    tag: it.tag || null,
    url: it.link || it.url || '',
    ts: rec.postedAt,
    published_at: it.publishedAt || null,
    severity: it.severity ?? null,
    metrics: it.metrics || '',
    posts: rec.posts,
    card: rec.card || null,
  };
}

export async function store(config, { claims, stores, log = () => {} } = {}) {
  const recs = records(claims, config.slug);
  const rows = recs.map((r) => {
    const row = (config.row || defaultRow)(r, config);
    return { ...row, card: row.card ?? r.card ?? null };
  });
  const results = [];
  for (const s of stores) {
    try {
      results.push({ store: s.name, ...(await s.upsert(rows, { wire: config.slug, table: config.table, bucket: config.bucket, deleteMissing: config.mirrorPolicy.delete, log })) });
    } catch (e) {
      log(`store ${s.name}: failed (${String(e.message || e).slice(0, 160)}); the next tick writes these rows again`);
      results.push({ store: s.name, error: String(e.message || e) });
    }
  }
  return { rows: rows.length, results };
}
