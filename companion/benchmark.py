"""Record real first-byte latency and save the streamed PCM as a WAV sample."""
import json
import time
import wave
from pathlib import Path

import httpx

TEXT = "Răng hàm có dấu hiệu viêm nha chu. Bác sĩ cần đánh giá mô quanh răng trước khi lập kế hoạch điều trị."
headers = {"X-AI-Translator": "1", "Origin": "chrome-extension://" + "a" * 32}
output = Path(__file__).resolve().parent / "outputs"
output.mkdir(exist_ok=True)
started = time.perf_counter()
chunks = []
first_byte = None
with httpx.stream("POST", "http://127.0.0.1:8001/speech", headers=headers,
                  json={"text": TEXT, "voice": "Mai Anh"}, timeout=90) as response:
    response.raise_for_status()
    sample_rate = int(response.headers["x-sample-rate"])
    for chunk in response.iter_bytes():
        if first_byte is None:
            first_byte = time.perf_counter() - started
        chunks.append(chunk)
elapsed = time.perf_counter() - started
pcm = b"".join(chunks)
with wave.open(str(output / "dental-vieneu.wav"), "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(sample_rate)
    audio.writeframes(pcm)
metrics = {"text": TEXT, "voice": "Mai Anh", "first_byte_seconds": first_byte,
           "synthesis_seconds": elapsed, "audio_seconds": len(pcm) / 2 / sample_rate,
           "sample_rate": sample_rate, "bytes": len(pcm)}
(output / "benchmark.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
print(json.dumps(metrics, ensure_ascii=False, indent=2))
