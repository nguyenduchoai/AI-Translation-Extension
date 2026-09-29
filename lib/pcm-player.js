// Schedule short PCM buffers as they arrive, without waiting for a whole WAV file.
export class PcmPlayer {
  constructor() { this.context = null; this.volume = 0.8; }

  setVolume(volume) {
    this.volume = volume;
    if (this.activeGain) this.activeGain.gain.setValueAtTime(volume, this.context.currentTime);
  }

  async unlock() {
    this.context ||= new AudioContext();
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Bấm Nghe hoặc bật Đọc tự động để cho phép phát âm thanh.');
  }

  async play(response, signal, onFirstAudio) {
    await this.unlock();
    signal.throwIfAborted();
    const sampleRate = Number(response.headers.get('X-Sample-Rate'));
    if (sampleRate !== 48000 || !response.headers.get('Content-Type')?.startsWith('audio/pcm')) {
      throw new Error('VieNeu trả về định dạng âm thanh không được hỗ trợ.');
    }
    const reader = response.body.getReader();
    const sources = new Set();
    const gain = this.context.createGain();
    this.activeGain = gain;
    gain.gain.value = this.volume;
    gain.connect(this.context.destination);
    let nextTime = this.context.currentTime + 0.08;
    let pending = new Uint8Array();
    let samplesPlayed = 0;
    let first = true;
    let lastFinished = Promise.resolve();
    const abort = () => {
      for (const source of sources) { try { source.stop(); } catch {} }
      reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    const schedule = bytes => {
      const count = bytes.byteLength / 2;
      const audio = this.context.createBuffer(1, count, sampleRate);
      const output = audio.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < count; i++) output[i] = view.getInt16(i * 2, true) / 32768;
      const source = this.context.createBufferSource();
      source.buffer = audio;
      source.connect(gain);
      sources.add(source);
      lastFinished = new Promise(resolve => {
        source.onended = () => { sources.delete(source); source.disconnect(); resolve(); };
      });
      const at = Math.max(nextTime, this.context.currentTime + 0.03);
      source.start(at);
      nextTime = at + count / sampleRate;
      samplesPlayed += count;
      if (first) { first = false; onFirstAudio?.(); }
    };
    try {
      while (true) {
        signal.throwIfAborted();
        // Bound scheduled audio memory when synthesis runs faster than playback.
        while (nextTime - this.context.currentTime > 5) {
          await new Promise(resolve => setTimeout(resolve, 50));
          signal.throwIfAborted();
        }
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (value) {
          const merged = new Uint8Array(pending.length + value.length);
          merged.set(pending); merged.set(value, pending.length); pending = merged;
        }
        while (pending.length >= 9600) {
          schedule(pending.subarray(0, 9600));
          pending = pending.slice(9600);
        }
        if (done) break;
      }
      if (pending.length % 2) throw new Error('Luồng âm thanh bị cắt giữa mẫu PCM.');
      if (pending.length) schedule(pending);
      if (!samplesPlayed) throw new Error('VieNeu không trả về âm thanh.');
      await lastFinished;
      signal.throwIfAborted();
    } finally {
      abort();
      signal.removeEventListener('abort', abort);
      reader.releaseLock();
      gain.disconnect();
      if (this.activeGain === gain) this.activeGain = null;
    }
  }
}
