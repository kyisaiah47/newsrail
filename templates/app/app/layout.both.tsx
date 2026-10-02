import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import config from '../newsrail.config.json';
import { getFeed } from '@/lib/feed';
import SiteViewProvider from '@/components/site-view/SiteViewProvider';
import './globals.css';

export const metadata: Metadata = { title: config.name, description: `${config.name}, published with NewsRail.` };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const feed = await getFeed();
  const p = feed.posts[0];
  const example = p ? { source: p.source, title: p.title, text: p.text, date: p.date } : null;
  return (
    <html lang="en">
      <body>
        <SiteViewProvider example={example}>{children}</SiteViewProvider>
      </body>
    </html>
  );
}
