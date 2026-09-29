import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechProviders, browserVoices, fetchVieneuVoices, VIENEU_URL } from '../lib/speech-providers.js';

const settings = { engine: 'vieneu', voice: 'selected-voice', volume: 0.3 };
const freshSignal = () => new AbortController().signal;

test('VieNeu sends selected text and voice only to loopback, with handshake header and no AI key', async t => {
  const provider = new SpeechProviders();
  const signal = freshSignal();
  const response = new Response('audio');
  const onFirstAudio = () => {};
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${VIENEU_URL}/speech`);
    assert.equal(new URL(url).hostname, '127.0.0.1');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { 'X-AI-Translator': '1', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), { text: 'Răng số 11.', voice: 'selected-voice' });
    assert.equal(options.signal, signal);
    return response;
  });
  const playback = t.mock.method(provider.player, 'play', async (actual, actualSignal, callback) => {
    assert.equal(actual, response);
    assert.equal(actualSignal, signal);
    assert.equal(callback, onFirstAudio);
  });
  await provider.speak('Răng số 11.', { ...settings, apiKey: 'must-not-send' }, signal, onFirstAudio);
  assert.equal(playback.mock.callCount(), 1);
  assert.equal(provider.player.volume, 0.3);
});

test('VieNeu empty selection omits voice and uses server default', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { text: 'Xin chào.' });
    return new Response('audio');
  });
  const provider = new SpeechProviders();
  t.mock.method(provider.player, 'play', async () => {});
  await provider.speak('Xin chào.', { ...settings, voice: '' }, freshSignal());
});

test('voice discovery uses loopback handshake and rejects empty or malformed lists', async t => {
  const voices = [{ id: 'voice', name: 'Giọng Việt' }];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${VIENEU_URL}/voices`);
    assert.deepEqual(options.headers, { 'X-AI-Translator': '1' });
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ voices });
  });
  assert.deepEqual(await fetchVieneuVoices(), voices);
  for (const payload of [{ voices: [] }, { voices: null }, {}]) {
    fetchMock.mock.mockImplementation(async () => Response.json(payload));
    await assert.rejects(fetchVieneuVoices(), /danh sách giọng/);
  }
  fetchMock.mock.mockImplementation(async () => new Response('', { status: 503 }));
  await assert.rejects(fetchVieneuVoices(), /chưa sẵn sàng/);
});

test('VieNeu connection, HTTP and playback errors fail without silent fallback', async t => {
  const provider = new SpeechProviders();
  const playback = t.mock.method(provider.player, 'play', async () => {});
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(provider.speak('Text', settings, freshSignal()), /Không kết nối/);
  request.mock.mockImplementation(async () => Response.json({ detail: 'Model đang tải' }, { status: 503 }));
  await assert.rejects(provider.speak('Text', settings, freshSignal()), /Model đang tải/);
  request.mock.mockImplementation(async () => new Response('broken', { status: 500 }));
  await assert.rejects(provider.speak('Text', settings, freshSignal()), /HTTP 500/);
  assert.equal(playback.mock.callCount(), 0);
  request.mock.mockImplementation(async () => new Response('audio'));
  playback.mock.mockImplementation(async () => { throw new Error('PCM corrupt'); });
  await assert.rejects(provider.speak('Text', settings, freshSignal()), /PCM corrupt/);
  await assert.rejects(provider.speak('Text', { engine: 'unknown' }, freshSignal()), /không được hỗ trợ/);
});

test('VieNeu request abort retains AbortError rather than reporting connection failure', async t => {
  const signal = AbortSignal.abort();
  t.mock.method(globalThis, 'fetch', async () => { signal.throwIfAborted(); });
  await assert.rejects(new SpeechProviders().speak('Text', settings, signal), { name: 'AbortError' });
});

globalThis.speechSynthesis ||= { getVoices() {}, speak() {}, cancel() {} };
globalThis.SpeechSynthesisUtterance ||= class { constructor(text) { this.text = text; } };

function setupBrowser(t, voices) {
  t.mock.method(speechSynthesis, 'getVoices', () => voices);
  return {
    speak: t.mock.method(speechSynthesis, 'speak', () => {}),
    cancel: t.mock.method(speechSynthesis, 'cancel', () => {})
  };
}

test('browser reads only Vietnamese voices and honors selected Vietnamese voice', async t => {
  const voices = [{ lang: 'en-US', voiceURI: 'en' }, { lang: 'vi-VN', voiceURI: 'vi' },
    { lang: 'vi_VN', voiceURI: 'other' }, { lang: 'vietnamese', voiceURI: 'bad-tag' }];
  const { speak } = setupBrowser(t, voices);
  assert.deepEqual(browserVoices(), voices.slice(1, 3));
  let started = 0;
  speak.mock.mockImplementation(utterance => {
    assert.equal(utterance.voice, voices[2]);
    assert.equal(utterance.text, 'Nha khoa.');
    assert.equal(utterance.lang, 'vi_VN');
    assert.equal(utterance.volume, 0.4);
    utterance.onstart(); utterance.onend();
  });
  await new SpeechProviders().speak('Nha khoa.', { engine: 'browser', voice: 'other', volume: 0.4 }, freshSignal(), () => started++);
  assert.equal(started, 1);
});

test('browser refuses to read Vietnamese through an English-only voice list', async t => {
  const { speak } = setupBrowser(t, [{ lang: 'en-US', voiceURI: 'en' }]);
  await assert.rejects(new SpeechProviders().speak('Nha khoa', { engine: 'browser' }, freshSignal()), /chưa có giọng tiếng Việt/);
  assert.equal(speak.mock.callCount(), 0);
});

test('browser cancellation stops speech and native errors surface to the queue', async t => {
  const { speak, cancel } = setupBrowser(t, [{ lang: 'vi-VN', voiceURI: 'vi' }]);
  const controller = new AbortController();
  const provider = new SpeechProviders();
  const pending = provider.speak('Nha khoa', { engine: 'browser' }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancel.mock.callCount(), 1);
  speak.mock.mockImplementation(utterance => utterance.onerror({ error: 'audio-busy' }));
  await assert.rejects(provider.speak('Nha khoa', { engine: 'browser' }, freshSignal()), /audio-busy/);
});

test('unresponsive browser voice times out and releases active speech', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { cancel } = setupBrowser(t, [{ lang: 'vi-VN', voiceURI: 'vi' }]);
  const pending = new SpeechProviders().speak('Nha khoa', { engine: 'browser' }, freshSignal());
  const rejected = assert.rejects(pending, /không phản hồi/);
  t.mock.timers.tick(90000);
  await rejected;
  assert.equal(cancel.mock.callCount(), 1);
});

test('VieNeu retries only a busy prior synthesis and then plays once', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? Response.json({ detail: 'busy' }, { status: 429 }) : new Response('audio'));
  const provider = new SpeechProviders();
  const playback = t.mock.method(provider.player, 'play', async () => {});
  await provider.speak('Câu mới.', settings, freshSignal());
  assert.equal(requests, 2);
  assert.equal(playback.mock.callCount(), 1);
});

test('Stop cancels a pending busy retry without sending a second request', async t => {
  const controller = new AbortController();
  const request = t.mock.method(globalThis, 'fetch', async () => {
    setTimeout(() => controller.abort(), 20);
    return Response.json({ detail: 'busy' }, { status: 429 });
  });
  await assert.rejects(new SpeechProviders().speak('Câu mới.', settings, controller.signal), { name: 'AbortError' });
  assert.equal(request.mock.callCount(), 1);
});
