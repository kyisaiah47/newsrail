// Step 2, select: hard filters first, then the score, then a batch.
//
// A hard filter is never traded against the score. An item that fails one is gone, however high
// it would rank: a ten-thousand-point story from last week is still last week's story. The score
// only orders what passed every filter.
//
// Hard filters, in order:
//   malformed   no URL or no title
//   no-date     no publication time, so its age cannot be proven
//   too-old     older than filters.maxAgeH
//   future      dated more than an hour ahead (a bad feed clock)
//   off-beat    its source is not in filters.sources (when the wire declares a beat)
//   score       below filters.minScore (only items whose source has a score)
//   stars       below filters.minStars (only items whose source has a star count)
//   denied      matches filters.deny, or its host is in filters.denyHosts
//   custom      a filters.custom predicate returned false or a reason
//   claimed     this wire already reserved or posted it
//   queued      a draft for it is already waiting in the queue

export function hardFilter(item, config, { claims, queuedKeys = new Set() } = {}) {
  const f = config.filters;
  if (!item.url || !item.title) return 'malformed';
  if (item.ageH == null || !Number.isFinite(item.ageH)) return 'no-date';
  if (item.ageH > f.maxAgeH) return 'too-old';
  if (item.ageH < -1) return 'future';
  if (Array.isArray(f.sources) && f.sources.length && !f.sources.includes(item.source)) return 'off-beat';
  if (item.score != null && f.minScore && item.score < f.minScore) return 'score';
  if (item.stars != null && f.minStars && item.stars < f.minStars) return 'stars';
  const hay = `${item.title}\n${item.text || ''}`;
  if ((f.deny || []).some((re) => (re instanceof RegExp ? re : new RegExp(re, 'i')).test(hay))) return 'denied';
  if ((f.denyHosts || []).length) {
    let host = '';
    try { host = new URL(item.link || item.url).host.replace(/^www\./, ''); } catch {}
    if (f.denyHosts.some((h) => host === h || host.endsWith(`.${h}`))) return 'denied';
  }
  for (const pred of f.custom || []) {
    const r = pred(item);
    if (r === false) return 'custom';
    if (typeof r === 'string') return r;
  }
  if (claims && claims.blocked(item.key, config.slug)) return 'claimed';
  if (queuedKeys.has(item.key)) return 'queued';
  return null;
}

export function select(items, config, { claims, queuedKeys, log = () => {} } = {}) {
  const dropped = {};
  const passed = [];
  for (const it of items) {
    const why = hardFilter(it, config, { claims, queuedKeys });
    if (why) dropped[why] = (dropped[why] || 0) + 1;
    else passed.push(it);
  }
  const ranked = passed
    .map((it) => ({ it, s: Number(config.score(it)) || 0 }))
    .sort((a, b) => b.s - a.s || (a.it.ageH ?? 0) - (b.it.ageH ?? 0))
    .map(({ it, s }) => ({ ...it, rank: s }));
  const batch = ranked.slice(0, config.batch);
  log(`select: ${passed.length} passed the hard filters, batch ${batch.length}; dropped ${Object.entries(dropped).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  return { batch, passed: ranked, dropped };
}
