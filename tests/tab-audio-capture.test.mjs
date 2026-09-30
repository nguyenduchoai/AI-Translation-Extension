import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { encodePcmWav, hasAudibleSamples, startTabAudioCapture } from '../lib/tab-audio-capture.js';

test('WAV chunks have independent headers, native sample rate, clamped signed PCM', async () => {
  for (const rate of [16000, 44100, 48000]) {
    const blob = encodePcmWav(Float32Array.of(-2, -0.5, 0, 0.5, 2, NaN), rate);
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    const text = (start, end) => new TextDecoder().decode(bytes.slice(start, end));
    assert.equal(blob.type, 'audio/wav');
    assert.equal(text(0, 4), 'RIFF');
    assert.equal(text(8, 12), 'WAVE');
    assert.equal(text(12, 16), 'fmt ');
    assert.equal(text(36, 40), 'data');
    assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), rate);
    assert.equal(view.getUint32(28, true), rate * 2);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(40, true), 12);
    assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)),
      [-32768, -16384, 0, 16384, 32767, 0]);
  }
  assert.throws(() => encodePcmWav(Float32Array.of(0), 0), /Tần số/);
});

test('silence filter preserves quiet speech and sparse audible transients', () => {
  assert.equal(hasAudibleSamples(new Float32Array()), false);
  assert.equal(hasAudibleSamples(new Float32Array(48000)), false);
  assert.equal(hasAudibleSamples(new Float32Array(48000).fill(0.00001)), false);
  assert.equal(hasAudibleSamples(new Float32Array(48000).fill(0.0002)), true);
  const transient = new Float32Array(48000); transient[120] = 0.002;
  assert.equal(hasAudibleSamples(transient), true);
});

test('worklet downmixes channels, transfers exact ten-second chunks and retains remainder', async () => {
  const messages = [];
  let Processor;
  const sandbox = {
    sampleRate: 4, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (data, transfer) => messages.push({ data, transfer }) }; } },
    registerProcessor: (name, processor) => { assert.equal(name, 'tab-audio-pcm'); Processor = processor; }
  };
  vm.runInNewContext(await readFile(new URL('../lib/tab-audio-worklet.js', import.meta.url), 'utf8'), sandbox);
  const processor = new Processor();
  assert.equal(processor.process([]), true);
  processor.process([[new Float32Array(25).fill(1), new Float32Array(25).fill(0)]]);
  assert.equal(messages.length, 0);
  processor.process([[new Float32Array(60).fill(-0.5)]]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].data.length, 40);
  assert.equal(messages[0].transfer[0], messages[0].data.buffer);
  assert.deepEqual([...messages[0].data], [...new Float32Array(25).fill(0.5), ...new Float32Array(15).fill(-0.5)]);
  assert.deepEqual([...messages[1].data], [...new Float32Array(40).fill(-0.5)]);
  assert.equal(processor.offset, 5);
  assert.equal(processor.samples.length, 40);
});

function browser(t, { surface = 'browser', audio = true, moduleError = false, moduleWait, resumeWait, resumeError, chooserWait } = {}) {
  const track = type => {
    const item = new EventTarget();
    Object.assign(item, { kind: type, readyState: 'live', stops: 0,
      stop() { this.stops++; this.readyState = 'ended'; },
      getSettings() { return { displaySurface: surface }; }
    });
    return item;
  };
  const video = track('video'), sound = track('audio');
  const tracks = audio ? [video, sound] : [video];
  const stream = { getTracks: () => tracks, getVideoTracks: () => [video], getAudioTracks: () => audio ? [sound] : [] };
  const source = { connect() {}, disconnect() { this.disconnected = true; } };
  const port = { close() { this.closed = true; } };
  const worklet = { port, connect() {}, disconnect() { this.disconnected = true; } };
  const context = {
    state: 'suspended', sampleRate: 48000, destination: {}, closes: 0,
    audioWorklet: { async addModule(url) { assert.match(url.pathname, /tab-audio-worklet.js$/); await moduleWait; if (moduleError) throw new Error('Module failed'); } },
    createMediaStreamSource(input) { assert.deepEqual(input.tracks, [sound]); return source; },
    async resume() { await resumeWait; if (resumeError) throw new Error('Resume failed'); if (this.state !== 'closed') this.state = 'running'; },
    async close() { this.closes++; this.state = 'closed'; }
  };
  let options;
  const globals = {
    navigator: { mediaDevices: { async getDisplayMedia(value) { options = value; await chooserWait; return stream; } } },
    AudioContext: function () { return context; },
    AudioWorkletNode: function () { return worklet; },
    MediaStream: class { constructor(input) { this.tracks = input; } }
  };
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  return { context, worklet, source, video, sound, get options() { return options; } };
}

