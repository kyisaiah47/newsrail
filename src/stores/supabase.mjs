// Store: a Supabase (PostgREST) table, with cards uploaded to a Storage bucket.
//
//   supabaseStore({ url, key, table: 'wire_posts', bucket: 'wire' })
//
// `url` and `key` fall back to SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The key needs write
// access to the table and the bucket, so keep it on the machine that runs the wire.
//
// Rows are upserted on `slug`. Only rows posted in the last `sinceDays` are sent each tick (the
// earlier ones are already there), unless `deleteMissing` is on, which needs the full set.
// The table needs the columns your row function returns. Pass `columns` to send only those keys
// when the row carries extra fields for other stores.

import fs from 'node:fs';
import path from 'node:path';

function conn(opts) {
  const url = String(opts.url ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = opts.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase: set url and key, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  return { url, key, f: opts.fetch || globalThis.fetch };
}

async function upload({ url, key, f }, bucket, objectPath, file, mime) {
  const r = await f(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': mime, 'x-upsert': 'true' },
    body: fs.readFileSync(file),
  });
  if (!r.ok) throw new Error(`supabase storage ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
}

const mimeOf = (file) => ({ '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file).toLowerCase()] || 'application/octet-stream');

/** An image host for the Threads transport: uploads a card to a public bucket, returns its URL. */
export function supabaseImageHost(opts = {}) {
  return async (file, { mime } = {}) => {
    const c = conn(opts);
    const name = `${opts.prefix || 'cards'}/${Date.now()}-${path.basename(file)}`;
    return upload(c, opts.bucket || 'newsrail', name, file, mime || mimeOf(file));
  };
}

export function supabaseStore(opts = {}) {
  return {
    name: 'supabase',
    local: false,
    async upsert(rows, { wire, table: wireTable, bucket: wireBucket, deleteMissing = false, log = () => {} } = {}) {
      const c = conn(opts);
      const table = opts.table || wireTable;
      const bucket = opts.bucket || wireBucket;
      if (!table) throw new Error('supabase: no table (set it on the store or as the wire\'s `table`)');
      const since = Date.now() - (opts.sinceDays ?? 3) * 864e5;
      const tsMs = (t) => (typeof t === 'number' ? t : Date.parse(t));
      const send = deleteMissing ? rows : rows.filter((r) => tsMs(r.ts) >= since);
      const out = [];
      for (const r of send) {
        const { card, ...full } = r;
        const row = Array.isArray(opts.columns) ? Object.fromEntries(opts.columns.filter((k) => k in full).map((k) => [k, full[k]])) : full;
        if (card && bucket && fs.existsSync(card) && (!opts.columns || opts.columns.includes('img'))) {
          try { row.img = await upload(c, bucket, `${wire}/${row.slug}${path.extname(card)}`, card, mimeOf(card)); }
          catch (e) { log(`  store supabase: card upload failed for ${row.slug}: ${e.message}`); }
        }
        out.push(row);
      }
      if (out.length) {
        const r = await c.f(`${c.url}/rest/v1/${table}?on_conflict=${opts.onConflict || 'slug'}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${c.key}`, apikey: c.key, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(out),
        });
        if (!r.ok) throw new Error(`supabase upsert ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
      if (deleteMissing && rows.length) {
        const list = rows.map((r) => `"${String(r.slug).replace(/"/g, '')}"`).join(',');
        const wireFilter = opts.wireColumn ? `&${opts.wireColumn}=eq.${encodeURIComponent(wire)}` : '';
        const r = await c.f(`${c.url}/rest/v1/${table}?slug=not.in.(${encodeURIComponent(list)})${wireFilter}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${c.key}`, apikey: c.key, prefer: 'return=minimal' },
        });
        if (!r.ok) throw new Error(`supabase delete ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
      log(`  store supabase: ${out.length} rows upserted into ${table}`);
      return { count: out.length };
    },
  };
}
