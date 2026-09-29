import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageController } from '../lib/page-controller.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Controller did not reach expected state');
}

function fixture(t, options = {}) {
  const tab = { id: 7, url: 'https://example.com/article' };
  const events = [], messages = [], injections = [], calls = [];
  const listeners = {};
  let serial = 0;
  let snapshot;
  const browser = {
    storage: { sync: { async get(defaults) {
      return { ...defaults, provider: 'gemini', apiKey: 'wrong-openai-key', geminiApiKey: 'gemini-key',
        geminiModel: 'gemini-custom', targetLang: 'vi', specialty: 'endodontics', ...options.settings };
    } } },
    runtime: { async sendMessage(event) { events.push(event); } },
    scripting: { async executeScript(request) {
      injections.push(request);
      await options.inject?.(request, injections.length);
    } },
    tabs: {
      async get(id) { assert.equal(id, tab.id); return { ...tab }; },
      async query() { return [{ ...tab }]; },
      onUpdated: { addListener(fn) { listeners.updated = fn; } },
      onRemoved: { addListener(fn) { listeners.removed = fn; } },
      async sendMessage(tabId, message) {
        assert.equal(tabId, tab.id);
        messages.push(message);
        if (options.message) {
          const result = await options.message(message);
          if (result !== undefined) return result;
        }
        if (message.action === 'pageCollect') {
          snapshot = { sessionId: `snapshot-${++serial}`,
            blocks: options.blocks || [{ id: '1', text: 'Dental source' }],
            skipped: options.skipped || 0, limited: options.limited || false };
          return snapshot;
        }
        if (message.action === 'pageApply') {
          if (snapshot?.sessionId !== message.sessionId) return { applied: 0, skipped: message.translations.length, stale: true };
          return { applied: message.translations.length, skipped: 0 };
        }
        if (message.action === 'pageRestore') { snapshot = null; return { restored: 1, skipped: 0 }; }
        if (message.action === 'pageStatus') return { translated: snapshot ? 1 : 0 };
      }
    }
  };
  const controller = createPageController({ browser,
    readPrompt: async ocrOnly => {
      assert.equal(ocrOnly, false);
      return { customInstruction: 'Use careful dental terminology.', promptLabel: 'Nha khoa tùy chỉnh' };
    },
    translate: async request => {
      calls.push(request);
      return options.translate ? options.translate(request, calls.length)
        : { translations: request.blocks.map(block => ({ id: block.id, text: `Dịch ${block.text}` })) };
    }
  });
  t.after(() => listeners.removed(tab.id));
  return { controller, tab, events, messages, injections, calls, listeners,
    start: () => controller.handle({ action: 'pageStart', tabId: tab.id }),
    status: () => controller.handle({ action: 'pageStatus', tabId: tab.id }),
    action: action => controller.handle({ action, tabId: tab.id }) };
}

test('starts, batches, applies and reports completion with correct provider key and selected prompt', async t => {
  const blocks = Array.from({ length: 41 }, (_, i) => ({ id: String(i), text: `Source ${i}` }));
  const f = fixture(t, { blocks, skipped: 2, limited: true });
  const initial = await f.start();
  assert.equal(initial.status, 'preparing');
  await until(() => f.events.some(event => event.status === 'done'));
  assert.deepEqual(f.calls.map(call => call.blocks.length), [40, 1]);
  for (const call of f.calls) {
    assert.equal(call.provider, 'gemini');
    assert.equal(call.apiKey, 'gemini-key');
    assert.equal(call.model, 'gemini-custom');
    assert.equal(call.specialty, 'endodontics');
    assert.equal(call.customInstruction, 'Use careful dental terminology.');
    assert.equal(call.targetLang, 'vi');
    assert.ok(call.signal instanceof AbortSignal);
  }
  const final = await f.status();
  assert.equal(final.jobId, initial.jobId);
  assert.equal(final.completed, 41);
  assert.equal(final.applied, 41);
  assert.equal(final.skipped, 2);
  assert.equal(final.limited, true);
  assert.equal(final.promptLabel, 'Nha khoa tùy chỉnh');
  assert.match(final.message, /không phải toàn bộ/);
  assert.deepEqual(f.events.filter(event => event.status === 'translating').map(event => event.completed), [0, 40, 41]);
  assert.deepEqual(f.injections[0], { target: { tabId: 7 }, files: ['page-content.js'] });
});

