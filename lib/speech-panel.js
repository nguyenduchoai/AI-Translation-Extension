import { SpeechQueue } from './speech-queue.js';
import { SpeechProviders, browserVoices, fetchVieneuVoices } from './speech-providers.js';

export async function setupSpeechPanel() {
  const el = id => document.getElementById(id);
  const engine = el('speech-engine');
  const voice = el('speech-voice');
  const auto = el('speech-auto');
  const status = el('speech-status');
  const metrics = el('speech-metrics');
  const providers = new SpeechProviders();
  const saved = await chrome.storage.local.get({ speechEngine: 'vieneu', speechVoice: '', speechVolume: 0.8 });
  engine.value = ['vieneu', 'browser'].includes(saved.speechEngine) ? saved.speechEngine : 'vieneu';
  el('speech-volume').value = saved.speechVolume;
  let preferredVoice = saved.speechVoice;
  let capture = { ocrOnly: false, targetLang: 'vi' };
  let currentOptions;
  let controlRevision = 0;
  let connectRevision = 0;
  let audioBusy = false;

  const queue = new SpeechQueue({
    speak: async (text, signal) => {
      const began = performance.now();
      await providers.speak(text, currentOptions, signal, () => {
        metrics.textContent = `Âm thanh đầu: ${Math.round(performance.now() - began)} ms / câu`;
      });
    },
    onStatus: info => {
      status.dataset.state = info.state;
      if (info.state === 'error') {
        auto.checked = false;
        status.textContent = info.message;
      } else {
        const labels = { speaking: 'Đang đọc', queued: 'Đang xếp câu', idle: 'Đã đọc xong', stopped: 'Đã dừng' };
        status.textContent = (labels[info.state] || 'Sẵn sàng') + (info.pending ? ` · còn ${info.pending} câu` : '');
      }
    }
  });
  const options = () => ({ engine: engine.value, voice: voice.value, volume: Number(el('speech-volume').value) });
  const save = () => chrome.storage.local.set({
    speechEngine: engine.value, speechVoice: voice.value, speechVolume: Number(el('speech-volume').value)
  });
  const stop = () => { controlRevision++; connectRevision++; queue.stop(); auto.checked = false; };
  const reportError = error => { stop(); status.textContent = error.message; status.dataset.state = 'error'; };
  const renderVoices = voices => {
    if (!voices.length && engine.value === 'vieneu' && preferredVoice) {
      voices = [{ id: preferredVoice, name: `Giọng đã lưu: ${preferredVoice}` }];
    }
    voice.replaceChildren(new Option('Giọng mặc định', ''), ...voices.map(item => new Option(item.name, item.id)));
    voice.value = [...voice.options].some(item => item.value === preferredVoice) ? preferredVoice : '';
  };
  const updateEngine = () => {
    el('speech-local-help').hidden = engine.value !== 'vieneu';
    el('speech-connect').hidden = engine.value !== 'vieneu';
    renderVoices(engine.value === 'browser' ? browserVoices().map(item => ({ id: item.voiceURI, name: item.name })) : []);
    status.textContent = engine.value === 'vieneu'
      ? 'Mở ứng dụng VieNeu local, rồi bấm Kết nối.'
      : browserVoices().length ? 'Giọng tiếng Việt có sẵn trên máy.' : 'Chưa tìm thấy giọng tiếng Việt. Có thể dùng VieNeu local.';
    status.dataset.state = '';
  };
  const prepare = async () => {
    const revision = ++controlRevision;
    connectRevision++;
    queue.stop();
    currentOptions = options();
    if (currentOptions.engine === 'vieneu') await providers.unlock();
    else if (!browserVoices().length) throw new Error('Máy chưa có giọng tiếng Việt. Chọn VieNeu local.');
    if (revision !== controlRevision) return false;
    metrics.textContent = '';
    queue.start();
    return true;
  };
  const read = async text => {
    if (audioBusy) { status.textContent = 'Dừng dịch audio tab trước khi nghe nội dung khác.'; return; }
    if (!text?.trim()) { status.textContent = 'Nhập nội dung hoặc tạo bản dịch trước khi nghe.'; return; }
    try {
      auto.checked = false;
      if (!await prepare()) return;
      queue.finish(text);
    } catch (error) { reportError(error); }
  };

  updateEngine();
  engine.addEventListener('change', () => { stop(); preferredVoice = ''; updateEngine(); save().catch(reportError); });
  voice.addEventListener('change', () => { stop(); preferredVoice = voice.value; save().catch(reportError); });
  el('speech-volume').addEventListener('input', () => {
    const volume = Number(el('speech-volume').value);
    if (currentOptions) currentOptions.volume = volume;
    providers.player.setVolume(volume);
  });
  el('speech-volume').addEventListener('change', () => { save().catch(reportError); });
  globalThis.speechSynthesis?.addEventListener('voiceschanged', () => {
    if (engine.value === 'browser') updateEngine();
  });
  el('speech-connect').addEventListener('click', async () => {
    const button = el('speech-connect');
    button.disabled = true;
    status.textContent = 'Đang kết nối VieNeu…';
    const selectedEngine = engine.value;
    const revision = ++connectRevision;
    try {
      const voices = await fetchVieneuVoices();
      if (engine.value !== selectedEngine || revision !== connectRevision) return;
      renderVoices(voices);
      status.textContent = `VieNeu sẵn sàng · ${voices.length} giọng`;
      status.dataset.state = '';
    } catch (error) {
      if (engine.value === selectedEngine && revision === connectRevision) {
        reportError(new Error('Chưa kết nối được VieNeu. Mở start-vieneu.command và chờ tải model xong.'));
      }
    }
    finally { button.disabled = false; }
  });
  auto.addEventListener('change', async () => {
    if (!auto.checked) { stop(); return; }
    try { if (await prepare()) status.textContent = 'Sẽ đọc từng câu của bản dịch tiếng Việt mới. Giữ panel mở.'; }
    catch (error) { reportError(error); }
  });
  el('speech-read').addEventListener('click', () => read(el('speech-text').value));
  el('speech-test').addEventListener('click', () => read('Xin chào anh. Đây là giọng đọc tiếng Việt của trợ lý dịch nha khoa.'));
  el('speech-stop').addEventListener('click', stop);
  el('speech-latest').addEventListener('click', () => read(document.querySelector('.ai-translator-translated')?.textContent));
  window.addEventListener('pagehide', stop, { once: true });
  return {
    read,
    stop,
    options,
    setAudioBusy(value) { audioBusy = value; },
    handle(message) {
      if (audioBusy) return;
      if (message.action === 'showLoading') {
        controlRevision++;
        queue.stop();
        capture = { ocrOnly: Boolean(message.ocrOnly), targetLang: message.targetLang || 'vi' };
        if (!auto.checked) return;
        if (capture.ocrOnly || capture.targetLang !== 'vi') {
          status.textContent = 'Tự đọc chỉ áp dụng cho bản dịch tiếng Việt; OCR không tự đọc.';
          return;
        }
        currentOptions = options();
        metrics.textContent = '';
        queue.start();
      } else if (message.action === 'showResult' && message.error) {
        queue.stop();
      } else if (auto.checked && !capture.ocrOnly && capture.targetLang === 'vi') {
        if (message.action === 'streamChunk') queue.append(message.fullText);
        if (message.action === 'showResult') queue.finish(message.result || '');
      }
    }
  };
}
