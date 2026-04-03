// Content script - handles screen region selection, streaming display, result panel

(function () {
  if (window.__aiTranslatorInjected) {
    console.log('[AI Translator] Re-injection, skipping');
    return;
  }
  window.__aiTranslatorInjected = true;

  let isSelecting = false;
  let startX, startY;
  let overlay, selectionBox;

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'startSelection':
        enterSelectionMode();
        sendResponse({ status: 'ok' });
        break;
      case 'showLoading':
        if (message.rect) {
          showLoadingAtPosition(message.rect.x, message.rect.y, message.rect.width, message.rect.height, message.message);
        } else {
          showLoadingIndicator(message.message);
        }
        sendResponse({ status: 'ok' });
        break;
      case 'streamChunk':
      case 'showResult':
        removeLoader();
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

    if (overlay) { overlay.remove(); overlay = null; }
    if (selectionBox) { selectionBox.remove(); selectionBox = null; }
    
    // Forcefully remove any leftovers from previous buggy multi-injections
    document.querySelectorAll('#ai-translator-overlay, #ai-translator-selection').forEach(el => el.remove());
    
    document.body.style.cursor = '';

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
    }, 150);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') cleanup();
  }

  // ======================================
  // Loading
  // ======================================
  function showLoadingAtPosition(x, y, w, h, msg) {
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
        <div class="ai-translator-loader-text">${msg || 'Đang xử lý...'}</div>
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
    
    // Force clean in case of orphaned elements
    document.querySelectorAll('#ai-translator-overlay, #ai-translator-selection').forEach(el => el.remove());

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
