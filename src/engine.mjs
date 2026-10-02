// runTick: one tick of one wire. The one entry point for every wire.
//
//   const r = await runTick(config, { platform, dry, force, log });
//   // r = { posted: [{ platform, url, id }], held: reason | null, owed: boolean }
//
// The steps run in order: poll, select, write, illustrate, publish, store.
//
// compile: 'on-demand'   poll, select and write run only when the queue holds no fresh draft for
//                        the platforms that are due. One researched story per slot.
// compile: 'every-tick'  poll, select and write run on every tick and fill the queue; the tick
//                        then publishes the freshest draft.
//
// `held` says why nothing (or not everything) went out. `owed` is true when the reason is ours
// (no fresh story, a refused draft, no card, an unverified send) and the next tick should try
// again. A hold (outside active hours, inside the gap, not armed) sets `hold: true` and `owed:
// false`. A platform signal is listed in `signals` and stops that platform for this tick.

import fs from 'node:fs';
import { defineWire, ConfigError } from './config.mjs';
import { Claims } from './claims.mjs';
import { statePaths, readQueue, writeQueue, readPosted } from './state.mjs';
import { createProvider, stubProvider } from './providers/index.mjs';
import { dryTransport } from './transports/dry.mjs';
import { poll } from './steps/poll.mjs';
import { select } from './steps/select.mjs';
import { write } from './steps/write.mjs';
import { illustrate } from './steps/illustrate.mjs';
import { publish } from './steps/publish.mjs';
import { store } from './steps/store.mjs';

const defaultLog = (m) => process.stderr.write(`${m}\n`);

function hourIn(ms, timeZone) {
  if (!timeZone) return new Date(ms).getHours();
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(ms)));
}

function resolveProvider(config, opts) {
  if (opts.provider) return typeof opts.provider.complete === 'function' ? opts.provider : createProvider(opts.provider);
  const m = config.model;
  if (m && typeof m.complete === 'function') return m;
  if (m && m.type) return createProvider(m);
  if (opts.dry) return stubProvider();
  throw new ConfigError('`model` is required: a provider from createProvider(), or { type, model, ... }');
}

/** Why a platform is not due now, or null when it is. */
export function cadenceHold(config, platform, posted, now) {
  const c = config.cadence;
  if (c.activeHours) {
    const [a, b] = c.activeHours;
    const h = hourIn(now, c.timezone);
    if (!(h >= a && h < b)) return `outside active hours (${a}:00 to ${b}:00)`;
  }
  if (c.gapMinutes) {
    const last = posted.filter((p) => p.platform === platform && p.verified).map((p) => Date.parse(p.at)).sort((x, y) => y - x)[0];
    if (last && now - last < c.gapMinutes * 60e3) return `inside the ${c.gapMinutes} minute gap on ${platform}`;
  }
  return null;
}

export async function runTick(wire, opts = {}) {
  const config = Object.isFrozen(wire) && wire.filters ? wire : defineWire(wire);
  const { dry = false, force = false, log = defaultLog } = opts;
  const now = opts.now ?? Date.now();
  const platforms = opts.platform ? [opts.platform] : config.platforms;
  for (const p of platforms) if (!config.platforms.includes(p)) throw new ConfigError(`platform "${p}" is not in this wire's platforms (${config.platforms.join(', ')})`);

  log(`tick ${config.slug}${dry ? ' (dry)' : ''}: ${platforms.join(', ')}`);

  if (!dry && !force && config.armFlag && !fs.existsSync(config.armFlag)) {
    return { posted: [], held: `not armed: ${config.armFlag} does not exist`, owed: false, hold: true, signals: [] };
  }

  const paths = statePaths(config, { dry });
  const postedLog = readPosted(paths.posted);
  const holds = {};
  const due = platforms.filter((p) => {
    const why = dry || force ? null : cadenceHold(config, p, postedLog, now);
    if (why) holds[p] = why;
    return !why;
  });
  if (!due.length) return { posted: [], held: Object.entries(holds).map(([p, w]) => `${p}: ${w}`).join('; '), owed: false, hold: true, signals: [] };

  const transports = dry ? Object.fromEntries(due.map((p) => [p, dryTransport(p, { log })])) : config.transports;
  for (const p of due) if (!transports[p]) throw new ConfigError(`no transport for platform "${p}"`);

  const claims = new Claims(paths.claims, { reserveHours: Math.max(24, config.filters.maxAgeH) });
  const fresh = (d) => Date.parse(d.expiresAt) > now && d.platforms.some((p) => !d.postedOn.includes(p));
  let queue = readQueue(paths.queue).filter(fresh);
  const eligible = () => queue
    .filter((d) => due.some((p) => d.platforms.includes(p) && !d.postedOn.includes(p)))
    .sort((a, b) => Date.parse(b.item.publishedAt || b.draftedAt) - Date.parse(a.item.publishedAt || a.draftedAt));

  if (config.compile === 'every-tick' || !eligible().length) {
    const provider = resolveProvider(config, { ...opts, dry });
    const items = await poll(config, { log, fetch: opts.fetch, now });
    const { batch } = select(items, config, { claims, queuedKeys: new Set(queue.map((d) => d.key)), log });
    const covered = [
      ...queue.map((d) => d.item.title),
      ...postedLog.filter((p) => p.verified && now - Date.parse(p.at) < 72 * 3.6e6).map((p) => p.title).filter(Boolean),
    ];
    const drafts = await write(batch, config, { provider, claims, covered, log, now });
    queue.push(...drafts);
    writeQueue(paths.queue, queue);
  }

  const draft = eligible()[0];
  if (!draft) {
    writeQueue(paths.queue, queue);
    return { posted: [], held: 'no fresh story passed the hard filters and the code gate this tick', owed: true, signals: [] };
  }

  const card = await illustrate(draft, config, { dir: paths.cards, log, fetch: opts.fetch });
  if (!card) {
    writeQueue(paths.queue, queue);
    return { posted: [], held: 'no card was rendered; the draft stays queued for the next tick', owed: true, signals: [] };
  }

  const targets = due.filter((p) => draft.platforms.includes(p) && !draft.postedOn.includes(p));
  const res = await publish(draft, card, targets, config, { transports, claims, paths, log });
  draft.postedOn.push(...res.posted.map((p) => p.platform));
  queue = queue.filter((d) => d.platforms.some((p) => !d.postedOn.includes(p)));
  writeQueue(paths.queue, queue);

  const stores = dry ? (config.dryStores || config.stores.filter((s) => s.local)) : config.stores;
  if (res.posted.length || stores.length) await store(config, { claims, stores, log });

  const reasons = [
    ...res.signals.map((s) => `${s.platform}: ${s.message}`),
    ...res.owed,
    ...Object.entries(holds).map(([p, w]) => `${p}: ${w}`),
  ];
  return {
    posted: res.posted,
    held: reasons.length ? reasons.join('; ') : null,
    owed: res.owed.length > 0,
    signals: res.signals,
  };
}
