'use client';

/* The Simple view. What the wire covers, the newest post as a readable card, then the rest of the
 * posts, each with its details behind a disclosure. Same posts as the Console, roomier layout. */
import type { Post } from '@/lib/feed';
import Disclosure from './Disclosure';
import { useSelected } from './useSelected';

function Details({ post }: { post: Post }) {
  return (
    <Disclosure title="Where this came from">
      <p>
        Source: <a href={post.url} rel="noopener">{post.source || post.url}</a>
      </p>
      {post.posts.length ? (
        <ul className="sv-list">
          {post.posts.map((x) => (
            <li key={`${x.platform}-${x.url}`}>
              Posted on {x.platform}: {x.url ? <a href={x.url} rel="noopener">{x.url}</a> : 'yes'}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sv-note">Posted {new Date(post.date).toUTCString()}.</p>
    </Disclosure>
  );
}

export default function SimpleView({ posts, title, description, feedUrl, error }: { posts: Post[]; title: string; description: string; feedUrl: string; error: string | null }) {
  const [selected] = useSelected(posts);
  const lead = posts.find((p) => p.id === selected) ?? posts[0] ?? null;
  const rest = posts.filter((p) => p !== lead);
  return (
    <main className="sv-home">
      <section className="sv-hero">
        <div className="sv-pitch">
          <h1>{title}</h1>
          <p>{description || `${title} posts each story that passes its filters, with the source linked.`}</p>
          <p className="sv-qualifier">
            Follow it in any feed reader: <a href={feedUrl}>{feedUrl}</a>
          </p>
        </div>
        {lead ? (
          <article className="sv-card" aria-label="Newest post">
            <span className="sv-eyebrow">NEWEST POST</span>
            {lead.image ? <img src={lead.image} alt={`Card for: ${lead.title}`} /> : null}
            <h2>{lead.title}</h2>
            <p className="sv-card-sub">{lead.text}</p>
            <Details post={lead} />
          </article>
        ) : (
          <article className="sv-card">
            <h2>{error ? 'The feed could not be read.' : 'No posts yet.'}</h2>
            <p className="sv-card-sub">{error || 'The first post appears here after the wire posts and stores it.'}</p>
          </article>
        )}
      </section>
      {rest.length ? (
        <section className="sv-section" aria-label="Earlier posts">
          <h2 className="sv-group">Earlier posts</h2>
          {rest.map((p) => (
            <article key={p.id} className="sv-row">
              <span className="sv-eyebrow">{p.source} / {new Date(p.date).toUTCString().slice(5, 22)}</span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
              <Details post={p} />
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
