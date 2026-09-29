import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../page-content.js', import.meta.url), 'utf8');

// Small DOM harness exercises the shipped isolated-world script and its messages.
function fixture() {
  const allText = [];
  const listeners = [];
  const body = element('body', null);
  let serial = 0;
  function element(tag, parent = body, attrs = {}, style = {}) {
    return {
      tagName: tag.toUpperCase(), parentElement: parent, attrs, style,
      id: attrs.id || '', classList: (attrs.class || '').split(' ').filter(Boolean),
      isContentEditable: false, hasAttribute: key => Object.hasOwn(attrs, key),
      getAttribute: key => attrs[key] ?? null,
    };
  }
  function text(value, parent = body, rects = [{ width: 30, height: 16, top: 0 }]) {
    const node = { nodeValue: value, parentElement: parent, isConnected: true, rects };
    allText.push(node);
    return node;
  }
  const context = vm.createContext({
    chrome: { runtime: { id: 'our-extension', onMessage: { addListener: x => listeners.push(x) } } },
    document: { body, designMode: 'off',
      createTreeWalker: () => {
        let index = 0;
        return { nextNode: () => allText[index++] || null };
      },
      createRange: () => {
        let node;
        return { selectNodeContents: x => { node = x; }, getClientRects: () => node.rects };
      },
    },
    location: { href: 'https://example.com/article' },
    crypto: { randomUUID: () => `session-${++serial}` },
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: el => ({ display: 'block', visibility: 'visible', opacity: '1', ...el.style }),
  });
  vm.runInContext(script, context);
  function message(action, values = {}, sender = { id: 'our-extension' }) {
    let response;
    listeners[0]({ action, ...values }, sender, value => { response = value; });
    return response === undefined ? undefined : JSON.parse(JSON.stringify(response));
  }
  return { body, element, text, context, listeners, message };
}

function apply(f, sessionId, id, text) {
  return f.message('pageApply', { sessionId, translations: [{ id, text }] });
}

test('collects rendered document text below fold but never private, hidden, code or extension UI text', () => {
  const f = fixture();
  f.text(' Visible heading ');
  f.text('Below fold', f.body, [{ width: 50, height: 16, top: 5000 }]);
  for (const tag of ['script', 'style', 'noscript', 'code', 'pre', 'svg', 'math',
    'iframe', 'input', 'textarea', 'select', 'button', 'form']) {
    f.text(`private ${tag}`, f.element('span', f.element(tag)));
  }
  for (const attrs of [{ hidden: '' }, { 'aria-hidden': 'true' }, { contenteditable: '' },
    { translate: 'no' }, { id: 'ai-translator-overlay' }, { class: 'ai-translator-hint' }]) {
    f.text('Excluded subtree', f.element('span', f.element('div', f.body, attrs)));
  }
  for (const style of [{ display: 'none' }, { visibility: 'hidden' },
    { opacity: '0' }, { contentVisibility: 'hidden' }]) {
    f.text('Hidden subtree', f.element('span', f.element('div', f.body, {}, style)));
  }
  f.text('Closed details', f.body, []);
  const result = f.message('pageCollect');
  assert.deepEqual(result.blocks, [{ id: '1', text: 'Visible heading' }, { id: '2', text: 'Below fold' }]);
  assert.equal(result.totalChars, 25);
  assert.equal(result.limited, false);
  assert.equal(result.skipped, 24);
});

test('applies plain text in place, preserves whitespace and safely restores exact original', () => {
  const f = fixture();
  const parent = f.element('a');
  parent.onclick = () => 'existing-handler';
  const node = f.text(' \nOriginal text\t ', parent);
  const { sessionId } = f.message('pageCollect');
  assert.deepEqual(apply(f, sessionId, '1', '<img src=x onerror=alert(1)>'), { applied: 1, skipped: 0 });
  assert.equal(node.nodeValue, ' \n<img src=x onerror=alert(1)>\t ');
  assert.equal(node.parentElement, parent);
  assert.equal(parent.onclick(), 'existing-handler');
  assert.equal(f.message('pageStatus').restorable, 1);
  assert.deepEqual(f.message('pageRestore'), { restored: 1, skipped: 0 });
  assert.equal(node.nodeValue, ' \nOriginal text\t ');
  assert.equal(f.message('pageStatus').sessionId, null);
  assert.equal(apply(f, sessionId, '1', 'Late response').stale, true);
});

