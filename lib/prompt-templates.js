/** Local prompt preferences never replace the translator's accuracy/OCR rules. */
export const PROMPT_STORAGE_KEY = 'promptTemplatesV1';
export const PROMPT_DRAFT_KEY = 'promptTemplateDraftV1';
export const PROMPT_LIMITS = Object.freeze({ count: 20, name: 80, body: 4000 });
export const BUILTIN_TEMPLATES = Object.freeze([
  Object.freeze({ id: 'faithful', kind: 'translation', name: 'Sát nghĩa · theo chuyên ngành', body: '' }),
  Object.freeze({ id: 'natural', kind: 'translation', name: 'Tự nhiên · dễ đọc', body: 'Use fluent, natural phrasing in {{targetLanguage}} while preserving every source detail and its degree of certainty. Do not simplify away specialist distinctions, summarize or add explanations.' }),
  Object.freeze({ id: 'academic', kind: 'translation', name: 'Học thuật · nhất quán thuật ngữ', body: 'Use a formal academic register in {{targetLanguage}} and consistent established terminology for {{specialty}}. Preserve the reasoning, citation markers, definitions and distinctions in the source without adding commentary.' }),
  Object.freeze({ id: 'verbatim', kind: 'ocr', name: 'OCR · nguyên văn', body: '' }),
  Object.freeze({ id: 'ocr-layout', kind: 'ocr', name: 'OCR · giữ bố cục', body: 'Pay special attention to reading order, headings, list indentation and table row/column relationships. Preserve the original wording and language exactly; do not translate or correct the source.' })
]);

const defaultId = kind => kind === 'ocr' ? 'verbatim' : 'faithful';
const isKind = kind => kind === 'translation' || kind === 'ocr';
const validId = id => typeof id === 'string' && /^custom-[a-zA-Z0-9-]{1,64}$/.test(id);

function validateFields({ name, body, kind }) {
  if (!isKind(kind)) throw new Error('Loại mẫu prompt không hợp lệ.');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > PROMPT_LIMITS.name) {
    throw new Error(`Tên mẫu cần từ 1 đến ${PROMPT_LIMITS.name} ký tự.`);
  }
  if (typeof body !== 'string' || body.length > PROMPT_LIMITS.body) {
    throw new Error(`Nội dung mẫu tối đa ${PROMPT_LIMITS.body} ký tự.`);
  }
  return { name: name.trim(), body: body.trim(), kind };
}

/** Defensive read: corrupt/unknown records fall back to the original safe prompt. */
export function normalizePromptSettings(raw) {
  const state = { version: 1, templates: [], selected: { translation: 'faithful', ocr: 'verbatim' } };
  if (!raw || raw.version !== 1) return state;
  const seen = new Set();
  for (const candidate of (Array.isArray(raw.templates) ? raw.templates : []).slice(0, PROMPT_LIMITS.count)) {
    try {
      if (!candidate || !validId(candidate.id) || seen.has(candidate.id)) continue;
      const fields = validateFields(candidate);
      state.templates.push({ id: candidate.id, ...fields });
      seen.add(candidate.id);
    } catch { /* Ignore damaged entries, never run content as code. */ }
  }
  for (const kind of ['translation', 'ocr']) {
    if (listPromptTemplates(state, kind).some(template => template.id === raw.selected?.[kind])) {
      state.selected[kind] = raw.selected[kind];
    }
  }
  return state;
}

export function listPromptTemplates(state, kind) {
  return [...BUILTIN_TEMPLATES, ...state.templates].filter(template => template.kind === kind);
}

export function getSelectedPrompt(state, kind) {
  return listPromptTemplates(state, kind).find(template => template.id === state.selected[kind])
    || BUILTIN_TEMPLATES.find(template => template.id === defaultId(kind));
}

/** Pure mutations make bounds, kind isolation and builtin immutability testable. */
export function changePromptSettings(raw, action) {
  const state = normalizePromptSettings(raw);
  const kind = action.kind;
  if (!isKind(kind)) throw new Error('Loại mẫu prompt không hợp lệ.');
  if (action.type === 'select') {
    if (!listPromptTemplates(state, kind).some(template => template.id === action.id)) {
      throw new Error('Không tìm thấy mẫu prompt.');
    }
    state.selected[kind] = action.id;
  } else if (action.type === 'save') {
    const fields = validateFields(action);
    if (!validId(action.id)) throw new Error('Chỉ có thể lưu thay đổi vào mẫu riêng.');
    const existing = state.templates.find(template => template.id === action.id);
    if (existing && existing.kind !== kind) throw new Error('Không thể đổi loại mẫu đã lưu.');
    if (!existing && state.templates.length >= PROMPT_LIMITS.count) {
      throw new Error(`Đã đủ ${PROMPT_LIMITS.count} mẫu riêng. Hãy xóa một mẫu trước khi tạo thêm.`);
    }
    if (state.templates.some(template => template.id !== action.id && template.kind === kind
      && template.name.toLocaleLowerCase() === fields.name.toLocaleLowerCase())) {
      throw new Error('Tên mẫu đã tồn tại trong chế độ này. Hãy chọn tên khác.');
    }
    state.templates = state.templates.filter(template => template.id !== action.id);
    state.templates.push({ id: action.id, ...fields });
    state.selected[kind] = action.id;
  } else if (action.type === 'delete') {
    if (!state.templates.some(template => template.kind === kind && template.id === action.id)) {
      throw new Error('Chỉ có thể xóa mẫu riêng.');
    }
    state.templates = state.templates.filter(template => template.id !== action.id);
    if (state.selected[kind] === action.id) state.selected[kind] = defaultId(kind);
  } else {
    throw new Error('Thao tác mẫu prompt không hợp lệ.');
  }
  return state;
}

export async function readPromptSettings(storage = chrome.storage.local) {
  const saved = await storage.get(PROMPT_STORAGE_KEY);
  return normalizePromptSettings(saved[PROMPT_STORAGE_KEY]);
}

export async function loadPromptSettings(ocrOnly = false) {
  const state = await readPromptSettings();
  const selected = getSelectedPrompt(state, ocrOnly ? 'ocr' : 'translation');
  return { customInstruction: selected.body, promptLabel: selected.name };
}

/** A partial draft may have an empty name while the user is editing. */
export function normalizePromptDraft(raw, state) {
  if (!raw || !isKind(raw.kind) || typeof raw.name !== 'string' || typeof raw.body !== 'string'
    || raw.name.length > PROMPT_LIMITS.name || raw.body.length > PROMPT_LIMITS.body
    || !listPromptTemplates(state, raw.kind).some(template => template.id === raw.id)) return null;
  return { kind: raw.kind, id: raw.id, name: raw.name, body: raw.body };
}
