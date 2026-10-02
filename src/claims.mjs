// The claim ledger. One JSON file, keyed by the canonical URL of each story.
//
// A claim has two states:
//   reserved  the wire drafted this story. Nothing has been sent. Other ticks of the same wire
//             leave it alone, so one story is never drafted twice.
//   posted    a send was VERIFIED on a platform. This is the only state the site is built from,
//             and it is written only after the platform confirmed the post exists.
//
// Several processes can share one file (two wires, or two platforms of one wire on separate
// schedules). So every read merges what is on disk, every write merges again first, and writes go
// through a temp file and a rename. Nothing here assumes it is the only writer.

import fs from 'node:fs';
import path from 'node:path';

/** The canonical key for a URL: no hash, no tracking parameters, no www, no trailing slash. */
export function keyOf(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|ref$|ref_|source$|fbclid|gclid|mc_)/i.test(p)) u.searchParams.delete(p);
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const rowId = (r) => `${r.wire}|${r.platform || ''}|${r.at}`;

export class Claims {
  /**
   * @param {string} file  path to the claims JSON file
   * @param {object} [o]
   * @param {number} [o.reserveHours=24]  how long an unposted reservation blocks a re-draft
   * @param {number} [o.ttlDays=30]       how long a reservation is kept at all. Posted rows are never pruned.
   */
  constructor(file, { reserveHours = 24, ttlDays = 30, now = () => Date.now() } = {}) {
    this.file = file;
    this.reserveHours = reserveHours;
    this.ttlDays = ttlDays;
    this.now = now;
    this.map = {};
    this.refresh();
  }

  refresh() {
    const disk = readJson(this.file, {});
    for (const [k, rows] of Object.entries(disk)) {
      const mine = this.map[k];
      if (!mine) { this.map[k] = Array.isArray(rows) ? rows : [rows]; continue; }
      const seen = new Set(mine.map(rowId));
      for (const r of (Array.isArray(rows) ? rows : [rows])) if (!seen.has(rowId(r))) mine.push(r);
    }
    return this.map;
  }

  write() {
    this.refresh();
    const cutoff = this.now() - this.ttlDays * 864e5;
    for (const [k, rows] of Object.entries(this.map)) {
      const keep = rows.filter((r) => r.postedAt || Date.parse(r.at) >= cutoff);
      if (keep.length) this.map[k] = keep; else delete this.map[k];
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.map, null, 1));
    fs.renameSync(tmp, this.file);
  }

  rows(key) { return this.refresh()[key] || []; }

  /** True when this wire already reserved or posted this story. */
  blocked(key, wire) {
    const reserveCut = this.now() - this.reserveHours * 3.6e6;
    return this.rows(key).some((r) => r.wire === wire && (r.postedAt || Date.parse(r.at) >= reserveCut));
  }

  /** True when this wire has a verified post of this story on this platform. */
  postedOn(key, wire, platform) {
    return this.rows(key).some((r) => r.wire === wire && r.platform === platform && r.postedAt);
  }

  /** Reserve a story for a wire. Returns false when another tick already holds it. */
  reserve(item, wire) {
    if (this.blocked(item.key, wire)) return false;
    (this.map[item.key] ||= []).push({ wire, platform: null, at: new Date(this.now()).toISOString(), item: carry(item) });
    this.write();
    return true;
  }

  /**
   * Record a VERIFIED send. Call only after the transport's verify() returned true.
   * The send is a new row per platform, so a story posted on two platforms has two rows and the
   * site can show both permalinks.
   */
  markPosted(key, { wire, platform, permalink = null, id = null, text = '', draft = null, card = null, item = null }) {
    const rows = (this.refresh()[key] ||= []);
    const reservation = rows.find((r) => r.wire === wire && !r.platform && !r.postedAt);
    const at = new Date(this.now()).toISOString();
    rows.push({
      wire, platform, at, postedAt: at, permalink, id, text, draft: draft ?? text, card,
      item: item ? carry(item) : reservation?.item || null,
    });
    this.write();
    return true;
  }

  /** Every verified send for a wire (or all wires), newest first, one entry per platform post. */
  posted(wire = null) {
    const out = [];
    for (const [key, rows] of Object.entries(this.refresh())) {
      for (const r of rows) if (r.postedAt && (!wire || r.wire === wire)) out.push({ key, ...r });
    }
    return out.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
  }
}

/** What a site row needs from the story, kept narrow. What went out is what gets written down. */
export function carry(item) {
  return {
    url: item.url,
    link: item.link || null,
    title: item.title || '',
    text: String(item.text || '').slice(0, 800),
    source: item.source || '',
    author: item.author || null,
    tag: item.tag || null,
    metrics: item.metrics || '',
    publishedAt: item.publishedAt || null,
    score: item.score ?? null,
    stars: item.stars ?? null,
    comments: item.comments ?? null,
    severity: item.severity ?? null,
    image: item.image || null,
    extra: item.extra || undefined,
  };
}
