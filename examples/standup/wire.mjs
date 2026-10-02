// The Standup, as a NewsRail wire.
//
// The Standup is a developer wire published by Compound Labs at https://standup.thecompound.tech.
// Its beat is what a developer has to act on: releases, CVEs, outages and breaking changes. This
// config reproduces its pipeline on public sources only: vendor changelog feeds, vendor status-page
// feeds, GitHub release feeds and reviewed GitHub security advisories. No key is needed to poll.
//
// Try it without posting anything (the stub writer, dry transports, a local JSON feed):
//   node src/cli.mjs tick examples/standup/wire.mjs --dry --provider stub
//
// Run it for real: set a model (NEWSRAIL_PROVIDER and NEWSRAIL_MODEL, plus that provider's key),
// Bluesky and Threads credentials, the Supabase values for Threads image hosting, then create the
// ARMED file next to this config.

import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import {
  defineWire, rssFeeds, githubReleases, githubAdvisories,
  bluesky, threads, jsonFeedStore, supabaseImageHost,
} from '../../src/index.mjs';

const here = (p) => new URL(p, import.meta.url).pathname;
const feeds = JSON.parse(readFileSync(here('./feeds.json'), 'utf8'));
const voice = readFileSync(here('./voice.md'), 'utf8');

// The site's row shape, from The Standup's own row derivation: a tier per kind (1 means something
// you depend on is broken, 2 means the vendor stated it), a label, a dek and per-kind detail.
const TIERS = { advisory: 1, incident: 1, release: 2, changelog: 2 };
const LABELS = { advisory: 'ADVISORY', incident: 'STATUS', release: 'RELEASE', changelog: 'CHANGELOG' };
const toDek = (raw) => {
  const s = String(raw || '').replace(/<[^>]+>/g, ' ').replace(/[*_`]{1,3}/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return s.length > 260 ? `${s.slice(0, 257).replace(/\s+\S*$/, '')}...` : s;
};
const slugOf = (key, title, tag) => {
  const stem = String(title).toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '') || tag;
  return `${stem}-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 6)}`;
};
function detailOf(it) {
  const d = {};
  if (it.tag === 'release') { if (it.author) d.repo = it.author; if (it.extra?.version) d.version = it.extra.version; }
  if (it.tag === 'advisory') {
    if (it.author) d.package = it.author;
    if (it.extra?.ecosystem) d.ecosystem = it.extra.ecosystem;
    if (it.severity) d.severity = it.severity;
    if (it.extra?.cve || it.extra?.ghsa) d.advisoryId = it.extra.cve || it.extra.ghsa;
    if (it.text) d.desc = toDek(it.text);
  }
  if (it.tag === 'incident') { if (it.author) d.service = it.author; if (it.text) d.desc = toDek(it.text); }
  if (it.tag === 'changelog' && it.author) d.sourceName = it.author;
  return d;
}

export default defineWire({
  slug: 'standup',
  name: 'The Standup',
  beat: 'releases, CVEs, outages and breaking changes that a developer has to act on',
  voice,

  sources: [
    rssFeeds({ feeds: feeds.feeds, source: 'feed', tag: 'changelog' }),
    rssFeeds({ feeds: feeds.status, source: 'status', tag: 'incident', titlePrefix: true }),
    githubReleases({ repos: feeds.releases }),
    githubAdvisories({ severities: ['critical', 'high'] }),
  ],

  // Hard filters. Never traded against the score.
  filters: { maxAgeH: 12, sources: ['advisory', 'status', 'release', 'feed'], minScore: 60, minStars: 200 },
  // Inside what passed: the freshest event first.
  score: (item) => -item.ageH,
  batch: 12,
  compile: 'on-demand',

  model: { type: process.env.NEWSRAIL_PROVIDER || 'gemini', model: process.env.NEWSRAIL_MODEL || 'gemini-2.5-flash', baseURL: process.env.NEWSRAIL_BASE_URL },
  purpose: 'compose',
  gate: 'default',
  copyGates: ['noise', 'prose'],

  card: {
    mode: 'software',
    publication: 'The Standup',
    credit: 'standup.thecompound.tech',
    accent: '#5c74ff',
    kicker: (item) => LABELS[item.tag] || String(item.tag || 'wire').toUpperCase(),
  },

  platforms: ['threads', 'bluesky'],
  platformRules: {
    threads: { maxChars: 500, targetChars: 220, tags: 'none' },
    bluesky: { maxChars: 300, targetChars: 200, tags: 'one' },
  },
  transports: {
    bluesky: bluesky({ expectedHandle: process.env.STANDUP_BLUESKY_HANDLE }),
    threads: threads({ expectedHandle: process.env.STANDUP_THREADS_HANDLE, hostImage: supabaseImageHost({ bucket: 'standup' }) }),
  },
  // Five posts a day per platform: a 2.8 hour gap inside 08:00 to 22:00.
  cadence: { activeHours: [8, 22], gapMinutes: 168 },

  // Runtime state and the local feed go under .newsrail/ in the directory you run from.
  stateDir: '.newsrail/standup',
  table: 'standup_posts',
  bucket: 'standup',
  row: (rec) => {
    const it = rec.item;
    const tag = it.tag || 'changelog';
    const slug = slugOf(rec.key, it.title, tag);
    return {
      slug,
      id: slug,
      title: it.title,
      dek: toDek(it.text),
      post: rec.text,
      tier: TIERS[tag] ?? 3,
      cat: tag,
      cat_label: LABELS[tag] || tag.toUpperCase(),
      category: 'dev',
      source: it.author || it.source || '',
      url: it.url,
      ts: Date.parse(rec.postedAt),
      detail: detailOf(it),
      kind: 'text',
      accounts: rec.posts.map((p) => ({ platform: p.platform, permalink: p.url, at: p.at })),
      updated_at: new Date().toISOString(),
      card: rec.card,
    };
  },
  stores: [
    jsonFeedStore({ path: '.newsrail/standup/site/feed.json', title: 'The Standup', homePageUrl: 'https://standup.thecompound.tech', description: 'Releases, CVEs, outages and breaking changes that a developer has to act on.' }),
  ],
  mirrorPolicy: { delete: false },
  armFlag: here('./ARMED'),
  launchd: 'newsrail.standup',
});
