// One provider interface over every model a wire can use.
//
//   const model = createProvider({ type: 'gemini', model: 'gemini-2.5-flash' });
//   const text = await model.complete({ system, prompt, purpose: 'compose' });
//
// Types:
//   openai             OpenAI's chat completions API. Needs `model`. Key: apiKey or OPENAI_API_KEY.
//   anthropic          Anthropic's messages API. Needs `model`. Key: apiKey or ANTHROPIC_API_KEY.
//   gemini             Google's Gemini API. Default model gemini-2.5-flash. Key: apiKey or GEMINI_API_KEY.
//   openai-compatible  Any server that speaks the chat completions shape, including a local model.
//                      Needs `baseURL` and `model`. The key is optional.
//   command            Any command-line model runner. The prompt goes to stdin, stdout is the answer.
//   stub               No model at all. It writes from the item fields, for tests and dry runs.
//
// `models` maps a wire's `purpose` to a model name, so one provider can serve several seats:
//   createProvider({ type: 'openai-compatible', baseURL, model: 'default-model', models: { compose: 'big-model' } })
//
// A key is read from the environment only when complete() runs and no apiKey was passed, so
// creating a provider never reads a key.

import { spawn } from 'node:child_process';

const OPENAI_BASE = 'https://api.openai.com/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class ProviderError extends Error {
  constructor(provider, status, body) {
    super(`${provider} answered ${status}: ${String(body || '').slice(0, 300)}`);
    this.name = 'ProviderError';
    this.status = status;
  }
}

async function postJson(f, url, headers, body, provider, timeoutMs) {
  const r = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) throw new ProviderError(provider, r.status, text);
  try { return JSON.parse(text); } catch { throw new ProviderError(provider, r.status, `not JSON: ${text.slice(0, 120)}`); }
}

const need = (v, what) => { if (!v) throw new Error(`provider: ${what} is required`); return v; };

export function createProvider(opts = {}) {
  const { type, models = {}, temperature = 0.4, maxTokens = 4096, timeoutMs = 120000 } = opts;
  const f = opts.fetch || globalThis.fetch;
  const modelFor = (purpose) => models[purpose] || opts.model;

  switch (type) {
    case 'openai':
    case 'openai-compatible': {
      const base = (opts.baseURL || (type === 'openai' ? OPENAI_BASE : '')).replace(/\/$/, '');
      if (type === 'openai-compatible') need(opts.baseURL, '`baseURL` for openai-compatible');
      need(opts.model, `\`model\` for ${type}`);
      return {
        name: type,
        async complete({ system = '', prompt, purpose = 'compose' }) {
          const key = opts.apiKey ?? (type === 'openai' ? process.env.OPENAI_API_KEY : '');
          if (type === 'openai') need(key, 'an API key (apiKey or OPENAI_API_KEY)');
          const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
          const j = await postJson(f, `${base}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {},
            { model: modelFor(purpose), messages, temperature, max_tokens: maxTokens }, type, timeoutMs);
          return String(j.choices?.[0]?.message?.content ?? '');
        },
      };
    }
    case 'anthropic': {
      const base = (opts.baseURL || ANTHROPIC_BASE).replace(/\/$/, '');
      need(opts.model, '`model` for anthropic');
      return {
        name: type,
        async complete({ system = '', prompt, purpose = 'compose' }) {
          const key = need(opts.apiKey ?? process.env.ANTHROPIC_API_KEY, 'an API key (apiKey or ANTHROPIC_API_KEY)');
          const j = await postJson(f, `${base}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            { model: modelFor(purpose), max_tokens: maxTokens, temperature, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] },
            type, timeoutMs);
          return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        },
      };
    }
    case 'gemini': {
      const base = (opts.baseURL || GEMINI_BASE).replace(/\/$/, '');
      return {
        name: type,
        async complete({ system = '', prompt, purpose = 'compose' }) {
          const key = need(opts.apiKey ?? process.env.GEMINI_API_KEY, 'an API key (apiKey or GEMINI_API_KEY)');
          const model = modelFor(purpose) || 'gemini-2.5-flash';
          const j = await postJson(f, `${base}/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens: maxTokens },
          }, type, timeoutMs);
          return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
        },
      };
    }
    case 'command': {
      need(opts.command, '`command` for the command provider');
      const args = opts.args || [];
      return {
        name: type,
        complete({ system = '', prompt, purpose = 'compose' }) {
          return new Promise((resolve, reject) => {
            const child = spawn(opts.command, args.map((a) => a.replace('{model}', modelFor(purpose) || '').replace('{purpose}', purpose)), {
              stdio: ['pipe', 'pipe', 'pipe'],
              env: { ...process.env, ...(opts.env || {}), NEWSRAIL_PURPOSE: purpose },
            });
            let out = '';
            let err = '';
            const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`command provider timed out after ${timeoutMs} ms`)); }, timeoutMs);
            child.stdout.on('data', (b) => { out += b; });
            child.stderr.on('data', (b) => { err += b; });
            child.on('error', (e) => { clearTimeout(timer); reject(e); });
            child.on('close', (code) => {
              clearTimeout(timer);
              if (code === 0) resolve(out.trim());
              else reject(new Error(`command provider exited ${code}: ${err.slice(0, 300)}`));
            });
            child.stdin.end(system ? `${system}\n\n${prompt}` : prompt);
          });
        },
      };
    }
    case 'stub':
      return stubProvider(opts);
    default:
      throw new Error(`provider: unknown type "${type}". Use openai, anthropic, gemini, openai-compatible, command or stub.`);
  }
}

/**
 * A provider that calls no model. By default it writes each item's title as a one-sentence post,
 * trimmed to the target length, and picks a topic tag from the item's source. Pass `respond` to
 * control the answer exactly: respond({ items, rules, prompt }) returns the array or the raw string.
 */
export function stubProvider({ respond = null } = {}) {
  return {
    name: 'stub',
    async complete({ prompt, items = [], rules = {} }) {
      if (respond) {
        const r = await respond({ items, rules, prompt });
        return typeof r === 'string' ? r : JSON.stringify(r);
      }
      const max = Math.min(...Object.values(rules).map((r) => r.maxChars || Infinity));
      const target = Math.min(...Object.values(rules).map((r) => r.targetChars || 220), Number.isFinite(max) ? max - 30 : 220);
      return JSON.stringify(items.map((it) => {
        let text = String(it.title || '').replace(/https?:\/\/\S+/g, '').replace(/#/g, '').replace(/\s+/g, ' ').trim();
        text = text.replace(/[.:;,\s]+$/, '');
        if (text.length > target) text = `${text.slice(0, target - 1).replace(/\s+\S*$/, '')}`;
        const tag = String(it.source || 'news').replace(/[^A-Za-z0-9]/g, '') || 'news';
        return { id: it.id, post: Boolean(text), why: 'stub writer', text: text ? `${text}.` : '', tag };
      }));
    },
  };
}
