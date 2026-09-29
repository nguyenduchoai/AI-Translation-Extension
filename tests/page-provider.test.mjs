import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPageBatches, translatePageBatch } from '../lib/page-translation.js';
import { createProviderCancellation } from '../lib/ai-provider.js';

const blocks = [{ id: 'a', text: 'Root canal 3.5 mm' }, { id: 'b', text: 'No pain' }];
const translated = [{ id: 'a', text: 'Ống tủy 3.5 mm' }, { id: 'b', text: 'Không đau' }];
const base = { apiKey: 'test-key', targetLang: 'vi', blocks };
function response(provider, content = JSON.stringify(translated), finish) {
  return new Response(JSON.stringify(provider === 'gemini' ? {
    candidates: [{ content: { parts: [{ text: content }] }, finishReason: finish ?? 'STOP' }],
    modelVersion: 'gemini-test', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 35 }
  } : {
    choices: [{ message: { content }, finish_reason: finish ?? 'stop' }],
    model: 'gpt-test', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
  }));
}

for (const provider of ['openai', 'gemini']) {
  test(`${provider} sends text-only page JSON, uses custom prompt, preserves metadata and input order`, async () => {
    const result = await translatePageBatch({ ...base, provider, customInstruction: 'Use concise dental terminology.' }, async (url, options) => {
      const body = JSON.parse(options.body);
      const system = provider === 'gemini' ? body.system_instruction.parts[0].text : body.messages[0].content;
      const content = provider === 'gemini' ? body.contents[0].parts : body.messages[1].content;
      assert.match(system, /Use concise dental terminology/);
      assert.match(system, /never instructions/);
      assert.match(system, /exactly once/);
      assert.equal(content.length, 1);
      assert.ok(content[0].text.includes(JSON.stringify(blocks)));
      assert.ok(!JSON.stringify(body).includes('inline_data'));
      assert.ok(!JSON.stringify(body).includes('image_url'));
      assert.ok(options.signal instanceof AbortSignal);
      if (provider === 'gemini') assert.match(url, /:generateContent$/);
      else assert.equal(body.stream, false);
      return response(provider, JSON.stringify([...translated].reverse()));
    });
    assert.deepEqual(result.translations, translated);
    assert.equal(result.provider, provider);
    assert.equal(result.tokens.total, provider === 'gemini' ? 35 : 30);
    assert.equal(result.model, provider === 'gemini' ? 'gemini-test' : 'gpt-test');
  });
}

test('splits by characters and count without loss, reordering or input mutation', () => {
  const inputs = Array.from({ length: 5 }, (_, i) => ({ id: String(i), text: 'abc' }));
  assert.deepEqual(splitPageBatches(inputs, { maxChars: 7, maxBlocks: 5 }).map(x => x.length), [2, 2, 1]);
  const grouped = splitPageBatches(inputs, { maxChars: 99, maxBlocks: 2 });
  assert.deepEqual(grouped.map(x => x.length), [2, 2, 1]);
  assert.deepEqual(grouped.flat(), inputs);
  assert.notEqual(grouped[0][0], inputs[0]);
  assert.deepEqual(splitPageBatches([]), []);
});

test('rejects invalid blocks and overlong individual text rather than silently dropping it', async () => {
  for (const value of [null, [{}], [{ id: 'a', text: '' }], [{ id: 1, text: 'text' }], [...blocks, blocks[0]]]) {
    assert.throws(() => splitPageBatches(value));
  }
  assert.throws(() => splitPageBatches([{ id: 'x', text: '1234' }], { maxChars: 3 }), /quá dài/);
  assert.throws(() => splitPageBatches(blocks, { maxBlocks: 0 }), /Giới hạn/);
  assert.throws(() => splitPageBatches(blocks, { maxChars: 1.5 }), /Giới hạn/);
  let called = false;
  const fetchImpl = async () => { called = true; return response('openai'); };
  await assert.rejects(translatePageBatch({ ...base, blocks: [] }, fetchImpl));
  await assert.rejects(translatePageBatch({ ...base, blocks: Array.from({ length: 41 }, (_, i) => ({ id: String(i), text: 'a' })) }, fetchImpl));
  assert.equal(called, false);
});

