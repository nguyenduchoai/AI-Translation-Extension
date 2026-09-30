import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioTranslationSession, translateAudioText } from '../lib/audio-translation-session.js';

const blob = text => new Blob([text], { type: 'audio/wav' });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('ASR, translation and voice execute in sequence, with voice backpressure', async () => {
  const calls = [], results = [], errors = [];
  const voice = deferred();
  const session = createAudioTranslationSession({
    async transcribe(audio) { const text = await audio.text(); calls.push(`asr:${text}`); return text; },
    async translate(text) { calls.push(`translate:${text}`); return `vi:${text}`; },
    async onResult(result, { signal }) {
      assert.equal(signal.aborted, false);
      calls.push(`voice:${result.sourceText}`); results.push(result);
      if (result.sequence === 1) await voice.promise;
    },
    onError: error => errors.push(error)
  });
  assert.equal(session.enqueue(blob('one')), true);
  assert.equal(session.enqueue(blob('two')), true);
  await tick();
  assert.deepEqual(calls, ['asr:one', 'translate:one', 'voice:one']);
  assert.equal(session.pending, 2);
  voice.resolve();
  await session.idle();
  assert.deepEqual(calls, ['asr:one', 'translate:one', 'voice:one', 'asr:two', 'translate:two', 'voice:two']);
  assert.deepEqual(results, [
    { sequence: 1, sourceText: 'one', text: 'vi:one' }, { sequence: 2, sourceText: 'two', text: 'vi:two' }
  ]);
  assert.equal(session.pending, 0);
  assert.deepEqual(errors, []);
});

for (const stage of ['asr', 'translate', 'voice']) {
  test(`stop cancels active ${stage}, clears queue and discards late response`, async () => {
    const blocked = deferred(), reached = deferred();
    const calls = [], errors = [];
    let activeSignal;
    async function step(name, { signal }) {
      calls.push(name);
      if (stage === name) { activeSignal = signal; reached.resolve(); await blocked.promise; }
      return 'text';
    }
    const session = createAudioTranslationSession({
      transcribe: (_, context) => step('asr', context),
      translate: (_, context) => step('translate', context),
      onResult: (_, context) => step('voice', context),
      onError: error => errors.push(error)
    });
    session.enqueue(blob('one')); session.enqueue(blob('two'));
    await reached.promise;
    session.stop();
    assert.equal(activeSignal.aborted, true);
    assert.equal(session.stopped, true);
    assert.equal(session.pending, 0);
    assert.equal(session.enqueue(blob('three')), false);
    blocked.resolve();
    await session.idle();
    assert.deepEqual(calls, ['asr', 'translate', 'voice'].slice(0, ['asr', 'translate', 'voice'].indexOf(stage) + 1));
    assert.deepEqual(errors, []);
  });
}

test('queue overflow includes active voice, reports once and stops before stale results', async () => {
  const blocked = deferred(), errors = [];
  let signal;
  const session = createAudioTranslationSession({
    transcribe: async () => 'one', translate: async () => 'một',
    async onResult(_, context) { signal = context.signal; await blocked.promise; },
    onError: error => errors.push(error)
  });
  session.enqueue(blob('one'));
  await tick();
  assert.equal(session.enqueue(blob('two')), true);
  assert.equal(session.enqueue(blob('three')), true);
  assert.equal(session.enqueue(blob('four')), false);
  assert.equal(session.enqueue(blob('five')), false);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /hàng đợi đã đầy/);
  assert.equal(signal.aborted, true);
  blocked.resolve();
  await session.idle();
});

test('ASR failure or voice failure stops pending audio and reports original error', async () => {
  for (const stage of ['asr', 'voice']) {
    const error = new Error(stage === 'asr' ? 'Groq rate limited HTTP 429' : 'Voice unavailable');
    const errors = [], calls = [];
    const session = createAudioTranslationSession({
      async transcribe() { calls.push('asr'); if (stage === 'asr') throw error; return 'one'; },
      translate: async () => 'một',
      async onResult() { throw error; }, onError: value => errors.push(value)
    });
    session.enqueue(blob('one')); session.enqueue(blob('two'));
    await session.idle();
    assert.deepEqual(errors, [error]);
    assert.deepEqual(calls, ['asr']);
    assert.equal(session.stopped, true);
  }
});

test('empty transcripts skip translation and voice without blocking next audio', async () => {
  const results = [], errors = [];
  const session = createAudioTranslationSession({
    transcribe: async audio => (await audio.text()) === 'silence' ? ' ' : 'speech',
    translate: async text => `vi:${text}`, onResult: result => results.push(result), onError: error => errors.push(error)
  });
  session.enqueue(blob('silence')); session.enqueue(blob('spoken'));
  await session.idle();
  assert.deepEqual(results, [{ sourceText: 'speech', text: 'vi:speech', sequence: 2 }]);
  assert.deepEqual(errors, []);
});

for (const provider of ['openai', 'gemini']) {
  test(`audio text helper reuses ${provider} settings, specialty and custom template, always Vietnamese`, async () => {
    const text = await translateAudioText({ text: 'No pain.', provider, apiKey: 'ai-key', targetLang: 'en',
      model: 'custom-model', specialty: 'orthodontics', customInstruction: 'Keep it concise.' }, async (_, request) => {
      const body = JSON.parse(request.body);
      const system = provider === 'gemini' ? body.system_instruction.parts[0].text : body.messages[0].content;
      assert.match(system, /into Vietnamese/);
      assert.match(system, /orthodontics/);
      assert.match(system, /Keep it concise/);
      const content = JSON.stringify([{ id: 'audio', text: 'Không đau.' }]);
      return new Response(JSON.stringify(provider === 'gemini' ? {
        candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }]
      } : { choices: [{ message: { content }, finish_reason: 'stop' }] }));
    });
    assert.equal(text, 'Không đau.');
  });
}
