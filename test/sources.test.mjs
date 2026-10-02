import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, rssFeeds, hackerNews, githubReleases, githubAdvisories, githubTopics, jsonFeed } from '../src/sources/index.mjs';
import { fakeFetch, hoursAgo } from './helpers.mjs';

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Postgres 18.1 released]]></title><link>https://example.org/pg-18-1</link>
<pubDate>${new Date(Date.now() - 3600e3).toUTCString()}</pubDate><description>&lt;p&gt;Fixes &amp;amp; more&lt;/p&gt;</description></item>
<item><title>No link here</title></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Release v2.3.0</title><link rel="alternate" href="https://github.com/o/r/releases/tag/v2.3.0"/><updated>${hoursAgo(2)}</updated><content type="html">Notes</content></entry>
<entry><title>Canary</title><link href="https://github.com/o/r/releases/tag/v2.4.0-canary.3"/><updated>${hoursAgo(1)}</updated></entry>
<entry><title>RC</title><link href="https://github.com/o/r/releases/tag/v2.4.0-rc1"/><updated>${hoursAgo(1)}</updated></entry>
<entry><title>[CI] Update clang 21.1.0</title><link href="https://github.com/o/r/releases/tag/ci-bump"/><updated>${hoursAgo(1)}</updated></entry>
</feed>`;

test('parseFeed reads RSS items with CDATA and entities, and drops items with no link', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Postgres 18.1 released');
  assert.equal(items[0].link, 'https://example.org/pg-18-1');
  assert.match(items[0].text, /Fixes & more/);
  assert.ok(items[0].ts > 0);
});

test('parseFeed reads Atom entries and their alternate link', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 4);
  assert.equal(items[0].link, 'https://github.com/o/r/releases/tag/v2.3.0');
});

test('rssFeeds polls each feed, prefixes titles when asked, and logs a failing feed instead of throwing', async () => {
  const logs = [];
  const f = fakeFetch({ 'GET https://a.example/feed': () => ({ body: RSS, headers: { 'content-type': 'application/rss+xml' } }) });
  const src = rssFeeds({ feeds: [{ url: 'https://a.example/feed', name: 'A' }, { url: 'https://b.example/down', name: 'B' }], source: 'status', titlePrefix: true });
  const out = await src.poll({ fetch: f, log: (m) => logs.push(m) });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'A: Postgres 18.1 released');
  assert.equal(out[0].source, 'status');
  assert.ok(logs.some((l) => l.includes('B')));
});

test('githubReleases keeps shipped versions and drops canary, prerelease and branch-like tags', async () => {
  const f = fakeFetch({ 'GET https://github.com/o/r/releases.atom': () => ({ body: ATOM, headers: { 'content-type': 'application/atom+xml' } }) });
  const out = await githubReleases({ repos: [{ repo: 'o/r', name: 'R' }] }).poll({ fetch: f });
  assert.deepEqual(out.map((i) => i.title), ['R v2.3.0']);
  assert.equal(out[0].extra.version, 'v2.3.0');
});

test('hackerNews carries the thread as url and the article as link, and applies its floor', async () => {
  const now = Math.floor(Date.now() / 1000);
  const f = fakeFetch({
    'GET https://hacker-news.firebaseio.com/v0/topstories.json': () => ({ body: [1, 2] }),
    'GET https://hacker-news.firebaseio.com/v0/item/1.json': () => ({ body: { id: 1, type: 'story', title: 'Big', url: 'https://example.com/a', score: 120, descendants: 40, by: 'x', time: now } }),
    'GET https://hacker-news.firebaseio.com/v0/item/2.json': () => ({ body: { id: 2, type: 'story', title: 'Small', score: 3, time: now } }),
  });
  const out = await hackerNews({ minScore: 30 }).poll({ fetch: f });
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://news.ycombinator.com/item?id=1');
  assert.equal(out[0].link, 'https://example.com/a');
  assert.equal(out[0].score, 120);
});

test('githubAdvisories keeps only advisories with a package', async () => {
  const f = fakeFetch({
    'GET https://api.github.com/advisories?severity=high': () => ({ body: [
      { ghsa_id: 'GHSA-1', html_url: 'https://github.com/advisories/GHSA-1', summary: 'RCE', published_at: hoursAgo(1), cve_id: 'CVE-2026-1', vulnerabilities: [{ package: { name: 'pkg', ecosystem: 'npm' } }] },
      { ghsa_id: 'GHSA-2', summary: 'no package', vulnerabilities: [] },
    ] }),
  });
  const out = await githubAdvisories({ severities: ['high'], token: '' }).poll({ fetch: f });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'high');
  assert.equal(out[0].extra.cve, 'CVE-2026-1');
});

test('githubTopics skips forks and archived repos and carries stars', async () => {
  const f = fakeFetch({
    'GET https://api.github.com/search/repositories': () => ({ body: { items: [
      { full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'An agent runner', stargazers_count: 900, pushed_at: hoursAgo(1), owner: { login: 'a' } },
      { full_name: 'c/d', html_url: 'https://github.com/c/d', fork: true, stargazers_count: 5000, pushed_at: hoursAgo(1) },
    ] } }),
  });
  const out = await githubTopics({ topics: ['ai-agents'], token: '' }).poll({ fetch: f });
  assert.equal(out.length, 1);
  assert.equal(out[0].stars, 900);
});

test('jsonFeed reads JSON Feed 1.1 by default and any JSON with a map', async () => {
  const f = fakeFetch({
    'GET https://j.example/feed.json': () => ({ body: { version: 'https://jsonfeed.org/version/1.1', items: [{ id: '1', url: 'https://j.example/1', title: 'One', content_text: 'Body', date_published: hoursAgo(1) }] } }),
    'GET https://j.example/api': () => ({ body: { data: { posts: [{ permalink: 'https://j.example/p', headline: 'Two', at: hoursAgo(2) }] } } }),
  });
  const a = await jsonFeed({ url: 'https://j.example/feed.json' }).poll({ fetch: f });
  assert.equal(a[0].title, 'One');
  const b = await jsonFeed({ url: 'https://j.example/api', itemsPath: 'data.posts', map: (p) => ({ url: p.permalink, title: p.headline, publishedAt: p.at }) }).poll({ fetch: f });
  assert.equal(b[0].url, 'https://j.example/p');
});
