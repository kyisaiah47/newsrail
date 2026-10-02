// Test helpers: a fake fetch, a temp dir, and a fixed set of items. No test reaches the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpdir(prefix = 'newsrail-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A fetch that answers from a route table: { 'GET https://x/y': (req) => ({ status, body, headers }) }. */
export function fakeFetch(routes, calls = []) {
  return async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const u = String(url);
    calls.push({ method, url: u, headers: init.headers || {}, body: init.body });
    const hit = Object.entries(routes).find(([k]) => {
      const [m, prefix] = k.split(' ');
      return m === method && u.startsWith(prefix);
    });
    if (!hit) return new Response(`no route for ${method} ${u}`, { status: 404 });
    const r = await hit[1]({ method, url: u, init });
    const body = typeof r.body === 'string' || r.body instanceof Uint8Array ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, { status: r.status ?? 200, headers: r.headers || { 'content-type': 'application/json' } });
  };
}

export const hoursAgo = (h, now = Date.now()) => new Date(now - h * 3.6e6).toISOString();

/** A source adapter that returns fixed items. */
export function fixedSource(items, name = 'fixed') {
  return { name, async poll() { return items.map((i) => ({ ...i })); } };
}

export function sampleItems(now = Date.now()) {
  return [
    { source: 'advisory', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', title: 'HIGH: left-pad: Prototype pollution in left-pad before 2.0.1', text: 'left-pad before 2.0.1 allows prototype pollution through crafted keys.', author: 'left-pad', publishedAt: hoursAgo(1, now), severity: 'high', tag: 'advisory', metrics: 'high, npm, CVE-2026-0001' },
    { source: 'status', url: 'https://status.example.com/incidents/1', title: 'ExampleCloud: Elevated API errors in us-east', text: 'We are investigating elevated 500 errors on the API in us-east.', author: 'ExampleCloud', publishedAt: hoursAgo(2, now), tag: 'incident', metrics: 'ExampleCloud' },
    { source: 'release', url: 'https://github.com/example/runtime/releases/tag/v5.0.0', title: 'Runtime v5.0.0', text: 'Drops support for Node 18. The default module format is now ESM.', author: 'example/runtime', publishedAt: hoursAgo(3, now), tag: 'release', metrics: 'example/runtime v5.0.0' },
    { source: 'feed', url: 'https://blog.example.org/old-news', title: 'Example Database 9 deprecates the legacy wire protocol', text: 'The legacy protocol is removed in version 10.', author: 'Example Database', publishedAt: hoursAgo(40, now), tag: 'changelog', score: 9999 },
  ];
}
