// Per-wire state on disk: the draft queue and the posted ledger.
//
//   <stateDir>/queue.json     drafts that passed the code gate and are waiting for a send
//   <stateDir>/posted.jsonl   one line per verified send, used for cadence and for the writer's
//                             "already covered" list
//
// A dry tick uses its own files (queue.dry.json, posted.dry.jsonl, claims.dry.json), so trying a
// wire never spends a real story.

import fs from 'node:fs';
import path from 'node:path';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export function statePaths(config, { dry = false } = {}) {
  const dir = path.resolve(config.stateDir || path.join('.newsrail', config.slug));
  const sfx = dry ? '.dry' : '';
  const claims = config.claims
    ? path.resolve(dry ? String(config.claims).replace(/\.json$/, '') + '.dry.json' : config.claims)
    : path.join(dir, `claims${sfx}.json`);
  return {
    dir,
    claims,
    queue: path.join(dir, `queue${sfx}.json`),
    posted: path.join(dir, `posted${sfx}.jsonl`),
    cards: path.join(dir, dry ? 'cards-dry' : 'cards'),
  };
}

export function readQueue(file) {
  const q = readJson(file, []);
  return Array.isArray(q) ? q : [];
}

export function writeQueue(file, queue) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 1));
  fs.renameSync(tmp, file);
}

export function readPosted(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function appendPosted(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}
