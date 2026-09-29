import { resolveProviderSettings, streamTranslation, testProviderConnection } from './lib/ai-provider.js';
import { loadPromptSettings } from './lib/prompt-templates.js';
import { createPageController } from './lib/page-controller.js';

let activeCaptureId = 0;
const pageController = createPageController();

// Background service worker - handles screenshot capture, AI translation, streaming, OCR

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Listen for keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-translate') {
    console.log('[AI Translator] Shortcut triggered');
    await startCapture();
  }
});

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (['pageStart', 'pageCancel', 'pageRestore', 'pageGetState'].includes(message.action)) {
    // Only our panel can initiate API work; page scripts cannot trigger translations.
    if (sender.url !== chrome.runtime.getURL('sidepanel.html')) return false;
    pageController.handle(message).then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  console.log('[AI Translator] Message received:', message.action);

  if (message.action === 'startCapture') {
    startCapture()
      .then(() => sendResponse({ status: 'started' }))
      .catch(err => {
        console.error('[AI Translator] startCapture failed:', err);
        sendResponse({ status: 'error', error: err.message });
      });
    return true;
  }

  if (message.action === 'captureAndTranslate') {
    handleCaptureAndTranslate(message, sender.tab.id)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[AI Translator] captureAndTranslate failed:', err);
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (message.action === 'testConnection') {
    testProviderConnection({ provider: message.provider, apiKey: message.apiKey, model: message.model })
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'captureScreen') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true;
  }
});

// Context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ai-translate-region',
    title: '🌐 Chụp & Dịch vùng này',
    contexts: ['page', 'image', 'frame']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ai-translate-region') {
    await startCapture();
  }
});

async function startCapture() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch(e) {}

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      console.log('[AI Translator] Content script injection:', e.message);
    }

    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
    } catch (e) {}

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'startSelection' });
    } catch (e) {
      await new Promise(r => setTimeout(r, 300));
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'startSelection' });
      } catch (e2) {
        console.error('[AI Translator] Failed to start selection:', e2.message);
      }
    }
  } catch (err) {
    console.error('[AI Translator] Failed to start capture:', err);
  }
}

// ============================================================
// Capture & Translate
// ============================================================
async function handleCaptureAndTranslate(message, tabId) {
  const { rect } = message;
  const captureId = ++activeCaptureId;

  const safeSend = async (msg) => {
    if (captureId !== activeCaptureId) return;
    try { await chrome.tabs.sendMessage(tabId, msg); } catch (e) {}
    if (captureId !== activeCaptureId) return;
    try { await chrome.runtime.sendMessage(msg); } catch (e) {}
  };

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const croppedBase64 = await cropImage(dataUrl, rect);

    const settings = await chrome.storage.sync.get({
      provider: 'openai',
      apiKey: '',
      geminiApiKey: '',
      geminiModel: 'gemini-3.8-flash',
      targetLang: 'vi',
      model: 'gpt-4o',
      ocrOnly: false,
      specialty: 'dentistry'
    });

    const providerSettings = resolveProviderSettings(settings);
    if (!providerSettings.apiKey) {
      await safeSend({
        action: 'showResult',
        error: `⚠️ Chưa cài đặt API Key ${providerSettings.provider === 'gemini' ? 'Gemini' : 'OpenAI'}!\n\nMở Cài đặt → Nhập API Key.`
      });
      return { error: 'No API key' };
    }

    await safeSend({
      action: 'showLoading',
      message: settings.ocrOnly ? '🔍 Đang trích xuất text...' : '🔄 Đang dịch...',
      rect: rect,
      ocrOnly: settings.ocrOnly,
      targetLang: settings.targetLang
    });

    const result = await streamTranslation({
      ...providerSettings,
      ...await loadPromptSettings(settings.ocrOnly),
      imageBase64: croppedBase64,
      targetLang: settings.targetLang,
      ocrOnly: settings.ocrOnly,
      specialty: settings.specialty,
      onChunk: (chunk, fullText) => safeSend({ action: 'streamChunk', chunk, fullText })
    });

    // Final result
    await safeSend({
      action: 'showResult',
      result: result.text,
      croppedImage: croppedBase64,
      model: result.model,
      provider: result.provider,
      tokens: result.tokens,
      ocrOnly: settings.ocrOnly
    });

    return { success: true };
  } catch (err) {
    console.error('[AI Translator] Error:', err);
    await safeSend({
      action: 'showResult',
      error: '❌ Lỗi: ' + err.message
    });
    return { error: err.message };
  }
}

// ============================================================
// Image Cropping
// ============================================================
async function cropImage(dataUrl, rect) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);

  const scaleX = rect.viewportWidth ? (imageBitmap.width / rect.viewportWidth) : (rect.devicePixelRatio || 1);
  const scaleY = rect.viewportHeight ? (imageBitmap.height / rect.viewportHeight) : (rect.devicePixelRatio || 1);

  const sx = Math.round(rect.x * scaleX);
  const sy = Math.round(rect.y * scaleY);
  const sw = Math.round(rect.width * scaleX);
  const sh = Math.round(rect.height * scaleY);

  const clampedSx = Math.max(0, Math.min(sx, imageBitmap.width - 1));
  const clampedSy = Math.max(0, Math.min(sy, imageBitmap.height - 1));
  const clampedSw = Math.max(1, Math.min(sw, imageBitmap.width - clampedSx));
  const clampedSh = Math.max(1, Math.min(sh, imageBitmap.height - clampedSy));

  const canvas = new OffscreenCanvas(clampedSw, clampedSh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, clampedSx, clampedSy, clampedSw, clampedSh, 0, 0, clampedSw, clampedSh);

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await croppedBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}
