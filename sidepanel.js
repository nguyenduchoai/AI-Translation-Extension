let streamingEl = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await renderHistoryPanel();
  setupSettings();
  setupButtons();
});

// Listen for messages from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'showLoading':
      showLoadingIndicator(message.message);
      sendResponse({ status: 'ok' });
      break;
    case 'streamChunk':
      handleStreamChunk(message.chunk, message.fullText);
      sendResponse({ status: 'ok' });
      break;
    case 'showResult':
      if (message.error) {
        showError(message.error);
      } else {
        showTranslationResult(message.result, message.croppedImage, message.model, message.tokens, message.ocrOnly);
      }
      sendResponse({ status: 'ok' });
      break;
  }
  return true;
});

function setupButtons() {
  document.querySelector('.ai-translator-btn-trash').addEventListener('click', async () => {
    if (confirm('Bạn có chắc muốn xóa toàn bộ lịch sử?')) {
      await chrome.storage.local.set({ translationHistory: [] });
      await renderHistoryPanel();
    }
  });

  document.querySelector('.ai-translator-btn-capture').addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'startCapture' });
    } catch (e) {
      // Background hasn't injected properly
    }
  });

  document.querySelector('.ai-translator-btn-copy').addEventListener('click', () => {
    const translatedEls = document.querySelectorAll('.ai-translator-translated');
    const text = Array.from(translatedEls).map(el => el.textContent).join('\n\n---\n\n');
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector('.ai-translator-btn-copy');
      btn.textContent = '✅';
      setTimeout(() => btn.textContent = '📋', 1500);
    });
  });

  document.querySelector('.ai-translator-btn-save').addEventListener('click', exportFile);
}

function setupSettings() {
  const panel = document.getElementById('settings-panel');
  const btn = document.querySelector('.ai-translator-btn-settings');
  
  btn.addEventListener('click', () => {
    panel.classList.toggle('open');
    btn.classList.toggle('active');
  });
  
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const targetLangSelect = document.getElementById('targetLang');
  const specialtySelect = document.getElementById('specialty');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const statusEl = document.getElementById('status');
  const modeTranslate = document.getElementById('modeTranslate');
  const modeOCR = document.getElementById('modeOCR');

  // Load saved settings
  chrome.storage.sync.get({
    apiKey: '',
    targetLang: 'vi',
    model: 'gpt-4o',
    ocrOnly: false,
    specialty: 'dentistry'
  }).then(saved => {
    apiKeyInput.value = saved.apiKey;
    targetLangSelect.value = saved.targetLang;
    modelSelect.value = saved.model;
    specialtySelect.value = saved.specialty;
    updateModeUI(saved.ocrOnly);
  });

  function updateModeUI(ocrOnly) {
    if (ocrOnly) {
      modeOCR.classList.add('active');
      modeTranslate.classList.remove('active');
    } else {
      modeTranslate.classList.add('active');
      modeOCR.classList.remove('active');
    }
  }

  modeTranslate.addEventListener('click', () => {
    updateModeUI(false);
    chrome.storage.sync.set({ ocrOnly: false });
  });

  modeOCR.addEventListener('click', () => {
    updateModeUI(true);
    chrome.storage.sync.set({ ocrOnly: true });
  });

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

  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('error', '⚠️ Nhập API Key trước khi test');
      return;
    }

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
      specialty: specialtySelect.value,
      ocrOnly: modeOCR.classList.contains('active')
    });

    saveBtn.innerHTML = '<span>✅ Đã lưu!</span>';
    setTimeout(() => {
      saveBtn.innerHTML = '<span>💾 Lưu lại</span>';
      panel.classList.remove('open');
      btn.classList.remove('active');
    }, 1500);

    showStatus('success', '✅ Đã lưu cài đặt!');
  });
}

function showLoadingIndicator(message) {
  streamingEl = null;

  const bodyEl = document.getElementById('result-body');
  
  // Remove empty state if exists
  const emptyEl = bodyEl.querySelector('.ai-translator-empty');
  if (emptyEl) emptyEl.remove();

  // Create streaming container
  const streamContainer = document.createElement('div');
  streamContainer.className = 'ai-translator-streaming';
  streamContainer.innerHTML = `
    <div class="ai-translator-stream-header">
      <span class="ai-translator-stream-indicator"></span>
      <span>${message || 'Đang nhận kết quả...'}</span>
    </div>
    <div class="ai-translator-stream-text"></div>
  `;

  // Insert at top
  if (bodyEl.firstChild) {
    bodyEl.insertBefore(streamContainer, bodyEl.firstChild);
  } else {
    bodyEl.appendChild(streamContainer);
  }

  streamingEl = streamContainer.querySelector('.ai-translator-stream-text');
  bodyEl.scrollTop = 0;
}

function handleStreamChunk(chunk, fullText) {
  if (!streamingEl) {
    showLoadingIndicator('Đang nhận kết quả...');
  }
  
  const headerText = streamingEl.parentElement.querySelector('.ai-translator-stream-header span:last-child');
  if (headerText) headerText.textContent = 'Đang nhận kết quả...';

  // Update text content with proper formatting
  streamingEl.innerHTML = escapeHtml(fullText);
  
  const bodyEl = document.getElementById('result-body');
  bodyEl.scrollTop = 0;
}

