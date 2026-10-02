#!/usr/bin/env node
// The scrub gate. It fails closed: any finding, or no files to scan, exits 1.
//
//   node scripts/scrub-gate.mjs [root]
//
// It scans every file git would publish (tracked plus untracked, minus .gitignore), or every file
// under the root when the root is not a git checkout. It refuses:
//
//   personal addresses   private email addresses of the people behind this project
//   private identifiers  a local home path, a private database project id, Stripe account ids,
//                        the names of private secret tools
//   account handles      handles of the publisher's own social accounts, and any AT Protocol DID
//   key shapes           API keys, tokens, private keys and app passwords
//   bot-detection bypass stealth plugins, automated challenge solvers, webdriver flag overrides
//
// Private values are matched by hash, so this file does not publish the list it protects. No
// allowlist and no override flag exist. A finding is fixed by removing the value.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const h = (s) => crypto.createHash('sha256').update(String(s).toLowerCase()).digest('hex').slice(0, 20);

// Handles that are never legitimate anywhere in this repo.
const BARE = new Set(['231a331bdce0d094c88c', 'f11d00bfd64aed93522c', '37354cb95dcc4ee9cf02', 'b2f3a4aee965bf05b70e', 'aa145caf4e2953e54bb8', '898a8db9b3cf8bfa4c71', '375ef17c2ba8e8e82356', '09e36f12f88829de3847', '7d51d82c55fe2d756d2e', '14d2354506ca94d4d68d', 'eccccc16a9340b47e71e', '9e8162c34771708ef1ec', 'c3e65dc868df7ec25d18', '9d49d293aabae30bc3cc', '70e21be1c3be6da8dca9', '3a0e52ccc2254ebca725', '8e325fd979479aa192ac', '7327751d474f3cca55c8', '4a20a45bb111de6b6ec8', 'a4c3b652a28e06e7c528']);
// Handles that are also a site domain or the repository owner: refused as a handle (@name, or
// assigned to handle, identifier or username), allowed as a domain or a repository path.
const AT = new Set(['1232b0f5e5073b48e735', 'e5b60367ee225010efcf', '1b03d7acea439a505927', '5c5e795ba4f3f4c727b0', 'eae09b4bf728a7c73411', '4586edb15c06763edc24', ...BARE]);
// Email prefixes: local part plus "@", or local part plus "@" plus the first domain label.
const EMAILS = new Set(['bacb5f1eb38633d7e8c8', '51579a5024dce403793a', '739b55edfb543ab7f381', 'a80f263e389ad5232375', '6ef68a1d5ed487ad5106', '66cfae41457040493831', '0287a47cbbc9dbfd0c6e']);
// Private project identifiers, matched as whole 20-letter tokens.
const IDS = new Set(['41f5de058b2a5859451d']);

export const PATTERNS = [
  ['private path', /\/Users\/admin\b/],
  ['private secret tool', /\bcompound-secre[t]\b|\bcompound-vaul[t]\b/],
  ['Stripe account id', /\bacct_[A-Za-z0-9]{8,}/],
  ['AT Protocol DID', /\bdid:plc:[a-z2-7]{24}\b/],
  ['OpenAI or Anthropic key', /\bsk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Google OAuth secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Stripe key', /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|\bwhsec_[A-Za-z0-9]{20,}/],
  ['Supabase key', /\bsbp_[a-f0-9]{30,}|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/],
  ['Meta or Threads token', /\b(?:EAA|THAA)[A-Za-z0-9]{60,}/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['app password', /\b(?=[a-z0-9-]*\d)[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/],
  ['stealth plugin', /puppeteer-extr[a]-plugin-[s]tealth|\bplaywright-extr[a]\b|\bStealthPlugi[n]\b|\bpuppeteer-extr[a]\b/i],
  ['challenge solver', /\b2captch[a]|\banti-?captch[a]|\bcapsolve[r]|\bcaptcha.?solv(?:e|er|ing)\b/i],
  ['webdriver override', /defineProperty\(\s*navigator\s*,\s*['"]webdrive[r]|navigator\.webdrive[r]\s*=(?!=)|AutomationControlle[d]/],
];

function hashFindings(text) {
  const out = [];
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]*/g)) {
    const [local, domain] = m[0].toLowerCase().split('@');
    if (EMAILS.has(h(`${local}@`)) || EMAILS.has(h(`${local}@${domain}`))) out.push(['personal address', m.index]);
  }
  for (const m of text.matchAll(/(?<![\w.@])@([A-Za-z0-9_][A-Za-z0-9_.-]{1,80})/g)) {
    if (AT.has(h(m[1].replace(/\.+$/, '')))) out.push(['account handle', m.index]);
  }
  for (const m of text.matchAll(/\b(?:handle|identifier|username|expectedHandle)\s*[:=]\s*['"`]@?([^'"`\s]+)['"`]/gi)) {
    if (AT.has(h(m[1]))) out.push(['account handle', m.index]);
  }
  for (const m of text.matchAll(/[A-Za-z0-9_][A-Za-z0-9_.-]*/g)) {
    const t = m[0].replace(/\.+$/, '');
    if (BARE.has(h(t))) out.push(['account handle', m.index]);
    if (t.split(/[._-]/).some((p) => p.length === 20 && /^[a-z]+$/.test(p) && IDS.has(h(p)))) out.push(['private project id', m.index]);
  }
  return out;
}

/** Findings in one text: [{ kind, line }]. */
export function scanText(text) {
  const found = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) found.push([kind, m.index]);
  }
  found.push(...hashFindings(text));
  return found.map(([kind, at]) => ({ kind, line: text.slice(0, at).split('\n').length }));
}

export function listFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
  } catch {
    const acc = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (['.git', 'node_modules'].includes(e.name)) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else acc.push(p);
      }
    };
    walk(root);
    return acc;
  }
}

/** Scan a tree. Returns { files, findings: [{ file, kind, line }] }. */
export function scrub(root) {
  const files = listFiles(root);
  const findings = [];
  let scanned = 0;
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(f); } catch { continue; }
    if (buf.includes(0)) continue;
    scanned += 1;
    for (const x of scanText(buf.toString('utf8'))) findings.push({ file: path.relative(root, f), ...x });
  }
  return { files: scanned, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const { files, findings } = scrub(root);
  if (!files) {
    console.error(`scrub-gate: FAIL. No files to scan under ${root}; the gate cannot pass on an empty set.`);
    process.exit(1);
  }
  if (findings.length) {
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.kind}`);
    console.error(`scrub-gate: FAIL. ${findings.length} finding(s) in ${files} files.`);
    process.exit(1);
  }
  console.log(`scrub-gate: PASS. ${files} files scanned, 0 findings.`);
}
