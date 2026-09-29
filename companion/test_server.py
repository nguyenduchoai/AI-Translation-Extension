"""Contract tests isolate networking/queue behavior from expensive model startup."""
import threading
import time
import unittest

import numpy as np
from fastapi.testclient import TestClient

import server
from speech_engine import SpeechEngine

HEADERS = {"X-AI-Translator": "1", "Origin": "chrome-extension://" + "a" * 32}


class FakeModel:
    def infer_stream(self, text, voice=None):
        if text == "fail":
            raise ValueError("test failure")
        for _ in range(2):
            yield np.array([0.0, 0.5, -0.5], dtype=np.float32)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.previous_engine = server.engine
        server.engine = SpeechEngine()
        server.engine.model = FakeModel()
        server.engine.voices = [{"id": "Mai Anh", "name": "Mai Anh"}]
        self.client = TestClient(server.app, base_url="http://127.0.0.1:8001")

    def tearDown(self):
        self.client.close()
        server.engine = self.previous_engine

    def test_requires_header_and_rejects_foreign_origin(self):
        self.assertEqual(self.client.get("/health").status_code, 403)
        self.assertEqual(self.client.get("/health", headers={**HEADERS, "Origin": "https://evil.test"}).status_code, 403)
        self.assertEqual(self.client.get("/health", headers={**HEADERS, "Origin": "null"}).status_code, 403)
        self.assertEqual(self.client.get("/health", headers={**HEADERS, "Host": "evil.test"}).status_code, 400)

    def test_preflight_and_health(self):
        result = self.client.options("/speech", headers={**HEADERS,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-ai-translator"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["access-control-allow-origin"], HEADERS["Origin"])
        self.assertEqual(self.client.get("/health", headers=HEADERS).json()["sampleRate"], 48000)

    def test_pcm_contract_and_validation(self):
        result = self.client.post("/speech", headers=HEADERS, json={"text": "Xin chào", "voice": "Mai Anh"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["x-sample-rate"], "48000")
        self.assertEqual(np.frombuffer(result.content, dtype="<i2").tolist(), [0, 16383, -16383] * 2)
        for payload in [{"text": " "}, {"text": "x" * 1201}, {"text": "test", "voice": "unknown"}]:
            self.assertEqual(self.client.post("/speech", headers=HEADERS, json=payload).status_code, 422)

    def test_busy_and_failure_status(self):
        server.engine.lock.acquire()
        try:
            self.assertEqual(self.client.post("/speech", headers=HEADERS, json={"text": "test"}).status_code, 429)
        finally:
            server.engine.lock.release()
        self.assertEqual(self.client.post("/speech", headers=HEADERS, json={"text": "fail"}).status_code, 503)

    def test_cancel_releases_worker_with_full_queue(self):
        class EndlessModel:
            def infer_stream(self, *args, **kwargs):
                while True:
                    yield np.zeros(10, dtype=np.float32)
        server.engine.model = EndlessModel()
        stream = server.engine.start("test", None)
        time.sleep(0.05)
        stream.cancel.set()
        deadline = time.monotonic() + 2
        while server.engine.lock.locked() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertFalse(server.engine.lock.locked())


if __name__ == "__main__":
    unittest.main()
