import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechQueue, splitSpeakableText } from '../lib/speech-queue.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

test('per-character streaming preserves dental decimals, titles and lists without repetition', async () => {
    const spoken = [];
    const queue = new SpeechQueue({ speak: async text => { spoken.push(text); } });
    const text = 'TS. Nguyễn đo 3.5 mm. Không đau!\n1. Kiểm tra răng 16.\n2. Chưa chỉ định.';
    queue.start();
    for (let i = 1; i <= text.length; i++) {
        queue.append(text.slice(0, i));
        await tick();
    }
    queue.finish(text);
    queue.finish(text);
    queue.append(text);
    await tick();
    assert.deepEqual(spoken, [
        'TS. Nguyễn đo 3.5 mm.', 'Không đau!', '1. Kiểm tra răng 16.', '2. Chưa chỉ định.'
    ]);
});

test('trailing punctuation waits for disambiguation; finish flushes incomplete text once', async () => {
    const spoken = [];
    const queue = new SpeechQueue({ speak: async text => spoken.push(text) });
    queue.start();
    queue.append('Kích thước 3.');
    assert.deepEqual(spoken, []);
    queue.append('Kích thước 3.5 mm. ');
    queue.append('Kích thước 3.5 mm. Cần kiểm tra');
    queue.finish('Kích thước 3.5 mm. Cần kiểm tra');
    await tick();
    assert.deepEqual(spoken, ['Kích thước 3.5 mm.', 'Cần kiểm tra']);
});

test('sentences play sequentially, with queued/speaking/idle status', async () => {
    const tasks = [], states = [];
    const queue = new SpeechQueue({
        speak: text => { const job = deferred(); tasks.push({ text, ...job }); return job.promise; },
        onStatus: state => states.push(state)
    });
    queue.start();
    queue.finish('Câu một. Câu hai. Câu ba.');
    assert.equal(tasks.length, 1);
    tasks[0].resolve(); await tick();
    assert.equal(tasks.length, 2);
    tasks[1].resolve(); await tick();
    assert.equal(tasks.length, 3);
    tasks[2].resolve(); await tick();
    assert.ok(states.some(state => state.state === 'queued' && state.pending === 3));
    assert.deepEqual(states.at(-1), { state: 'idle', pending: 0 });
});

test('stop aborts speech and ignores late appends and completion', async () => {
    const job = deferred(), states = [];
    let signal, count = 0;
    const queue = new SpeechQueue({
        speak: (_, inputSignal) => { signal = inputSignal; count++; return job.promise; },
        onStatus: state => states.push(state)
    });
    queue.start(); queue.append('Một. Hai. '); queue.stop();
    assert.equal(signal.aborted, true);
    queue.append('Ba. '); queue.finish('Ba.');
    job.resolve(); await tick();
    assert.equal(count, 1);
    assert.deepEqual(states.at(-1), { state: 'stopped', pending: 0 });
});

test('new start isolates late rejection from cancelled generation', async () => {
    const tasks = [], states = [];
    const queue = new SpeechQueue({
        speak: (text, signal) => { const job = deferred(); tasks.push({ text, signal, ...job }); return job.promise; },
        onStatus: state => states.push(state)
    });
    queue.start(); queue.finish('Cũ. Bỏ qua.');
    queue.start(); queue.finish('Mới. Tiếp.');
    assert.equal(tasks[0].signal.aborted, true);
    tasks[0].reject(new Error('Aborted old generation')); await tick();
    assert.equal(states.at(-1).state, 'speaking');
    tasks[1].resolve(); await tick();
    assert.equal(tasks[2].text, 'Tiếp.');
    tasks[2].resolve(); await tick();
    assert.equal(states.at(-1).state, 'idle');
});

test('speech failure clears queued content and is visible', async () => {
    const states = [], spoken = [];
    const queue = new SpeechQueue({
        speak: async text => { spoken.push(text); throw new Error('Model unavailable'); },
        onStatus: state => states.push(state)
    });
    queue.start(); queue.finish('Một. Hai.'); await tick();
    queue.append('Ba.');
    assert.deepEqual(spoken, ['Một.']);
    assert.deepEqual(states.at(-1), { state: 'error', pending: 0, message: 'Model unavailable' });
});

test('rewritten cumulative content stops instead of reading duplicates', () => {
    const states = [];
    let signal;
    const queue = new SpeechQueue({
        speak: (_, value) => { signal = value; return new Promise(() => {}); },
        onStatus: state => states.push(state)
    });
    queue.start(); queue.append('Răng 16. '); queue.append('Răng 26. ');
    assert.equal(signal.aborted, true);
    assert.equal(states.at(-1).state, 'error');
    assert.match(states.at(-1).message, /thay đổi/);
});

test('backlog overflow is explicit and includes active speech and unfinished suffix', () => {
    const states = [];
    let signal;
    const queue = new SpeechQueue({
        maxPendingChars: 20,
        speak: (_, value) => { signal = value; return new Promise(() => {}); },
        onStatus: state => states.push(state)
    });
    queue.start(); queue.append('Một câu. '); queue.append('Một câu. ' + 'a'.repeat(20));
    assert.equal(signal.aborted, true);
    assert.equal(states.at(-1).state, 'error');
    assert.match(states.at(-1).message, /hàng đợi đã đầy/);
    queue.start(); queue.append('x'.repeat(21));
    assert.equal(states.at(-1).state, 'error');
});

test('long unpunctuated paragraphs split at whitespace without losing words', () => {
    const text = Array.from({ length: 400 }, (_, i) => `từ${i}`).join(' ');
    const { chunks, remaining } = splitSpeakableText(text, true);
    assert.equal(remaining, '');
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length <= 600));
    assert.equal(chunks.join(' '), text);
    assert.deepEqual(splitSpeakableText('a'.repeat(700)), { chunks: [], remaining: 'a'.repeat(700) });
});

test('closing quotes and international punctuation stay with sentences', () => {
    assert.deepEqual(splitSpeakableText('“Không đau.” Tiếp theo? Đúng！ Xong', true).chunks,
        ['“Không đau.”', 'Tiếp theo?', 'Đúng！', 'Xong']);
});

test('complete long sentences, newline chunks and final suffix all respect word-boundary cap', () => {
    const long = Array.from({ length: 420 }, (_, i) => `từ${i}`).join(' ');
    for (const text of [`${long}. `, `${long}\n`, `${long}. ${long}`]) {
        const { chunks, remaining } = splitSpeakableText(text, true);
        assert.equal(remaining, '');
        assert.ok(chunks.length > 3);
        assert.ok(chunks.every(chunk => chunk.length <= 600));
        assert.equal(chunks.join(' '), text.trim().replace(/\s+/gu, ' '));
    }
});

test('oversized unbroken token stops with a visible error before provider invocation', () => {
    const states = [], spoken = [];
    const queue = new SpeechQueue({
        speak: async text => spoken.push(text),
        onStatus: status => states.push(status)
    });
    for (const suffix of ['', '.', '\n']) {
        queue.start();
        queue.finish('Đầu câu. ' + 'x'.repeat(1201) + suffix);
        assert.equal(states.at(-1).state, 'error');
        assert.match(states.at(-1).message, /1200/);
    }
    assert.deepEqual(spoken, []);
    assert.throws(() => splitSpeakableText('x'.repeat(1201)), /1200/);
    assert.deepEqual(splitSpeakableText('x'.repeat(700), true).chunks, ['x'.repeat(700)]);
});
