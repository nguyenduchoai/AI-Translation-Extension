import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmPlayer } from '../lib/pcm-player.js';

function mockAudio(t, { automaticEnd = true } = {}) {
  const sources = [];
  const gain = { gain: {}, connect() {}, disconnected: false, disconnect() { this.disconnected = true; } };
  const context = {
    state: 'running', currentTime: 0, destination: {},
    async resume() {},
    createGain: () => gain,
    createBuffer(channels, count, rate) {
      assert.equal(channels, 1);
      return { rate, samples: new Float32Array(count), getChannelData() { return this.samples; } };
    },
    createBufferSource() {
      const source = {
        connect() {}, disconnect() {}, stopped: false,
        start(at) { this.at = at; if (automaticEnd) queueMicrotask(() => this.onended()); },
        stop() { this.stopped = true; queueMicrotask(() => this.onended()); }
      };
      sources.push(source);
      return source;
    }
  };
  t.mock.method(globalThis, 'AudioContext', function () { return context; });
  return { context, sources, gain };
}

// Node has no audio device; restore this constructor after this test file exits.
globalThis.AudioContext ||= class {};

function pcmResponse(chunks, headers = {}) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
    controller.close();
  } }), { headers: { 'Content-Type': 'audio/pcm', 'X-Sample-Rate': '48000', ...headers } });
}

test('PCM decodes signed little-endian samples across odd network boundaries', async t => {
  const { sources, gain } = mockAudio(t);
  const player = new PcmPlayer();
  player.volume = 0.25;
  let firstAudio = 0;
  await player.play(pcmResponse([[0], [128, 0, 0, 255], [127, 0], [192]]),
    new AbortController().signal, () => firstAudio++);
  assert.deepEqual([...sources[0].buffer.samples], [-1, 0, 32767 / 32768, -0.5]);
  assert.equal(sources[0].buffer.rate, 48000);
  assert.equal(gain.gain.value, 0.25);
  assert.equal(gain.disconnected, true);
  assert.equal(firstAudio, 1);
});

test('PCM schedules successive buffers contiguously and announces first audio once', async t => {
  const { sources } = mockAudio(t);
  let firstAudio = 0;
  await new PcmPlayer().play(pcmResponse([new Uint8Array(19204)]),
    new AbortController().signal, () => firstAudio++);
  assert.deepEqual(sources.map(source => source.buffer.samples.length), [4800, 4800, 2]);
  assert.equal(sources[1].at, sources[0].at + 0.1);
  assert.equal(sources[2].at, sources[1].at + 0.1);
  assert.equal(firstAudio, 1);
});

test('PCM rejects truncated samples, empty audio and unsupported formats', async t => {
  const { sources, gain } = mockAudio(t);
  const player = new PcmPlayer();
  const signal = new AbortController().signal;
  await assert.rejects(player.play(pcmResponse([[1]]), signal), /cắt giữa mẫu PCM/);
  await assert.rejects(player.play(pcmResponse([]), signal), /không trả về âm thanh/);
  await assert.rejects(player.play(pcmResponse([[0, 0]], { 'X-Sample-Rate': '24000' }), signal), /định dạng/);
  await assert.rejects(player.play(pcmResponse([[0, 0]], { 'Content-Type': 'audio/wav' }), signal), /định dạng/);
  assert.equal(sources.length, 0);
  assert.equal(gain.disconnected, true);
});

test('PCM abort stops queued audio, cancels a pending stream read and releases resources', async t => {
  const { sources, gain } = mockAudio(t, { automaticEnd: false });
  const controller = new AbortController();
  let canceled = false;
  let started;
  const firstAudio = new Promise(resolve => { started = resolve; });
  const response = new Response(new ReadableStream({
    start(stream) { stream.enqueue(new Uint8Array(9600)); },
    cancel() { canceled = true; }
  }), { headers: { 'Content-Type': 'audio/pcm', 'X-Sample-Rate': '48000' } });
  const playback = new PcmPlayer().play(response, controller.signal, started);
  const rejected = assert.rejects(playback, { name: 'AbortError' });
  await firstAudio;
  controller.abort();
  await rejected;
  assert.equal(canceled, true);
  assert.equal(sources[0].stopped, true);
  assert.equal(gain.disconnected, true);
  assert.equal(response.body.locked, false);
});

test('PCM aborted before playback never consumes or schedules audio', async t => {
  const { sources } = mockAudio(t);
  const response = pcmResponse([[0, 0]]);
  await assert.rejects(new PcmPlayer().play(response, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(response.body.locked, false);
  assert.equal(sources.length, 0);
});

test('PCM stream failure after first chunk stops audio and disconnects resources', async t => {
  const { sources, gain } = mockAudio(t, { automaticEnd: false });
  let stream;
  const response = new Response(new ReadableStream({ start(controller) {
    stream = controller;
    controller.enqueue(new Uint8Array(9600));
  } }), { headers: { 'Content-Type': 'audio/pcm', 'X-Sample-Rate': '48000' } });
  await assert.rejects(new PcmPlayer().play(response, new AbortController().signal,
    () => stream.error(new Error('connection interrupted'))), /connection interrupted/);
  assert.equal(sources[0].stopped, true);
  assert.equal(response.body.locked, false);
  assert.equal(gain.disconnected, true);
});
