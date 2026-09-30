import { translatePageBatch } from './page-translation.js';

// Reuse provider selection, specialty safeguards and the selected prompt template.
export async function translateAudioText({ text, ...options }, fetchImpl = fetch) {
  const result = await translatePageBatch({
    ...options, targetLang: 'vi', blocks: [{ id: 'audio', text }]
  }, fetchImpl);
  return result.translations[0].text;
}

// A slow ASR, translator or voice must not build an unbounded, increasingly stale queue.
export function createAudioTranslationSession({ transcribe, translate, onResult, onError, maxPending = 3 }) {
  if (![transcribe, translate, onResult, onError].every(value => typeof value === 'function')) {
    throw new Error('Thiếu bộ xử lý phiên dịch âm thanh.');
  }
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) throw new Error('Giới hạn hàng đợi âm thanh không hợp lệ.');
  const controller = new AbortController();
  const queue = [];
  let running = false;
  let active = false;
  let sequence = 0;
  let task = Promise.resolve();

  function stop() {
    queue.length = 0;
    controller.abort();
  }

  function fail(error) {
    if (controller.signal.aborted) return;
    stop();
    // Error reporting must not leave an unhandled rejection from the background drain.
    try { Promise.resolve(onError(error)).catch(() => {}); } catch { /* Session already stopped. */ }
  }

  async function drain() {
    try {
      while (queue.length && !controller.signal.aborted) {
        const item = queue.shift();
        active = true;
        const context = { signal: controller.signal };
        const sourceText = await transcribe(item.blob, context);
        if (controller.signal.aborted) return;
        if (typeof sourceText !== 'string') throw new Error('Kết quả nhận dạng không hợp lệ.');
        // Silence yields no transcript, so it must not invoke the translator or voice.
        if (sourceText.trim()) {
          const text = await translate(sourceText, context);
          if (controller.signal.aborted) return;
          if (typeof text !== 'string' || !text.trim()) throw new Error('AI chưa trả về bản dịch âm thanh.');
          await onResult({ sourceText, text, sequence: item.sequence }, context);
        }
        active = false;
      }
    } catch (error) {
      fail(error);
    } finally {
      active = false;
      running = false;
    }
  }

  return {
    enqueue(blob) {
      if (controller.signal.aborted) return false;
      if (!(blob instanceof Blob) || !blob.size) {
        fail(new Error('Đoạn âm thanh trống hoặc không hợp lệ.'));
        return false;
      }
      if (queue.length + Number(active) >= maxPending) {
        fail(new Error('Xử lý âm thanh chậm hơn video; hàng đợi đã đầy. Phiên dịch đã dừng để tránh đọc trễ. Hãy tạm dừng video rồi thử lại.'));
        return false;
      }
      queue.push({ blob, sequence: ++sequence });
      if (!running) {
        running = true;
        task = Promise.resolve().then(drain);
      }
      return true;
    },
    stop,
    idle: () => task,
    get pending() { return controller.signal.aborted ? 0 : queue.length + Number(active); },
    get stopped() { return controller.signal.aborted; }
  };
}
