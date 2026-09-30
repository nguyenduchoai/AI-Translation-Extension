import { startTabAudioCapture } from './tab-audio-capture.js';
import { transcribeGroqAudio } from './groq-asr.js';
import { createAudioTranslationSession, translateAudioText } from './audio-translation-session.js';
import { resolveProviderSettings, createProviderCancellation } from './ai-provider.js';
import { loadPromptSettings } from './prompt-templates.js';
import { SpeechProviders, browserVoices } from './speech-providers.js';
import { createAudioVoiceQueue } from './audio-voice-queue.js';

export async function setupAudioPanel({ speech }) {
  const el = id => document.getElementById(id);
  const key = el('audio-groq-key');
  const status = el('audio-status');
  const providers = new SpeechProviders();
  let current = null;
  const saved = await chrome.storage.local.get({ groqAsrApiKey: '' });
  key.value = saved.groqAsrApiKey;
  const report = (message, error = false) => {
    status.textContent = message;
    status.dataset.state = error ? 'error' : '';
  };
  const setBusy = busy => {
    speech.setAudioBusy(busy);
    for (const id of ['audio-start', 'audio-save-key', 'audio-groq-key', 'audio-language', 'audio-read']) el(id).disabled = busy;
    el('audio-stop').disabled = !busy;
    el('audio-badge').textContent = busy ? 'Đang bật' : 'Groq · Thử nghiệm';
    // A single voice owner prevents overlapping OCR/manual speech and video speech.
    document.querySelectorAll('.speech-panel:not(#audio-panel) input, .speech-panel:not(#audio-panel) select, .speech-panel:not(#audio-panel) button')
      .forEach(control => { control.disabled = busy; });
  };
  const stop = (message = 'Đã dừng thu, dịch và đọc. Các đoạn dưới đây chỉ giữ trong phiên panel.', error = false) => {
    const previous = current;
    current = null;
    previous?.session?.stop();
    previous?.voice?.stop();
    previous?.capture?.stop();
    setBusy(false);
    report(message, error);
  };
  const fail = (run, error) => {
    if (current === run) stop(error?.message || 'Không thể dịch âm thanh.', true);
  };
  const renderResult = ({ sourceText, text, sequence }) => {
    const item = document.createElement('article');
    item.className = 'audio-result';
    const label = document.createElement('strong');
    label.textContent = `Đoạn ${sequence}`;
    const source = document.createElement('p');
    source.className = 'audio-source';
    source.textContent = sourceText;
    const translated = document.createElement('p');
    translated.className = 'audio-translation';
    translated.textContent = text;
    item.append(label, source, translated);
    el('audio-results').prepend(item);
    while (el('audio-results').children.length > 30) el('audio-results').lastChild.remove();
  };
  el('audio-save-key').addEventListener('click', async () => {
    try {
      if (key.value.trim()) await chrome.storage.local.set({ groqAsrApiKey: key.value.trim() });
      else await chrome.storage.local.remove('groqAsrApiKey');
      report(key.value.trim() ? 'Đã lưu Groq key trên máy; chưa gửi audio.' : 'Đã xóa Groq key đã lưu.');
    } catch { report('Không lưu được Groq key trên máy.', true); }
  });
  el('audio-stop').addEventListener('click', () => stop());
  el('audio-start').addEventListener('click', async () => {
    if (current) return;
    const apiKey = key.value.trim();
    if (!apiKey) { report('Nhập Groq API key trước khi bắt đầu.', true); return; }
    const read = el('audio-read').checked;
    const voiceOptions = speech.options();
    if (read && voiceOptions.engine === 'browser' && !browserVoices().length) {
      report('Máy chưa có giọng Việt. Chọn VieNeu local hoặc bỏ chọn Đọc bản dịch.', true);
      return;
    }
    speech.stop();
    const run = { capture: null, session: null };
    current = run;
    setBusy(true);
    report('Chọn Tab Chrome và bật Chia sẻ âm thanh tab…');
    const language = el('audio-language').value;
    try {
      // Invoke the chooser before any await so browser user activation is retained.
      const capturePromise = startTabAudioCapture({
        onChunk: blob => { if (current === run) run.session?.enqueue(blob); },
        onEnded: () => { if (current === run) stop('Chrome đã dừng chia sẻ. Phiên dịch đã dừng.'); },
        onError: error => fail(run, error)
      }).then(capture => {
        run.capture = capture;
        if (current !== run) capture.stop();
        return capture;
      });
      const unlock = read && voiceOptions.engine === 'vieneu' ? providers.unlock() : Promise.resolve();
      // Handle both promises immediately, including a rejected AudioContext resume.
      const [capture, unlocked] = await Promise.allSettled([capturePromise, unlock]);
      if (capture.status === 'rejected') throw capture.reason;
      run.capture = capture.value;
      if (current !== run) { run.capture.stop(); return; }
      if (unlocked.status === 'rejected') throw unlocked.reason;
      const settings = await chrome.storage.sync.get({ provider: 'openai', apiKey: '', geminiApiKey: '', specialty: 'dentistry', model: 'gpt-4o', geminiModel: 'gemini-3.8-flash' });
      const provider = resolveProviderSettings(settings);
      if (!provider.apiKey) throw new Error('Mở ⚙️, nhập và lưu API key của AI dịch (OpenAI hoặc Gemini).');
      const prompt = await loadPromptSettings(false);
      if (current !== run) { run.capture.stop(); return; }
      if (read) run.voice = createAudioVoiceQueue({
        speak: async (text, signal) => {
          const timeout = createProviderCancellation(signal, { timeoutMs: 60000 });
          try { await providers.speak(text, voiceOptions, timeout.signal); }
          finally { timeout.dispose(); }
        },
        onError: error => fail(run, error)
      });
      run.session = createAudioTranslationSession({
        transcribe: (blob, { signal }) => {
          report('Đang nhận dạng audio trên Groq…');
          return transcribeGroqAudio({ blob, apiKey, language, signal });
        },
        translate: (text, { signal }) => {
          report('Đang dịch sang tiếng Việt…');
          return translateAudioText({ ...provider, ...prompt, specialty: settings.specialty, text, signal });
        },
        onResult: result => {
          if (current !== run) return;
          renderResult(result);
          run.voice?.enqueue(result.text);
          if (current === run) report(read ? 'Đang thu audio tab và đọc các bản dịch · Dừng để kết thúc.' : 'Đang thu audio tab · Dừng để kết thúc.');
        },
        onError: error => fail(run, error)
      });
      el('audio-results').replaceChildren();
      report(`Đang thu audio tab · ${provider.provider} dịch tiếng Việt · ${prompt.promptLabel}. Đợi khoảng 10 giây có tiếng nói.`);
    } catch (error) {
      // A chooser can resolve after Stop. Always release its stream, but never
      // overwrite the status of a newer session with this session's late error.
      run.capture?.stop();
      const message = {
        NotAllowedError: 'Chưa được phép chia sẻ audio hoặc đã hủy chọn tab. Bấm Bắt đầu để chọn lại.',
        NotReadableError: 'Chrome không đọc được audio tab này. Kiểm tra quyền chia sẻ rồi thử lại.',
        InvalidStateError: 'Hãy bấm Bắt đầu khi panel đang hiển thị để chọn tab có audio.'
      }[error?.name];
      fail(run, message ? new Error(message) : error);
    }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (current && message.action === 'showLoading') stop('Đã dừng dịch audio để chuyển sang dịch ảnh.');
  });
  window.addEventListener('pagehide', () => stop(), { once: true });
  return { stop };
}