test('stop aborts provider and ignores a late successful response', async t => {
  const result = deferred();
  const f = fixture(t, { translate: () => result.promise });
  await f.start();
  await until(() => f.calls.length === 1);
  assert.equal((await f.action('pageCancel')).status, 'stopped');
  assert.equal(f.calls[0].signal.aborted, true);
  result.resolve({ translations: [{ id: '1', text: 'Too late' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.some(message => message.action === 'pageApply'), false);
  assert.equal((await f.status()).status, 'stopped');
  assert.equal(f.events.some(event => event.status === 'done'), false);
});

test('restore cancels pending work and clears state without applying late text', async t => {
  const result = deferred();
  const f = fixture(t, { translate: () => result.promise });
  await f.start();
  await until(() => f.calls.length === 1);
  const restored = await f.action('pageRestore');
  assert.equal(restored.status, 'idle');
  assert.match(restored.message, /khôi phục 1/);
  assert.equal(f.calls[0].signal.aborted, true);
  result.resolve({ translations: [{ id: '1', text: 'Too late' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.some(message => message.action === 'pageApply'), false);
  assert.equal((await f.status()).status, 'idle');
});

test('a new job supersedes the old provider request and applies only the new snapshot', async t => {
  const old = deferred();
  const f = fixture(t, { translate: (request, n) => n === 1 ? old.promise
    : { translations: [{ id: '1', text: 'New translation' }] } });
  const first = await f.start();
  await until(() => f.calls.length === 1);
  const second = await f.start();
  await until(() => f.events.some(event => event.status === 'done' && event.jobId === second.jobId));
  old.resolve({ translations: [{ id: '1', text: 'Old translation' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(first.jobId, second.jobId);
  assert.equal(f.calls[0].signal.aborted, true);
  const applied = f.messages.filter(message => message.action === 'pageApply');
  assert.equal(applied.length, 1);
  assert.equal(applied[0].sessionId, 'snapshot-2');
  assert.equal(applied[0].translations[0].text, 'New translation');
  assert.equal((await f.status()).jobId, second.jobId);
});

for (const change of [{ status: 'loading' }, { url: 'https://example.com/next' }]) {
  test(`tab navigation ${JSON.stringify(change)} aborts and ignores the old response`, async t => {
    const result = deferred();
    const f = fixture(t, { translate: () => result.promise });
    await f.start();
    await until(() => f.calls.length === 1);
    f.listeners.updated(7, change);
    assert.equal(f.calls[0].signal.aborted, true);
    result.resolve({ translations: [{ id: '1', text: 'Wrong document' }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.messages.some(message => message.action === 'pageApply'), false);
    assert.equal((await f.status()).status, 'idle');
  });
}

test('provider failure reports actual error and retains completed counts for restore', async t => {
  const f = fixture(t, {
    blocks: Array.from({ length: 41 }, (_, i) => ({ id: String(i), text: 'Original' })),
    translate: (request, count) => {
      if (count === 2) throw new Error('HTTP 429 Quota exhausted');
      return { translations: request.blocks.map(block => ({ id: block.id, text: 'Đã dịch' })) };
    }
  });
  await f.start();
  await until(() => f.events.some(event => event.status === 'error'));
  const result = await f.status();
  assert.match(result.message, /HTTP 429 Quota exhausted/);
  assert.equal(result.completed, 40);
  assert.equal(result.applied, 40);
  assert.equal(f.messages.filter(message => message.action === 'pageApply').length, 1);
  assert.equal((await f.action('pageRestore')).status, 'idle');
});

test('missing selected-provider key fails before collection or provider call', async t => {
  const f = fixture(t, { settings: { geminiApiKey: '' } });
  await f.start();
  await until(() => f.events.some(event => event.status === 'error'));
  assert.match((await f.status()).message, /API key/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.injections.length, 0);
});

test('restricted browser and Store pages are rejected before starting', async t => {
  const f = fixture(t);
  for (const url of ['chrome://extensions', 'file:///private.pdf', 'https://chromewebstore.google.com/detail/item', 'https://chrome.google.com/webstore/detail/item']) {
    f.tab.url = url;
    await assert.rejects(f.start(), /HTTP\/HTTPS/);
  }
  assert.equal(f.calls.length, 0);
});

test('pending restore cannot delete or invalidate a newer translation job', async t => {
  const restoreInjection = deferred();
  const old = deferred();
  const next = deferred();
  const f = fixture(t, {
    inject: (_, count) => count === 2 ? restoreInjection.promise : undefined,
    translate: (_, count) => count === 1 ? old.promise : next.promise
  });
  await f.start();
  await until(() => f.calls.length === 1);
  const restore = f.action('pageRestore');
  await until(() => f.injections.length === 2);
  const started = f.start();
  // A controller may serialize these actions or invalidate stale restores.
  restoreInjection.resolve();
  await restore;
  const latest = await started;
  await until(() => f.calls.length === 2);
  next.resolve({ translations: [{ id: '1', text: 'Current translation' }] });
  old.resolve({ translations: [{ id: '1', text: 'Old translation' }] });
  await until(() => f.events.some(event => event.status === 'done' && event.jobId === latest.jobId));
  assert.equal((await f.status()).jobId, latest.jobId);
  assert.equal((await f.status()).applied, 1);
});

test('a new collection waits for an already dispatched restore to finish', async t => {
  const restoreReply = deferred();
  const f = fixture(t, {
    message: message => message.action === 'pageRestore' ? restoreReply.promise : undefined
  });
  await f.start();
  await until(() => f.events.some(event => event.status === 'done'));
  const restoring = f.action('pageRestore');
  await until(() => f.messages.some(message => message.action === 'pageRestore'));
  const newest = await f.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.filter(message => message.action === 'pageCollect').length, 1);
  restoreReply.resolve({ restored: 1 });
  await restoring;
  await until(() => f.events.some(event => event.status === 'done' && event.jobId === newest.jobId));
  assert.equal(f.messages.filter(message => message.action === 'pageCollect').length, 2);
  assert.equal((await f.status()).applied, 1);
});

test('stale DOM session fails explicitly and does not spend quota on remaining batches', async t => {
  const f = fixture(t, {
    blocks: Array.from({ length: 41 }, (_, i) => ({ id: String(i), text: 'Source' })),
    message: message => message.action === 'pageApply' ? { applied: 0, skipped: 40, stale: true } : undefined
  });
  await f.start();
  await until(() => f.events.some(event => event.status === 'error'));
  assert.match((await f.status()).message, /đã thay đổi/);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.status()).completed, 0);
});
