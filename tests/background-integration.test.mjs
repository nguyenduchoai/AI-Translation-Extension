import test from 'node:test';
import assert from 'node:assert/strict';

const screenshot = 'data:image/png;base64,c2NyZWVu';
const rect = { x: 10, y: 20, width: 100, height: 80, viewportWidth: 800, viewportHeight: 600 };
let importCount = 0;

async function backgroundHarness(t, settings, apiResponse) {
  const messages = [];
  const requests = [];
  const draws = [];
  let listener;
  const globals = ['chrome', 'fetch', 'createImageBitmap', 'OffscreenCanvas'];
  const descriptors = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const name of globals) {
      if (descriptors[name]) Object.defineProperty(globalThis, name, descriptors[name]);
      else delete globalThis[name];
    }
  });
  globalThis.chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    commands: { onCommand: { addListener() {} } },
    contextMenus: { onClicked: { addListener() {} } },
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      onInstalled: { addListener() {} },
      sendMessage: async message => messages.push({ destination: 'panel', ...message })
    },
    tabs: {
      captureVisibleTab: async (windowId, options) => {
        assert.equal(windowId, null);
        assert.equal(options.format, 'png');
        return screenshot;
      },
      sendMessage: async (tabId, message) => {
        assert.equal(tabId, 42);
        messages.push({ destination: 'tab', ...message });
      }
    },
    storage: { sync: { get: async defaults => ({ ...defaults, ...settings }) } }
  };
  globalThis.createImageBitmap = async () => ({ width: 1600, height: 1200 });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { assert.deepEqual([width, height], [200, 160]); }
    getContext(kind) {
      assert.equal(kind, '2d');
      return { drawImage: (...args) => draws.push(args.slice(1)) };
    }
    async convertToBlob(options) {
      assert.equal(options.type, 'image/png');
      return new Blob(['cropped-png'], options);
    }
  };
  globalThis.fetch = async (url, options) => {
    if (url === screenshot) return new Response(new Blob(['screen-png']));
    requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return apiResponse();
  };
  // Re-evaluate the service worker to register its real listener against each mock browser.
  await import(`../background.js?integration=${++importCount}`);
  const dispatch = message => new Promise(resolve => {
    assert.equal(listener(message, { tab: { id: 42 } }, resolve), true);
  });
  return { dispatch, requests, messages, draws };
}

const settings = {
  provider: 'gemini', apiKey: 'old-openai-key', model: 'gpt-4o-mini',
  geminiApiKey: 'saved-gemini-key', geminiModel: 'gemini-custom-flash',
  targetLang: 'vi', specialty: 'endodontics'
};
function geminiSuccess(text) {
  const chunks = [
    { candidates: [{ content: { parts: [{ text }] } }] },
    { candidates: [{ finishReason: 'STOP' }], modelVersion: 'gemini-served-version', usageMetadata: { promptTokenCount: 24, candidatesTokenCount: 8, totalTokenCount: 32 } }
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(''));
}

test('capture dispatch uses saved Gemini config, crops image, streams then emits final translation', async t => {
  const harness = await backgroundHarness(t, settings, () => geminiSuccess('Răng 11 không đau.'));
  assert.deepEqual(await harness.dispatch({ action: 'captureAndTranslate', rect }), { success: true });
  assert.deepEqual(harness.draws, [[20, 40, 200, 160, 0, 0, 200, 160]]);
  assert.equal(harness.requests.length, 1);
  const request = harness.requests[0];
  assert.match(request.url, /models\/gemini-custom-flash:streamGenerateContent\?alt=sse$/);
  assert.equal(request.headers['x-goog-api-key'], 'saved-gemini-key');
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.body.contents[0].parts[1].inline_data.data, btoa('cropped-png'));
  assert.match(request.body.system_instruction.parts[0].text, /endodontics/);
  assert.match(request.body.contents[0].parts[0].text, /Vietnamese/);
  const panel = harness.messages.filter(message => message.destination === 'panel');
  assert.deepEqual(panel.map(message => message.action), ['showLoading', 'streamChunk', 'showResult']);
  assert.equal(panel[1].fullText, 'Răng 11 không đau.');
  assert.equal(panel[2].result, 'Răng 11 không đau.');
  assert.equal(panel[2].provider, 'gemini');
  assert.equal(panel[2].model, 'gemini-served-version');
  assert.deepEqual(panel[2].tokens, { prompt: 24, completion: 8, total: 32 });
  assert.equal(panel[2].croppedImage, btoa('cropped-png'));
  assert.equal(panel[2].ocrOnly, false);
});

test('capture OCR dispatch keeps original language and isolated transcription prompt', async t => {
  const harness = await backgroundHarness(t, { ...settings, ocrOnly: true }, () => geminiSuccess('Tooth 11: no pain.'));
  assert.deepEqual(await harness.dispatch({ action: 'captureAndTranslate', rect }), { success: true });
  const body = harness.requests[0].body;
  assert.match(body.system_instruction.parts[0].text, /Do not translate/);
  assert.doesNotMatch(body.system_instruction.parts[0].text, /endodontics|Vietnamese/);
  const result = harness.messages.find(message => message.destination === 'panel' && message.action === 'showResult');
  assert.equal(result.result, 'Tooth 11: no pain.');
  assert.equal(result.ocrOnly, true);
});

test('capture API failure emits an error and never a successful translation', async t => {
  const harness = await backgroundHarness(t, settings, () => new Response(JSON.stringify({ error: { message: 'Fixture quota exhausted' } }), { status: 429 }));
  const reply = await harness.dispatch({ action: 'captureAndTranslate', rect });
  assert.match(reply.error, /HTTP 429.*Fixture quota exhausted/);
  assert.equal(reply.success, undefined);
  const results = harness.messages.filter(message => message.destination === 'panel' && message.action === 'showResult');
  assert.equal(results.length, 1);
  assert.match(results[0].error, /Fixture quota exhausted/);
  assert.equal(results[0].result, undefined);
  assert.equal(harness.messages.some(message => message.action === 'streamChunk'), false);
});

test('selected Gemini without its own key never submits the saved OpenAI key', async t => {
  const harness = await backgroundHarness(t, { ...settings, geminiApiKey: '' }, () => { throw new Error('Must not call provider'); });
  const reply = await harness.dispatch({ action: 'captureAndTranslate', rect });
  assert.equal(reply.error, 'No API key');
  assert.equal(harness.requests.length, 0);
  assert.ok(harness.messages.some(message => message.error?.includes('Gemini')));
});
