// Threads through the official Threads API (graph.threads.net). No browser.
//
//   threads({ accessToken, hostImage, expectedHandle })
//
// `accessToken` falls back to THREADS_ACCESS_TOKEN. It needs the threads_basic and
// threads_content_publish permissions.
//
// Threads fetches images from a public URL, so a card needs `hostImage(file, { mime })`, a function
// that uploads the file and returns its public https URL. The Supabase store exports one
// (supabaseImageHost). Without hostImage a card cannot be attached and the tick stays owed.
//
// Posting is two calls: create a container, then publish it. verify() reads the published post
// back and checks its text.

import { SlotStillOwed, PlatformSignal, platformError } from '../signals.mjs';

export function threads(opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  const api = (opts.api || 'https://graph.threads.net/v1.0').replace(/\/$/, '');
  const userId = opts.userId || 'me';
  const pollMs = opts.pollMs ?? 3000;
  const pollTries = opts.pollTries ?? 20;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let checked = false;

  const token = () => {
    const t = opts.accessToken ?? process.env.THREADS_ACCESS_TOKEN;
    if (!t) throw new PlatformSignal('no Threads credentials', 'set accessToken or THREADS_ACCESS_TOKEN', { platform: 'threads' });
    return t;
  };

  async function call(method, path, params = {}) {
    const p = new URLSearchParams({ ...params, access_token: token() });
    const url = method === 'GET' ? `${api}${path}?${p}` : `${api}${path}`;
    const r = await f(url, {
      method,
      headers: method === 'GET' ? {} : { 'content-type': 'application/x-www-form-urlencoded' },
      body: method === 'GET' ? undefined : p.toString(),
      signal: AbortSignal.timeout(60000),
    });
    const text = await r.text();
    if (!r.ok) throw platformError('threads', r.status, text);
    return text ? JSON.parse(text) : {};
  }

  async function checkIdentity() {
    if (checked || !opts.expectedHandle) return;
    const me = await call('GET', '/me', { fields: 'id,username' });
    const want = String(opts.expectedHandle).replace(/^@/, '').toLowerCase();
    if (String(me.username || '').toLowerCase() !== want) {
      throw new PlatformSignal('identity mismatch', `signed in as @${me.username}, expected @${want}`, { platform: 'threads' });
    }
    checked = true;
  }

  async function publish(params) {
    const container = await call('POST', `/${userId}/threads`, params);
    for (let i = 0; i < pollTries; i++) {
      const st = await call('GET', `/${container.id}`, { fields: 'status,error_message' });
      if (st.status === 'FINISHED') break;
      if (st.status === 'ERROR' || st.status === 'EXPIRED') throw new SlotStillOwed(`Threads container ${st.status}: ${st.error_message || ''}`);
      await sleep(pollMs);
    }
    const pub = await call('POST', `/${userId}/threads_publish`, { creation_id: container.id });
    const got = await call('GET', `/${pub.id}`, { fields: 'id,permalink,text' });
    return { id: pub.id, url: got.permalink || null, text: params.text };
  }

  return {
    platform: 'threads',

    async post({ text, card = null }) {
      await checkIdentity();
      if (card && card.path) {
        if (typeof opts.hostImage !== 'function') throw new SlotStillOwed('Threads needs hostImage(file) to attach a card');
        const imageUrl = await opts.hostImage(card.path, { mime: card.mime });
        if (!/^https:\/\//.test(String(imageUrl || ''))) throw new SlotStillOwed('hostImage returned no public https URL');
        return publish({ media_type: 'IMAGE', image_url: imageUrl, text });
      }
      return publish({ media_type: 'TEXT', text });
    },

    async reply(parent, { text }) {
      return publish({ media_type: 'TEXT', text, reply_to_id: parent.id });
    },

    async verify(result) {
      if (!result?.id) return false;
      const got = await call('GET', `/${result.id}`, { fields: 'id,permalink,text' });
      return got.id === result.id && String(got.text || '').trim() === String(result.text || '').trim();
    },
  };
}
