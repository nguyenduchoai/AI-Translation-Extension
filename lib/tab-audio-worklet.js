// Runs on the audio thread. Each transferred buffer is a complete ten-second
// mono segment; no MediaRecorder container fragments need to be reconstructed.
class TabAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(Math.round(sampleRate * 10));
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let frame = 0; frame < channels[0].length; frame++) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame] || 0;
      this.samples[this.offset++] = sample / channels.length;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples, [this.samples.buffer]);
        this.samples = new Float32Array(Math.round(sampleRate * 10));
        this.offset = 0;
      }
    }
    // Outputs remain zero: captured sound must never be replayed into the tab.
    return true;
  }
}

registerProcessor('tab-audio-pcm', TabAudioProcessor);
