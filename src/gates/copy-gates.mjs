// Optional copy gates: noise and prose. A port of the Compound Labs copy gates.
//
//   noise  performed sincerity, euphemism for no, narrating the answer, product filler
//   prose  a caption in place of a sentence, a money figure with no payer, a metaphor for the
//          product, a label alone on a line
//
// Turn them on per wire with `copyGates: ['noise', 'prose']`. Each check returns the first hit,
// with the fix the pattern list carries, so the writer's log says why a draft was refused.

import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));

function compile(spec, flags) {
  return spec.patterns.map((p) => ({
    ...p,
    re: new RegExp(p.pattern, flags),
    requiresRe: p.requires ? new RegExp(p.requires) : null,
    unlessRe: p.unless ? new RegExp(p.unless) : null,
  }));
}

export const NOISE = load('./noise-patterns.json');
export const PROSE = load('./prose-patterns.json');
const NOISE_P = compile(NOISE, 'i');
const PROSE_P = compile(PROSE, 'im');

const SENT = /(?<=[.!?])\s+|\n+/;
const wordCount = (s) => (String(s).match(/[A-Za-z][A-Za-z']*/g) || []).length;
function sentenceAround(text, index) {
  let pos = 0;
  for (const s of String(text).split(SENT)) {
    const end = pos + s.length;
    if (index >= pos && index <= end) return s.trim();
    pos = end + 1;
  }
  return String(text).slice(Math.max(0, index - 80), index + 120).trim();
}

function scan(patterns, text, scope) {
  const t = String(text || '').replace(/https?:\/\/[^\s"'<>)\]]+/g, '<url>');
  const hits = [];
  for (const p of patterns) {
    if (!p[scope]) continue;
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`);
    let m;
    while ((m = re.exec(t)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      const sentence = sentenceAround(t, m.index);
      if (p.min_words && wordCount(sentence) < p.min_words) continue;
      if (p.requiresRe && !p.requiresRe.test(sentence)) continue;
      if (p.unlessRe && p.unlessRe.test(sentence)) continue;
      hits.push({ slug: p.slug, family: p.family, fix: p.fix, fragment: m[0].trim().slice(0, 200), sentence });
      break;
    }
  }
  return hits;
}

/** Noise hits in outward copy. Empty array means clean. */
export const noiseIssues = (text, { scope = 'copy' } = {}) => scan(NOISE_P, text, scope);
/** Prose hits in outward copy. Empty array means clean. */
export const proseIssues = (text, { scope = 'copy' } = {}) => scan(PROSE_P, text, scope);

/** The rules to put in a writer prompt for the gates a wire turns on. */
export function copyRules(gates = []) {
  const out = [];
  if (gates.includes('noise')) out.push(NOISE.copy_rule);
  if (gates.includes('prose')) out.push(PROSE.copy_rule);
  return out;
}

/** First refusal reason from the turned-on copy gates, or null. */
export function copyGateIssue(text, gates = []) {
  if (gates.includes('noise')) {
    const h = noiseIssues(text)[0];
    if (h) return `noise:${h.slug} ("${h.fragment}")`;
  }
  if (gates.includes('prose')) {
    const h = proseIssues(text)[0];
    if (h) return `prose:${h.slug} ("${h.fragment}")`;
  }
  return null;
}
