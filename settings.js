const PROVIDERS = {
  openai: {
    name: 'OpenAI', key: 'apiKey', model: 'model', defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini'], placeholder: 'sk-...',
    url: 'https://platform.openai.com/api-keys', host: 'platform.openai.com'
  },
  gemini: {
    name: 'Gemini', key: 'geminiApiKey', model: 'geminiModel', defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'], placeholder: 'AIza...',
    url: 'https://aistudio.google.com/apikey', host: 'Google AI Studio'
  }
};

export async function setupSettings() {
  const byId = id => document.getElementById(id);
  const panel = byId('settings-panel');
  const toggle = document.querySelector('.ai-translator-btn-settings');
  const providerSelect = byId('provider');
  const apiKeyInput = byId('apiKey');
  const modelSelect = byId('model');
  const customModel = byId('customModel');
  const targetLang = byId('targetLang');
  const specialty = byId('specialty');
  const saveBtn = byId('saveBtn');
  const testBtn = byId('testBtn');
  const status = byId('status');
  let provider = 'openai';
  let ocrOnly = false;
  const drafts = { openai: {}, gemini: {} };

  toggle.addEventListener('click', () => {
    panel.classList.toggle('open');
    toggle.classList.toggle('active');
  });

  const showStatus = (type, message) => {
    status.className = `status ${type}`;
    status.textContent = message;
  };
  const selectedModel = () => modelSelect.value === 'custom'
    ? customModel.value.trim() : modelSelect.value;
  const stashDraft = () => {
    drafts[provider] = { apiKey: apiKeyInput.value.trim(), model: selectedModel() };
  };
  const updateCustomModel = () => {
    byId('customModelGroup').hidden = modelSelect.value !== 'custom';
  };
  const renderProvider = () => {
    const config = PROVIDERS[provider];
    const draft = drafts[provider];
    providerSelect.value = provider;
    apiKeyInput.value = draft.apiKey || '';
    apiKeyInput.placeholder = config.placeholder;
    byId('apiKeyLabel').textContent = `${config.name} API Key`;
    byId('apiKeyLink').href = config.url;
    byId('apiKeyLink').textContent = config.host;
    modelSelect.replaceChildren(...config.models.map(model => new Option(model, model)),
      new Option('Model khác…', 'custom'));
    const model = draft.model || config.defaultModel;
    modelSelect.value = config.models.includes(model) ? model : 'custom';
    customModel.value = modelSelect.value === 'custom' ? model : '';
    updateCustomModel();
    showStatus('', '');
  };
  const updateMode = value => {
    ocrOnly = value;
    byId('modeTranslate').classList.toggle('active', !value);
    byId('modeOCR').classList.toggle('active', value);
    byId('modeTranslate').setAttribute('aria-pressed', String(!value));
    byId('modeOCR').setAttribute('aria-pressed', String(value));
    specialty.disabled = value;
    targetLang.disabled = value;
  };

  // Retain the previous OpenAI fields so upgrading does not lose saved credentials.
  try {
    const saved = await chrome.storage.sync.get({
      provider: 'openai', apiKey: '', model: 'gpt-4o', geminiApiKey: '',
      geminiModel: 'gemini-3.8-flash', targetLang: 'vi', specialty: 'dentistry', ocrOnly: false
    });
    for (const [name, config] of Object.entries(PROVIDERS)) {
      drafts[name] = { apiKey: saved[config.key], model: saved[config.model] };
    }
    provider = Object.hasOwn(PROVIDERS, saved.provider) ? saved.provider : 'openai';
    targetLang.value = saved.targetLang;
    specialty.value = saved.specialty;
    updateMode(saved.ocrOnly);
    renderProvider();
  } catch (error) {
    showStatus('error', `Không đọc được cài đặt: ${error.message}`);
  }

  providerSelect.addEventListener('change', () => {
    stashDraft();
    provider = providerSelect.value;
    renderProvider();
  });
  modelSelect.addEventListener('change', updateCustomModel);
  for (const [id, value] of [['modeTranslate', false], ['modeOCR', true]]) {
    byId(id).addEventListener('click', () => updateMode(value));
  }

  function validate() {
    if (!apiKeyInput.value.trim()) throw new Error('Vui lòng nhập API Key');
    if (!selectedModel()) throw new Error('Vui lòng nhập mã model hỗ trợ đọc ảnh');
  }

  testBtn.addEventListener('click', async () => {
    try {
      validate();
      testBtn.disabled = true;
      // Keep the visible credentials aligned with the request being tested.
      for (const input of [providerSelect, apiKeyInput, modelSelect, customModel, saveBtn]) input.disabled = true;
      testBtn.classList.add('testing');
      showStatus('info', 'Đang kiểm tra kết nối…');
      const result = await chrome.runtime.sendMessage({
        action: 'testConnection', provider, apiKey: apiKeyInput.value.trim(), model: selectedModel()
      });
      if (!result?.success) throw new Error(result?.error || 'Kết nối thất bại');
      showStatus('success', result.message);
    } catch (error) {
      showStatus('error', error.message);
    } finally {
      testBtn.disabled = false;
      for (const input of [providerSelect, apiKeyInput, modelSelect, customModel, saveBtn]) input.disabled = false;
      testBtn.classList.remove('testing');
    }
  });

  saveBtn.addEventListener('click', async () => {
    try {
      validate();
      stashDraft();
      const values = { provider, targetLang: targetLang.value, specialty: specialty.value, ocrOnly };
      for (const [name, config] of Object.entries(PROVIDERS)) {
        values[config.key] = drafts[name].apiKey || '';
        values[config.model] = drafts[name].model || config.defaultModel;
      }
      await chrome.storage.sync.set(values);
      showStatus('success', `Đã lưu ${PROVIDERS[provider].name} · ${selectedModel()}`);
    } catch (error) {
      showStatus('error', `Không lưu được: ${error.message}`);
    }
  });
}