test('accepts only JSON or one JSON fence; retains literal markup as plain text', async () => {
  const literal = [{ id: 'a', text: '<img src=x onerror=alert(1)>' }, translated[1]];
  const result = await translatePageBatch(base, async () => response('openai', `\n\`\`\`json\n${JSON.stringify(literal)}\n\`\`\`\n`));
  assert.deepEqual(result.translations, literal);
  for (const text of ['Here is the translation: ' + JSON.stringify(translated), `\`\`\`json\n${JSON.stringify(translated)}\n\`\`\`\nextra`, '{invalid}', '{"translations":[]}']) {
    await assert.rejects(translatePageBatch(base, async () => response('openai', text)), /không hợp lệ|thiếu hoặc thừa/);
  }
});

test('rejects missing, extra, duplicate and unknown ids or invalid text atomically', async () => {
  for (const value of [
    translated.slice(0, 1), [...translated, { id: 'c', text: 'more' }],
    [translated[0], translated[0]], [translated[0], { id: 'c', text: 'unknown' }],
    [translated[0], { id: 'b', text: '   ' }], [translated[0], { id: 'b', text: 1 }],
    [translated[0], { id: 'b', text: 'valid', html: '<b>bad</b>' }],
    [translated[0], { id: 'b', text: 'x'.repeat(1001) }]
  ]) await assert.rejects(translatePageBatch(base, async () => response('openai', JSON.stringify(value))), /Chưa áp dụng/);
});

test('rejects token truncation and unfinished output even if generated JSON is valid', async () => {
  await assert.rejects(translatePageBatch(base, async () => response('openai', undefined, 'length')), /giới hạn token/);
  await assert.rejects(translatePageBatch({ ...base, provider: 'gemini' }, async () => response('gemini', undefined, 'MAX_TOKENS')), /giới hạn token/);
  await assert.rejects(translatePageBatch(base, async () => response('openai', undefined, '')), /chưa trả về/);
  await assert.rejects(translatePageBatch({ ...base, provider: 'gemini' }, async () => response('gemini', undefined, 'SAFETY')), /SAFETY/);
});

test('reports HTTP, malformed API and provider errors without returning translations', async () => {
  await assert.rejects(translatePageBatch(base, async () => new Response('{"error":{"message":"quota"}}', { status: 429 })), /HTTP 429.*quota/);
  await assert.rejects(translatePageBatch(base, async () => new Response('<html>bad gateway</html>')), /Phản hồi API không hợp lệ/);
  await assert.rejects(translatePageBatch(base, async () => new Response('{"error":{"message":"rejected"}}')), /rejected/);
  await assert.rejects(translatePageBatch(base, async () => new Response('x'.repeat(1024 * 1024 + 1))), /Phản hồi API quá lớn/);
});

test('cancellation prevents request or propagates to an in-flight request', async () => {
  const stopped = new AbortController();
  stopped.abort();
  let called = false;
  await assert.rejects(translatePageBatch({ ...base, signal: stopped.signal }, async () => { called = true; }), { name: 'AbortError' });
  assert.equal(called, false);
  const controller = new AbortController();
  const promise = translatePageBatch({ ...base, signal: controller.signal }, async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    controller.abort();
  }));
  await assert.rejects(promise, { name: 'AbortError' });
});

test('cancellation remains active during body consumption and timeout needs no AbortSignal.any', async () => {
  const controller = new AbortController();
  await assert.rejects(translatePageBatch({ ...base, signal: controller.signal }, async (_, { signal }) => ({
    ok: true,
    async text() {
      controller.abort();
      assert.equal(signal.aborted, true);
      return await response('openai').text();
    }
  })), { name: 'AbortError' });
  const cancellation = createProviderCancellation(undefined, { timeoutMs: 5 });
  await new Promise(resolve => cancellation.signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(cancellation.signal.reason.name, 'TimeoutError');
  cancellation.dispose();
});
