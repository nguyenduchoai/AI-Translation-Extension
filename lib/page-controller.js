import { resolveProviderSettings } from './ai-provider.js';
import { loadPromptSettings } from './prompt-templates.js';
import { splitPageBatches, translatePageBatch } from './page-translation.js';

const ACTIVE = new Set(['preparing', 'translating', 'restoring']);

// Jobs are bound to one tab and one DOM snapshot. Late replies never belong to a new job.
export function createPageController({ browser = chrome, translate = translatePageBatch,
  readPrompt = loadPromptSettings } = {}) {
  const jobs = new Map();
  const transitions = new Map();
  async function serialDom(tabId, operation) {
    const pending = (transitions.get(tabId) || Promise.resolve()).catch(() => {}).then(operation);
    transitions.set(tabId, pending);
    try { return await pending; }
    finally { if (transitions.get(tabId) === pending) transitions.delete(tabId); }
  }
  const state = job => ({ tabId: job.tabId, jobId: job.id, status: job.status,
    completed: job.completed, total: job.total, applied: job.applied, skipped: job.skipped,
    limited: job.limited, message: job.message, promptLabel: job.promptLabel });
  const notify = async job => {
    if (jobs.get(job.tabId) !== job) return;
    try { await browser.runtime.sendMessage({ action: 'pageProgress', ...state(job) }); } catch {}
  };
  const cancel = tabId => {
    const job = jobs.get(tabId);
    if (job && ACTIVE.has(job.status)) {
      job.status = 'stopped';
      job.message = 'Đã dừng. Phần đã dịch vẫn ở trên trang; có thể khôi phục bản gốc.';
      job.controller.abort();
      void notify(job);
    }
    return job;
  };
  const current = job => jobs.get(job.tabId) === job && !job.controller.signal.aborted;
  async function target(tabId) {
    const tab = Number.isInteger(tabId) ? await browser.tabs.get(tabId)
      : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '') ||
      /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i.test(tab.url)) {
      throw new Error('Mở một trang web HTTP/HTTPS thông thường để dịch. Trang Chrome, Store và PDF dạng ảnh không hỗ trợ dịch trang.');
    }
    return tab;
  }
  async function inject(tabId) {
    await browser.scripting.executeScript({ target: { tabId }, files: ['page-content.js'] });
  }
  async function run(job, tab) {
    // Finite keepalive only while translating; each request also times out before Chrome's fetch limit.
    const keepalive = setInterval(() => { void browser.runtime.getPlatformInfo?.().catch(() => {}); }, 20000);
    try {
      const settings = await browser.storage.sync.get({ provider: 'openai', apiKey: '', geminiApiKey: '',
        model: 'gpt-4o', geminiModel: 'gemini-3.8-flash', targetLang: 'vi', specialty: 'dentistry' });
      const provider = resolveProviderSettings(settings);
      if (!provider.apiKey) throw new Error('Mở Cài đặt, nhập và lưu API key trước khi dịch trang.');
      const prompt = await readPrompt(false);
      if (!current(job)) return;
      const snapshot = await serialDom(tab.id, async () => {
        if (!current(job)) return null;
        await inject(tab.id);
        if (!current(job)) return null;
        return browser.tabs.sendMessage(tab.id, { action: 'pageCollect' });
      });
      if (!current(job)) return;
      if (!snapshot?.sessionId || !Array.isArray(snapshot.blocks)) throw new Error(snapshot?.error || 'Không đọc được nội dung trang.');
      job.total = snapshot.blocks.length;
      job.limited = Boolean(snapshot.limited);
      job.skipped = snapshot.skipped || 0;
      job.promptLabel = prompt.promptLabel;
      if (!job.total) throw new Error('Không tìm thấy chữ phù hợp để dịch. Với ảnh, PDF hoặc nội dung nhúng, hãy dùng Chụp vùng/OCR.');
      job.status = 'translating';
      job.message = 'Đang dịch và thay chữ trên trang…';
      await notify(job);
      for (const blocks of splitPageBatches(snapshot.blocks)) {
        if (!current(job)) return;
        const latest = await browser.tabs.get(tab.id);
        if (latest.url !== tab.url) throw new Error('Trang đã chuyển địa chỉ. Hãy bắt đầu lại trên trang mới.');
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; job.controller.abort(); }, 25000);
        let result;
        try {
          result = await translate({ ...provider, targetLang: settings.targetLang,
            specialty: settings.specialty, ...prompt, blocks, signal: job.controller.signal });
        } catch (error) {
          if (timedOut) throw new Error('API phản hồi quá 25 giây. Hãy chọn model nhanh hơn và thử lại.');
          throw error;
        } finally { clearTimeout(timer); }
        if (!current(job)) return;
        const applied = await browser.tabs.sendMessage(tab.id, {
          action: 'pageApply', sessionId: snapshot.sessionId, translations: result.translations
        });
        if (!current(job)) return;
        if (applied?.error) throw new Error(applied.error);
        if (applied?.stale) throw new Error('Trang hoặc lượt dịch đã thay đổi. Hãy bắt đầu lại trên trang hiện tại.');
        if (!applied || !Number.isInteger(applied.applied)) throw new Error('Trang không nhận được bản dịch. Hãy tải lại trang và thử lại.');
        job.completed += blocks.length;
        job.applied += applied.applied;
        job.skipped += applied.skipped || 0;
        await notify(job);
      }
      if (!current(job)) return;
      job.status = 'done';
      job.message = job.limited || job.skipped
        ? 'Đã dịch phần nội dung phù hợp. Một số đoạn bị bỏ qua hoặc trang vượt giới hạn; không phải toàn bộ trang đã được dịch.'
        : 'Đã dịch xong nội dung chữ trên trang. Có thể khôi phục bản gốc bất cứ lúc nào.';
    } catch (error) {
      if (jobs.get(tab.id) === job && job.status !== 'stopped') {
        job.status = 'error';
        job.message = `${error.message || 'Không thể dịch trang.'} Phần đã dịch có thể khôi phục bằng Bản gốc.`;
      }
    } finally { clearInterval(keepalive); await notify(job); }
  }
  async function handle(message) {
    const tab = await target(message.tabId);
    if (message.action === 'pageStart') {
      cancel(tab.id);
      const job = { id: crypto.randomUUID(), tabId: tab.id, url: tab.url, controller: new AbortController(),
        status: 'preparing', completed: 0, total: 0, applied: 0, skipped: 0, limited: false,
        message: 'Đang đọc nội dung trang…', promptLabel: '' };
      jobs.set(tab.id, job);
      void run(job, tab);
      return state(job);
    }
    if (message.action === 'pageCancel') return state(cancel(tab.id) || {
      tabId: tab.id, status: 'idle', message: 'Không có lượt dịch đang chạy.' });
    if (message.action === 'pageRestore') {
      cancel(tab.id);
      const restoring = { id: crypto.randomUUID(), tabId: tab.id, url: tab.url, controller: new AbortController(),
        status: 'restoring', message: 'Đang khôi phục bản gốc…' };
      jobs.set(tab.id, restoring);
      const result = await serialDom(tab.id, async () => {
        if (!current(restoring)) return null;
        await inject(tab.id);
        if (!current(restoring)) return null;
        const reply = await browser.tabs.sendMessage(tab.id, { action: 'pageRestore' });
        if (reply?.error) throw new Error(reply.error);
        return reply;
      }).catch(error => {
        if (jobs.get(tab.id) === restoring) {
          restoring.status = 'error';
          restoring.message = error.message;
          void notify(restoring);
        }
        throw error;
      });
      if (!current(restoring)) return state(jobs.get(tab.id) || { tabId: tab.id, status: 'idle' });
      jobs.delete(tab.id);
      return { tabId: tab.id, status: 'idle', message: `Đã khôi phục ${result?.restored || 0} đoạn.${result?.skipped ? ' Nội dung đã được website thay đổi được giữ nguyên.' : ''}` };
    }
    const job = jobs.get(tab.id);
    if (job) return state(job);
    const saved = await browser.tabs.sendMessage(tab.id, { action: 'pageStatus' }).catch(() => null);
    return { tabId: tab.id, status: 'idle', message: saved?.translated
      ? 'Trang có bản dịch từ lượt trước. Bấm Bản gốc để khôi phục hoặc Dịch trang để dịch lại.'
      : 'Chọn mẫu prompt trong Cài đặt rồi bấm Dịch trang.' };
  }
  browser.tabs.onRemoved?.addListener(tabId => { cancel(tabId); jobs.delete(tabId); });
  browser.tabs.onUpdated?.addListener((tabId, change) => {
    const job = jobs.get(tabId);
    if (job && (change.status === 'loading' || (change.url && change.url !== job.url))) {
      cancel(tabId); jobs.delete(tabId);
    }
  });
  return { handle };
}
