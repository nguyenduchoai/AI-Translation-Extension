import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderRequest, resolveProviderSettings, streamTranslation, testProviderConnection } from '../lib/ai-provider.js';

const base = { apiKey: 'test-key', imageBase64: 'aGVsbG8=', targetLang: 'vi' };
const gemini = { ...base, provider: 'gemini' };
const event = data => `data: ${JSON.stringify(data)}\r\n\r\n`;
const candidate = (text, finishReason) => ({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });
function responseStream(text, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } }));
}

test('legacy OpenAI configuration survives and provider keys never cross', () => {
  assert.deepEqual(resolveProviderSettings({ apiKey: 'old', model: 'gpt-4o-mini' }), { provider: 'openai', apiKey: 'old', model: 'gpt-4o-mini' });
  assert.equal(resolveProviderSettings({ provider: 'gemini', apiKey: 'old' }).apiKey, '');
  assert.equal(resolveProviderSettings({ provider: 'gemini', geminiApiKey: 'g' }).model, 'gemini-3.8-flash');
  assert.throws(() => resolveProviderSettings({ provider: 'unexpected' }), /không được hỗ trợ/);
});

test('Gemini request carries PNG and system instruction and key only in header', () => {
  const result = buildProviderRequest({ ...gemini, prompts: { system: 'system', user: 'translate' } });
  const body = JSON.parse(result.options.body);
  assert.match(result.url, /models\/gemini-3.8-flash:streamGenerateContent\?alt=sse$/);
  assert.equal(result.url.includes('test-key'), false);
  assert.equal(result.options.headers['x-goog-api-key'], 'test-key');
  assert.equal(result.options.headers.Authorization, undefined);
  assert.equal(body.system_instruction.parts[0].text, 'system');
  assert.deepEqual(body.contents[0].parts[1].inline_data, { mime_type: 'image/png', data: 'aGVsbG8=' });
  assert.throws(() => buildProviderRequest({ ...gemini, model: '../evil', prompts: {} }), /model Gemini/);
});

test('Gemini stream preserves Vietnamese at every byte split and latest usage', async () => {
  const chunks = [];
  const source = event(candidate('Răng 11: ')) + event({ ...candidate('không đau 🦷', 'STOP'), modelVersion: 'gemini-version', usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, thoughtsTokenCount: 2, totalTokenCount: 27 } });
  const result = await streamTranslation({ ...gemini, onChunk: (chunk, full) => chunks.push([chunk, full]) }, async () => responseStream(source));
  assert.equal(result.text, 'Răng 11: không đau 🦷');
  assert.equal(result.model, 'gemini-version');
  assert.deepEqual(result.tokens, { prompt: 20, completion: 7, total: 27 });
  assert.equal(chunks.at(-1)[1], result.text);
});

test('OpenAI stream handles metadata, finish and usage-only events', async () => {
  const source = event({ choices: [{ delta: { content: 'Tủy răng' }, finish_reason: null }] }) +
    event({ choices: [{ delta: {}, finish_reason: 'stop' }], model: 'gpt-4o-mini' }) +
    event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }) + 'data: [DONE]\n\n';
  const result = await streamTranslation(base, async () => responseStream(source, 3));
  assert.equal(result.text, 'Tủy răng');
  assert.equal(result.model, 'gpt-4o-mini');
  assert.deepEqual(result.tokens, { prompt: 10, completion: 3, total: 13 });
});

test('SSE supports multiline data and final event without newline', async () => {
  const raw = JSON.stringify(candidate('Răng', 'STOP')).replace(',"finishReason"', ',\n"finishReason"');
  const source = ': keepalive\n\n' + raw.split('\n').map(line => `data:${line}`).join('\n');
  assert.equal((await streamTranslation(gemini, async () => responseStream(source))).text, 'Răng');
});

test('Gemini thought parts are not exposed as translation', async () => {
  const data = { candidates: [{ content: { parts: [{ text: 'internal', thought: true }, { text: 'Kết quả' }] }, finishReason: 'STOP' }] };
  assert.equal((await streamTranslation(gemini, async () => responseStream(event(data)))).text, 'Kết quả');
});

for (const [label, source, match] of [
  ['malformed JSON', 'data: {broken}\n\n', /không hợp lệ/],
  ['premature EOF', event(candidate('partial')), /ngắt trước khi hoàn tất/],
  ['blocked prompt', event({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/],
  ['blocked completion', event(candidate('', 'SAFETY')), /SAFETY/],
  ['token limit', event(candidate('partial', 'MAX_TOKENS')), /giới hạn token/],
  ['empty output', event(candidate('', 'STOP')), /không trả về văn bản/],
  ['in-stream error', event({ error: { message: 'quota failure' } }), /quota failure/]
]) {
  test(`fails explicitly on ${label}`, async () => {
    await assert.rejects(streamTranslation(gemini, async () => responseStream(source)), match);
  });
}

test('OpenAI token-limited output is never returned as complete', async () => {
  await assert.rejects(streamTranslation(base, async () => responseStream(event({ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }))), /giới hạn token/);
});

test('HTTP and provider failure responses remain errors', async () => {
  await assert.rejects(streamTranslation(gemini, async () => new Response(JSON.stringify({ error: { message: 'Quota exhausted' } }), { status: 429 })), /HTTP 429.*Quota exhausted/);
  await assert.rejects(streamTranslation(gemini, async () => new Response('unavailable', { status: 503 })), /HTTP 503/);
});

test('connection tests use selected provider and require a complete text response', async () => {
  const result = await testProviderConnection(gemini, async (url, options) => {
    assert.match(url, /:generateContent$/);
    assert.equal(JSON.parse(options.body).contents[0].parts.length, 1);
    return new Response(JSON.stringify(candidate('OK', 'STOP')));
  });
  assert.equal(result.success, true);
  assert.equal(result.provider, 'gemini');
  await assert.rejects(testProviderConnection(gemini, async () => new Response(JSON.stringify({}))), /chưa trả về/);
  assert.equal((await testProviderConnection(base, async () => new Response(JSON.stringify({ model: 'gpt-4o', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })))).success, true);
});
