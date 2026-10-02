// Step 1, poll: run every source adapter and return candidate items with a stable key.
//
// Adapters run at the same time. A failing adapter logs and contributes nothing; it never ends
// the tick. Two adapters can surface one story under different URLs, so items are merged on the
// canonical key and the richer record wins.

import { keyOf } from '../claims.mjs';

export async function poll(config, { log = () => {}, fetch, now = Date.now(), userAgent } = {}) {
  const ctx = { log, fetch, now, userAgent: userAgent || config.userAgent };
  const batches = await Promise.all(config.sources.map(async (s) => {
    try { return (await s.poll(ctx)) || []; }
    catch (e) { log(`  source ${s.name || '?'} failed: ${String(e.message || e).slice(0, 120)}`); return []; }
  }));
  const byKey = new Map();
  for (const it of batches.flat()) {
    if (!it || !it.url) continue;
    const key = keyOf(it.url);
    const ageH = it.publishedAt ? (now - Date.parse(it.publishedAt)) / 3.6e6 : null;
    const row = { ...it, key, ageH: ageH == null ? null : Number(ageH.toFixed(2)) };
    const prev = byKey.get(key);
    if (!prev || String(row.text || '').length > String(prev.text || '').length) byKey.set(key, row);
  }
  const items = [...byKey.values()];
  const bySource = items.reduce((a, i) => ({ ...a, [i.source]: (a[i.source] || 0) + 1 }), {});
  log(`poll: ${items.length} items (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`);
  return items;
}
