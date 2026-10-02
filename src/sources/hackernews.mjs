// Hacker News through its official Firebase API. No key, no quota.
//
// The discussion URL is the item's identity (`url`). The linked article is what a reader is sent
// to (`link`). Both are carried, because the story is the article and the claim is the thread.

import { get, isoOrNull, item, plainText } from './http.mjs';

const API = 'https://hacker-news.firebaseio.com/v0';

/**
 *   hackerNews({ lists: ['topstories', 'showstories'], limit: 30, minScore: 30 })
 *
 * `minScore` is a collection floor. A wire's own `filters.minScore` is applied later, in select.
 * Show HN items are held to half the floor, since a launch has had less time to collect points.
 */
export function hackerNews({ lists = ['topstories'], limit = 30, minScore = 30, source = 'hn' } = {}) {
  return {
    name: source,
    async poll(ctx = {}) {
      const out = [];
      for (const list of lists) {
        try {
          const ids = (await get(`${API}/${list}.json`, { fetch: ctx.fetch, userAgent: ctx.userAgent })).slice(0, limit);
          const rows = await Promise.all(ids.map((id) => get(`${API}/item/${id}.json`, { fetch: ctx.fetch, userAgent: ctx.userAgent }).catch(() => null)));
          const show = list === 'showstories';
          for (const it of rows) {
            if (!it || it.dead || it.deleted || it.type !== 'story') continue;
            if ((it.score || 0) < (show ? Math.round(minScore / 2) : minScore)) continue;
            out.push(item({
              source,
              url: `https://news.ycombinator.com/item?id=${it.id}`,
              link: it.url || null,
              title: it.title,
              text: plainText(it.text || '').slice(0, 600),
              author: it.by || null,
              publishedAt: isoOrNull((it.time || 0) * 1000),
              score: it.score || 0,
              comments: it.descendants || 0,
              metrics: `${it.score || 0} points, ${it.descendants || 0} comments`,
              tag: show ? 'show-hn' : 'hn',
            }));
          }
        } catch (e) {
          ctx.log?.(`  ${source}/${list}: ${String(e.message || e).slice(0, 100)}`);
        }
      }
      return out;
    },
  };
}
