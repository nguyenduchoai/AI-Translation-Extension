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
    testApiKey(message.apiKey, message.model)
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
// Test API Key
// ============================================================
async function testApiKey(apiKey, model) {
  if (!apiKey) throw new Error('API Key trống');

  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: model || 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Say "OK" in one word.' }],
    max_tokens: 5
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const code = response.status;
    if (code === 401) throw new Error('API Key không hợp lệ');
    if (code === 429) throw new Error('Hết quota hoặc rate limit');
    if (code === 403) throw new Error('Key bị vô hiệu hóa');
    throw new Error(err.error?.message || `Lỗi HTTP ${code}`);
  }

  const data = await response.json();
  return {
    success: true,
    model: data.model,
    message: `✅ Kết nối thành công! Model: ${data.model}`
  };
}

// ============================================================
// Capture & Translate
// ============================================================
async function handleCaptureAndTranslate(message, tabId) {
  const { rect } = message;

  const safeSend = async (msg) => {
    try { await chrome.tabs.sendMessage(tabId, msg); } catch (e) {}
    try { chrome.runtime.sendMessage(msg); } catch (e) {}
  };

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const croppedBase64 = await cropImage(dataUrl, rect);

    const settings = await chrome.storage.sync.get({
      apiKey: '',
      targetLang: 'vi',
      model: 'gpt-4o',
      ocrOnly: false,
      specialty: 'dentistry'
    });

    if (!settings.apiKey) {
      await safeSend({
        action: 'showResult',
        error: '⚠️ Chưa cài đặt API Key!\n\nClick vào icon extension → Nhập API Key.'
      });
      return { error: 'No API key' };
    }

    await safeSend({
      action: 'showLoading',
      message: settings.ocrOnly ? '🔍 Đang trích xuất text...' : '🔄 Đang dịch...',
      rect: rect
    });

    // Use streaming
    const result = await translateWithAIStreaming(
      croppedBase64,
      settings.apiKey,
      settings.targetLang,
      settings.model,
      settings.ocrOnly,
      tabId,
      settings.specialty
    );

    // Final result
    await safeSend({
      action: 'showResult',
      result: result.text,
      croppedImage: croppedBase64,
      model: result.model,
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
// Streaming Translation
// ============================================================
async function translateWithAIStreaming(imageBase64, apiKey, targetLang, model, ocrOnly, tabId, specialty) {
  const langNames = {
    'vi': 'Vietnamese', 'en': 'English', 'zh': 'Chinese',
    'ja': 'Japanese', 'ko': 'Korean', 'fr': 'French',
    'de': 'German', 'es': 'Spanish', 'th': 'Thai'
  };

  const targetLangName = langNames[targetLang] || 'Vietnamese';

  // ============================================================
  // Specialty-specific expert profiles
  // ============================================================
  const specialtyProfiles = {
    'dentistry': {
      title: 'Giáo sư đầu ngành Nha khoa (Dentistry)',
      expertise: 'dental sciences, oral pathology, dental materials, restorative dentistry, dental anatomy, occlusion, and clinical dentistry',
      context: 'dental textbooks, clinical guidelines, and peer-reviewed dental journals'
    },
    'orthodontics': {
      title: 'Giáo sư đầu ngành Chỉnh nha (Orthodontics)',
      expertise: 'orthodontic biomechanics, cephalometric analysis, malocclusion classification, fixed and removable appliances, clear aligner therapy, and craniofacial growth',
      context: 'orthodontic textbooks such as Proffit, Nanda, and Burstone, clinical case reports, and orthodontic journals'
    },
    'implantology': {
      title: 'Giáo sư đầu ngành Implant Nha khoa (Implantology)',
      expertise: 'dental implant systems, osseointegration, bone grafting, sinus lift procedures, guided bone regeneration (GBR), immediate loading protocols, and peri-implant diseases',
      context: 'implantology textbooks such as Misch, ITI Treatment Guide, and implant-related journals'
    },
    'endodontics': {
      title: 'Giáo sư đầu ngành Nội nha (Endodontics)',
      expertise: 'pulp biology, root canal anatomy, endodontic instrumentation, obturation techniques, endodontic retreatment, vital pulp therapy, and apical surgery',
      context: 'endodontic textbooks such as Cohen\'s Pathways of the Pulp, Ingle\'s Endodontics, and endodontic journals'
    },
    'periodontics': {
      title: 'Giáo sư đầu ngành Nha chu (Periodontics)',
      expertise: 'periodontal disease classification, scaling and root planing, flap surgery, mucogingival surgery, regenerative periodontics, and periodontal-systemic medicine links',
      context: 'periodontal textbooks such as Carranza, Lindhe, and periodontal journals'
    },
    'prosthodontics': {
      title: 'Giáo sư đầu ngành Phục hình răng (Prosthodontics)',
      expertise: 'fixed prosthodontics, removable partial dentures, complete dentures, maxillofacial prosthetics, CAD/CAM dentistry, dental ceramics, and occlusal rehabilitation',
      context: 'prosthodontic textbooks such as Shillingburg, McCracken, and prosthodontic journals'
    },
    'oral-surgery': {
      title: 'Giáo sư đầu ngành Phẫu thuật miệng (Oral & Maxillofacial Surgery)',
      expertise: 'dentoalveolar surgery, orthognathic surgery, TMJ disorders, oral pathology, trauma surgery, and surgical management of odontogenic infections',
      context: 'oral surgery textbooks such as Peterson, Hupp, and oral surgery journals'
    },
    'pediatric-dentistry': {
      title: 'Giáo sư đầu ngành Nha khoa trẻ em (Pediatric Dentistry)',
      expertise: 'pediatric dental behavior management, pulp therapy for primary teeth, space management, traumatic dental injuries in children, and preventive dentistry',
      context: 'pediatric dentistry textbooks such as McDonald, Pinkham, and pediatric dental journals'
    },
    'medicine': {
      title: 'Giáo sư đầu ngành Y khoa (Medicine)',
      expertise: 'internal medicine, clinical pharmacology, pathophysiology, diagnostic medicine, and evidence-based medicine',
      context: 'medical textbooks such as Harrison, Cecil, and peer-reviewed medical journals'
    },
    'pharmacy': {
      title: 'Giáo sư đầu ngành Dược học (Pharmacy)',
      expertise: 'pharmacology, pharmacokinetics, drug interactions, pharmaceutical chemistry, clinical pharmacy, and drug delivery systems',
      context: 'pharmacy textbooks such as Goodman & Gilman, applied therapeutics, and pharmaceutical journals'
    },
    'general': {
      title: 'Chuyên gia dịch thuật học thuật',
      expertise: 'academic translation, technical writing, and cross-language scientific communication',
      context: 'academic textbooks, research papers, and scholarly publications'
    }
  };

  const profile = specialtyProfiles[specialty] || specialtyProfiles['dentistry'];

  // ============================================================
  // Build system message (expert persona)
  // ============================================================
  const systemMessage = `You are a ${profile.title} — one of the most respected and authoritative experts in ${profile.expertise}.

You have 30+ years of clinical experience, have published extensively in top-tier journals, and have trained generations of practitioners. You regularly author and review ${profile.context}.

YOUR ROLE: You are translating specialized academic/clinical material for fellow professionals and advanced students. Your translations must reflect the depth of understanding that only a true domain expert possesses.

TRANSLATION PRINCIPLES:
1. ACCURACY FIRST: Every concept, mechanism, classification, and clinical detail must be translated with absolute precision. Never simplify or omit nuanced information.
2. TERMINOLOGY HANDLING:
   - Use the standard accepted ${targetLangName} terminology used in ${targetLangName}-language academia and clinical practice.
   - For critical technical terms, include the original English term in parentheses on FIRST occurrence only. Example: "cắn hở (open bite)" or "tủy hoại tử (pulp necrosis)".
   - For universally-used English terms that have no widely-accepted ${targetLangName} equivalent, keep the English term as-is.
   - Drug names: use INN (International Nonproprietary Names) consistently.
3. READABILITY: Write in clear, professional ${targetLangName} academic prose. The translation should read naturally — as if originally written in ${targetLangName} by a professor, not machine-translated.
4. STRUCTURE PRESERVATION: Maintain all headings, numbered lists, bullet points, paragraph breaks, and logical structure from the original.
5. CONTEXTUAL INTELLIGENCE: When the source text is ambiguous, use your deep domain expertise to choose the most clinically/academically appropriate interpretation.

STRICT RULES:
- Output ONLY the translated text.
- Do NOT add introductions, commentary, summaries, or conversational text.
- Do NOT say "Here is the translation" or anything similar.
- Do NOT apologize or explain.
- If you cannot read part of the image, translate what you can see and mark unclear parts with [...].`;

  let userPrompt;
  if (ocrOnly) {
    userPrompt = `Extract ALL text from this image exactly as written. Preserve the original formatting, paragraph breaks, and structure. Output ONLY the extracted text, nothing else.`;
  } else {
    userPrompt = `Translate the content shown in this image into ${targetLangName}. Apply your full expertise as a ${profile.title} to ensure the translation is accurate, professional, and reads naturally for ${targetLangName}-speaking professionals.`;
  }

  const url = 'https://api.openai.com/v1/chat/completions';

  const messages = ocrOnly
    ? [{
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${imageBase64}`,
              detail: 'high'
            }
          }
        ]
      }]
    : [
        { role: 'system', content: systemMessage },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
                detail: 'high'
              }
            }
          ]
        }
      ];

  const body = {
    model: model || 'gpt-4o',
    messages: messages,
    max_tokens: 4096,
    temperature: 0.15,
    stream: true,
    stream_options: { include_usage: true }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  // Stream the response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let usageData = null;
  let responseModel = model;

  const safeSend = async (msg) => {
    try { await chrome.tabs.sendMessage(tabId, msg); } catch (e) {}
    try { chrome.runtime.sendMessage(msg); } catch (e) {}
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        responseModel = parsed.model || responseModel;

        if (parsed.usage) {
          usageData = parsed.usage;
        }

        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          // Stream to content script
          await safeSend({
            action: 'streamChunk',
            chunk: content,
            fullText: fullText
          });
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }
  }

  return {
    text: fullText || 'Không nhận được kết quả',
    imageBase64,
    model: responseModel,
    tokens: usageData ? {
      prompt: usageData.prompt_tokens,
      completion: usageData.completion_tokens,
      total: usageData.total_tokens
    } : null
  };
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
