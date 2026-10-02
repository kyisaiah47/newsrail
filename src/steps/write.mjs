// Step 3, write: one model call for the whole batch, then the code gate on every draft.
//
// The model returns a post/skip decision per item. Its yes is a suggestion: each draft is
// re-checked by codeGate() and refused with a logged reason when any check fails. Only a draft
// that passes is reserved in the claims ledger and returned for the queue.

import { wirePrompt } from '../prompt.mjs';
import { codeGate } from '../gates/code-gate.mjs';
import { copyRules } from '../gates/copy-gates.mjs';

const SYSTEM = 'You are the writer for a news wire. You return only the JSON the instructions ask for.';

/** Pull the JSON array out of a model answer, tolerating a code fence or stray text around it. */
export function parseDrafts(raw) {
  const s = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('the model returned no JSON array');
  const out = JSON.parse(s.slice(a, b + 1));
  if (!Array.isArray(out)) throw new Error('the model returned JSON that is not an array');
  return out;
}

export async function write(batch, config, { provider, claims, covered = [], recentTexts = [], log = () => {}, now = Date.now() } = {}) {
  if (!batch.length) return [];
  const rules = config.platformRules;
  const limits = Object.values(rules).map((r) => r.maxChars).filter(Boolean);
  const maxChars = limits.length ? Math.min(...limits) : null;
  const targets = Object.values(rules).map((r) => r.targetChars).filter(Boolean);
  const targetChars = targets.length ? Math.min(...targets) : null;
  const tagged = Object.values(rules).some((r) => r.tags === 'one');
  const tagLen = tagged ? 24 : 0;

  const items = batch.map((b, i) => ({
    id: i + 1, source: b.source, author: b.author || undefined, age: b.ageH != null ? `${b.ageH}h` : undefined,
    metrics: b.metrics || undefined, title: b.title, body: String(b.text || '').slice(0, 500) || undefined,
  }));
  const args = {
    name: config.card?.publication || config.name || config.slug, beat: config.beat, voice: config.voice, items, covered,
    maxChars: maxChars ? maxChars - tagLen : null, targetChars, tagged, ownNames: config.ownNames,
    extra: typeof config.prompt === 'string' ? config.prompt : '', copyRules: copyRules(config.copyGates),
  };
  const prompt = typeof config.prompt === 'function' ? config.prompt(args) : wirePrompt(args);

  const raw = await provider.complete({ system: SYSTEM, prompt, purpose: config.purpose, items, rules });
  let answers;
  try { answers = parseDrafts(raw); }
  catch (e) { log(`write: could not read the model answer (${e.message})`); return []; }

  const drafts = [];
  const seenTitles = [...covered];
  for (const r of answers) {
    const item = batch[Number(r.id) - 1];
    if (!item) continue;
    if (!r.post) { log(`  ${r.id} model skipped: ${String(r.why || '').slice(0, 90)}`); continue; }
    const d = { text: String(r.text || '').replace(/\s+/g, ' ').trim(), tag: r.tag ? String(r.tag).replace(/^#/, '').trim() : null };
    const why = codeGate(d, item, {
      rules, covered: seenTitles, ownNames: config.ownNames, offSubject: config.offSubject,
      copyGates: config.copyGates, gates: config.gate, recentTexts,
    });
    if (why) { log(`  ${r.id} REFUSED by the code gate (${why}): ${d.text.slice(0, 80)}`); continue; }
    if (!claims.reserve(item, config.slug)) { log(`  ${r.id} lost the claim race`); continue; }
    seenTitles.push(item.title);
    drafts.push({
      key: item.key,
      item,
      text: d.text,
      tag: d.tag,
      why: String(r.why || ''),
      platforms: [...config.platforms],
      postedOn: [],
      draftedAt: new Date(now).toISOString(),
      expiresAt: new Date((item.publishedAt ? Date.parse(item.publishedAt) : now) + config.filters.maxAgeH * 3.6e6).toISOString(),
    });
    log(`  ${r.id} QUEUED: ${d.text.slice(0, 90)}`);
  }
  log(`write: ${batch.length} sent, ${drafts.length} passed the code gate`);
  return drafts;
}
