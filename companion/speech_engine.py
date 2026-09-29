"""One CPU inference at a time; bounded output queue and disconnect cancellation."""
import asyncio
import logging
import queue
import threading
from dataclasses import dataclass

import numpy as np

LOG = logging.getLogger(__name__)
SAMPLE_RATE = 48000


@dataclass
class Failure:
    message: str


class SpeechEngine:
    def __init__(self):
        self.model = None
        self.voices = []
        self.lock = threading.Lock()

    def load(self):
        from model_cache import prepare_cache

        prepare_cache()
        from vieneu import Vieneu

        self.model = Vieneu(mode="v3turbo", backend="onnx", precision="fp32")
        self.voices = [
            {"id": voice_id, "name": label}
            for label, voice_id in self.model.list_preset_voices()
        ]
        # Loading graphs is insufficient: warm the phonemizer and decoder as well.
        for _ in self.model.infer_stream("Xin chào."):
            pass

    def start(self, text, voice):
        if not self.lock.acquire(blocking=False):
            return None
        stream = SpeechStream(self, text, voice)
        threading.Thread(target=stream.produce, daemon=True).start()
        return stream


class SpeechStream:
    def __init__(self, engine, text, voice):
        self.engine, self.text, self.voice = engine, text, voice
        self.cancel = threading.Event()
        self.output = queue.Queue(maxsize=4)

    def put(self, chunk):
        while not self.cancel.is_set():
            try:
                self.output.put(chunk, timeout=0.1)
                return
            except queue.Full:
                pass

    def produce(self):
        iterator = None
        try:
            iterator = self.engine.model.infer_stream(self.text, voice=self.voice)
            for chunk in iterator:
                if self.cancel.is_set():
                    break
                pcm = (np.clip(np.asarray(chunk), -1, 1) * 32767).astype("<i2")
                if pcm.size:
                    self.put(pcm.tobytes())
        except Exception:
            LOG.exception("Speech synthesis failed")
            self.put(Failure("Không tạo được giọng đọc. Xem cửa sổ VieNeu trên máy."))
        finally:
            try:
                if iterator is not None:
                    iterator.close()
            finally:
                self.engine.lock.release()
                self.put(None)

    async def next(self, request):
        for _ in range(300):
            if await request.is_disconnected():
                self.cancel.set()
                raise asyncio.CancelledError
            try:
                return self.output.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.1)
        self.cancel.set()
        return Failure("VieNeu xử lý quá lâu. Thử câu ngắn hơn.")
