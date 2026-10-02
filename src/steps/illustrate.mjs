// Step 4, illustrate: render the card for one draft.
//
// No card means no post. A failure here returns null, the draft stays in the queue, and the tick
// ends with the slot still owed. A stand-in picture is never substituted.
//
// card config:
//   mode         'software' or 'news'
//   publication  the wire's name on the card
//   credit       the wire's site, bottom right
//   accent       the one accent colour
//   kicker(item) the small label; defaults to the item's tag or source
//   object(item) software mode: an object image for the right side (optional)
//   photo(item)  news mode: { url | path, credit } for the photograph (required in news mode)
//   headline(d)  the sentence set on the card; defaults to the item's title

import { renderCardToFile } from '../card/render.mjs';

const fileName = (key) => String(key).replace(/[^a-z0-9]+/gi, '-').slice(0, 80).replace(/-+$/, '');

export async function illustrate(draft, config, { dir, log = () => {}, fetch } = {}) {
  const c = config.card;
  const item = draft.item;
  try {
    const opts = {
      mode: c.mode,
      headline: typeof c.headline === 'function' ? c.headline(draft) : item.title,
      kicker: typeof c.kicker === 'function' ? c.kicker(item) : (c.kicker || item.tag || item.source),
      publication: c.publication || config.slug,
      source: item.author || item.source,
      credit: c.credit || '',
      accent: c.accent,
      accentInk: c.accentInk,
      fetch,
    };
    if (c.mode === 'news') {
      const p = typeof c.photo === 'function' ? await c.photo(item) : (item.image ? { url: item.image } : null);
      if (!p || !(p.url || p.path)) { log('illustrate: no photograph for a news card; the draft stays queued'); return null; }
      opts.photo = p.path || p.url;
      opts.photoCredit = p.credit || '';
    } else if (typeof c.object === 'function') {
      opts.object = await c.object(item);
    }
    const card = await renderCardToFile(opts, dir, `${fileName(draft.key)}-${Date.now()}`);
    log(`illustrate: ${card.path}`);
    return card;
  } catch (e) {
    log(`illustrate: failed (${String(e.message || e).slice(0, 120)}); the draft stays queued`);
    return null;
  }
}
