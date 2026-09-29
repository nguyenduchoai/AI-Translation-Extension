import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TEMPLATES, PROMPT_STORAGE_KEY, PROMPT_LIMITS, normalizePromptSettings,
  changePromptSettings, getSelectedPrompt, readPromptSettings, loadPromptSettings
} from '../lib/prompt-templates.js';

const save = (state, values = {}) => changePromptSettings(state, {
  type: 'save', kind: 'translation', id: 'custom-dental', name: 'Nha khoa của tôi', body: 'Giữ thuật ngữ.', ...values
});

test('legacy install gets original prompts with independent translation/OCR defaults', async () => {
  const storage = { async get(key) { assert.equal(key, PROMPT_STORAGE_KEY); return {}; } };
  const state = await readPromptSettings(storage);
  assert.equal(getSelectedPrompt(state, 'translation').body, '');
  assert.equal(getSelectedPrompt(state, 'ocr').body, '');
  const before = globalThis.chrome;
  globalThis.chrome = { storage: { local: storage } };
  try { assert.deepEqual(await loadPromptSettings(), { customInstruction: '', promptLabel: 'Sát nghĩa · theo chuyên ngành' }); }
  finally { globalThis.chrome = before; }
});

test('create, update, select and delete are immutable and isolate modes', () => {
  const original = normalizePromptSettings();
  const created = save(original);
  assert.equal(original.templates.length, 0);
  assert.equal(created.selected.translation, 'custom-dental');
  assert.equal(created.selected.ocr, 'verbatim');
  const updated = save(created, { body: 'Câu rõ ràng.' });
  assert.equal(updated.templates.length, 1);
  assert.equal(created.templates[0].body, 'Giữ thuật ngữ.');
  assert.equal(updated.templates[0].body, 'Câu rõ ràng.');
  const ocr = save(updated, { kind: 'ocr', id: 'custom-ocr', name: 'Bảng OCR' });
  assert.equal(ocr.selected.translation, 'custom-dental');
  assert.equal(ocr.selected.ocr, 'custom-ocr');
  const removed = changePromptSettings(ocr, { type: 'delete', kind: 'translation', id: 'custom-dental' });
  assert.equal(removed.selected.translation, 'faithful');
  assert.equal(removed.selected.ocr, 'custom-ocr');
  assert.equal(removed.templates.length, 1);
});

test('builtins can be cloned but never overwritten/deleted or selected in wrong mode', () => {
  const natural = BUILTIN_TEMPLATES.find(template => template.id === 'natural');
  const cloned = save(undefined, { name: natural.name, body: natural.body });
  assert.equal(cloned.templates[0].body, natural.body);
  assert.throws(() => save(cloned, { id: 'natural' }), /mẫu riêng/);
  assert.throws(() => changePromptSettings(cloned, { type: 'delete', kind: 'translation', id: 'natural' }), /mẫu riêng/);
  assert.throws(() => changePromptSettings(cloned, { type: 'select', kind: 'ocr', id: 'natural' }), /Không tìm thấy/);
  assert.throws(() => save(cloned, { kind: 'ocr' }), /đổi loại/);
});

test('validation bounds content, count, names and IDs; duplicate names do not replace records', () => {
  assert.throws(() => save(undefined, { name: ' ' }), /Tên mẫu/);
  assert.throws(() => save(undefined, { name: 'x'.repeat(PROMPT_LIMITS.name + 1) }), /Tên mẫu/);
  assert.throws(() => save(undefined, { body: 'x'.repeat(PROMPT_LIMITS.body + 1) }), /Nội dung/);
  assert.throws(() => save(undefined, { id: '__proto__' }), /mẫu riêng/);
  const first = save();
  assert.throws(() => save(first, { id: 'custom-other', name: 'NHA KHOA CỦA TÔI' }), /đã tồn tại/);
  let full;
  for (let i = 0; i < PROMPT_LIMITS.count; i++) full = save(full, { id: `custom-${i}`, name: `Mẫu ${i}` });
  assert.throws(() => save(full), /Đã đủ/);
  assert.equal(save(full, { id: 'custom-0', name: 'Đã đổi' }).templates.length, PROMPT_LIMITS.count);
});

test('damaged storage cannot inject builtins, cross-mode choices, duplicates or oversized text', () => {
  const valid = { id: 'custom-ok', kind: 'ocr', name: 'OCR riêng', body: '<script>alert(1)</script>' };
  const raw = {
    version: 1, selected: { translation: 'custom-ok', ocr: 'custom-ok' },
    templates: [null, { ...valid, id: 'faithful' }, { ...valid, id: 'custom-long', body: 'a'.repeat(4001) }, valid, valid]
  };
  const clean = normalizePromptSettings(raw);
  assert.equal(clean.templates.length, 1);
  // Plain text is allowed, never evaluated or inserted as HTML by the editor.
  assert.equal(clean.templates[0].body, valid.body);
  assert.equal(clean.selected.translation, 'faithful');
  assert.equal(clean.selected.ocr, 'custom-ok');
  assert.equal(normalizePromptSettings({ ...raw, version: 900 }).templates.length, 0);
});
