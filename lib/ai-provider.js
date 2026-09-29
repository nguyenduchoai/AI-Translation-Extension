import { buildTranslationPrompts } from './translation-prompts.js';
import { readSseEvents } from './sse-stream.js';
import { parseProviderChunk } from './provider-response.js';

const DEFAULT_MODELS = { openai: 'gpt-4o', gemini: 'gemini-3.8-flash' };

function validateProvider(provider = 'openai') {
  if (!Object.hasOwn(DEFAULT_MODELS, provider)) throw new Error('Nhà cung cấp AI không được hỗ trợ.');
  return provider;
}

// Retain legacy OpenAI settings; a Gemini selection never falls back to an OpenAI key.
export function resolveProviderSettings(settings = {}) {
  const provider = validateProvider(settings.provider || 'openai');
  return {
    provider,
    apiKey: (provider === 'gemini' ? settings.geminiApiKey : settings.apiKey)?.trim() || '',
    model: (provider === 'gemini' ? settings.geminiModel : settings.model)?.trim() || DEFAULT_MODELS[provider]
  };
}

export function buildProviderRequest({ provider = 'openai', apiKey, model, prompts, imageBase64, stream = true }) {
  validateProvider(provider);
  if (!apiKey?.trim()) throw new Error(`Chưa cài đặt API Key ${provider === 'gemini' ? 'Gemini' : 'OpenAI'}.`);
  model = model?.trim() || DEFAULT_MODELS[provider];
  const headers = { 'Content-Type': 'application/json' };
  let url;
  let body;
  if (provider === 'gemini') {
    // Encode only a model ID so custom model names cannot change the request host/path.
    model = model.replace(/^models\//, '');
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Tên model Gemini không hợp lệ.');
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    headers['x-goog-api-key'] = apiKey.trim();
    const parts = [{ text: prompts.user }];
    if (imageBase64) parts.push({ inline_data: { mime_type: 'image/png', data: imageBase64 } });
    body = {
      system_instruction: { parts: [{ text: prompts.system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: 8192 }
    };
  } else {
    url = 'https://api.openai.com/v1/chat/completions';
    headers.Authorization = `Bearer ${apiKey.trim()}`;
    const content = [{ type: 'text', text: prompts.user }];
    if (imageBase64) content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' } });
    body = {
      model,
      messages: [{ role: 'system', content: prompts.system }, { role: 'user', content }],
      max_tokens: 4096,
      temperature: 0.15,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {})
    };
  }
  return { url, options: { method: 'POST', headers, body: JSON.stringify(body) }, model };
}

// Keep the cancellation active until the caller has consumed the response body.
// Chrome 116 supports AbortController but not AbortSignal.any.
export function createProviderCancellation(signal, { timeoutMs = 120000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('API phản hồi quá chậm. Hãy thử lại.', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

export async function requestProvider(request, fetchImpl, signal = AbortSignal.timeout(120000)) {
  signal.throwIfAborted();
  const response = await fetchImpl(request.url, { ...request.options, signal });
  signal.throwIfAborted();
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    signal.throwIfAborted();
    const detail = data?.error?.message;
    const fallback = {
      401: 'API Key không hợp lệ.', 403: 'API Key không có quyền truy cập model hoặc dịch vụ.',
      429: 'Hết quota hoặc bị giới hạn tốc độ. Hãy kiểm tra tài khoản API.'
    }[response.status] || 'Không thể kết nối API.';
    throw new Error(`${fallback} (HTTP ${response.status})${detail ? ` ${detail}` : ''}`);
  }
  return response;
}

export async function streamTranslation(options, fetchImpl = fetch) {
  const provider = validateProvider(options.provider || 'openai');
  const prompts = buildTranslationPrompts(options);
  const request = buildProviderRequest({ ...options, provider, prompts, stream: true });
  const response = await requestProvider(request, fetchImpl);
  let text = '';
  let model = request.model;
  let tokens = null;
  let finished = false;
  for await (const event of readSseEvents(response.body)) {
    if (event === '[DONE]') break;
    let data;
    try { data = JSON.parse(event); }
    catch { throw new Error('Luồng dữ liệu API không hợp lệ. Hãy thử lại.'); }
    const chunk = parseProviderChunk(provider, data);
    model = chunk.model || model;
    tokens = chunk.tokens || tokens;
    finished ||= chunk.finished;
    if (chunk.text) {
      text += chunk.text;
      await options.onChunk?.(chunk.text, text);
    }
  }
  if (!finished) throw new Error('Kết nối bị ngắt trước khi hoàn tất. Hãy thử lại.');
  if (!text.trim()) throw new Error('API không trả về văn bản. Hãy kiểm tra vùng chụp và thử lại.');
  return { text, model, tokens, provider };
}

export async function testProviderConnection(options, fetchImpl = fetch) {
  const provider = validateProvider(options.provider || 'openai');
  const prompts = { system: 'Reply concisely.', user: 'Reply with only OK.' };
  const request = buildProviderRequest({ provider, apiKey: options.apiKey, model: options.model, prompts, stream: false });
  const response = await requestProvider(request, fetchImpl);
  const result = parseProviderChunk(provider, await response.json(), false);
  if (!result.finished || !result.text.trim()) throw new Error('API chưa trả về văn bản hoàn chỉnh.');
  const model = result.model || request.model;
  return { success: true, provider, model, message: `✅ Kết nối thành công! Model: ${model}` };
}
