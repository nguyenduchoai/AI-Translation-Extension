// Native Chrome getDisplayMedia + real AudioWorklet. Source audio is a local
// oscillator; no mocked capture API, real speech recognition, or API keys.
// This smoke needs BROWSER_HEADED=1 on the verified macOS Chrome for Testing.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const root = process.env.EXTENSION_PATH ? path.resolve(process.env.EXTENSION_PATH) : path.resolve(__dirname, '..');
const fixture = `<!doctype html><title>GroqAudioFixture</title><button id="play">Play source tone</button>
<script>document.querySelector('#play').onclick=async()=>{
  window.sourceContext=new AudioContext();const oscillator=sourceContext.createOscillator();
  oscillator.frequency.value=440;oscillator.connect(sourceContext.destination);oscillator.start();
  await sourceContext.resume();window.sourceReady=true;
};</script>`;

// Side-panel WebContents are CDP page targets but Playwright omits them from
// context.pages(). Attach directly and use native Input events for activation.
async function sidePanelAdapter(browserSession, targetId, errors) {
  const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId, flatten: false });
  let nextId = 0;
  const pending = new Map();
  browserSession.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id) {
      const promise = pending.get(message.id); pending.delete(message.id);
      if (message.error) promise?.reject(new Error(message.error.message)); else promise?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    browserSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  await send('Runtime.enable');
  const evaluate = async (fn, argument) => {
    const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(argument) || ''})`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitForFunction = async (fn, argument, { timeout = 30000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(fn, argument)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Native side panel condition timed out');
  };
  return { evaluate, waitForFunction, on() {},
    waitForLoadState: () => waitForFunction(() => document.readyState !== 'loading'),
    waitForTimeout: delay => new Promise(resolve => setTimeout(resolve, delay)),
    locator: selector => ({ click: async () => {
      const point = await evaluate(selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }, selector);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    } }) };
}

(async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'native-tab-capture-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: process.env.BROWSER_HEADED !== '1',
      ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`,
        '--auto-select-tab-capture-source-by-title=GroqAudioFixture',
        '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding'],
      viewport: { width: 900, height: 800 }
    });
    const errors = [];
    const providerRequests = [];
    await context.route(/https?:\/\/(api\.groq\.com|api\.openai\.com|generativelanguage\.googleapis\.com|127\.0\.0\.1:8001)\//, route => {
      providerRequests.push(route.request().url());
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const source = context.pages()[0];
    await source.goto(`http://127.0.0.1:${server.address().port}/source`);
    await source.locator('#play').click();
    await source.waitForFunction(() => window.sourceReady);
    let page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    if (process.env.BROWSER_NATIVE_SIDE_PANEL === '1') {
      const previousPages = new Set(context.pages());
      await page.evaluate(async () => {
        const { id: windowId } = await chrome.windows.getCurrent();
        const button = document.createElement('button');
        button.id = 'open-native-side-panel'; button.textContent = 'Open browser side panel';
        button.style.cssText = 'position:fixed;top:0;left:0;z-index:999999';
        button.onclick = () => chrome.sidePanel.open({ windowId });
        document.body.append(button);
      });
      await page.locator('#open-native-side-panel').click();
      await page.waitForTimeout(3000);
      let newPage = context.pages().find(candidate => !previousPages.has(candidate));
      if (!newPage) {
        const browserSession = await context.browser().newBrowserCDPSession();
        const targets = (await browserSession.send('Target.getTargets')).targetInfos;
        const target = targets.find(target => !target.attached && target.type === 'page' && target.url === `chrome-extension://${id}/sidepanel.html`);
        if (!target) throw new Error('Native side panel target not found.');
        newPage = await sidePanelAdapter(browserSession, target.targetId, errors);
      }
      page = newPage;
      page.on('pageerror', error => errors.push(error.message));
      await page.waitForLoadState();
    }
    await page.evaluate(async () => {
      const { startTabAudioCapture } = await import('./lib/tab-audio-capture.js');
      window.nativeCapture = { chunks: [], stoppedTracks: [], errors: [] };
      // Observe real stop calls without replacing capture, tracks, or settings.
      const nativeStop = MediaStreamTrack.prototype.stop;
      MediaStreamTrack.prototype.stop = function () {
        nativeStop.call(this);
        nativeCapture.stoppedTracks.push({ kind: this.kind, state: this.readyState });
      };
      const button = document.createElement('button');
      button.id = 'native-capture-start'; button.textContent = 'Start native capture smoke';
      button.style.cssText = 'position:fixed;top:0;left:0;z-index:999999';
      document.body.append(button);
      button.onclick = () => {
        // The extension emits a distinct tone to detect accidental output feedback.
        window.outputContext = new AudioContext();
        const oscillator = outputContext.createOscillator();
        oscillator.frequency.value = 880; oscillator.connect(outputContext.destination); oscillator.start();
        outputContext.resume();
        startTabAudioCapture({
          onChunk: async blob => nativeCapture.chunks.push(await blob.arrayBuffer()),
          onError: error => nativeCapture.errors.push(error.message),
          onEnded: () => { nativeCapture.ended = true; }
        }).then(handle => { nativeCapture.handle = handle; }, error => { nativeCapture.errors.push(error.message); });
      };
    });
    await page.locator('#native-capture-start').click();
    try {
      await page.waitForFunction(() => nativeCapture.chunks.length || nativeCapture.errors.length, null, { timeout: 30000 });
    } catch (error) {
      console.error('Native capture diagnostic:', await page.evaluate(() => ({
        started: Boolean(nativeCapture.handle), chunks: nativeCapture.chunks.length,
        errors: nativeCapture.errors, ended: Boolean(nativeCapture.ended),
        outputState: outputContext.state
      })));
      throw error;
    }
    const evidence = await page.evaluate(async () => {
      if (nativeCapture.errors.length) return { errors: nativeCapture.errors };
      const bytes = nativeCapture.chunks[0];
      const view = new DataView(bytes);
      const rate = view.getUint32(24, true);
      const count = view.getUint32(40, true) / 2;
      // Measure one second after startup. Comparing tones checks that the
      // extension's output stays outside the selected tab's captured audio.
      const amplitude = frequency => {
        let real = 0, imaginary = 0;
        for (let i = 0; i < rate; i++) {
          const sample = view.getInt16(44 + (rate + i) * 2, true) / 32768;
          const angle = 2 * Math.PI * frequency * i / rate;
          real += sample * Math.cos(angle); imaginary += sample * Math.sin(angle);
        }
        return 2 * Math.hypot(real, imaginary) / rate;
      };
      const result = { rate, samples: count, bytes: bytes.byteLength,
        source440: amplitude(440), extension880: amplitude(880),
        riff: new TextDecoder().decode(bytes.slice(0, 4)),
        wave: new TextDecoder().decode(bytes.slice(8, 12)) };
      nativeCapture.handle.stop(); nativeCapture.handle.stop();
      await outputContext.close();
      result.stoppedTracks = nativeCapture.stoppedTracks;
      result.errors = nativeCapture.errors;
      return result;
    });
    assert.deepEqual(evidence.errors, [], 'Native tab audio capture failed');
    assert.equal(evidence.riff, 'RIFF'); assert.equal(evidence.wave, 'WAVE');
    assert.equal(evidence.samples, evidence.rate * 10);
    assert.equal(evidence.bytes, 44 + evidence.samples * 2);
    assert.ok(evidence.source440 > 0.05, 'Source tab audio was not captured');
    assert.ok(evidence.extension880 < evidence.source440 * 0.05, 'Extension playback leaked into captured tab');
    assert.deepEqual(evidence.stoppedTracks.map(track => track.kind).sort(), ['audio', 'video']);
    assert.ok(evidence.stoppedTracks.every(track => track.state === 'ended'));
    await page.waitForTimeout(11000);
    assert.equal(await page.evaluate(() => nativeCapture.chunks.length), 1, 'Capture continued after Stop');
    assert.deepEqual(errors, []);
    assert.deepEqual(providerRequests, [], 'Native capture smoke must not contact providers');
    await source.evaluate(() => sourceContext.close());
    console.log(JSON.stringify({ success: true, chrome: context.browser().version(),
      surface: process.env.BROWSER_NATIVE_SIDE_PANEL === '1' ? 'native browser side panel container'
        : 'extension page loading sidepanel.html; not the browser side panel container',
      capture: 'native getDisplayMedia; chooser auto-selected by Chrome testing flag',
      audio: 'local synthetic source oscillator, real tab audio route', providerCalls: providerRequests.length,
      checks: ['complete ten-second WAV', 'source audio present', 'extension output excluded',
        'audio/video native tracks ended', 'idempotent stop', 'no chunks after stop'], evidence }, null, 2));
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
