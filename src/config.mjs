// One wire is one config file. defineWire() checks it and fills defaults.
//
// The fields follow the engine spec, section 6.2:
//   slug, beat, sources, filters, score, batch, compile, prompt, purpose, gate, card, platforms,
//   cadence, claims, table, row, bucket, mirrorPolicy, armFlag, launchd
// plus what an open-source wire needs to run anywhere:
//   model, transports, stores, voice, platformRules, stateDir, cite, ownNames, copyGates

export const PLATFORM_RULES = {
  x: { maxChars: 280, targetChars: 220, tags: 'none' },
  bluesky: { maxChars: 300, targetChars: 220, tags: 'none' },
  threads: { maxChars: 500, targetChars: 300, tags: 'none' },
  webhook: { maxChars: null, targetChars: 400, tags: 'none' },
};

const COMPILE = ['on-demand', 'every-tick'];
const CARD_MODES = ['software', 'news'];

export class ConfigError extends Error {
  constructor(msg) { super(`newsrail config: ${msg}`); this.name = 'ConfigError'; }
}

const isFn = (f) => typeof f === 'function';

/** Validate a wire config and return it with defaults filled in. Throws ConfigError. */
export function defineWire(c) {
  if (!c || typeof c !== 'object') throw new ConfigError('a wire config must be an object');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(c.slug || ''))) throw new ConfigError('`slug` must be lowercase letters, digits and dashes');
  if (!c.beat || typeof c.beat !== 'string') throw new ConfigError('`beat` must say in one sentence what the wire covers');
  if (!Array.isArray(c.sources) || !c.sources.length) throw new ConfigError('`sources` must list at least one source adapter');
  for (const s of c.sources) if (!s || !isFn(s.poll)) throw new ConfigError('every source must be an adapter with a poll() function');

  const filters = { maxAgeH: 12, sources: null, minScore: 0, minStars: 0, deny: [], custom: [], ...(c.filters || {}) };
  if (!(Number(filters.maxAgeH) > 0)) throw new ConfigError('`filters.maxAgeH` must be a positive number of hours');

  const compile = c.compile || 'on-demand';
  if (!COMPILE.includes(compile)) throw new ConfigError(`\`compile\` must be one of ${COMPILE.join(', ')}`);

  const platforms = c.platforms || [];
  if (!Array.isArray(platforms) || !platforms.length) throw new ConfigError('`platforms` must list at least one platform');
  const transports = c.transports || {};
  for (const p of platforms) {
    if (transports[p] && !isFn(transports[p].post)) throw new ConfigError(`transports.${p} must be a transport with post() and verify()`);
  }

  const card = { mode: 'software', ...(c.card || {}) };
  if (!CARD_MODES.includes(card.mode)) throw new ConfigError(`\`card.mode\` must be one of ${CARD_MODES.join(', ')}`);

  const gate = c.gate ?? 'default';
  for (const g of [].concat(gate)) {
    if (!isFn(g) && !['default', 'verbatim'].includes(g)) throw new ConfigError('`gate` must be "default", "verbatim", a function, or a list of these');
  }

  const platformRules = {};
  for (const p of platforms) platformRules[p] = { ...(PLATFORM_RULES[p] || PLATFORM_RULES.webhook), ...((c.platformRules || {})[p] || {}) };

  const cadence = { activeHours: null, gapMinutes: null, timezone: null, ...(c.cadence || {}) };
  if (cadence.activeHours && (!Array.isArray(cadence.activeHours) || cadence.activeHours.length !== 2)) {
    throw new ConfigError('`cadence.activeHours` must be [startHour, endHour]');
  }

  if (c.prompt != null && !isFn(c.prompt) && typeof c.prompt !== 'string') throw new ConfigError('`prompt` must be a function or a string of extra instructions');
  if (c.score != null && !isFn(c.score)) throw new ConfigError('`score` must be a function of an item');
  if (c.row != null && !isFn(c.row)) throw new ConfigError('`row` must be a function of a posted record');

  return Object.freeze({
    ...c,
    filters,
    score: c.score || ((item) => -(item.ageH ?? 0)),
    batch: Math.max(1, Number(c.batch || 6)),
    compile,
    prompt: c.prompt ?? '',
    purpose: c.purpose || 'compose',
    gate,
    card,
    platforms,
    platformRules,
    transports,
    stores: c.stores || [],
    cadence,
    cite: c.cite !== false,
    mirrorPolicy: { delete: false, ...(c.mirrorPolicy || {}) },
    ownNames: c.ownNames || [],
    copyGates: c.copyGates || [],
    voice: c.voice || '',
  });
}
