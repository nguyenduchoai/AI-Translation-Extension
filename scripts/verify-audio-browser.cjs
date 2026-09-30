// Real Chrome/AudioWorklet, synthetic shared media and mocked providers; no paid API key.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.env.EXTENSION_PATH ? path.resolve(process.env.EXTENSION_PATH) : path.resolve(__dirname, '..');
const wait = async (fn, message, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(message);
};
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-translator-smoke-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true,
      ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required'],
      viewport: { width: 420, height: 1000 } });
    const requests = [], speechRequests = [], pageErrors = [];
    let groqStatus = 200, delayed = false, releaseResponse;
    await context.route('https://api.groq.com/**', async route => {
      const request = route.request();
      const bytes = request.postDataBuffer();
      const offset = bytes.indexOf(Buffer.from('RIFF'));
      assert.ok(offset >= 0, 'Groq needs a standalone WAV, not an incomplete media fragment');
      assert.equal(bytes.subarray(offset + 8, offset + 12).toString(), 'WAVE');
      const rate = bytes.readUInt32LE(offset + 24);
      assert.equal(bytes.readUInt32LE(offset + 40), rate * 10 * 2);
      assert.ok(bytes.includes(Buffer.from('whisper-large-v3-turbo')));
      assert.equal(request.headers().authorization, 'Bearer fixture-groq-key');
      requests.push({ rate, audioBytes: bytes.readUInt32LE(offset + 40) });
      if (delayed) await new Promise(resolve => { releaseResponse = resolve; });
      await route.fulfill({ status: groqStatus, contentType: 'application/json', body: JSON.stringify(groqStatus === 200
        ? { text: 'Dental measurement is 3.5 mm. <img src=x onerror=alert(1)>' }
        : { error: { message: 'PRIVATE PROVIDER DETAIL must not be displayed' } }) }).catch(() => {});
    });
    await context.route('https://api.openai.com/**', async route => {
      const body = route.request().postDataJSON();
      const user = body.messages[1].content[0].text;
      assert.ok(!JSON.stringify(body).includes('image_url'));
      const blocks = JSON.parse(user.split('source data only:\n')[1]);
      assert.match(body.messages[0].content, /Vietnamese/);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify(blocks.map(b => ({ id: b.id, text: 'Kích thước nha khoa là 3,5 mm. <img src=x onerror=alert(1)>' })))
      } }], model: 'fixture-openai' }) });
    });
    await context.route('http://127.0.0.1:8001/speech', async route => {
      speechRequests.push(route.request().postDataJSON());
      await route.fulfill({ headers: { 'Content-Type': 'audio/pcm', 'X-Sample-Rate': '48000' }, body: Buffer.alloc(4800) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    await worker.evaluate(() => chrome.storage.local.set({ translationHistory: [{ translation: 'HISTORY-REPLAY must not speak during audio', id: 1 }] }));
    const panel = await context.newPage();
    panel.on('pageerror', error => pageErrors.push(error.message));
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.waitForFunction(() => document.getElementById('speech-status').textContent !== 'Đang khởi tạo…');
    await panel.evaluate(async () => {
      await chrome.storage.sync.set({ provider: 'openai', apiKey: 'fixture-ai-key', specialty: 'dentistry' });
      window.audioFixture = { mode: 'normal', streams: [], contexts: [] };
      navigator.mediaDevices.getDisplayMedia = async options => {
        window.audioFixture.options = options;
        if (audioFixture.mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
        if (audioFixture.mode === 'delayed') await new Promise(resolve => { audioFixture.releaseChooser = resolve; });
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        oscillator.connect(destination); oscillator.start(); await context.resume();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
        canvas.getContext('2d').fillRect(0, 0, 16, 16);
        const video = canvas.captureStream(1).getVideoTracks()[0];
        video.getSettings = () => ({ displaySurface: 'browser' });
        const stream = new MediaStream([video, ...(audioFixture.mode === 'no-audio' ? [] : destination.stream.getAudioTracks())]);
        audioFixture.streams.push(stream); audioFixture.contexts.push(context);
        return stream;
      };
    });
    await panel.locator('#audio-panel summary').click();
    await panel.locator('#audio-groq-key').fill('fixture-groq-key');
    await panel.locator('#audio-save-key').click();
    await wait(() => panel.locator('#audio-status').textContent().then(t => t.includes('Đã lưu')), 'Key not saved');
    const storage = await panel.evaluate(async () => ({ local: await chrome.storage.local.get('groqAsrApiKey'), sync: await chrome.storage.sync.get('groqAsrApiKey') }));
    assert.equal(storage.local.groqAsrApiKey, 'fixture-groq-key'); assert.deepEqual(storage.sync, {});
    await panel.locator('#audio-start').click();
    await wait(() => panel.locator('.audio-result').count().then(n => n >= 2), 'Two audio segments did not translate', 35000);
    await wait(() => speechRequests.length >= 2, 'Translated audio did not reach VieNeu');
    assert.ok((await panel.locator('.audio-source').first().textContent()).includes('3.5 mm'));
    assert.equal(await panel.locator('#audio-results img').count(), 0, 'Provider HTML executed');
    assert.equal(await panel.locator('#speech-read').isDisabled(), true);
    await panel.locator('.ai-translator-speak-section').evaluate(button => button.click());
    await new Promise(r => setTimeout(r, 200));
    assert.ok(speechRequests.every(request => !request.text.includes('HISTORY-REPLAY')), 'History bypassed audio voice ownership');
    await panel.screenshot({ path: path.join(os.tmpdir(), 'audio-translator-results.png') });
    await panel.locator('#audio-stop').click();
    assert.ok(await panel.evaluate(() => audioFixture.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
    const count = requests.length;
    await new Promise(r => setTimeout(r, 11000)); assert.equal(requests.length, count, 'Requests continued after Stop');
    // A Stop while the chooser is pending must release its later grant.
    await panel.evaluate(() => { audioFixture.mode = 'delayed'; });
    await panel.locator('#audio-start').click(); await panel.locator('#audio-stop').click();
    await panel.evaluate(() => audioFixture.releaseChooser());
    await wait(() => panel.evaluate(() => audioFixture.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), 'Late capture leaked');
    for (const mode of ['denied', 'no-audio']) {
      await panel.evaluate(mode => { audioFixture.mode = mode; }, mode);
      await panel.locator('#audio-start').click();
      await wait(() => panel.locator('#audio-status').getAttribute('data-state').then(s => s === 'error'), mode + ' did not fail');
      assert.equal(await panel.locator('#audio-start').isDisabled(), false);
    }
    // Stop while Groq is pending; a late response cannot translate or speak.
    await panel.evaluate(() => { audioFixture.mode = 'normal'; }); delayed = true;
    await panel.locator('#audio-start').click();
    await wait(() => Boolean(releaseResponse), 'Expected pending Groq request');
    await panel.locator('#audio-stop').click(); const spoken = speechRequests.length;
    releaseResponse(); delayed = false; await new Promise(r => setTimeout(r, 300));
    assert.equal(await panel.locator('.audio-result').count(), 0); assert.equal(speechRequests.length, spoken);
    // Rate-limit failure ends capture and does not display the provider body.
    groqStatus = 429;
    await panel.locator('#audio-start').click();
    await wait(() => panel.locator('#audio-status').textContent().then(t => t.includes('HTTP 429')), 'Rate limit was not surfaced');
    assert.ok(!(await panel.locator('#audio-status').textContent()).includes('PRIVATE'));
    assert.ok(await panel.evaluate(() => audioFixture.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
    assert.equal(await panel.locator('#speech-read').isDisabled(), false);
    await panel.locator('#audio-groq-key').fill(''); await panel.locator('#audio-save-key').click();
    await wait(() => panel.evaluate(async () => !(await chrome.storage.local.get('groqAsrApiKey')).groqAsrApiKey), 'Key deletion failed');
    const screenshot = path.join(os.tmpdir(), 'audio-translator-panel.png'); await panel.screenshot({ path: screenshot });
    assert.deepEqual(pageErrors, []);
    await panel.evaluate(() => Promise.all(audioFixture.contexts.map(c => c.close())));
    console.log(JSON.stringify({ success: true, providerMode: 'mocked', mediaMode: 'synthetic shared tracks with real AudioWorklet', requests, speechRequests: speechRequests.length,
      checks: ['local-only key/save/delete', 'two independent ten-second WAVs', 'ASR to AI to PCM playback', 'inert provider HTML', 'stop capture and requests', 'late chooser cleanup', 'denied/no-audio', 'late response suppressed', '429 stops capture'], screenshot }, null, 2));
  } finally { await context?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
