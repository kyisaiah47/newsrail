// One card renderer, two modes. Rewritten from the software and news card modes the Compound
// Labs wires run.
//
//   software  a landscape card (1200 x 630) for developer and technology wires: a dark plate on a
//             48 px grid, a small tracked kicker with the wire's one accent mark, a heavy headline,
//             an optional object image on the right, the publication and source along the bottom.
//   news      a portrait card (1080 x 1350) for wider news: a photograph filling the frame, a
//             heavy bottom scrim, a filled kicker pill in the accent, a large headline, and a
//             wordmark bar with the source and the photo credit.
//
// The card is built as SVG. When @resvg/resvg-js is installed (an optional dependency) it is also
// rasterised to PNG, which is what every platform upload needs. Without it a card is SVG only,
// which is enough for a dry run and for a site.
//
// One accent per card, spent once. Figures are never set as the dominant type: the headline is a
// sentence, and numbers stay inside it at headline size.

import fs from 'node:fs';
import path from 'node:path';

const SANS = "Inter, 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";
const MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";

export const SIZES = { software: { w: 1200, h: 630 }, news: { w: 1080, h: 1350 } };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Width of a string in em, close enough to wrap text without a font engine.
function emWidth(s, { bold = true, mono = false } = {}) {
  if (mono) return [...s].length * 0.6;
  let w = 0;
  for (const ch of s) {
    if (/[ilj.,:;'!|]/.test(ch)) w += 0.28;
    else if (ch === ' ') w += 0.28;
    else if (/[mwMW@]/.test(ch)) w += 0.86;
    else if (/[A-Z0-9]/.test(ch)) w += 0.66;
    else w += 0.54;
  }
  return bold ? w * 1.04 : w;
}

/** Break text into lines that fit `maxPx` at `size`. Returns null when it needs more than `maxLines`. */
export function wrap(text, size, maxPx, maxLines, opts = {}) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (emWidth(next, opts) * size <= maxPx || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.some((l) => emWidth(l, opts) * size > maxPx * 1.02)) return null;
  return lines.length <= maxLines ? lines : null;
}

/** The largest size between `max` and `min` at which the text fits. Truncates with an ellipsis at `min`. */
export function fitText(text, { max, min, maxPx, maxLines, ...opts }) {
  for (let size = max; size >= min; size -= 2) {
    const lines = wrap(text, size, maxPx, maxLines, opts);
    if (lines) return { size, lines };
  }
  const words = String(text || '').split(/\s+/);
  for (let n = words.length - 1; n > 0; n--) {
    const lines = wrap(`${words.slice(0, n).join(' ')}...`, min, maxPx, maxLines, opts);
    if (lines) return { size: min, lines };
  }
  return { size: min, lines: [String(text || '').slice(0, 40)] };
}

const tspans = (lines, x, y0, lh) => lines.map((l, i) => `<tspan x="${x}" y="${Math.round(y0 + i * lh)}">${esc(l)}</tspan>`).join('');

function mimeOf(file) {
  const ext = path.extname(String(file)).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[ext] || 'image/png';
}

/** An image reference as a data URI. Accepts a local path, a data URI, an http(s) URL or a Buffer. */
export async function toDataUri(src, { fetch: f = globalThis.fetch } = {}) {
  if (!src) return null;
  if (Buffer.isBuffer(src)) return `data:image/png;base64,${src.toString('base64')}`;
  const s = String(src);
  if (s.startsWith('data:')) return s;
  if (/^https?:\/\//i.test(s)) {
    const r = await f(s, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`image ${r.status} ${s}`);
    const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  }
  return `data:${mimeOf(s)};base64,${fs.readFileSync(s).toString('base64')}`;
}

function softwareSvg({ headline, kicker, publication, source, credit, accent, object }) {
  const { w, h } = SIZES.software;
  const pad = 64;
  const textW = object ? 640 : w - pad * 2;
  const head = fitText(headline, { max: 64, min: 36, maxPx: textW, maxLines: 4 });
  const lh = Math.round(head.size * 1.1);
  const headTop = 168;
  const grid = [];
  for (let x = 48; x < w; x += 48) grid.push(`M${x} 0V${h}`);
  for (let y = 48; y < h; y += 48) grid.push(`M0 ${y}H${w}`);
  const obj = object ? `<image href="${object}" x="${w - pad - 380}" y="${Math.round((h - 380) / 2)}" width="380" height="380" preserveAspectRatio="xMidYMid meet"/>` : '';
  const footLeft = [publication, source ? `Source: ${source}` : ''].filter(Boolean).join('  /  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#1a1a1a"/>
<path d="${grid.join('')}" stroke="#2c2c2c" stroke-width="1"/>
${obj}
<rect x="${pad}" y="${pad + 4}" width="24" height="14" fill="${esc(accent)}"/>
<text x="${pad + 36}" y="${pad + 17}" font-family="${MONO}" font-size="18" font-weight="500" letter-spacing="2" fill="#d6d6d6">${esc(String(kicker || 'WIRE').toUpperCase())}</text>
<text font-family="${SANS}" font-size="${head.size}" font-weight="700" letter-spacing="-1" fill="#ffffff">${tspans(head.lines, pad, headTop + head.size, lh)}</text>
<text x="${pad}" y="${h - pad}" font-family="${MONO}" font-size="17" fill="#9a9a9a">${esc(footLeft.toUpperCase())}</text>
<text x="${w - pad}" y="${h - pad}" text-anchor="end" font-family="${MONO}" font-size="17" fill="#9a9a9a">${esc(credit || '')}</text>
</svg>`;
}

function newsSvg({ headline, kicker, publication, source, credit, photoCredit, accent, accentInk, photo }) {
  const { w, h } = SIZES.news;
  const pad = 72;
  const head = fitText(headline, { max: 84, min: 48, maxPx: w - pad * 2, maxLines: 5 });
  const lh = Math.round(head.size * 1.08);
  const barH = 110;
  const headBottom = h - barH - 56;
  const headTop = headBottom - (head.lines.length - 1) * lh;
  const kick = String(kicker || 'NEWS').toUpperCase();
  const pillW = Math.round(emWidth(kick, { mono: false, bold: true }) * 26 + 44);
  const pillY = headTop - head.size - 70;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#060607" stop-opacity="0"/><stop offset="0.38" stop-color="#060607" stop-opacity="0.15"/>
<stop offset="0.62" stop-color="#060607" stop-opacity="0.82"/><stop offset="1" stop-color="#060607" stop-opacity="0.97"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="#101114"/>
${photo ? `<image href="${photo}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>` : ''}
<rect width="${w}" height="${h}" fill="url(#scrim)"/>
<rect x="${pad}" y="${pillY}" width="${pillW}" height="50" rx="25" fill="${esc(accent)}"/>
<text x="${pad + 22}" y="${pillY + 34}" font-family="${SANS}" font-size="26" font-weight="800" letter-spacing="1.5" fill="${esc(accentInk)}">${esc(kick)}</text>
<text font-family="${SANS}" font-size="${head.size}" font-weight="800" letter-spacing="-1.5" fill="#ffffff">${tspans(head.lines, pad, headTop, lh)}</text>
<rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="#060607"/>
<rect x="0" y="${h - barH}" width="${w}" height="2" fill="${esc(accent)}"/>
<text x="${pad}" y="${h - barH / 2 + 10}" font-family="${SANS}" font-size="30" font-weight="800" letter-spacing="2" fill="#ffffff">${esc(String(publication || '').toUpperCase())}</text>
<text x="${w - pad}" y="${h - barH / 2 - 4}" text-anchor="end" font-family="${MONO}" font-size="20" fill="#dedbd6">${esc(source ? `SOURCE: ${String(source).toUpperCase()}` : '')}</text>
<text x="${w - pad}" y="${h - barH / 2 + 24}" text-anchor="end" font-family="${MONO}" font-size="17" fill="#a8a5a0">${esc([photoCredit ? `PHOTO: ${photoCredit}` : '', credit || ''].filter(Boolean).join('  /  '))}</text>
</svg>`;
}

let resvg;
async function loadResvg() {
  if (resvg !== undefined) return resvg;
  try { resvg = (await import('@resvg/resvg-js')).Resvg; } catch { resvg = null; }
  return resvg;
}

/** True when PNG output is available in this install. */
export async function canRenderPng() { return Boolean(await loadResvg()); }

/**
 * Render one card.
 *
 * @param {object} o
 * @param {'software'|'news'} o.mode
 * @param {string} o.headline     the sentence set on the card
 * @param {string} [o.kicker]     small label above the headline
 * @param {string} o.publication  the wire's name
 * @param {string} [o.source]     who issued the story
 * @param {string} [o.credit]     the wire's site, bottom right
 * @param {string} [o.accent]     the one accent colour
 * @param {string} [o.accentInk]  ink on the accent pill (news mode)
 * @param {string} [o.object]     software mode: an object image (path, URL or data URI)
 * @param {string} [o.photo]      news mode: the photograph (path, URL or data URI). Required.
 * @param {string} [o.photoCredit]
 * @returns {Promise<{svg:string, png:Buffer|null, width:number, height:number}>}
 */
export async function renderCard(o) {
  const mode = o.mode || 'software';
  if (!SIZES[mode]) throw new Error(`renderCard: unknown mode "${mode}"`);
  const accent = o.accent || (mode === 'news' ? '#4ade80' : '#5c74ff');
  let svg;
  if (mode === 'news') {
    const photo = await toDataUri(o.photo, o);
    if (!photo) throw new Error('renderCard: news mode needs a photo');
    svg = newsSvg({ ...o, accent, accentInk: o.accentInk || '#08140c', photo });
  } else {
    svg = softwareSvg({ ...o, accent, object: o.object ? await toDataUri(o.object, o) : null });
  }
  const R = await loadResvg();
  let png = null;
  if (R) {
    png = new R(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' } }).render().asPng();
  }
  return { svg, png, ...SIZES[mode] };
}

/** Render a card and write it to `<dir>/<name>.png` (or .svg when PNG output is not installed). */
export async function renderCardToFile(o, dir, name) {
  const card = await renderCard(o);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.${card.png ? 'png' : 'svg'}`);
  fs.writeFileSync(file, card.png || card.svg);
  return { path: file, mime: card.png ? 'image/png' : 'image/svg+xml', width: card.width, height: card.height };
}
