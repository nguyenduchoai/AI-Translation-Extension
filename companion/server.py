"""Loopback-only VieNeu adapter consumed by the extension's side panel."""
import asyncio
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from speech_engine import Failure, SAMPLE_RATE, SpeechEngine

ORIGIN_PATTERN = r"(?:chrome-extension://[a-p]{32}|http://(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?)"
engine = SpeechEngine()


@asynccontextmanager
async def lifespan(app):
    await asyncio.to_thread(engine.load)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def local_access(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin is not None and not re.fullmatch(ORIGIN_PATTERN, origin):
        return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    if request.method != "OPTIONS" and request.headers.get("x-ai-translator") != "1":
        return JSONResponse({"detail": "X-AI-Translator: 1 required"}, status_code=403)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ORIGIN_PATTERN,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-AI-Translator"],
    expose_headers=["X-Sample-Rate", "X-Audio-Channels", "Retry-After"],
    allow_private_network=True,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    voice: str | None = Field(default=None, max_length=100)


@app.get("/health")
async def health():
    return {"status": "ready", "engine": "VieNeu v3 Turbo", "sampleRate": SAMPLE_RATE,
            "precision": "fp32", "busy": engine.lock.locked()}


@app.get("/voices")
async def voices():
    return {"voices": engine.voices}


@app.post("/speech")
async def speech(body: SpeechRequest, request: Request):
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Text must not be blank")
    if body.voice and body.voice not in {voice["id"] for voice in engine.voices}:
        raise HTTPException(422, "Unknown preset voice")
    stream = engine.start(text, body.voice or None)
    if stream is None:
        raise HTTPException(429, "VieNeu đang đọc một câu khác.", headers={"Retry-After": "1"})
    try:
        first = await stream.next(request)
        if isinstance(first, Failure) or first is None:
            raise HTTPException(503, first.message if first else "VieNeu returned no audio")
    except BaseException:
        stream.cancel.set()
        raise

    async def audio():
        try:
            yield first
            while True:
                chunk = await stream.next(request)
                if chunk is None:
                    break
                if isinstance(chunk, Failure):
                    # Do not disguise a failed stream as a successful short utterance.
                    raise RuntimeError(chunk.message)
                yield chunk
        finally:
            stream.cancel.set()

    return StreamingResponse(audio(), media_type="audio/pcm", headers={
        "X-Sample-Rate": str(SAMPLE_RATE), "X-Audio-Channels": "1", "Cache-Control": "no-store",
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="info")