test('capture sends only audible WAV, retains video locally, and stop releases resources once', async t => {
  const state = browser(t);
  const blobs = [];
  let ended = 0;
  const capture = await startTabAudioCapture({ onChunk: blob => blobs.push(blob), onEnded: () => ended++ });
  assert.equal(state.options.systemAudio, 'exclude');
  assert.equal(state.options.surfaceSwitching, 'exclude');
  assert.equal(state.video.stops, 0);
  const message = state.worklet.port.onmessage;
  message({ data: new Float32Array(48000) });
  message({ data: new Float32Array(48000).fill(0.2) });
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].size, 96044);
  capture.stop(); capture.stop();
  message({ data: new Float32Array(48000).fill(0.2) });
  assert.equal(blobs.length, 1);
  assert.equal(ended, 0);
  assert.equal(state.video.stops, 1);
  assert.equal(state.sound.stops, 1);
  assert.equal(state.context.closes, 1);
  assert.equal(state.worklet.port.closed, true);
  assert.equal(state.source.disconnected, true);
});

test('window/screen selection, absent audio and worklet load errors release captured tracks', async t => {
  for (const config of [{ surface: 'window' }, { surface: 'monitor' }, { audio: false }, { moduleError: true }]) {
    await t.test(JSON.stringify(config), async sub => {
      const state = browser(sub, config);
      await assert.rejects(startTabAudioCapture({ onChunk() {} }));
      assert.equal(state.video.stops, 1);
      if (config.audio !== false) assert.equal(state.sound.stops, 1);
    });
  }
});

test('browser share stop announces end once and frees resources', async t => {
  const state = browser(t);
  let ended = 0;
  await startTabAudioCapture({ onChunk() {}, onEnded: () => ended++ });
  state.video.dispatchEvent(new Event('ended'));
  state.sound.dispatchEvent(new Event('ended'));
  assert.equal(ended, 1);
  assert.equal(state.context.closes, 1);
});

test('asynchronous chunk consumer failures stop capture and report once', async t => {
  const state = browser(t);
  const errors = [];
  await startTabAudioCapture({ onChunk: async () => { throw new Error('Queue full'); }, onError: error => errors.push(error.message) });
  state.worklet.port.onmessage({ data: Float32Array.of(0.5) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, ['Queue full']);
  assert.equal(state.context.closes, 1);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('sharing ending while worklet loads rejects setup and closes tracks/context once', async t => {
  const pending = deferred();
  const state = browser(t, { moduleWait: pending.promise });
  let ended = 0;
  const start = startTabAudioCapture({ onChunk() {}, onEnded: () => ended++ });
  const rejected = assert.rejects(start, /kết thúc chia sẻ/);
  await new Promise(resolve => setImmediate(resolve));
  state.video.dispatchEvent(new Event('ended'));
  pending.resolve();
  await rejected;
  assert.equal(ended, 1);
  assert.equal(state.context.closes, 1);
  assert.equal(state.video.stops, 1);
  assert.equal(state.sound.stops, 1);
});

test('sharing ending during AudioContext resume releases worklet and rejects late setup', async t => {
  const pending = deferred();
  const state = browser(t, { resumeWait: pending.promise });
  let ended = 0;
  const start = startTabAudioCapture({ onChunk() {}, onEnded: () => ended++ });
  const rejected = assert.rejects(start, /Không thể bật thu âm/);
  await new Promise(resolve => setImmediate(resolve));
  state.sound.dispatchEvent(new Event('ended'));
  pending.resolve();
  await rejected;
  assert.equal(ended, 1);
  assert.equal(state.worklet.port.closed, true);
  assert.equal(state.source.disconnected, true);
  assert.equal(state.context.closes, 1);
});

test('AudioContext resume failure releases tracks, source and processor', async t => {
  const state = browser(t, { resumeError: true });
  await assert.rejects(startTabAudioCapture({ onChunk() {} }), /Resume failed/);
  assert.equal(state.video.stops, 1);
  assert.equal(state.sound.stops, 1);
  assert.equal(state.source.disconnected, true);
  assert.equal(state.worklet.port.closed, true);
  assert.equal(state.context.closes, 1);
});

test('chooser starts synchronously and a late granted handle can be stopped immediately', async t => {
  const pending = deferred();
  const state = browser(t, { chooserWait: pending.promise });
  let chunks = 0;
  const start = startTabAudioCapture({ onChunk() { chunks++; } });
  assert.equal(state.options.video.displaySurface, 'browser');
  assert.equal(state.context.closes, 0);
  // The caller marks its run cancelled while the native chooser remains open.
  const runCancelled = true;
  const cleanup = start.then(capture => { if (runCancelled) capture.stop(); });
  pending.resolve();
  await cleanup;
  assert.equal(chunks, 0);
  assert.equal(state.video.stops, 1);
  assert.equal(state.context.closes, 1);
});

test('denied native chooser rejects without creating an AudioContext', async t => {
  const pending = deferred();
  const state = browser(t, { chooserWait: pending.promise });
  const start = startTabAudioCapture({ onChunk() {} });
  const rejected = assert.rejects(start, { name: 'NotAllowedError' });
  pending.reject(new DOMException('Permission denied', 'NotAllowedError'));
  await rejected;
  assert.equal(state.context.closes, 0);
  assert.equal(state.video.stops, 0);
});

test('processor failure stops capture and stale errors cannot report twice', async t => {
  const state = browser(t);
  const errors = [];
  await startTabAudioCapture({ onChunk() {}, onError: error => errors.push(error.message) });
  const fail = state.worklet.onprocessorerror;
  fail(); fail();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Bộ thu âm tab/);
  assert.equal(state.context.closes, 1);
  assert.equal(state.worklet.port.onmessage, null);
});
