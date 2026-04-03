// Content script - handles screen region selection, streaming display, result panel

(function () {
  if (window.__aiTranslatorInjected) {
    console.log('[AI Translator] Re-injection, refreshing listeners');
  }
  window.__aiTranslatorInjected = true;

  let isSelecting = false;
  let startX, startY;
  let overlay, selectionBox, resultPanel;
  let originalBodyPadding = '';
  let streamingEl = null;

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'startSelection':
        enterSelectionMode();
        sendResponse({ status: 'ok' });
        break;
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

  // ======================================
  // Selection Mode
  // ======================================
  function enterSelectionMode() {
    cleanup();

    overlay = document.createElement('div');
    overlay.id = 'ai-translator-overlay';
    overlay.innerHTML = `
      <div class="ai-translator-hint">
        <div class="ai-translator-hint-icon">🎯</div>
        <div class="ai-translator-hint-text">Kéo chuột để chọn vùng cần dịch</div>
        <div class="ai-translator-hint-sub">Nhấn <kbd>ESC</kbd> để hủy</div>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    selectionBox = document.createElement('div');
    selectionBox.id = 'ai-translator-selection';
    document.documentElement.appendChild(selectionBox);

    overlay.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    document.body.style.cursor = 'crosshair';
  }

  function onMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';

    const hint = overlay.querySelector('.ai-translator-hint');
    if (hint) hint.style.opacity = '0';

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!isSelecting) return;
    e.preventDefault();
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    selectionBox.style.left = x + 'px';
    selectionBox.style.top = y + 'px';
    selectionBox.style.width = w + 'px';
    selectionBox.style.height = h + 'px';
    selectionBox.setAttribute('data-dimensions', `${w} × ${h}`);
  }

  function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    if (w < 20 || h < 20) { cleanup(); return; }

    if (overlay) overlay.style.display = 'none';
    document.body.style.cursor = '';
    selectionBox.style.display = 'none';

    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'captureAndTranslate',
        rect: {
          x, y, width: w, height: h,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        }
      }).catch(err => {
        showError('❌ Lỗi kết nối. Reload extension tại chrome://extensions');
      });

      showLoadingAtPosition(x, y, w, h);
    }, 100);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') cleanup();
  }

  // ======================================
  // Loading
  // ======================================
  function showLoadingAtPosition(x, y, w, h) {
    cleanup(true);
    const loader = document.createElement('div');
    loader.id = 'ai-translator-loader';
    loader.style.left = x + 'px';
    loader.style.top = y + 'px';
    loader.style.width = w + 'px';
    loader.style.height = h + 'px';
    loader.innerHTML = `
      <div class="ai-translator-loader-content">
        <div class="ai-translator-spinner"></div>
        <div class="ai-translator-loader-text">Đang xử lý...</div>
      </div>
    `;
    document.documentElement.appendChild(loader);
  }

  function showLoadingIndicator(message) {
    const loader = document.getElementById('ai-translator-loader');
    if (loader) {
      const textEl = loader.querySelector('.ai-translator-loader-text');
      if (textEl) textEl.textContent = message || 'Đang xử lý...';
    }
  }

  // ======================================
  // Streaming
  // ======================================
  function handleStreamChunk(chunk, fullText) {
    removeLoader();
    ensureResultPanel();

    if (!streamingEl) {
      // Create streaming container inside result body
      const bodyEl = document.querySelector('#ai-translator-result .ai-translator-result-body');
      if (!bodyEl) return;

      // Clear loading state
      const existingStream = bodyEl.querySelector('.ai-translator-streaming');
      if (existingStream) {
        streamingEl = existingStream.querySelector('.ai-translator-stream-text');
        if (streamingEl) {
          streamingEl.textContent = fullText;
          return;
        }
      }

      const streamContainer = document.createElement('div');
      streamContainer.className = 'ai-translator-streaming';
      streamContainer.innerHTML = `
        <div class="ai-translator-stream-header">
          <span class="ai-translator-stream-indicator"></span>
          <span>Đang nhận kết quả...</span>
        </div>
        <div class="ai-translator-stream-text"></div>
      `;

      // Insert at top of body
      if (bodyEl.firstChild) {
        bodyEl.insertBefore(streamContainer, bodyEl.firstChild);
      } else {
        bodyEl.appendChild(streamContainer);
      }

      streamingEl = streamContainer.querySelector('.ai-translator-stream-text');
    }

    // Update text content with proper formatting
    streamingEl.innerHTML = escapeHtml(fullText);

    // Auto-scroll to bottom of streaming element
    const bodyEl = document.querySelector('#ai-translator-result .ai-translator-result-body');
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  // ======================================
  // Results
  // ======================================
  function showError(error) {
    removeLoader();
    streamingEl = null;
    showResultPanel(error, true);
  }

  async function showTranslationResult(result, croppedImage, model, tokens, ocrOnly) {
    removeLoader();
    streamingEl = null;

    let original = '';
    let translation = '';

    if (result.includes('---ORIGINAL---') && result.includes('---TRANSLATION---')) {
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

    await renderHistoryPanel(false, history);
  }

  async function renderHistoryPanel(isError, history = null) {
    if (isError) {
      showResultPanel(history, true);
      return;
    }

    if (!history) {
      const data = await chrome.storage.local.get({ translationHistory: [] });
      history = data.translationHistory;
    }

    if (history.length === 0) return;

    let html = '';
    history.forEach((item, index) => {
      if (index > 0) {
        html += `<div class="ai-translator-divider"></div>`;
      }
      html += formatTranslation(item);
    });

    showResultPanel(html, false);
  }

  function formatTranslation(item) {
    let html = '';

    // Meta info bar
    if (item.model || item.tokens) {
      html += `<div class="ai-translator-meta">`;
      if (item.model) html += `<span class="ai-translator-meta-model">${item.model}</span>`;
      if (item.tokens) html += `<span class="ai-translator-meta-tokens">${item.tokens.total} tokens</span>`;
      if (item.ocrOnly) html += `<span class="ai-translator-meta-mode">OCR</span>`;
      html += `</div>`;
    }

    // Cropped image preview
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

    // Original text
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

    // Translation / OCR result
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

  // ======================================
  // Result Panel
  // ======================================
  function ensureResultPanel() {
    if (document.getElementById('ai-translator-result')) return;
    showResultPanel('', false, true);
  }

  function showResultPanel(content, isError, isStreaming) {
    const existing = document.getElementById('ai-translator-result');
    if (existing && !isStreaming) {
      const bodyEl = existing.querySelector('.ai-translator-result-body');
      if (isError) {
        bodyEl.innerHTML = `<div class="ai-translator-error-text">${escapeHtml(content)}</div>`;
        existing.classList.add('ai-translator-error');
      } else {
        existing.classList.remove('ai-translator-error');
        bodyEl.innerHTML = content;
        bodyEl.scrollTop = 0;
      }
      bindCopySectionButtons(existing);
      return;
    }

    if (existing) return; // Already showing streaming

    resultPanel = document.createElement('div');
    resultPanel.id = 'ai-translator-result';
    if (isError) resultPanel.classList.add('ai-translator-error');

    resultPanel.innerHTML = `
      <div class="ai-translator-result-header">
        <div class="ai-translator-result-title">
          <span class="ai-translator-logo">🌐</span>
          <span>AI Translator</span>
        </div>
        <div class="ai-translator-result-actions">
          <button class="ai-translator-btn ai-translator-btn-save" title="Lưu File (.txt)">💾</button>
          <button class="ai-translator-btn ai-translator-btn-copy" title="Copy tất cả">📋</button>
          <button class="ai-translator-btn ai-translator-btn-trash" title="Xóa lịch sử">🗑️</button>
          <button class="ai-translator-btn ai-translator-btn-again" title="Chụp lại">🔄</button>
          <button class="ai-translator-btn ai-translator-btn-close" title="Đóng">✕</button>
        </div>
      </div>
      <div class="ai-translator-result-body">
        ${isError ? `<div class="ai-translator-error-text">${escapeHtml(content)}</div>` : content}
      </div>
    `;

    document.documentElement.appendChild(resultPanel);

    // Push page content
    if (!document.body.style.paddingRight || document.body.style.paddingRight !== '400px') {
      originalBodyPadding = document.body.style.paddingRight;
      document.body.style.transition = 'padding-right 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
      document.body.style.paddingRight = '400px';
    }

    // Bind header buttons
    resultPanel.querySelector('.ai-translator-btn-close').addEventListener('click', closePanel);

    resultPanel.querySelector('.ai-translator-btn-trash').addEventListener('click', async () => {
      await chrome.storage.local.set({ translationHistory: [] });
      closePanel();
    });

    resultPanel.querySelector('.ai-translator-btn-copy').addEventListener('click', () => {
      const translatedEls = resultPanel.querySelectorAll('.ai-translator-translated');
      const text = Array.from(translatedEls).map(el => el.textContent).join('\n\n---\n\n');
      navigator.clipboard.writeText(text).then(() => {
        const btn = resultPanel.querySelector('.ai-translator-btn-copy');
        btn.textContent = '✅';
        setTimeout(() => btn.textContent = '📋', 1500);
      });
    });

    resultPanel.querySelector('.ai-translator-btn-again').addEventListener('click', () => {
      enterSelectionMode();
    });

    resultPanel.querySelector('.ai-translator-btn-save').addEventListener('click', () => {
      exportFile();
    });

    // Bind inline copy buttons
    bindCopySectionButtons(resultPanel);

    // Animate in
    requestAnimationFrame(() => {
      resultPanel.classList.add('ai-translator-result-visible');
    });
  }

  function closePanel() {
    const panel = document.getElementById('ai-translator-result');
    if (!panel) return;
    panel.classList.remove('ai-translator-result-visible');
    document.body.style.paddingRight = originalBodyPadding;
    setTimeout(() => {
      if (panel) panel.remove();
      resultPanel = null;
    }, 400);
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

  function exportFile() {
    let output = '=======================================\n';
    output += '  TÀI LIỆU DỊCH — AI Screen Translator\n';
    output += '  Ngày: ' + new Date().toLocaleString('vi-VN') + '\n';
    output += '=======================================\n\n';

    const panel = document.getElementById('ai-translator-result');
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

    const btn = panel.querySelector('.ai-translator-btn-save');
    if (btn) {
      btn.textContent = '✅';
      setTimeout(() => btn.textContent = '💾', 1500);
    }
  }

  // ======================================
  // Utility
  // ======================================
  function removeLoader() {
    const loader = document.getElementById('ai-translator-loader');
    if (loader) loader.remove();
  }

  function cleanup(keepResult) {
    isSelecting = false;
    document.body.style.cursor = '';

    if (overlay) { overlay.remove(); overlay = null; }
    if (selectionBox) { selectionBox.remove(); selectionBox = null; }
    if (!keepResult && resultPanel) { closePanel(); }

    removeLoader();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKeyDown);
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }
})();
