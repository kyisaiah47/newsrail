// Store: a SQLite table through node:sqlite (Node 22.5 or newer). No dependency.
//
//   sqliteStore({ path: 'wire.db', table: 'posts' })
//
// One row per story, keyed by slug, with the full row as JSON and the common columns beside it.

import fs from 'node:fs';
import path from 'node:path';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function sqliteStore(opts = {}) {
  if (!opts.path) throw new Error('sqliteStore: `path` is required');
  return {
    name: 'sqlite',
    local: true,
    async upsert(rows, { wire, table: wireTable, deleteMissing = false, log = () => {} } = {}) {
      const table = opts.table || wireTable || 'newsrail_posts';
      if (!IDENT.test(table)) throw new Error(`sqliteStore: bad table name ${table}`);
      const { DatabaseSync } = await import('node:sqlite');
      fs.mkdirSync(path.dirname(path.resolve(opts.path)), { recursive: true });
      const db = new DatabaseSync(opts.path);
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
          slug TEXT PRIMARY KEY, wire TEXT, title TEXT, dek TEXT, url TEXT, source TEXT, tag TEXT,
          ts TEXT, img TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        const up = db.prepare(`INSERT INTO ${table} (slug, wire, title, dek, url, source, tag, ts, img, data, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET wire=excluded.wire, title=excluded.title, dek=excluded.dek, url=excluded.url,
            source=excluded.source, tag=excluded.tag, ts=excluded.ts, img=excluded.img, data=excluded.data, updated_at=excluded.updated_at`);
        const now = new Date().toISOString();
        db.exec('BEGIN');
        for (const r of rows) {
          const { card, ...data } = r;
          up.run(r.slug, wire, r.title, r.dek, r.url, r.source, r.tag || null, r.ts, r.img || card || null, JSON.stringify(data), now);
        }
        if (deleteMissing) {
          const keep = new Set(rows.map((r) => r.slug));
          const del = db.prepare(`DELETE FROM ${table} WHERE slug = ? AND wire = ?`);
          for (const { slug } of db.prepare(`SELECT slug FROM ${table} WHERE wire = ?`).all(wire)) if (!keep.has(slug)) del.run(slug, wire);
        }
        db.exec('COMMIT');
        const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE wire = ?`).get(wire);
        log(`  store sqlite: ${n} rows in ${opts.path}:${table}`);
        return { count: n };
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch {}
        throw e;
      } finally {
        db.close();
      }
    },
  };
}
