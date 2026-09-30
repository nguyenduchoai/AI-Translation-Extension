// Audio stays at the AudioContext's native rate. WAV records that rate so the
// ASR service can decode it without a lossy, handwritten browser resampler.
export function encodePcmWav(samples, sampleRate) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('Tần số âm thanh không được hỗ trợ.');
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function hasAudibleSamples(samples) {
  if (!samples.length) return false;
  let squares = 0;
  let peak = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) continue;
    squares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  // Skip only near-digital silence, not a voice-activity classifier. Keep even
  // quiet speech and short transients rather than losing words to an eager VAD.
  return Math.sqrt(squares / samples.length) >= 0.0001 || peak >= 0.001;
}

export async function startTabAudioCapture({ onChunk, onEnded, onError }) {
  if (!globalThis.navigator?.mediaDevices?.getDisplayMedia) {
    throw new Error('Trình duyệt không hỗ trợ chia sẻ âm thanh tab. Hãy dùng Chrome hoặc Edge trên máy tính.');
  }
  // Invoke this function directly from a click handler to preserve activation.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: { suppressLocalAudioPlayback: false },
    selfBrowserSurface: 'exclude',
    systemAudio: 'exclude',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude'
  });
  let context;
  let source;
  let worklet;
  let stopped = false;
  const endedListeners = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const [track, listener] of endedListeners) track.removeEventListener('ended', listener);
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.onprocessorerror = null;
      worklet.port.close();
      worklet.disconnect();
    }
    source?.disconnect();
    for (const track of stream.getTracks()) track.stop();
    context?.close().catch(() => {});
  };
  const fail = error => {
    if (stopped) return;
    stop();
    onError?.(error);
  };
  try {
    const video = stream.getVideoTracks()[0];
    const audio = stream.getAudioTracks()[0];
    if (video?.getSettings().displaySurface !== 'browser') {
      throw new Error('Hãy chọn một tab trình duyệt; không chọn cửa sổ hoặc toàn màn hình để tránh thu lại giọng dịch.');
    }
    if (!audio || audio.readyState === 'ended') {
      throw new Error('Chưa chia sẻ âm thanh. Chọn tab có video và bật “Chia sẻ âm thanh tab”.');
    }
    for (const track of stream.getTracks()) {
      const listener = () => { if (!stopped) { stop(); onEnded?.(); } };
      track.addEventListener('ended', listener, { once: true });
      endedListeners.push([track, listener]);
    }
    context = new AudioContext();
    await context.audioWorklet.addModule(new URL('./tab-audio-worklet.js', import.meta.url));
    // Sharing may end while Chrome loads the bundled processor.
    if (stopped || stream.getTracks().some(track => track.readyState === 'ended')) {
      stop();
      throw new Error('Đã kết thúc chia sẻ tab.');
    }
    source = context.createMediaStreamSource(new MediaStream([audio]));
    worklet = new AudioWorkletNode(context, 'tab-audio-pcm', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
    });
    worklet.port.onmessage = event => {
      if (stopped || !(event.data instanceof Float32Array)) return;
      try {
        if (!hasAudibleSamples(event.data)) return;
        const result = onChunk(encodePcmWav(event.data, context.sampleRate));
        Promise.resolve(result).catch(fail);
      } catch (error) { fail(error); }
    };
    worklet.onprocessorerror = () => fail(new Error('Bộ thu âm tab bị lỗi. Hãy dừng và chia sẻ lại tab.'));
    source.connect(worklet);
    // A silent connected output keeps processing active without replaying audio.
    worklet.connect(context.destination);
    await context.resume();
    if (stopped || context.state !== 'running') throw new Error('Không thể bật thu âm. Hãy bấm bắt đầu lại.');
    // Keep the video track alive to preserve the share, but never read or send it.
    return { stop };
  } catch (error) {
    stop();
    throw error;
  }
}
