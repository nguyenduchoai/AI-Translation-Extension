import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioVoiceQueue } from '../lib/audio-voice-queue.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('constructor does not speak; segments split into ordered sentences and preserve decimals', async () => {
  const spoken = [], errors = [], first = deferred();
  const queue = createAudioVoiceQueue({
    async speak(text, signal) {
      assert.equal(signal.aborted, false);
      spoken.push(text);
      if (spoken.length === 1) await first.promise;
    },
    onError: error => errors.push(error)
  });
  await tick();
  assert.deepEqual(spoken, []);
  const segment = 'Ống tủy 3.5 mm. Không đau.';
  assert.equal(queue.enqueue(segment), true);
  assert.equal(queue.enqueue('Tiếp theo!'), true);
  await tick();
  assert.deepEqual(spoken, ['Ống tủy 3.5 mm.']);
  assert.equal(queue.pending, 2);
  assert.equal(queue.pendingChars, segment.length + 'Tiếp theo!'.length);
  first.resolve();
  await queue.idle();
  assert.deepEqual(spoken, ['Ống tủy 3.5 mm.', 'Không đau.', 'Tiếp theo!']);
  assert.equal(queue.pending, 0);
  assert.equal(queue.pendingChars, 0);
  assert.deepEqual(errors, []);
});

test('pending segment limit includes active speech, overflow aborts and reports only once', async () => {
  const blocked = deferred(), spoken = [], errors = [];
  let activeSignal;
  const queue = createAudioVoiceQueue({
    async speak(text, signal) { spoken.push(text); activeSignal = signal; await blocked.promise; },
    onError: error => errors.push(error)
  });
  queue.enqueue('Một. Phần còn lại.');
  await tick();
  assert.equal(queue.enqueue('Hai.'), true);
  assert.equal(queue.enqueue('Ba.'), true);
  assert.equal(queue.enqueue('Bốn.'), false);
  assert.equal(queue.enqueue('Năm.'), false);
  assert.equal(queue.stopped, true);
  assert.equal(activeSignal.aborted, true);
  assert.equal(queue.pending, 0);
  assert.equal(queue.pendingChars, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /hàng đợi đã đầy/);
  blocked.resolve();
  await queue.idle();
  assert.deepEqual(spoken, ['Một.']);
});

test('character limit includes current segment as well as queued segments', async () => {
  const blocked = deferred(), errors = [];
  const queue = createAudioVoiceQueue({ speak: () => blocked.promise, onError: error => errors.push(error), maxChars: 10 });
  assert.equal(queue.enqueue('12345'), true);
  await tick();
  assert.equal(queue.enqueue('67890'), true);
  assert.equal(queue.pendingChars, 10);
  assert.equal(queue.enqueue('x'), false);
  assert.equal(errors.length, 1);
  blocked.resolve();
  await queue.idle();
});

test('stop aborts voice and discards queued text and remainder of active segment', async () => {
  const blocked = deferred(), spoken = [], errors = [];
  let activeSignal;
  const queue = createAudioVoiceQueue({
    async speak(text, signal) { spoken.push(text); activeSignal = signal; await blocked.promise; },
    onError: error => errors.push(error)
  });
  queue.enqueue('Đầu. Cuối.'); queue.enqueue('Đoạn sau.');
  await tick();
  queue.stop(); queue.stop();
  assert.equal(activeSignal.aborted, true);
  assert.equal(queue.enqueue('Mới.'), false);
  blocked.resolve();
  await queue.idle();
  assert.deepEqual(spoken, ['Đầu.']);
  assert.deepEqual(errors, []);
  assert.equal(queue.pendingChars, 0);
});

test('voice failure stops queued text; reporting failure cannot cause unhandled rejection', async () => {
  const error = new Error('VieNeu unavailable'), spoken = [], errors = [];
  const queue = createAudioVoiceQueue({
    async speak(text) { spoken.push(text); throw error; },
    async onError(value) { errors.push(value); throw new Error('UI unavailable'); }
  });
  queue.enqueue('Một.'); queue.enqueue('Hai.');
  await queue.idle();
  assert.deepEqual(spoken, ['Một.']);
  assert.deepEqual(errors, [error]);
  assert.equal(queue.stopped, true);
});

test('completed segments release capacity; a long session does not accumulate full transcript', async () => {
  let calls = 0;
  const errors = [];
  const queue = createAudioVoiceQueue({ speak: async () => { calls++; }, onError: error => errors.push(error), maxChars: 10 });
  for (let i = 0; i < 100; i++) {
    assert.equal(queue.enqueue('Xin chào.'), true);
    await queue.idle();
    assert.equal(queue.pending, 0);
    assert.equal(queue.pendingChars, 0);
  }
  assert.equal(calls, 100);
  assert.deepEqual(errors, []);
});

test('invalid segments and unbroken tokens fail before playback', async () => {
  for (const text of ['', ' ', null, 'x'.repeat(1201)]) {
    let calls = 0;
    const errors = [];
    const queue = createAudioVoiceQueue({ speak: async () => { calls++; }, onError: error => errors.push(error) });
    assert.equal(queue.enqueue(text), false);
    await queue.idle();
    assert.equal(queue.stopped, true);
    assert.equal(calls, 0);
    assert.equal(errors.length, 1);
  }
});
