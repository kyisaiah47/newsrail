// Store: a JSON Feed 1.1 file (https://jsonfeed.org/version/1.1) plus a cards/ folder beside it.
// A static site, the scaffolded Next.js app, or any feed reader can read it directly.
//
//   jsonFeedStore({ path: 'public/feed.json', title: 'The Wire', homePageUrl, publicBase })
//
// Items are keyed by slug and kept across ticks. With `deleteMissing` (the wire's
// mirrorPolicy.delete) an item with no verified post behind it is removed.

import fs from 'node:fs';
import path from 'node:path';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export function jsonFeedStore(opts = {}) {
  if (!opts.path) throw new Error('jsonFeedStore: `path` is required');
  const file = path.resolve(opts.path);
  const dir = path.dirname(file);
  return {
    name: 'json-feed',
    local: true,
    path: file,
    async upsert(rows, { wire, deleteMissing = false, log = () => {} } = {}) {
      const doc = readJson(file, null) || {};
      const byId = new Map((doc.items || []).map((i) => [i.id, i]));
      const keep = new Set();
      for (const row of rows) {
        let image = row.img || null;
        if (row.card && fs.existsSync(row.card)) {
          const name = `${row.slug}${path.extname(row.card)}`;
          fs.mkdirSync(path.join(dir, 'cards'), { recursive: true });
          fs.copyFileSync(row.card, path.join(dir, 'cards', name));
          image = opts.publicBase ? `${String(opts.publicBase).replace(/\/$/, '')}/cards/${name}` : `cards/${name}`;
        }
        const { card, ...data } = row;
        const date = typeof row.ts === 'number' ? new Date(row.ts).toISOString() : row.ts;
        const kind = row.source_kind || row.cat || row.tag || '';
        const posts = row.posts || (row.accounts || []).map((a) => ({ platform: a.platform, url: a.permalink || a.url || null }));
        byId.set(row.slug, {
          id: row.slug,
          url: row.url,
          external_url: row.url,
          title: row.title,
          content_text: row.post || row.dek,
          summary: row.dek,
          date_published: date,
          image: image || undefined,
          tags: [kind, row.source].filter(Boolean),
          _newsrail: { ...data, kind, posts, img: image, wire },
        });
        keep.add(row.slug);
      }
      if (deleteMissing) for (const id of [...byId.keys()]) if (!keep.has(id)) byId.delete(id);
      const items = [...byId.values()].sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published));
      const out = {
        version: 'https://jsonfeed.org/version/1.1',
        title: opts.title || doc.title || wire,
        ...(opts.homePageUrl ? { home_page_url: opts.homePageUrl } : {}),
        ...(opts.feedUrl ? { feed_url: opts.feedUrl } : {}),
        ...(opts.description ? { description: opts.description } : {}),
        items,
      };
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out, null, 1));
      fs.renameSync(tmp, file);
      log(`  store json-feed: ${items.length} items in ${file}`);
      return { count: items.length };
    },
  };
}
