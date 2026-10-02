// Step 5, publish: post to each platform, add the source-cite reply, verify, record.
//
// The claim is marked posted only after verify() returns true for that platform. A send that
// cannot be verified is recorded as unverified, the claim stays a reservation, and the tick
// reports the slot as owed. A PlatformSignal (auth wall, rate limit, ban, identity mismatch) stops
// that platform for this tick and is reported once.

import { isOurs, isTheirs } from '../signals.mjs';
import { appendPosted } from '../state.mjs';

export function textFor(draft, rules) {
  return rules?.tags === 'one' && draft.tag ? `${draft.text} #${draft.tag}` : draft.text;
}

export async function publish(draft, card, platforms, config, { transports, claims, paths, log = () => {} } = {}) {
  const posted = [];
  const signals = [];
  const owed = [];
  const link = draft.item.link || draft.item.url;
  for (const platform of platforms) {
    const t = transports[platform];
    if (!t) { owed.push(`${platform}: no transport configured`); continue; }
    const text = textFor(draft, config.platformRules[platform]);
    try {
      const res = await t.post({ text, card, link, item: draft.item, wire: config.slug, alt: draft.item.title });
      const ok = await t.verify(res, { text });
      if (!ok) {
        appendPosted(paths.posted, { wire: config.slug, platform, key: draft.key, id: res?.id || null, url: res?.url || null, text, at: new Date().toISOString(), verified: false });
        owed.push(`${platform}: the send was not verified`);
        log(`publish ${platform}: sent but NOT verified (${res?.id || 'no id'}); the claim stays a reservation`);
        continue;
      }
      claims.markPosted(draft.key, { wire: config.slug, platform, permalink: res.url || null, id: res.id || null, text, draft: draft.text, card: card?.path || null, item: draft.item });
      appendPosted(paths.posted, { wire: config.slug, platform, key: draft.key, id: res.id, url: res.url || null, text, title: draft.item.title, at: new Date().toISOString(), verified: true });
      posted.push({ platform, url: res.url || null, id: res.id || null });
      log(`publish ${platform}: posted and verified ${res.url || res.id}`);
      if (config.cite && link && typeof t.reply === 'function') {
        try { await t.reply(res, { text: config.citeText ? config.citeText(link, draft.item) : `Source: ${link}` }); }
        catch (e) { log(`publish ${platform}: the source reply failed (${String(e.message).slice(0, 100)}); the post stands`); }
      }
    } catch (e) {
      if (isTheirs(e)) { signals.push({ platform, signal: e.platformSignal, message: e.message }); log(`publish ${platform}: ${e.message}`); continue; }
      if (isOurs(e)) { owed.push(`${platform}: ${e.message}`); log(`publish ${platform}: ${e.message}; the slot is still owed`); continue; }
      throw e;
    }
  }
  return { posted, signals, owed };
}
