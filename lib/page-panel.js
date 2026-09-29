export function setupPagePanel() {
  const status = document.getElementById('page-status');
  const progress = document.getElementById('page-progress');
  const start = document.getElementById('page-start');
  const stop = document.getElementById('page-stop');
  const restore = document.getElementById('page-restore');
  let activeTabId;
  let refreshing = 0;
  function render(state) {
    if (state.tabId !== activeTabId) return;
    const busy = ['preparing', 'translating', 'restoring'].includes(state.status);
    start.disabled = busy;
    stop.disabled = !busy;
    restore.disabled = ['preparing', 'restoring'].includes(state.status);
    status.textContent = state.message || '';
    status.dataset.state = state.status;
    progress.hidden = !busy && !state.total;
    progress.max = state.total || 1;
    progress.value = state.completed || 0;
    document.getElementById('page-count').textContent = state.total
      ? `${state.completed || 0}/${state.total} đoạn · Đã thay ${state.applied || 0} đoạn${state.skipped ? ` · Bỏ qua ${state.skipped}` : ''}${state.promptLabel ? ` · ${state.promptLabel}` : ''}` : '';
  }
  async function action(action) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('Không tìm thấy trang đang mở.');
      activeTabId = tab.id;
      const response = await chrome.runtime.sendMessage({ action, tabId: tab.id });
      if (response?.error) throw new Error(response.error);
      render(response);
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = 'error';
      start.disabled = false;
      stop.disabled = true;
    }
  }
  async function refresh() {
    const generation = ++refreshing;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (generation !== refreshing || !tab) return;
      activeTabId = tab.id;
      const result = await chrome.runtime.sendMessage({ action: 'pageGetState', tabId: tab.id });
      if (generation !== refreshing) return;
      render(result?.error ? { tabId: tab.id, status: 'idle', message: result.error } : result);
    } catch { /* Opening/closing a tab may invalidate a transient request. */ }
  }
  start.addEventListener('click', () => { start.disabled = true; void action('pageStart'); });
  stop.addEventListener('click', () => { void action('pageCancel'); });
  restore.addEventListener('click', () => { void action('pageRestore'); });
  chrome.runtime.onMessage.addListener(message => {
    if (message.action === 'pageProgress') render(message);
  });
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (tabId === activeTabId && (change.url || change.status === 'complete')) void refresh();
  });
  void refresh();
}
