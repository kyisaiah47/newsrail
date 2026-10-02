// A generic JSON source. By default it reads JSON Feed 1.1 (https://jsonfeed.org/version/1.1).
// Any other JSON API works with `itemsPath` and `map`.
//
//   jsonFeed({ url: 'https://example.com/feed.json' })
//   jsonFeed({ url, itemsPath: 'data.posts', map: (p) => ({ url: p.permalink, title: p.headline, publishedAt: p.at }) })

import { get, isoOrNull, item, plainText } from './http.mjs';

const at = (obj, dotted) => String(dotted || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);

const jsonFeedItem = (it) => ({
  url: it.url || it.external_url || it.id,
  link: it.external_url || null,
  title: it.title || plainText(it.content_html || it.content_text || '').slice(0, 140),
  text: it.content_text || plainText(it.content_html || it.summary || ''),
  author: it.authors?.[0]?.name || it.author?.name || null,
  publishedAt: it.date_published || it.date_modified || null,
  image: it.image || it.banner_image || null,
  tag: it.tags?.[0] || null,
});

export function jsonFeed({ url, itemsPath = 'items', map = jsonFeedItem, source = 'json', headers = {} } = {}) {
  if (!url) throw new Error('jsonFeed: `url` is required');
  return {
    name: source,
    async poll(ctx = {}) {
      try {
        const j = await get(url, { accept: 'application/feed+json, application/json', fetch: ctx.fetch, userAgent: ctx.userAgent, headers });
        const rows = Array.isArray(j) ? j : at(j, itemsPath);
        if (!Array.isArray(rows)) throw new Error(`no array at "${itemsPath}"`);
        const out = [];
        for (const raw of rows) {
          const f = map(raw) || {};
          if (!f.url || !f.title) continue;
          out.push(item({ source, ...f, publishedAt: isoOrNull(f.publishedAt) }));
        }
        return out;
      } catch (e) {
        ctx.log?.(`  ${source}/${url}: ${String(e.message || e).slice(0, 100)}`);
        return [];
      }
    },
  };
}
