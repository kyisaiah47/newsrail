// newsrail new-app: scaffold a Next.js site that reads a wire's stored JSON feed.
//
//   --app console   the Console view only: filters, a dense table, the selected post
//   --app simple    the Simple view only: the newest post as a readable card, details on demand
//   --app both      both views, a Start here welcome, and a footer switch between them
//
// The views follow the Console and Simple shells the Compound Labs sites use: Console is the
// default, ?view= overrides the saved choice, the choice is saved, and the selected post survives
// a switch.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'app');
const APPS = ['console', 'simple', 'both'];

const EMPTY_FEED = { version: 'https://jsonfeed.org/version/1.1', title: '', items: [] };

function plan(app) {
  const common = [
    ['package.json', 'package.json'],
    ['next.config.mjs', 'next.config.mjs'],
    ['tsconfig.json', 'tsconfig.json'],
    ['next-env.d.ts', 'next-env.d.ts'],
    ['newsrail.config.json', 'newsrail.config.json'],
    ['gitignore', '.gitignore'],
    ['lib/feed.ts', 'lib/feed.ts'],
    ['app/globals.css', 'app/globals.css'],
  ];
  if (app === 'both') {
    return [...common,
      ['app/layout.both.tsx', 'app/layout.tsx'],
      ['app/page.both.tsx', 'app/page.tsx'],
      ['components/Footer.both.tsx', 'components/Footer.tsx'],
      ['components/ConsoleView.tsx', 'components/ConsoleView.tsx'],
      ['components/SimpleView.tsx', 'components/SimpleView.tsx'],
      ['components/Disclosure.tsx', 'components/Disclosure.tsx'],
      ['components/useSelected.ts', 'components/useSelected.ts'],
      ['components/site-view/SiteViewProvider.tsx', 'components/site-view/SiteViewProvider.tsx'],
      ['components/site-view/Welcome.tsx', 'components/site-view/Welcome.tsx'],
      ['components/site-view/ViewControls.tsx', 'components/site-view/ViewControls.tsx'],
      ['components/site-view/PageViews.tsx', 'components/site-view/PageViews.tsx'],
    ];
  }
  const view = app === 'console'
    ? [['components/ConsoleView.tsx', 'components/ConsoleView.tsx']]
    : [['components/SimpleView.tsx', 'components/SimpleView.tsx'], ['components/Disclosure.tsx', 'components/Disclosure.tsx']];
  return [...common,
    ['app/layout.single.tsx', 'app/layout.tsx'],
    [`app/page.${app}.tsx`, 'app/page.tsx'],
    ['components/Footer.single.tsx', 'components/Footer.tsx'],
    ['components/useSelected.single.ts', 'components/useSelected.ts'],
    ...view,
  ];
}

export function newApp({ app = 'both', dir = './newsrail-site', feed = 'public/feed.json', name = 'The Wire', slug = null } = {}) {
  if (!APPS.includes(app)) throw new Error(`--app must be one of ${APPS.join(', ')}`);
  const out = path.resolve(dir);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} exists and is not empty`);
  const s = slug || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wire';
  const subs = { __NAME__: name, __SLUG__: s, __PKG__: `${s}-site`, __FEED__: feed };
  const files = [];
  for (const [from, to] of plan(app)) {
    let text = fs.readFileSync(path.join(TEMPLATES, from), 'utf8');
    for (const [k, v] of Object.entries(subs)) text = text.split(k).join(String(v).replace(/"/g, '\\"'));
    const dest = path.join(out, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    files.push(to);
  }
  if (!/^https?:\/\//.test(feed)) {
    const feedFile = path.join(out, feed);
    if (!fs.existsSync(feedFile)) {
      fs.mkdirSync(path.dirname(feedFile), { recursive: true });
      fs.writeFileSync(feedFile, `${JSON.stringify({ ...EMPTY_FEED, title: name }, null, 1)}\n`);
      files.push(path.relative(out, feedFile));
    }
  }
  return { dir: out, app, files };
}
