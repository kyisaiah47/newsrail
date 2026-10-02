#!/usr/bin/env node
// newsrail command line.
//
//   newsrail tick <wire.mjs> [--platform bluesky] [--dry] [--force] [--provider stub] [--json]
//   newsrail new-app --app console|simple|both [--dir ./site] [--feed ./feed.json] [--name "The Wire"]
//   newsrail schedule <wire.mjs> [--every 600]
//
// Exit codes for `tick`: 0 posted, owed or stopped by a platform signal; 75 held (outside active
// hours, inside the gap, not armed); 1 a fault in the agent itself.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runTick } from './engine.mjs';
import { exitCode } from './signals.mjs';
import { newApp } from './scaffold/new-app.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const HELP = `newsrail ${pkg.version}

  newsrail tick <wire.mjs> [--platform <p>] [--dry] [--force] [--provider stub] [--json]
      Run one tick of a wire. --dry swaps every transport for a dry one, uses separate state
      files, and writes only to local stores. --force ignores the arm flag and the cadence.

  newsrail new-app --app console|simple|both [--dir <path>] [--feed <path or URL>] [--name <name>]
      Scaffold a Next.js site that reads the wire's stored JSON feed.

  newsrail schedule <wire.mjs> [--every <seconds>]
      Print a crontab line and a launchd job for the wire.
`;

async function loadWire(file) {
  if (!file) throw new Error('give the path to a wire config file');
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  return mod.default || mod.wire;
}

async function main() {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { process.stdout.write(HELP); return 0; }
  if (cmd === '--version' || cmd === '-v') { process.stdout.write(`${pkg.version}\n`); return 0; }

  if (cmd === 'tick') {
    const wire = await loadWire(argv[1]);
    const providerName = arg('--provider');
    const r = await runTick(wire, {
      platform: arg('--platform') || undefined,
      dry: flag('--dry'),
      force: flag('--force'),
      provider: providerName ? { type: providerName } : undefined,
    });
    process.stdout.write(`${JSON.stringify(r, null, flag('--json') ? 0 : 2)}\n`);
    for (const s of r.signals || []) process.stderr.write(`${s.message}\n`);
    return exitCode(r);
  }

  if (cmd === 'new-app') {
    const app = arg('--app') || 'both';
    const out = newApp({ app, dir: arg('--dir') || './newsrail-site', feed: arg('--feed') || 'public/feed.json', name: arg('--name') || 'The Wire' });
    process.stdout.write(`${out.files.length} files written to ${out.dir}\n  cd ${out.dir} && npm install && npm run dev\n`);
    return 0;
  }

  if (cmd === 'schedule') {
    const file = path.resolve(argv[1] || '');
    const wire = await loadWire(argv[1]);
    const every = Number(arg('--every') || 600);
    const label = wire.launchd || `newsrail.${wire.slug}`;
    const node = process.execPath;
    const cli = new URL(import.meta.url).pathname;
    process.stdout.write(`# crontab (every ${Math.max(1, Math.round(every / 60))} min)
*/${Math.max(1, Math.round(every / 60))} * * * * cd ${path.dirname(file)} && ${node} ${cli} tick ${file} >> ${wire.slug}.log 2>&1

# launchd: save as ~/Library/LaunchAgents/${label}.plist, then launchctl load it
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${cli}</string><string>tick</string><string>${file}</string></array>
  <key>WorkingDirectory</key><string>${path.dirname(file)}</string>
  <key>StartInterval</key><integer>${every}</integer>
  <key>StandardOutPath</key><string>${path.join(path.dirname(file), `${wire.slug}.log`)}</string>
  <key>StandardErrorPath</key><string>${path.join(path.dirname(file), `${wire.slug}.log`)}</string>
</dict></plist>
`);
    return 0;
  }

  process.stderr.write(`unknown command "${cmd}"\n\n${HELP}`);
  return 1;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
  process.exitCode = exitCode(e);
});
