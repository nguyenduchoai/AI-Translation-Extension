import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPromptTemplateEditor } from '../lib/prompt-template-editor.js';
import { PROMPT_STORAGE_KEY, PROMPT_DRAFT_KEY } from '../lib/prompt-templates.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.style = {}; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  insertBefore(child) { this.children.push(child); }
  setAttribute() {}
  addEventListener(name, handler) { this.events[name] = handler; }
  async fire(event) {
    if (this.disabled) return;
    await this.events[event]?.();
    await new Promise(resolve => setImmediate(resolve));
  }
  find(id) { return this.id === id ? this : this.children.map(child => child.find(id)).find(Boolean); }
}

async function environment(run) {
  const saved = { document: globalThis.document, Option: globalThis.Option, chrome: globalThis.chrome };
  const data = {};
  let fail = false;
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.Option = class extends Element {
    constructor(text, value) { super('option'); this.textContent = text; this.value = value; }
  };
  globalThis.chrome = { storage: { local: {
    async get(key) { return { [key]: data[key] }; },
    async set(values) { if (fail) throw new Error('storage unavailable'); Object.assign(data, structuredClone(values)); }
  } } };
  const mount = async () => {
    const panel = new Element('div');
    await setupPromptTemplateEditor(panel, null);
    return id => panel.find(`prompt-${id}`);
  };
  try { await run({ data, mount, failStorage: value => { fail = value; } }); }
  finally { Object.assign(globalThis, saved); }
}

test('dirty draft survives destroyed panel, blocks switching and saves without API credentials', async () => {
  await environment(async ({ data, mount }) => {
    let get = await mount();
    get('name').value = 'Giọng văn riêng';
    get('body').value = 'Keep {{targetLanguage}} natural.';
    await get('body').fire('input');
    assert.equal(data[PROMPT_DRAFT_KEY].name, 'Giọng văn riêng');
    get('select').value = 'academic';
    await get('select').fire('change');
    assert.equal(get('select').value, 'faithful');
    assert.match(get('status').textContent, /chưa được lưu/);
    get = await mount(); // Actual side-panel closure discards the old DOM.
    assert.equal(get('body').value, 'Keep {{targetLanguage}} natural.');
    assert.match(get('status').textContent, /khôi phục bản sửa/);
    await get('clone').fire('click');
    assert.equal(data[PROMPT_DRAFT_KEY], null);
    assert.equal(data[PROMPT_STORAGE_KEY].templates.length, 1);
    assert.equal(data[PROMPT_STORAGE_KEY].templates[0].name, 'Giọng văn riêng');
    get('kind').value = 'ocr';
    await get('kind').fire('change');
    get('select').value = 'ocr-layout';
    await get('select').fire('change');
    assert.equal(data[PROMPT_STORAGE_KEY].selected.ocr, 'ocr-layout');
    assert.match(data[PROMPT_STORAGE_KEY].selected.translation, /^custom-/);
  });
});

test('failed update/revert keeps visible draft and successful revert clears persisted recovery', async () => {
  await environment(async ({ data, mount, failStorage }) => {
    const get = await mount();
    await get('clone').fire('click');
    const original = get('body').value;
    get('body').value = 'Modified draft';
    await get('body').fire('input');
    failStorage(true);
    await get('save').fire('click');
    assert.equal(get('body').value, 'Modified draft');
    assert.equal(data[PROMPT_STORAGE_KEY].templates[0].body, original);
    assert.match(get('status').textContent, /Không lưu được/);
    await get('revert').fire('click');
    assert.equal(get('body').value, 'Modified draft');
    failStorage(false);
    await get('revert').fire('click');
    assert.equal(get('body').value, original);
    assert.equal(data[PROMPT_DRAFT_KEY], null);
    await get('delete').fire('click');
    assert.equal(data[PROMPT_STORAGE_KEY].templates.length, 0);
    assert.equal(get('select').value, 'faithful');
  });
});
