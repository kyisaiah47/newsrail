/* Reads the wire's stored JSON Feed: a file path relative to this app (the default is
 * public/feed.json, which NewsRail's jsonFeedStore writes) or an https URL. NEWSRAIL_FEED overrides
 * the path in newsrail.config.json. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import config from '../newsrail.config.json';

export interface PlatformPost {
  platform: string;
  url: string | null;
}

export interface Post {
  id: string;
  title: string;
  text: string;
  url: string;
  date: string;
  image: string | null;
  source: string;
  kind: string;
  posts: PlatformPost[];
}

export interface Feed {
  title: string;
  description: string;
  feedUrl: string;
  posts: Post[];
  error: string | null;
}

interface FeedItem {
  id: string;
  url?: string;
  external_url?: string;
  title?: string;
  content_text?: string;
  summary?: string;
  date_published?: string;
  image?: string;
  tags?: string[];
  _newsrail?: { source?: string; kind?: string; posts?: PlatformPost[] };
}

function imageUrl(image: string | undefined, base: string): string | null {
  if (!image) return null;
  if (/^https?:\/\//.test(image)) return image;
  if (/^https?:\/\//.test(base)) return new URL(image, base).href;
  return `/${image.replace(/^\/+/, '')}`;
}

export async function getFeed(): Promise<Feed> {
  const src = process.env.NEWSRAIL_FEED || config.feed;
  const isUrl = /^https?:\/\//.test(src);
  const feedUrl = isUrl ? src : `/${path.relative('public', src).replace(/\\/g, '/')}`;
  try {
    const raw = isUrl
      ? await (await fetch(src, { next: { revalidate: 300 } })).json()
      : JSON.parse(await readFile(path.resolve(/*turbopackIgnore: true*/ process.cwd(), src), 'utf8'));
    const items: FeedItem[] = Array.isArray(raw.items) ? raw.items : [];
    return {
      title: raw.title || config.name,
      description: raw.description || '',
      feedUrl,
      error: null,
      posts: items.map((i) => ({
        id: i.id,
        title: i.title || '',
        text: i.content_text || i.summary || '',
        url: i.external_url || i.url || '',
        date: i.date_published || '',
        image: imageUrl(i.image, src),
        source: i._newsrail?.source || i.tags?.[1] || '',
        kind: i._newsrail?.kind || i.tags?.[0] || '',
        posts: i._newsrail?.posts || [],
      })),
    };
  } catch (e) {
    return { title: config.name, description: '', feedUrl, posts: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** "4 h ago" style age, computed at render time on the server. */
export function age(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
