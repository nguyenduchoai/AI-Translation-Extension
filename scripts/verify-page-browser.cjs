// Optional real-Chrome smoke test: NODE_PATH must expose Playwright. Provider responses are fixtures.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const root = process.env.EXTENSION_PATH ? path.resolve(process.env.EXTENSION_PATH) : path.resolve(__dirname, '..');
const fixture = `<!doctype html><html><body><h1 id="heading">Dental reference</h1>
<p id="paragraph">Dental plaque affects <strong id="term">gingiva</strong> and teeth.</p>
<p id="decimal">Measurement: 3.5 mm; tooth 36.</p><a id="link" href="#reference">Read reference</a>
<p id="unsafe">Safe sample</p><form><label>Private form label</label><input value="private-patient-123"><textarea>private-note-456</textarea></form>
<div hidden>hidden-secret-789</div><div contenteditable>editor-secret-012</div><pre>code-secret-345</pre>
<p id="dynamic">Original dynamic text</p><script>window.clicks=0;document.getElementById('link').onclick=e=>{e.preventDefault();window.clicks++}</script>
</body></html>`;
const wait = async (fn, message) => { for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error(message); };
(async () => {
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(fixture)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'page-translator-smoke-'));
 let context;
 try {
  context=await chromium.launchPersistentContext(profile,{headless:true,
   ...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{}),
   args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`],viewport:{width:1100,height:800}});
  const requests=[];let pendingReply;let delayed=false;
  await context.route(/https:\/\/(api\.openai\.com|generativelanguage\.googleapis\.com)\//,async route=>{
   const body=route.request().postDataJSON();requests.push(body);
   const user=body.messages?.[1]?.content?.[0]?.text||body.contents?.[0]?.parts?.[0]?.text;
   const blocks=JSON.parse(user.split('source data only:\n')[1]);
   const text=JSON.stringify(blocks.map(b=>({id:b.id,text:b.text==='Safe sample'?'<img src=x onerror=alert(1)>':`DỊCH: ${b.text}`})));
   const reply=async()=>route.fulfill({contentType:'application/json',body:JSON.stringify(body.messages?
    {choices:[{message:{content:text},finish_reason:'stop'}],model:'fixture-openai'}:
    {candidates:[{content:{parts:[{text}]},finishReason:'STOP'}],modelVersion:'fixture-gemini'})});
   if(delayed){pendingReply=reply;return;}await reply();
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const extensionId=new URL(worker.url()).host;
  const page=context.pages()[0];await page.goto(`http://127.0.0.1:${server.address().port}/article`);
  const original=await page.locator('body').innerHTML();
  const tabId=await worker.evaluate(async()=>{const t=await chrome.tabs.query({});return t.find(x=>x.url?.includes('/article')).id});
  const panel=await context.newPage();await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.waitForSelector('#prompt-select');
  await panel.evaluate(async()=>chrome.storage.sync.set({provider:'openai',apiKey:'fixture-key',model:'fixture-openai',targetLang:'vi',specialty:'dentistry'}));
  await panel.locator('.ai-translator-btn-settings').click();
  await panel.locator('#prompt-name').fill('Nha khoa riêng');await panel.locator('#prompt-body').fill('Use the phrase TERM-FIXTURE and preserve {{targetLanguage}}.');
  await panel.locator('#prompt-clone').click();await panel.locator('#prompt-status').filter({hasText:'Đã tạo'}).waitFor();
  const templateId=await panel.locator('#prompt-select').inputValue();assert.match(templateId,/^custom-/);
  await panel.reload();await panel.waitForSelector('#prompt-select');assert.equal(await panel.locator('#prompt-select').inputValue(),templateId);
  await panel.locator('.ai-translator-btn-settings').click();
  await panel.locator('#prompt-body').fill('UNSAVED-DRAFT must survive panel reload');
  await wait(()=>panel.evaluate(async()=>Boolean((await chrome.storage.local.get('promptTemplateDraftV1')).promptTemplateDraftV1)), 'draft did not persist');
  await panel.reload();await panel.waitForSelector('#prompt-select');
  assert.equal(await panel.locator('#prompt-body').inputValue(),'UNSAVED-DRAFT must survive panel reload');
  await panel.locator('.ai-translator-btn-settings').click();await panel.locator('#prompt-revert').click();
  await panel.locator('#prompt-status').filter({hasText:'Đã bỏ bản sửa'}).waitFor();
  assert.ok((await panel.locator('#prompt-body').inputValue()).includes('TERM-FIXTURE'));
  await panel.locator('.ai-translator-btn-settings').click();
  const send=action=>panel.evaluate(({action,tabId})=>chrome.runtime.sendMessage({action,tabId}),{action,tabId});
  const getState=()=>send('pageGetState');
  await page.bringToFront();await panel.evaluate(()=>document.getElementById('page-start').click());
  await wait(async()=>(await getState()).status==='done','page translation did not complete');
  assert.equal(await page.locator('#heading').textContent(),'DỊCH: Dental reference');
  assert.equal(await page.locator('#term').textContent(),'DỊCH: gingiva');assert.equal(await page.locator('#unsafe').textContent(),'<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#unsafe img').count(),0);await page.locator('#link').click();assert.equal(await page.evaluate(()=>window.clicks),1);
  const payload=JSON.stringify(requests);for(const secret of ['private-patient-123','private-note-456','hidden-secret-789','editor-secret-012','code-secret-345'])assert.ok(!payload.includes(secret),secret+' leaked');
  assert.ok(payload.includes('TERM-FIXTURE'));assert.ok(payload.includes('Vietnamese'));assert.ok(!payload.includes('image_url'));
  await send('pageRestore');assert.equal(await page.locator('body').innerHTML(),original);
  // Cancel a real pending HTTP response; a late provider reply must not touch the page.
  delayed=true;pendingReply=null;await send('pageStart');await wait(()=>Boolean(pendingReply),'provider request missing');await send('pageCancel');await pendingReply().catch(()=>{});
  await new Promise(r=>setTimeout(r,250));assert.equal((await getState()).status,'stopped');assert.equal(await page.locator('body').innerHTML(),original);
  // A site update during inference takes precedence over the old snapshot.
  pendingReply=null;await send('pageStart');await wait(()=>Boolean(pendingReply),'second pending request missing');
  await page.locator('#dynamic').evaluate(e=>{e.textContent='Site updated this text';});delayed=false;await pendingReply();
  await wait(async()=>(await getState()).status==='done','updated page translation did not complete');
  assert.equal(await page.locator('#dynamic').textContent(),'Site updated this text');assert.ok((await getState()).skipped>0);
  await send('pageRestore');assert.equal(await page.locator('#dynamic').textContent(),'Site updated this text');
  // Exercise Gemini through the same real worker/content-script path.
  await panel.evaluate(()=>chrome.storage.sync.set({provider:'gemini',geminiApiKey:'fixture-gemini-key',geminiModel:'fixture-gemini'}));
  await send('pageStart');await wait(async()=>(await getState()).status==='done','Gemini did not finish');
  assert.ok(requests.some(x=>x.system_instruction));await send('pageRestore');
  await panel.bringToFront();await panel.setViewportSize({width:390,height:900});
  await panel.locator('.ai-translator-btn-settings').click();await panel.locator('#prompt-template-editor').scrollIntoViewIfNeeded();
  await panel.screenshot({path:path.join(os.tmpdir(),'page-translator-prompt-panel.png')});
  console.log(JSON.stringify({success:true,providerRequests:requests.length,checks:['OpenAI/Gemini worker+DOM pipeline','custom prompt persisted and used','unsaved draft recovered and reverted','in-place translation','HTML output inert','form/hidden/editable excluded','links preserved','exact restore','cancel late response','site mutation preserved'],screenshot:path.join(os.tmpdir(),'page-translator-prompt-panel.png')},null,2));
 } finally {await context?.close();await new Promise(r=>server.close(r));fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
