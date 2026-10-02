import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import config from '../newsrail.config.json';
import './globals.css';

export const metadata: Metadata = { title: config.name, description: `${config.name}, published with NewsRail.` };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
