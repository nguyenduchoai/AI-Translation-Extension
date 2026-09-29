import {
  PROMPT_STORAGE_KEY, PROMPT_DRAFT_KEY, PROMPT_LIMITS, readPromptSettings, normalizePromptSettings, normalizePromptDraft,
  listPromptTemplates, getSelectedPrompt, changePromptSettings
} from './prompt-templates.js';

/** Independent prompt editor: saving a template never requires an API key. */
export async function setupPromptTemplateEditor(panel, before) {
  const create = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const section = create('section');
  section.id = 'prompt-template-editor';
  section.append(create('div', '📝 Mẫu prompt', 'section-title'));
  const field = (labelText, tag, id) => {
    const group = create('div', '', 'form-group');
    const label = create('label', labelText, 'form-label');
    label.htmlFor = id;
    const input = create(tag, '', tag === 'select' ? 'form-select' : 'form-input');
    input.id = id;
    group.append(label, input);
    section.append(group);
    return input;
  };
  const mode = field('Loại mẫu (lưu riêng cho từng chế độ)', 'select', 'prompt-kind');
  mode.append(new Option('Dịch ảnh / trang web', 'translation'), new Option('OCR · chỉ trích nguyên văn', 'ocr'));
  const select = field('Mẫu đang áp dụng', 'select', 'prompt-select');
  const name = field('Tên mẫu', 'input', 'prompt-name');
  name.maxLength = PROMPT_LIMITS.name;
  const body = field('Chỉ dẫn bổ sung', 'textarea', 'prompt-body');
  body.rows = 5;
  body.maxLength = PROMPT_LIMITS.body;
  body.style.resize = 'vertical';
  body.placeholder = 'Để trống để giữ prompt mặc định theo chuyên ngành.';
  const hint = create('p', 'Mẫu chỉ bổ sung cách diễn đạt; luôn giữ dữ kiện gốc. OCR vẫn không dịch. Có thể dùng {{targetLanguage}} và {{specialty}} trong mẫu dịch. Chọn mẫu áp dụng ngay, không cần Lưu API.', 'form-label');
  section.append(hint);
  const buttons = create('div', '', 'btn-row');
  buttons.style.flexWrap = 'wrap';
  const button = (label, id) => {
    const node = create('button', label, 'test-btn');
    node.type = 'button';
    node.id = id;
    buttons.append(node);
    return node;
  };
  const save = button('Lưu thay đổi', 'prompt-save');
  const clone = button('Lưu thành mẫu mới', 'prompt-clone');
  const remove = button('Xóa mẫu', 'prompt-delete');
  const revert = button('Bỏ sửa', 'prompt-revert');
  const status = create('div', '', 'status');
  status.id = 'prompt-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  section.append(buttons, status);
  panel.insertBefore(section, before);

  let state = normalizePromptSettings();
  let kind = 'translation';
  let busy = false;
  let draftWrite = Promise.resolve();
  const selected = () => getSelectedPrompt(state, kind);
  const dirty = () => name.value !== selected().name || body.value !== selected().body;
  const show = (message, type = 'info') => {
    status.textContent = message;
    status.className = `status ${type}`;
  };
  const refreshButtons = () => {
    const builtin = !selected().id.startsWith('custom-');
    save.disabled = busy || builtin || !dirty();
    clone.disabled = busy;
    remove.disabled = busy || builtin;
    revert.disabled = busy || !dirty();
  };
  const render = () => {
    mode.value = kind;
    select.replaceChildren(...listPromptTemplates(state, kind)
      .map(template => new Option(template.name, template.id)));
    select.value = state.selected[kind];
    name.value = selected().name;
    body.value = selected().body;
    refreshButtons();
  };
  const guardDraft = () => {
    if (!dirty()) return true;
    show('Mẫu đang sửa chưa được lưu. Hãy Lưu thay đổi / Lưu thành mẫu mới hoặc Bỏ sửa trước khi chuyển hay xóa mẫu.', 'error');
    return false;
  };
  const controls = [mode, select, name, body, save, clone, remove, revert];
  function storeDraft(value) {
    const write = draftWrite.then(() => chrome.storage.local.set({ [PROMPT_DRAFT_KEY]: value }));
    draftWrite = write.catch(error => show(`Không giữ được bản sửa: ${error.message}. Hãy lưu mẫu trước khi đóng panel.`, 'error'));
    return write;
  }
  async function persist(action, message) {
    try {
      busy = true;
      controls.forEach(control => { control.disabled = true; });
      const next = changePromptSettings(state, action);
      await draftWrite;
      await chrome.storage.local.set({ [PROMPT_STORAGE_KEY]: next, [PROMPT_DRAFT_KEY]: null });
      state = next;
      render();
      show(message, 'success');
    } catch (error) {
      select.value = state.selected[kind];
      show(`Không lưu được mẫu: ${error.message}`, 'error');
    } finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
      refreshButtons();
    }
  }
  mode.addEventListener('change', () => {
    if (!guardDraft()) { mode.value = kind; return; }
    kind = mode.value;
    render();
    show('Mẫu dịch và OCR được chọn độc lập.');
  });
  select.addEventListener('change', () => {
    if (!guardDraft()) { select.value = state.selected[kind]; return; }
    void persist({ type: 'select', kind, id: select.value }, 'Đã áp dụng mẫu cho lần xử lý tiếp theo.');
  });
  for (const input of [name, body]) input.addEventListener('input', () => {
    refreshButtons();
    void storeDraft(dirty() ? { kind, id: selected().id, name: name.value, body: body.value } : null).catch(() => {});
    show(selected().id.startsWith('custom-')
      ? 'Có thay đổi chưa lưu.' : 'Mẫu có sẵn được giữ nguyên. Chọn Lưu thành mẫu mới để lưu bản chỉnh sửa.');
  });
  save.addEventListener('click', () => void persist({
    type: 'save', kind, id: selected().id, name: name.value, body: body.value
  }, 'Đã cập nhật và áp dụng mẫu.'));
  clone.addEventListener('click', () => {
    // An unchanged clone gets a unique display name without mutating the builtin.
    let newName = name.value;
    if (newName === selected().name) {
      const names = new Set(listPromptTemplates(state, kind).map(template => template.name.toLocaleLowerCase()));
      let number = 1;
      do { newName = `${name.value.slice(0, 65)} · bản ${number++}`; }
      while (names.has(newName.toLocaleLowerCase()));
    }
    void persist({ type: 'save', kind, id: `custom-${crypto.randomUUID()}`, name: newName, body: body.value }, 'Đã tạo và áp dụng mẫu riêng.');
  });
  remove.addEventListener('click', () => {
    if (guardDraft()) void persist({ type: 'delete', kind, id: selected().id }, 'Đã xóa mẫu riêng; trở về mẫu mặc định.');
  });
  revert.addEventListener('click', async () => {
    busy = true;
    controls.forEach(control => { control.disabled = true; });
    try {
      await storeDraft(null);
      render();
      show('Đã bỏ bản sửa, giữ nội dung được lưu trước đó.');
    } catch { /* Preserve the visible draft if clearing it failed. */ }
    finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
      refreshButtons();
    }
  });
  render();
  controls.forEach(control => { control.disabled = true; });
  try {
    const [savedState, savedDraft] = await Promise.all([readPromptSettings(), chrome.storage.local.get(PROMPT_DRAFT_KEY)]);
    state = savedState;
    const draft = normalizePromptDraft(savedDraft[PROMPT_DRAFT_KEY], state);
    if (draft) { kind = draft.kind; state.selected[kind] = draft.id; }
    controls.forEach(control => { control.disabled = false; });
    render();
    if (draft) {
      name.value = draft.name;
      body.value = draft.body;
      refreshButtons();
      show('Đã khôi phục bản sửa chưa lưu. Chọn Lưu thay đổi / Lưu thành mẫu mới để áp dụng, hoặc Bỏ sửa.');
    }
  } catch (error) {
    show(`Không đọc được mẫu đã lưu: ${error.message}. Đóng rồi mở lại side panel để thử lại.`, 'error');
  }
  // Drafts survive side-panel closure; selected prompts change only on explicit save.
  return { hasUnsavedChanges: dirty };
}
