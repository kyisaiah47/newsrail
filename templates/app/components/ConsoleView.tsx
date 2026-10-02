'use client';

/* The Console. Three columns edge to edge: the filters on the left, every post as one dense row in
 * the middle, the selected post on the right. The selected post lives in the URL as ?p=, so a link
 * to a post is a link to that post. */
import { useEffect, useMemo, useState } from 'react';
import type { Post } from '@/lib/feed';
import { useSelected } from './useSelected';

const short = (iso: string) => (iso ? new Date(iso).toISOString().slice(5, 16).replace('T', ' ') : '');

export default function ConsoleView({ posts, title, description, error }: { posts: Post[]; title: string; description: string; error: string | null }) {
  const kinds = useMemo(() => [...new Set(posts.map((p) => p.kind).filter(Boolean))].sort(), [posts]);
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [selected, select] = useSelected(posts);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((p) => (!kind || p.kind === kind) && (!q || `${p.title} ${p.text} ${p.source}`.toLowerCase().includes(q)));
  }, [posts, kind, query]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('p');
    if (p && posts.some((x) => x.id === p)) select(p);
  }, [posts, select]);

  const pick = (id: string) => {
    select(id);
    const url = new URL(window.location.href);
    url.searchParams.set('p', id);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  };

  const cur = posts.find((p) => p.id === selected) ?? shown[0] ?? null;

  return (
    <main className="console">
      <aside className="console-rail" aria-label="Filters">
        <h1>{title}</h1>
        {description ? <p className="console-sub">{description}</p> : null}
        <label className="console-label" htmlFor="console-search">Search</label>
        <input id="console-search" className="console-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, text or source" />
        <span className="console-label">Source kind</span>
        <div className="console-chips" role="group" aria-label="Source kind">
          <button type="button" aria-pressed={!kind} onClick={() => setKind('')}>all {posts.length}</button>
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k} {posts.filter((p) => p.kind === k).length}
            </button>
          ))}
        </div>
      </aside>

      <section className="console-rows" aria-label="Posts">
        {error ? <p className="console-empty">The feed could not be read: {error}</p> : null}
        {!error && !posts.length ? <p className="console-empty">No posts yet. Run a tick with a jsonFeedStore that writes this app&rsquo;s feed file.</p> : null}
        <table>
          <thead>
            <tr><th scope="col">Posted (UTC)</th><th scope="col">Kind</th><th scope="col">Source</th><th scope="col">Headline</th></tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} data-selected={cur?.id === p.id} onClick={() => pick(p.id)}>
                <td className="mono">{short(p.date)}</td>
                <td className="mono">{p.kind}</td>
                <td>{p.source}</td>
                <td><button type="button" className="row-link" onClick={() => pick(p.id)}>{p.title}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="console-detail" aria-label="Selected post">
        {cur ? (
          <>
            {cur.image ? <img src={cur.image} alt={`Card for: ${cur.title}`} /> : null}
            <span className="console-label">{cur.kind} / {cur.source}</span>
            <h2>{cur.title}</h2>
            <p>{cur.text}</p>
            <dl>
              <div><dt>Posted</dt><dd className="mono">{cur.date}</dd></div>
              <div><dt>Source</dt><dd><a href={cur.url} rel="noopener">{cur.url}</a></dd></div>
              {cur.posts.map((x) => (
                <div key={`${x.platform}-${x.url}`}><dt>{x.platform}</dt><dd>{x.url ? <a href={x.url} rel="noopener">{x.url}</a> : 'posted'}</dd></div>
              ))}
            </dl>
          </>
        ) : null}
      </aside>
    </main>
  );
}
