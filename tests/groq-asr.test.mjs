import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeGroqAudio } from '../lib/groq-asr.js';

const base = { blob: new Blob(['audio'], { type: 'audio/wav' }), apiKey: ' groq-test-key ' };
const json = text => new Response(JSON.stringify({ text }));

test('sends source audio as multipart to fixed Groq transcription endpoint with optional language', async () => {
  for (const language of ['', 'en']) {
    const result = await transcribeGroqAudio({ ...base, language }, async (url, request) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
      assert.equal(request.method, 'POST');
      assert.deepEqual(request.headers, { Authorization: 'Bearer groq-test-key' });
      assert.ok(request.body instanceof FormData);
      assert.equal(request.body.get('file').name, 'audio.wav');
      assert.equal(await request.body.get('file').text(), 'audio');
      assert.equal(request.body.get('model'), 'whisper-large-v3-turbo');
      assert.equal(request.body.get('response_format'), 'json');
      assert.equal(request.body.get('language'), language || null);
      assert.ok(request.signal instanceof AbortSignal);
      return json('  Root canal 3.5 mm.  ');
    });
    assert.equal(result, 'Root canal 3.5 mm.');
  }
});

test('preserves no-speech result and recognizes WebM codec MIME', async () => {
  assert.equal(await transcribeGroqAudio({ ...base, blob: new Blob(['audio'], { type: 'audio/webm;codecs=opus' }) }, async (_, { body }) => {
    assert.equal(body.get('file').name, 'audio.webm');
    return json('');
  }), '');
});

test('invalid key, audio and language fail before network access', async () => {
  let called = false;
  for (const invalid of [
    { apiKey: '' }, { apiKey: 123 }, { blob: null }, { blob: new Blob([]) },
    { blob: new Blob(['bad'], { type: 'text/plain' }) }, { language: 'english' },
    { blob: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'audio/wav' }) },
    { timeoutMs: 0 }
  ]) {
    await assert.rejects(transcribeGroqAudio({ ...base, ...invalid }, async () => { called = true; }));
  }
  assert.equal(called, false);
});

test('HTTP errors expose status but never provider body or API key; no automatic retries', async () => {
  for (const status of [400, 401, 403, 413, 429, 500]) {
    let calls = 0;
    await assert.rejects(transcribeGroqAudio(base, async () => {
      calls++;
      return new Response('secret echoed groq-test-key', { status });
    }), error => {
      assert.equal(error.status, status);
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /secret|groq-test-key/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('invalid success responses and network errors use safe messages', async () => {
  for (const body of ['bad secret', '{}', '{"text":123}', '{"text":"","error":"secret"}',
    JSON.stringify({ text: 'x'.repeat(6001) }), 'x'.repeat(64001)]) {
    await assert.rejects(transcribeGroqAudio(base, async () => new Response(body)), error => {
      assert.doesNotMatch(error.message, /secret|groq-test-key/);
      return true;
    });
  }
  await assert.rejects(transcribeGroqAudio(base, async () => { throw new Error('groq-test-key'); }), /Không kết nối được Groq/);
});

test('pre-abort, in-flight timeout and cancellation during body read prevent results', async () => {
  const before = new AbortController();
  before.abort();
  let called = false;
  await assert.rejects(transcribeGroqAudio({ ...base, signal: before.signal }, async () => { called = true; }), { name: 'AbortError' });
  assert.equal(called, false);
  await assert.rejects(transcribeGroqAudio({ ...base, timeoutMs: 5 }, async (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })), { name: 'TimeoutError' });
  const controller = new AbortController();
  await assert.rejects(transcribeGroqAudio({ ...base, signal: controller.signal }, async () => ({
    ok: true, async text() { controller.abort(); return '{"text":"stale"}'; }
  })), { name: 'AbortError' });
});
