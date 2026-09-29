// Injected on demand in the isolated world. Page text stays in existing DOM nodes.
(() => {
  if (globalThis.__aiTranslatorPageInjected) return;
  globalThis.__aiTranslatorPageInjected = true;

  const MAX_CHARS = 60000;
  const MAX_BLOCKS = 600;
  const MAX_NODE_CHARS = 4000;
  const EXCLUDED = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG', 'MATH', 'IFRAME',
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'DATALIST', 'FORM',
  ]);
  let session = null;

  function eligible(node, styleCache = new WeakMap()) {
    if (!node.isConnected || !node.parentElement) return false;
    if (document.designMode?.toLowerCase() === 'on') return false;
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (EXCLUDED.has(el.tagName.toUpperCase()) || el.isContentEditable ||
          el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false' ||
          el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' ||
          el.getAttribute('translate') === 'no' || el.hasAttribute('data-ai-translator') ||
          el.id?.startsWith('ai-translator-') ||
          [...el.classList].some(name => name.startsWith('ai-translator-'))) return false;
      let style = styleCache.get(el);
      if (!style) {
        style = getComputedStyle(el);
        styleCache.set(el, style);
      }
      if (style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse' || style.contentVisibility === 'hidden' ||
          Number(style.opacity) === 0) return false;
    }
    // Text ranges also exclude closed details and other non-rendered descendants.
    // No viewport intersection check: below-the-fold text is part of the page.
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  }

  function restore() {
    let restored = 0;
    let skipped = 0;
    for (const item of session?.nodes.values() || []) {
      if (item.appliedText === null) continue;
      // A framework/user update takes ownership back; never replace its new text.
      if (item.node.isConnected && item.node.nodeValue === item.appliedText) {
        item.node.nodeValue = item.original;
        restored++;
      } else skipped++;
    }
    session = null;
    return { restored, skipped };
  }

  function collect() {
    restore();
    const sessionId = crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    session = { id: sessionId, href: location.href, nodes: new Map() };
    const blocks = [];
    let totalChars = 0;
    let skipped = 0;
    let limited = false;
    if (!document.body) return { sessionId, blocks, totalChars, skipped, limited };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const styles = new WeakMap();
    let node;
    while ((node = walker.nextNode())) {
      const original = node.nodeValue;
      const text = original.trim();
      if (!text) continue;
      if (!eligible(node, styles)) { skipped++; continue; }
      // Do not truncate a node: it would lose text or exceed the AI batch budget.
      if (text.length > MAX_NODE_CHARS || blocks.length >= MAX_BLOCKS ||
          totalChars + text.length > MAX_CHARS) {
        limited = true;
        skipped++;
        continue;
      }
      const id = String(blocks.length + 1);
      const prefix = original.match(/^\s*/u)[0];
      const suffix = original.match(/\s*$/u)[0];
      session.nodes.set(id, { node, original, prefix, suffix, appliedText: null });
      blocks.push({ id, text });
      totalChars += text.length;
    }
    return { sessionId, blocks, totalChars, limited, skipped };
  }

  function apply(message) {
    const translations = Array.isArray(message.translations) ? message.translations : [];
    if (!session || session.id !== message.sessionId || session.href !== location.href) {
      return { applied: 0, skipped: translations.length, stale: true };
    }
    let applied = 0;
    let skipped = 0;
    const styles = new WeakMap();
    for (const translation of translations) {
      const item = session.nodes.get(translation?.id);
      if (!item || item.appliedText !== null || typeof translation.text !== 'string' ||
          !translation.text.trim() || translation.text.length > 12000 ||
          item.node.nodeValue !== item.original || !eligible(item.node, styles)) {
        skipped++;
        continue;
      }
      item.appliedText = item.prefix + translation.text.trim() + item.suffix;
      // Untrusted model output is text, never markup or executable HTML.
      item.node.nodeValue = item.appliedText;
      applied++;
    }
    return { applied, skipped };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only the extension's background/panel may request collection or mutation.
    if (sender.id !== chrome.runtime.id) return false;
    try {
      switch (message.action) {
        case 'pageCollect': sendResponse(collect()); break;
        case 'pageApply': sendResponse(apply(message)); break;
        case 'pageRestore': sendResponse(restore()); break;
        case 'pageStatus': {
          const items = [...(session?.nodes.values() || [])];
          const applied = items.filter(x => x.appliedText !== null).length;
          const restorable = items.filter(x => x.appliedText !== null &&
            x.node.isConnected && x.node.nodeValue === x.appliedText).length;
          sendResponse({ sessionId: session?.id || null,
            stale: Boolean(session && session.href !== location.href),
            total: items.length, applied, translated: applied, restorable });
          break;
        }
        default: return false;
      }
    } catch (error) {
      sendResponse({ error: error.message || 'Không thể xử lý nội dung trang.' });
    }
    return false;
  });
})();
