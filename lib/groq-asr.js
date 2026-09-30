import { createProviderCancellation } from './ai-provider.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_EXTENSIONS = {
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3'
};

function providerError(status) {
  const message = {
    400: 'Groq không nhận được đoạn âm thanh hợp lệ.',
    401: 'API key Groq không hợp lệ. Hãy kiểm tra lại key.',
    403: 'Tài khoản Groq chưa có quyền dùng nhận dạng giọng nói.',
    413: 'Đoạn âm thanh quá lớn để gửi tới Groq.',
    429: 'Groq đã hết hạn mức hoặc giới hạn tốc độ. Phiên dịch đã dừng; hãy kiểm tra tài khoản rồi thử lại.'
  }[status] || 'Groq chưa xử lý được âm thanh. Hãy thử lại sau.';
  const error = new Error(`${message} (HTTP ${status})`);
  error.status = status;
  return error;
}

// Browser creates multipart boundaries; never put the user's key in a URL or error body.
export async function transcribeGroqAudio({ blob, apiKey, language = '', signal, timeoutMs = 30000 }, fetchImpl = fetch) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Chưa nhập API key Groq.');
  if (!(blob instanceof Blob) || !blob.size) throw new Error('Đoạn âm thanh trống hoặc không hợp lệ.');
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('Đoạn âm thanh quá lớn. Hãy bắt đầu lại phiên dịch.');
  const extension = AUDIO_EXTENSIONS[blob.type.split(';')[0].toLowerCase()];
  if (!extension) throw new Error('Định dạng âm thanh chưa được hỗ trợ.');
  if (typeof language !== 'string' || (language && !/^[a-z]{2}$/.test(language))) {
    throw new Error('Ngôn ngữ nhận dạng phải là mã hai chữ thường hoặc để tự nhận dạng.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Thời gian chờ ASR không hợp lệ.');
  const cancellation = createProviderCancellation(signal, { timeoutMs });
  try {
    cancellation.signal.throwIfAborted();
    const form = new FormData();
    form.append('file', blob, `audio.${extension}`);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (language) form.append('language', language);
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey.trim()}` },
        body: form, signal: cancellation.signal
      });
    } catch {
      cancellation.signal.throwIfAborted();
      throw new Error('Không kết nối được Groq. Hãy kiểm tra mạng rồi bắt đầu lại.');
    }
    cancellation.signal.throwIfAborted();
    // Provider error bodies may echo request content: use only our fixed messages.
    if (!response.ok) throw providerError(response.status);
    let body;
    try { body = await response.text(); }
    catch {
      cancellation.signal.throwIfAborted();
      throw new Error('Kết nối Groq bị ngắt khi nhận kết quả.');
    }
    cancellation.signal.throwIfAborted();
    if (body.length > 64000) throw new Error('Phản hồi nhận dạng Groq quá lớn.');
    let data;
    try { data = JSON.parse(body); }
    catch { throw new Error('Groq trả về kết quả nhận dạng không hợp lệ.'); }
    if (!data || typeof data.text !== 'string' || data.text.length > 6000 || data.error) {
      throw new Error('Groq trả về kết quả nhận dạng không hợp lệ.');
    }
    return data.text.trim();
  } finally {
    cancellation.dispose();
  }
}
