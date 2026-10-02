// The code gate. The model's post:true is a suggestion; this decides.
//
// Every check here is deterministic and reads only the draft, the item it was written from and
// the wire's recent posts. A draft that fails any check is refused with a reason, and the reason
// goes to the log. Editorial rules live here, in code, not in the prompt.

import { copyGateIssue } from './copy-gates.mjs';

const toks = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []);

/** Crude token overlap: two titles about the same story share half their long words. */
export function similar(a, b) {
  const A = toks(a);
  const B = toks(b);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size) >= 0.5;
}

// Things that arrive dressed as news and are not news for a wire like this. A wire can replace or
// extend the list with `offSubject`.
export const OFF_SUBJECT = [
  [/\bLPA\b|\blakhs?\b|\bCTC\b|\btotal comp(ensation)?\b|\bbase salary\b|\bRSUs?\b|\bsigning bonus\b/i, 'compensation'],
  [/\b(offer letter|job offer|got an offer|new grad|interview loop|job (search|hunt)|salary negotiation)\b/i, 'career-anecdote'],
  [/\b(flash ?loan|scalper bot|trading bot|sniper bot|arbitrage bot|memecoin|meme coin|airdrop farm)/i, 'crypto-bait'],
];

const FIRST_PERSON_WORK = /\b(?:I|we)\s+(?:built|shipped|made|launched|wrote|rebuilt|delivered|fixed|debugged|tested|benchmarked|implemented|tried)\b/i;
const REASONING_LEAK = /<\/?post>|\b(let me|i'?ll (write|pick|use|draft)|drafting\b|candidate lines?|picking the strongest)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const ANCHOR_STOP = new Set('about after again against been being could from have into just more most over same some than that their them then there these they this those through under very what when where which while will with would your says said today release released version update updates'.split(' '));

/** The lead sentence must name something from the source: its author, project or title words. */
export function anchorIssue(text, item) {
  const anchors = [...toks(`${item.author || ''} ${item.title || ''}`)].filter((t) => !ANCHOR_STOP.has(t)).slice(0, 16);
  if (!anchors.length) return null;
  const lead = toks(String(text || '').slice(0, 140));
  return anchors.some((t) => lead.has(t)) ? null : `missing source entity in the lead (${anchors.slice(0, 4).join('|')})`;
}

/** Every figure in the post must appear in the item. Use for wires whose numbers must be exact. */
export function verbatimIssue(text, item) {
  const hay = `${item.title || ''} ${item.text || ''} ${item.metrics || ''} ${JSON.stringify(item.extra || {})}`;
  for (const n of String(text).match(/\d[\d,.]*\d|\d/g) || []) {
    const plain = n.replace(/,/g, '');
    if (!hay.includes(n) && !hay.replace(/,/g, '').includes(plain)) return `figure not in the source: ${n}`;
  }
  return null;
}

const length = (s) => [...String(s || '')].length;

/**
 * Check one draft. Returns null when it passes, or a reason string.
 *
 * @param {object} d            { text, tag }
 * @param {object} item         the item the draft was written from
 * @param {object} ctx
 * @param {object} ctx.rules    platform rules for every platform the draft must fit
 * @param {string[]} ctx.covered titles this wire already covered recently
 * @param {string[]} ctx.ownNames names the wire must not mention
 * @param {Array} ctx.offSubject [regex, label] pairs
 * @param {string[]} ctx.copyGates 'noise' and/or 'prose'
 * @param {Array} ctx.gates     'default', 'verbatim' or functions (text, item, ctx) => reason | null
 */
export function codeGate(d, item, ctx = {}) {
  const text = String(d.text || '').trim();
  const gates = [].concat(ctx.gates ?? 'default');
  if (!text) return 'empty';

  if (gates.includes('default')) {
    for (const [p, r] of Object.entries(ctx.rules || {})) {
      const tag = r.tags === 'one' ? ` #${d.tag || ''}` : '';
      if (r.maxChars && length(text) + length(tag) > r.maxChars) return `too long for ${p} (${length(text) + length(tag)} > ${r.maxChars})`;
      if (r.tags === 'one' && !/^[A-Za-z][A-Za-z0-9]{1,29}$/.test(String(d.tag || ''))) return `${p} needs one topic tag and the draft has "${d.tag || ''}"`;
    }
    if (/https?:\/\/|\bwww\./i.test(text)) return 'link in the body';
    if (/(^|\s)#[A-Za-z]/.test(text)) return 'hashtag in the body';
    if (EMOJI.test(text)) return 'emoji';
    if (REASONING_LEAK.test(text)) return 'reasoning leaked into the post';
    if ((ctx.covered || []).some((t) => similar(t, item.title))) return 'already covered';
    if (FIRST_PERSON_WORK.test(text)) return `first-person work claim ("${text.match(FIRST_PERSON_WORK)[0]}")`;
    const own = (ctx.ownNames || []).find((n) => new RegExp(`\\b${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    if (own) return `names ${own}`;
    const hay = `${text}\n${item.title || ''}\n${String(item.text || '').slice(0, 400)}`;
    const off = (ctx.offSubject || OFF_SUBJECT).find(([re]) => re.test(hay));
    if (off) return `off-subject:${off[1]}`;
    const anchor = anchorIssue(text, item);
    if (anchor) return anchor;
  }
  if (gates.includes('verbatim')) {
    const v = verbatimIssue(text, item);
    if (v) return v;
  }
  const copy = copyGateIssue(text, ctx.copyGates || []);
  if (copy) return copy;
  for (const g of gates) {
    if (typeof g !== 'function') continue;
    const r = g(text, item, ctx);
    if (r) return String(r);
  }
  return null;
}
