const MAX_CHUNK_CHARS = 600;
const MAX_UNBROKEN_CHARS = 1200;
const ABBREVIATION = /(?:^|\s)(?:ts|pgs|gs|ths|bs|bsck\d*|dr|mr|mrs|ms|prof|vs|vd|v\.d|e\.g|i\.e|tp|q|p)\.$/iu;

function splitAtWordBoundaries(text, flush) {
    const chunks = [];
    let remaining = text.trimStart();
    while (remaining.length > MAX_CHUNK_CHARS) {
        let cut = -1;
        for (let i = MAX_CHUNK_CHARS; i > 0; i--) {
            if (/\s/u.test(remaining[i])) { cut = i; break; }
        }
        // An unusually long token stays intact, but must fit the backend limit.
        if (cut < 1) cut = remaining.search(/\s/u);
        if (cut < 1) break;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trimStart();
    }
    if (flush && remaining.trim()) {
        chunks.push(remaining.trim());
        remaining = '';
    }
    return { chunks, remaining };
}

// Leave ambiguous trailing punctuation in the buffer until whitespace or EOF.
// This prevents a streamed "3." from being spoken before the following "5".
export function splitSpeakableText(text, flush = false) {
    if (text.split(/\s/u).some(token => token.length > MAX_UNBROKEN_CHARS)) {
        throw new RangeError('Văn bản có chuỗi không có khoảng trắng dài hơn 1200 ký tự. Đã dừng đọc; hãy chia đoạn văn bản.');
    }
    const chunks = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\n') {
            const line = text.slice(start, i).trim();
            if (line) chunks.push(line);
            start = i + 1;
            continue;
        }
        if (!'.!?…。！？'.includes(char)) continue;
        let end = i + 1;
        while (end < text.length && /[.!?…。！？"'”’»\)\]]/u.test(text[end])) end++;
        if (end === text.length && !flush) continue;
        if (end < text.length && !/\s/u.test(text[end])) continue;
        const candidate = text.slice(start, end);
        if (char === '.' && (ABBREVIATION.test(candidate) || /^\s*\d+\.$/u.test(candidate))) continue;
        if (candidate.trim()) chunks.push(candidate.trim());
        start = end;
        i = end - 1;
    }
    // Apply the same limit to complete sentences, newline chunks and EOF suffixes.
    const boundedChunks = chunks.flatMap(chunk => splitAtWordBoundaries(chunk, true).chunks);
    const suffix = splitAtWordBoundaries(text.slice(start), flush);
    return { chunks: [...boundedChunks, ...suffix.chunks], remaining: suffix.remaining };
}

export class SpeechQueue {
    constructor({ speak, onStatus = () => {}, maxPendingChars = 12000 }) {
        if (typeof speak !== 'function') throw new TypeError('speak phải là hàm.');
        if (!Number.isFinite(maxPendingChars) || maxPendingChars < 1) {
            throw new RangeError('maxPendingChars phải là số dương.');
        }
        this.speak = speak;
        this.onStatus = onStatus;
        this.maxPendingChars = maxPendingChars;
        this.generation = 0;
        this.accepting = false;
        this.pending = [];
        this.remaining = '';
        this.fullText = '';
        this.active = null;
    }

    start() {
        this._reset();
        this.accepting = true;
        this._status('idle');
    }

    append(fullText) {
        if (!this.accepting) return;
        this._ingest(fullText, false);
    }

    finish(fullText = this.fullText) {
        if (!this.accepting) return;
        this._ingest(fullText, true);
        this.accepting = false;
    }

    stop() {
        this._reset();
        this._status('stopped');
    }

    _reset() {
        this.generation++;
        this.accepting = false;
        this.active?.controller.abort();
        this.active = null;
        this.pending = [];
        this.remaining = '';
        this.fullText = '';
    }

    _status(state, message) {
        this.onStatus({ state, pending: this.pending.length, ...(message ? { message } : {}) });
    }

    _fail(message) {
        this._reset();
        this._status('error', message);
    }

    _ingest(fullText, flush) {
        if (typeof fullText !== 'string' || !fullText.startsWith(this.fullText)) {
            this._fail('Văn bản AI đã thay đổi phần trước đó. Đã dừng đọc để tránh đọc lặp hoặc sai nội dung.');
            return;
        }
        const delta = fullText.slice(this.fullText.length);
        const bufferedChars = this.remaining.length + delta.length +
            this.pending.reduce((total, text) => total + text.length, 0) + (this.active?.text.length || 0);
        if (bufferedChars > this.maxPendingChars) {
            this._fail('Văn bản đến nhanh hơn tốc độ đọc, hàng đợi đã đầy. Đã dừng đọc; hãy đọc lại một đoạn ngắn hơn.');
            return;
        }
        this.fullText = fullText;
        let split;
        try {
            split = splitSpeakableText(this.remaining + delta, flush);
        } catch (error) {
            this._fail(error.message);
            return;
        }
        const { chunks, remaining } = split;
        this.remaining = remaining;
        this.pending.push(...chunks);
        if (chunks.length) this._status('queued');
        this._drain();
    }

    async _drain() {
        if (this.active) return;
        if (!this.pending.length) {
            this._status('idle');
            return;
        }
        const generation = this.generation;
        const active = { text: this.pending.shift(), controller: new AbortController() };
        this.active = active;
        this._status('speaking');
        try {
            await this.speak(active.text, active.controller.signal);
        } catch (error) {
            // A stopped/replaced request must never change the next generation.
            if (generation === this.generation) {
                this._fail(error?.message || 'Không thể tạo hoặc phát giọng đọc.');
            }
            return;
        }
        if (generation !== this.generation) return;
        this.active = null;
        this._drain();
    }
}