test('rejects stale sessions/navigation and never clobbers dynamic app updates or disconnected nodes', () => {
  const f = fixture();
  const first = f.text('Source one');
  const second = f.text('Source two');
  const third = f.text('Source three');
  const { sessionId } = f.message('pageCollect');
  assert.equal(apply(f, 'wrong-session', '1', 'Bad').stale, true);
  first.nodeValue = 'Live app update';
  second.isConnected = false;
  assert.deepEqual(f.message('pageApply', { sessionId,
    translations: [{ id: '1', text: 'Wrong' }, { id: '2', text: 'Wrong' }] }), { applied: 0, skipped: 2 });
  f.context.location.href = 'https://example.com/new-route';
  assert.equal(apply(f, sessionId, '3', 'Wrong').stale, true);
  assert.equal(f.message('pageStatus').stale, true);
  assert.equal(first.nodeValue, 'Live app update');
  assert.equal(third.nodeValue, 'Source three');
});

test('restore preserves post-translation edits; collecting again uses originals, not old translations', () => {
  const f = fixture();
  const first = f.text('English one');
  const second = f.text('English two');
  const a = f.message('pageCollect');
  apply(f, a.sessionId, '1', 'Tiếng Việt một');
  apply(f, a.sessionId, '2', 'Tiếng Việt hai');
  second.nodeValue = 'Framework update';
  assert.equal(f.message('pageStatus').restorable, 1);
  const b = f.message('pageCollect');
  assert.equal(first.nodeValue, 'English one');
  assert.equal(second.nodeValue, 'Framework update');
  assert.deepEqual(b.blocks.map(x => x.text), ['English one', 'Framework update']);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(apply(f, a.sessionId, '1', 'Old response').stale, true);
});

test('reports exact caps and skips oversized nodes without truncating content', () => {
  const f = fixture();
  const oversized = f.text('x'.repeat(4001));
  for (let i = 0; i < 601; i++) f.text('a'.repeat(100));
  const result = f.message('pageCollect');
  assert.equal(result.blocks.length, 600);
  assert.equal(result.totalChars, 60000);
  assert.equal(result.skipped, 2);
  assert.equal(result.limited, true);
  assert.equal(oversized.nodeValue.length, 4001);
  const g = fixture();
  for (let i = 0; i < 601; i++) g.text('A');
  assert.equal(g.message('pageCollect').blocks.length, 600);
});

test('applies only valid, still-public nodes and ignores unknown/duplicate/empty model results', () => {
  const f = fixture();
  const publicNode = f.text('Public article');
  const privateParent = f.element('div');
  const privateNode = f.text('Now editing', privateParent);
  const { sessionId } = f.message('pageCollect');
  privateParent.attrs.contenteditable = '';
  const result = f.message('pageApply', { sessionId, translations: [
    null, { id: '1', text: ' ' }, { id: '1', text: 'a'.repeat(12001) },
    { id: 'unknown', text: 'Ignore' }, { id: '2', text: 'Ignore' },
    { id: '1', text: 'Bài viết' }, { id: '1', text: 'Duplicate' },
  ] });
  assert.deepEqual(result, { applied: 1, skipped: 6 });
  assert.equal(publicNode.nodeValue, 'Bài viết');
  assert.equal(privateNode.nodeValue, 'Now editing');
});

test('injection is idempotent; unrelated senders and messages cannot read page content', () => {
  const f = fixture();
  f.text('Private content');
  vm.runInContext(script, f.context);
  assert.equal(f.listeners.length, 1);
  assert.equal(f.message('pageCollect', {}, { id: 'another-extension' }), undefined);
  assert.equal(f.message('unrelatedAction'), undefined);
  f.context.document.designMode = 'on';
  assert.equal(f.message('pageCollect').blocks.length, 0);
});


test('collect works on insecure HTTP pages where randomUUID is unavailable', () => {
  const f = fixture();
  f.context.location.href = 'http://example.com/article';
  f.context.crypto = { getRandomValues: array => array.fill(7) };
  f.text('HTTP article');
  const result = f.message('pageCollect');
  assert.equal(result.sessionId, '07'.repeat(16));
  assert.equal(result.blocks[0].text, 'HTTP article');
});
