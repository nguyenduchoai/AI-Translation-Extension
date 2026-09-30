import { splitSpeakableText } from './speech-queue.js';

// Buffer translated segments only; completed audio never accumulates a full transcript.
export function createAudioVoiceQueue({ speak, onError, maxPending = 3, maxChars = 2400 }) {
  if (typeof speak !== 'function' || typeof onError !== 'function') throw new Error('Thiếu bộ phát giọng đọc âm thanh.');
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || !Number.isSafeInteger(maxChars) || maxChars < 1) {
    throw new Error('Giới hạn hàng đợi giọng đọc không hợp lệ.');
  }
  const controller = new AbortController();
  const queue = [];
  let active = false;
  let running = false;
  let pendingChars = 0;
  let task = Promise.resolve();

  function stop() {
    queue.length = 0;
    pendingChars = 0;
    controller.abort();
  }

  function fail(error) {
    if (controller.signal.aborted) return;
    stop();
    try { Promise.resolve(onError(error)).catch(() => {}); } catch { /* Queue already stopped. */ }
  }

  async function drain() {
    try {
      while (queue.length && !controller.signal.aborted) {
        const segment = queue.shift();
        active = true;
        for (const chunk of segment.chunks) {
          if (controller.signal.aborted) return;
          await speak(chunk, controller.signal);
        }
        if (controller.signal.aborted) return;
        pendingChars -= segment.chars;
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
    enqueue(text) {
      if (controller.signal.aborted) return false;
      if (typeof text !== 'string' || !text.trim()) {
        fail(new Error('Không có bản dịch hợp lệ để đọc.'));
        return false;
      }
      if (queue.length + Number(active) >= maxPending || pendingChars + text.length > maxChars) {
        fail(new Error('Giọng đọc chậm hơn video; hàng đợi đã đầy. Phiên dịch đã dừng để tránh đọc trễ. Hãy tạm dừng video rồi thử lại.'));
        return false;
      }
      let chunks;
      try { chunks = splitSpeakableText(text, true).chunks; }
      catch (error) { fail(error); return false; }
      queue.push({ chunks, chars: text.length });
      pendingChars += text.length;
      if (!running) {
        running = true;
        task = Promise.resolve().then(drain);
      }
      return true;
    },
    stop,
    idle: () => task,
    get pending() { return controller.signal.aborted ? 0 : queue.length + Number(active); },
    get pendingChars() { return pendingChars; },
    get stopped() { return controller.signal.aborted; }
  };
}
