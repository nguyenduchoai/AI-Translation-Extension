// Popup script — settings, test connection, mode toggle, capture trigger

document.addEventListener('DOMContentLoaded', async () => {
  const captureBtn = document.getElementById('captureBtn');
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const targetLangSelect = document.getElementById('targetLang');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const statusEl = document.getElementById('status');
  const modelInfo = document.getElementById('modelInfo');
  const modeTranslate = document.getElementById('modeTranslate');
  const modeOCR = document.getElementById('modeOCR');

  // Model pricing data
  const modelPricing = {
    'gpt-4o': '~$2.50/1M tokens',
    'gpt-4o-mini': '~$0.15/1M tokens',
    'gpt-4.1': '~$2.00/1M tokens',
    'gpt-4.1-mini': '~$0.40/1M tokens'
  };

  // Load saved settings
  const saved = await chrome.storage.sync.get({
    apiKey: '',
    targetLang: 'vi',
    model: 'gpt-4o',
    ocrOnly: false
  });

  apiKeyInput.value = saved.apiKey;
  targetLangSelect.value = saved.targetLang;
  modelSelect.value = saved.model;
  updateModelInfo();
  updateModeUI(saved.ocrOnly);

  // ===== Model info update =====
  modelSelect.addEventListener('change', updateModelInfo);

  function updateModelInfo() {
    const model = modelSelect.value;
    const price = modelPricing[model] || '';
    modelInfo.innerHTML = `<span class="dot"></span><span>${price}</span>`;
  }

  // ===== Mode toggle =====
  modeTranslate.addEventListener('click', () => {
    updateModeUI(false);
    chrome.storage.sync.set({ ocrOnly: false });
  });

  modeOCR.addEventListener('click', () => {
    updateModeUI(true);
    chrome.storage.sync.set({ ocrOnly: true });
  });

  function updateModeUI(ocrOnly) {
    if (ocrOnly) {
      modeOCR.classList.add('active');
      modeTranslate.classList.remove('active');
      captureBtn.querySelector('.icon').textContent = '📝';
      captureBtn.querySelector('.icon + span').textContent = 'Chụp & Trích text';
    } else {
      modeTranslate.classList.add('active');
      modeOCR.classList.remove('active');
      captureBtn.querySelector('.icon').textContent = '📸';
      captureBtn.querySelector('.icon + span').textContent = 'Chụp & Dịch';
    }
  }

  // ===== Test Connection =====
  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('error', '⚠️ Nhập API Key trước khi test');
      return;
    }

    // Show loading state
    testBtn.classList.add('testing');
    showStatus('info', '🔄 Đang kiểm tra kết nối...');

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'testConnection',
        apiKey: apiKey,
        model: modelSelect.value
      });

      if (result.success) {
        showStatus('success', result.message);
      } else {
        showStatus('error', '❌ ' + (result.error || 'Kết nối thất bại'));
      }
    } catch (err) {
      showStatus('error', '❌ Lỗi: ' + err.message);
    } finally {
      testBtn.classList.remove('testing');
    }
  });

  // ===== Save Settings =====
  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('error', '⚠️ Vui lòng nhập API Key');
      return;
    }

    await chrome.storage.sync.set({
      apiKey,
      targetLang: targetLangSelect.value,
      model: modelSelect.value,
      ocrOnly: modeOCR.classList.contains('active')
    });

    saveBtn.classList.add('saved');
    saveBtn.innerHTML = '<span>✅</span><span>Đã lưu!</span>';

    setTimeout(() => {
      saveBtn.classList.remove('saved');
      saveBtn.innerHTML = '<span>💾</span><span>Lưu cài đặt</span>';
    }, 2000);

    showStatus('success', '✅ Đã lưu cài đặt!');
  });

  // ===== Capture =====
  captureBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('error', '⚠️ Nhập API Key trước khi sử dụng');
      return;
    }

    // Save settings first
    await chrome.storage.sync.set({
      apiKey,
      targetLang: targetLangSelect.value,
      model: modelSelect.value,
      ocrOnly: modeOCR.classList.contains('active')
    });

    try {
      await chrome.runtime.sendMessage({ action: 'startCapture' });
    } catch (err) {
      console.error('[Popup] startCapture failed:', err);
    }

    window.close();
  });

  // ===== Status helper =====
  function showStatus(type, message) {
    statusEl.className = 'status ' + type;
    statusEl.innerHTML = message;

    if (type !== 'info') {
      setTimeout(() => {
        statusEl.className = 'status';
        statusEl.innerHTML = '';
      }, 4000);
    }
  }
});
