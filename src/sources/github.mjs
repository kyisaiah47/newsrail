// GitHub as a source: topic search, release feeds and reviewed security advisories.
//
// Topic search and advisories use the REST API. Without a token the search endpoint allows 10
// requests a minute per IP, so pass `token` (or set GITHUB_TOKEN) on a busy wire. Release feeds are
// read as github.com/<repo>/releases.atom, which costs no API quota at all.

import { get, mapLimit, isoOrNull, item } from './http.mjs';
import { parseFeed } from './rss.mjs';

const API = 'https://api.github.com';
const tokenOf = (token) => token ?? process.env.GITHUB_TOKEN ?? '';
const ghHeaders = (token) => {
  const t = tokenOf(token);
  return { 'X-GitHub-Api-Version': '2022-11-28', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

/**
 * Repositories under one or more topics, pushed to recently, ranked by stars.
 *
 *   githubTopics({ topics: ['ai-agents', 'mcp'], minStars: 150, pushedWithinDays: 7 })
 */
export function githubTopics({ topics = [], minStars = 50, pushedWithinDays = 7, perTopic = 20, token, source = 'github' } = {}) {
  if (!topics.length) throw new Error('githubTopics: `topics` must name at least one topic');
  return {
    name: source,
    async poll(ctx = {}) {
      const out = [];
      const since = new Date((ctx.now ?? Date.now()) - pushedWithinDays * 864e5).toISOString().slice(0, 10);
      for (const topic of topics) {
        try {
          const q = encodeURIComponent(`topic:${topic} pushed:>${since} stars:>=${minStars} archived:false fork:false`);
          const j = await get(`${API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perTopic}`,
            { accept: 'application/vnd.github+json', fetch: ctx.fetch, userAgent: ctx.userAgent, headers: ghHeaders(token) });
          for (const r of j.items || []) {
            if (r.archived || r.fork || r.is_template) continue;
            out.push(item({
              source,
              url: r.html_url,
              link: r.homepage || null,
              title: r.description ? `${r.full_name}: ${r.description}` : r.full_name,
              text: r.description || '',
              author: r.owner?.login || null,
              publishedAt: r.pushed_at || r.created_at,
              stars: r.stargazers_count || 0,
              metrics: `${r.stargazers_count || 0} stars, ${r.language || 'no language'}`,
              tag: topic,
              extra: { repo: r.full_name, topics: r.topics || [], language: r.language || null, createdAt: r.created_at },
            }));
          }
        } catch (e) {
          ctx.log?.(`  ${source}/topic:${topic}: ${String(e.message || e).slice(0, 100)}`);
        }
      }
      return out;
    },
  };
}

// A release feed carries every tag, and most tags are not news. Canary and nightly builds are
// dropped, prereleases are dropped (the real release follows within days), and the tag must look
// like a version. The optional `rel_` prefix is for repositories that tag REL_18_1.
const NOISY = /canary|nightly|snapshot|-dev\b|\+build|[-._](rc|alpha|beta|preview|pre)\d*\b/i;
const VERSIONISH = /^(?:v|rel[_-]?)?\d+[._]\d+/i;

/**
 * Shipped releases from a watchlist of repositories.
 *
 *   githubReleases({ repos: [{ repo: 'nodejs/node', name: 'Node.js' }] })
 */
export function githubReleases({ repos = [], concurrency = 8, source = 'release' } = {}) {
  if (!repos.length) throw new Error('githubReleases: `repos` must name at least one { repo, name }');
  return {
    name: source,
    async poll(ctx = {}) {
      const out = [];
      await mapLimit(repos, concurrency, async (r) => {
        try {
          const xml = await get(`https://github.com/${r.repo}/releases.atom`, { accept: 'application/atom+xml', fetch: ctx.fetch, userAgent: ctx.userAgent });
          for (const it of parseFeed(xml)) {
            // The tag comes from the link, never the entry title: a release NAME can carry a version
            // that is not this release's.
            const tag = decodeURIComponent((it.link.match(/\/releases\/tag\/(.+)$/) || [])[1] || '');
            if (!tag || tag.includes('/') || NOISY.test(tag) || !VERSIONISH.test(tag)) continue;
            out.push(item({
              source,
              url: it.link,
              title: `${r.name || r.repo} ${tag}`,
              text: it.text,
              author: r.repo,
              publishedAt: isoOrNull(it.ts),
              metrics: `${r.repo} ${tag}`,
              tag: 'release',
              extra: { repo: r.repo, version: tag },
            }));
          }
        } catch (e) {
          ctx.log?.(`  ${source}/${r.repo}: ${String(e.message || e).slice(0, 100)}`);
        }
      });
      return out;
    },
  };
}

/**
 * Reviewed GitHub security advisories. `type=reviewed` limits the list to advisories with an
 * ecosystem and a package name, which is what makes them something a reader can act on.
 *
 *   githubAdvisories({ severities: ['critical', 'high'] })
 */
export function githubAdvisories({ severities = ['critical', 'high'], ecosystem = null, perPage = 20, token, source = 'advisory' } = {}) {
  return {
    name: source,
    async poll(ctx = {}) {
      const out = [];
      for (const sev of severities) {
        try {
          const eco = ecosystem ? `&ecosystem=${encodeURIComponent(ecosystem)}` : '';
          const j = await get(`${API}/advisories?severity=${sev}&type=reviewed&per_page=${perPage}${eco}`,
            { accept: 'application/vnd.github+json', fetch: ctx.fetch, userAgent: ctx.userAgent, headers: ghHeaders(token) });
          if (!Array.isArray(j)) throw new Error(String(j?.message || 'unexpected response shape'));
          for (const a of j) {
            const p = a.vulnerabilities?.[0]?.package || {};
            if (!p.name) continue;
            out.push(item({
              source,
              url: a.html_url || `https://github.com/advisories/${a.ghsa_id}`,
              title: `${sev.toUpperCase()}: ${p.name}: ${a.summary || a.ghsa_id}`,
              text: a.description || '',
              author: p.name,
              publishedAt: a.published_at || null,
              severity: sev,
              metrics: `${sev}, ${p.ecosystem || 'package'}, ${a.cve_id || a.ghsa_id}`,
              tag: 'advisory',
              extra: { ecosystem: p.ecosystem || null, ghsa: a.ghsa_id, cve: a.cve_id || null },
            }));
          }
        } catch (e) {
          ctx.log?.(`  ${source}/${sev}: ${String(e.message || e).slice(0, 100)}`);
        }
      }
      return out;
    },
  };
}
