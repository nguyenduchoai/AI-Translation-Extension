import { PcmPlayer } from './pcm-player.js';

export const VIENEU_URL = 'http://127.0.0.1:8001';
const HEADERS = { 'X-AI-Translator': '1' };

function waitForPreviousSpeech(signal, milliseconds) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function fetchVieneuVoices() {
  const response = await fetch(`${VIENEU_URL}/voices`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('VieNeu chưa sẵn sàng. Mở start-vieneu.command rồi thử lại.');
  const data = await response.json();
  if (!Array.isArray(data.voices) || !data.voices.length) throw new Error('VieNeu chưa có danh sách giọng.');
  return data.voices;
}

export function browserVoices() {
  return (globalThis.speechSynthesis?.getVoices() || []).filter(voice => /^vi(?:[-_]|$)/i.test(voice.lang));
}

function speakBrowser(text, voiceId, volume, signal, onFirstAudio) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const voice = browserVoices().find(item => item.voiceURI === voiceId) || browserVoices()[0];
    if (!voice) return reject(new Error('Máy chưa có giọng tiếng Việt trong trình duyệt. Chọn VieNeu local.'));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice; utterance.lang = voice.lang; utterance.volume = volume;
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); speechSynthesis.cancel(); reject(new DOMException('Stopped', 'AbortError')); };
    const timeout = setTimeout(() => {
      cleanup(); speechSynthesis.cancel(); reject(new Error('Giọng trình duyệt không phản hồi. Hãy thử VieNeu local.'));
    }, 90000);
    signal.addEventListener('abort', abort, { once: true });
    utterance.onstart = () => onFirstAudio?.();
    utterance.onend = () => { cleanup(); resolve(); };
    utterance.onerror = event => { cleanup(); reject(new Error(`Không phát được giọng trình duyệt: ${event.error}`)); };
    try { speechSynthesis.speak(utterance); }
    catch (error) { cleanup(); reject(error); }
  });
}

export class SpeechProviders {
  constructor() { this.player = new PcmPlayer(); }
  unlock() { return this.player.unlock(); }

  async speak(text, { engine, voice, volume }, signal, onFirstAudio) {
    if (engine === 'browser') return speakBrowser(text, voice, volume, signal, onFirstAudio);
    if (engine !== 'vieneu') throw new Error('Nguồn giọng không được hỗ trợ.');
    this.player.volume = volume;
    let response;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        signal.throwIfAborted();
        response = await fetch(`${VIENEU_URL}/speech`, {
          method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: voice || undefined }), signal
        });
        if (response.status !== 429 || attempt === 2) break;
        // An aborted prior request may need one more model frame to release the CPU.
        await response.body?.cancel();
        await waitForPreviousSpeech(signal, 500);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error('Không kết nối được VieNeu local. Mở start-vieneu.command và chờ model sẵn sàng.');
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(typeof error.detail === 'string' ? error.detail : `VieNeu lỗi HTTP ${response.status}`);
    }
    await this.player.play(response, signal, onFirstAudio);
  }
}
