// Provider tests. Every call goes to a fake fetch on a local base URL, with an explicit test key.
// No test reads a key from the environment and no test reaches a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, stubProvider } from '../src/index.mjs';
import { fakeFetch } from './helpers.mjs';

test('openai-compatible sends the chat completions shape to the base URL and maps purpose to model', async () => {
  const calls = [];
  const f = fakeFetch({ 'POST http://localhost:11434/v1/chat/completions': () => ({ body: { choices: [{ message: { content: '[]' } }] } }) }, calls);
  const p = createProvider({ type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'small', models: { compose: 'big' }, fetch: f });
  assert.equal(await p.complete({ system: 'sys', prompt: 'hi', purpose: 'compose' }), '[]');
  const body = JSON.parse(calls[0].body);
  assert.equal(body.model, 'big');
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(calls[0].headers.authorization, undefined, 'no key, no header');
});

test('openai uses a bearer key and needs a model', async () => {
  const calls = [];
  const f = fakeFetch({ 'POST http://openai.test/v1/chat/completions': () => ({ body: { choices: [{ message: { content: 'ok' } }] } }) }, calls);
  const p = createProvider({ type: 'openai', baseURL: 'http://openai.test/v1', model: 'm', apiKey: 'test-key', fetch: f });
  assert.equal(await p.complete({ prompt: 'hi' }), 'ok');
  assert.equal(calls[0].headers.authorization, 'Bearer test-key');
  assert.throws(() => createProvider({ type: 'openai' }), /model/);
});

test('anthropic sends the messages shape with the version header', async () => {
  const calls = [];
  const f = fakeFetch({ 'POST http://anthropic.test/v1/messages': () => ({ body: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }) }, calls);
  const p = createProvider({ type: 'anthropic', baseURL: 'http://anthropic.test', model: 'm', apiKey: 'test-key', fetch: f });
  assert.equal(await p.complete({ system: 's', prompt: 'hi' }), 'ab');
  assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(JSON.parse(calls[0].body).system, 's');
});

test('gemini sends generateContent with the key in a header', async () => {
  const calls = [];
  const f = fakeFetch({ 'POST http://gemini.test/v1beta/models/gemini-2.5-flash:generateContent': () => ({ body: { candidates: [{ content: { parts: [{ text: 'g' }] } }] } }) }, calls);
  const p = createProvider({ type: 'gemini', baseURL: 'http://gemini.test/v1beta', apiKey: 'test-key', fetch: f });
  assert.equal(await p.complete({ system: 's', prompt: 'hi' }), 'g');
  assert.equal(calls[0].headers['x-goog-api-key'], 'test-key');
});

test('a provider error carries the status', async () => {
  const f = fakeFetch({ 'POST http://local.test/v1/chat/completions': () => ({ status: 500, body: 'boom' }) });
  const p = createProvider({ type: 'openai-compatible', baseURL: 'http://local.test/v1', model: 'm', fetch: f });
  await assert.rejects(p.complete({ prompt: 'x' }), (e) => e.status === 500);
});

test('the command provider pipes the prompt through a local program', async () => {
  const p = createProvider({ type: 'command', command: process.execPath, args: ['-e', 'process.stdin.on("data", (d) => process.stdout.write(String(d).toUpperCase()))'] });
  assert.equal(await p.complete({ prompt: 'shout' }), 'SHOUT');
});

test('the stub writes one draft per item inside the length rules', async () => {
  const out = JSON.parse(await stubProvider().complete({ items: [{ id: 1, title: 'A'.repeat(400), source: 'feed' }], rules: { bluesky: { maxChars: 300, targetChars: 200 } } }));
  assert.equal(out[0].post, true);
  assert.ok(out[0].text.length <= 201);
  assert.equal(out[0].tag, 'feed');
});
