// RSS 2.0 and Atom feeds. No dependency: a small extractor that has to survive real-world feeds,
// including CDATA, entity-encoded HTML, Atom link elements and missing dates.

import { get, mapLimit, plainText, isoOrNull, item } from './http.mjs';

const pickTag = (block, tag) => (block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1] || '';

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const attr = (s, name) => (s.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) || s.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i')) || [])[1] || '';
  const alt = links.find((l) => attr(l, 'href') && (!attr(l, 'rel') || attr(l, 'rel') === 'alternate'));
  return alt ? attr(alt, 'href') : '';
}

/** Every <item> or <entry> in a feed document, as { title, link, ts, text, image }. */
export function parseFeed(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    const title = plainText(pickTag(b, 'title'));
    let link = plainText(pickTag(b, 'link'));
    if (!link || !/^https?:/i.test(link)) link = atomLink(b) || link;
    if (!link) link = plainText(pickTag(b, 'guid'));
    const ts = Date.parse(plainText(pickTag(b, 'pubDate') || pickTag(b, 'published') || pickTag(b, 'updated') || pickTag(b, 'dc:date'))) || 0;
    const text = plainText(pickTag(b, 'summary') || pickTag(b, 'description') || pickTag(b, 'content') || pickTag(b, 'content:encoded'));
    const image = (b.match(/<media:(?:content|thumbnail)\b[^>]*\burl="([^"]+)"/i) || b.match(/<enclosure\b[^>]*\burl="([^"]+)"[^>]*type="image/i) || [])[1] || null;
    if (title && /^https?:\/\//i.test(link)) out.push({ title, link: link.replace(/([^:])\/\/+/g, '$1/'), ts, text, image });
  }
  return out;
}

/**
 * A list of RSS or Atom feeds as one source.
 *
 *   rssFeeds({ feeds: [{ url, name }], source: 'feed', tag: 'changelog' })
 *
 * `titlePrefix: true` puts the feed's name in front of every title ("GitHub: Incident with Actions"),
 * which is what a status-page feed needs, because its item titles do not say whose status it is.
 */
export function rssFeeds({ feeds = [], source = 'feed', tag = null, titlePrefix = false, concurrency = 8, maxPerFeed = 30, accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml' } = {}) {
  if (!Array.isArray(feeds) || !feeds.length) throw new Error('rssFeeds: `feeds` must be a non-empty array of { url, name }');
  return {
    name: source,
    async poll(ctx = {}) {
      const out = [];
      await mapLimit(feeds, concurrency, async (f) => {
        try {
          const xml = await get(f.url, { accept, fetch: ctx.fetch, userAgent: ctx.userAgent });
          for (const it of parseFeed(xml).slice(0, maxPerFeed)) {
            out.push(item({
              source,
              url: it.link,
              title: titlePrefix && f.name ? `${f.name}: ${it.title}` : it.title,
              text: it.text,
              author: f.name || null,
              publishedAt: isoOrNull(it.ts),
              tag: f.tag || tag,
              metrics: f.name || '',
              image: it.image,
            }));
          }
        } catch (e) {
          ctx.log?.(`  ${source}/${f.name || f.url}: ${String(e.message || e).slice(0, 100)}`);
        }
      });
      return out;
    },
  };
}