function showError(error) {
  streamingEl = null;
  const bodyEl = document.getElementById('result-body');
  
  const errorEl = document.createElement('div');
  errorEl.className = 'ai-translator-error-text';
  errorEl.style.marginBottom = '20px';
  errorEl.innerHTML = escapeHtml(error);
  
  if (bodyEl.firstChild) {
    bodyEl.insertBefore(errorEl, bodyEl.firstChild);
  } else {
    bodyEl.appendChild(errorEl);
  }
}

async function showTranslationResult(result, croppedImage, model, tokens, ocrOnly) {
  streamingEl = null;

  let original = '';
  let translation = '';

  if (result && result.includes('---ORIGINAL---') && result.includes('---TRANSLATION---')) {
    const parts = result.split('---TRANSLATION---');
    original = parts[0].replace('---ORIGINAL---', '').trim();
    translation = parts[1].trim();
  } else {
    translation = result;
  }

  // Save to history
  const data = await chrome.storage.local.get({ translationHistory: [] });
  const history = data.translationHistory;
  history.unshift({
    original, translation,
    id: Date.now(),
    image: croppedImage,
    model: model,
    tokens: tokens,
    ocrOnly: ocrOnly
  });
  if (history.length > 50) history.pop();
  await chrome.storage.local.set({ translationHistory: history });

  await renderHistoryPanel(history);
}

async function renderHistoryPanel(history = null) {
  if (!history) {
    const data = await chrome.storage.local.get({ translationHistory: [] });
    history = data.translationHistory;
  }

  const bodyEl = document.getElementById('result-body');

  if (history.length === 0) {
    bodyEl.innerHTML = `
      <div class="ai-translator-empty">
        <span>🎯</span>
        Nhấn Alt+Q hoặc click chuột phải <br>để quét và dịch màn hình.
      </div>
    `;
    return;
  }

  let html = '';
  history.forEach((item, index) => {
    if (index > 0) {
      html += `<div class="ai-translator-divider"></div>`;
    }
    html += formatTranslation(item);
  });

  bodyEl.innerHTML = html;
  bindCopySectionButtons(bodyEl);
}

function bindCopySectionButtons(container) {
  container.querySelectorAll('.ai-translator-copy-section').forEach(btn => {
    btn.onclick = () => {
      const text = decodeURIComponent(btn.getAttribute('data-text'));
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✅';
        setTimeout(() => btn.textContent = '📋', 1200);
      });
    };
  });
}

function formatTranslation(item) {
  let html = '';

  if (item.model || item.tokens) {
    html += `<div class="ai-translator-meta">`;
    if (item.model) html += `<span class="ai-translator-meta-model">${item.model}</span>`;
    if (item.tokens) html += `<span class="ai-translator-meta-tokens">${item.tokens.total} tokens</span>`;
    if (item.ocrOnly) html += `<span class="ai-translator-meta-mode">OCR</span>`;
    html += `</div>`;
  }

  if (item.image) {
    html += `
      <div class="ai-translator-section ai-translator-img-section">
        <div class="ai-translator-section-header">
          <span class="ai-translator-section-icon">🖼️</span>
          <span>Ảnh gốc</span>
        </div>
        <img src="data:image/png;base64,${item.image}" class="ai-translator-preview-img" />
      </div>
    `;
  }

  if (item.original) {
    html += `
      <div class="ai-translator-section">
        <div class="ai-translator-section-header">
          <span class="ai-translator-section-icon">📄</span>
          <span>Nguyên văn</span>
          <button class="ai-translator-copy-section" data-text="${encodeURIComponent(item.original)}" title="Copy">📋</button>
        </div>
        <div class="ai-translator-section-content ai-translator-original">${escapeHtml(item.original)}</div>
      </div>
    `;
  }

  const label = item.ocrOnly ? 'Trích xuất' : 'Bản dịch';
  const icon = item.ocrOnly ? '📝' : '🇻🇳';
  html += `
    <div class="ai-translator-section">
      <div class="ai-translator-section-header">
        <span class="ai-translator-section-icon">${icon}</span>
        <span>${label}</span>
        <button class="ai-translator-copy-section" data-text="${encodeURIComponent(item.translation)}" title="Copy">📋</button>
      </div>
      <div class="ai-translator-section-content ai-translator-translated">${escapeHtml(item.translation)}</div>
    </div>
  `;

  return html;
}

function exportFile() {
  let output = '=======================================\n';
  output += '  TÀI LIỆU DỊCH — AI Screen Translator\n';
  output += '  Ngày: ' + new Date().toLocaleString('vi-VN') + '\n';
  output += '=======================================\n\n';

  const panel = document.getElementById('result-body');
  if (!panel) return;

  const originals = panel.querySelectorAll('.ai-translator-original');
  const translates = panel.querySelectorAll('.ai-translator-translated');

  if (translates.length === originals.length && originals.length > 0) {
    for (let i = translates.length - 1; i >= 0; i--) {
      output += '[NGUYÊN VĂN]\n' + originals[i].textContent + '\n\n';
      output += '[BẢN DỊCH]\n' + translates[i].textContent + '\n\n';
      output += '--------------------------------------------------\n\n';
    }
  } else {
    for (let i = translates.length - 1; i >= 0; i--) {
      output += translates[i].textContent + '\n\n--------------------------------------------------\n\n';
    }
  }

  const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'TaiLieuDich_' + new Date().toISOString().slice(0, 10) + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const btn = document.querySelector('.ai-translator-btn-save');
  if (btn) {
    btn.textContent = '✅';
    setTimeout(() => btn.textContent = '💾', 1500);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}
