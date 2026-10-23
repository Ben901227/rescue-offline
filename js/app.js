import * as log from './log.js'; // 最先載入，才能接到之後的程式錯誤
import { db, kv } from './db.js';
import { APP_VERSION } from './version.js';
import { normalizeCase, caseStatus } from './lib/caseSchema.js';
import * as summary from './views/summary.js';
import * as map from './views/map.js';
import * as gps from './views/gps.js';
import * as tasks from './views/tasks.js';
import * as cases from './views/cases.js';
import * as settings from './views/settings.js';
import * as edit from './views/editor.js';
import * as admin from './views/admin.js';
import { checkUpdate, applyUpdate } from './update.js';
import * as cloud from './cloud.js';

const views = { summary, map, gps, tasks, cases, settings, edit, admin };
const viewEl = document.getElementById('view');

const app = {
  cases: [],
  current: null,
  async reload() {
    this.cases = (await db.all('cases')).map(normalizeCase).sort((a, b) => (b.meta.reportDate || '').localeCompare(a.meta.reportDate || ''));
    const id = await kv.get('currentCase');
    this.current = this.cases.find((c) => c.id === id) || this.cases[0] || null;
    renderHeader();
  },
  async select(id) {
    await kv.set('currentCase', id);
    await this.reload();
  },
  go(tab) {
    location.hash = `#/${tab}`;
  },
};

let active = null;

function renderHeader() {
  const c = app.current;
  document.getElementById('caseName').textContent = c ? c.meta.name : '搜救資訊';
  const chip = document.getElementById('caseStatus');
  if (c) {
    const s = caseStatus(c);
    chip.textContent = s;
    chip.className = `chip ${s === '已尋獲' ? 'ok' : s === '搜索中' ? '' : 'muted'}`;
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }
}

async function route() {
  const tab = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const name = views[tab] ? tab : 'summary';
  active?.destroy?.();
  viewEl.innerHTML = '';
  viewEl.className = '';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  active = views[name];
  window.scrollTo(0, 0);
  if (!app.current && !['cases', 'gps', 'settings', 'edit', 'admin'].includes(name)) {
    viewEl.innerHTML = `<div class="card empty"><p>尚未選擇案件</p><a class="btn primary" href="#/cases">登入或選擇案件</a></div>`;
    return;
  }
  await active.render(viewEl, app);
}

function updateNet() {
  const el = document.getElementById('netStatus');
  el.textContent = navigator.onLine ? '連線中' : '離線';
  el.classList.toggle('offline', !navigator.onLine);
}

document.getElementById('caseSwitch').addEventListener('click', () => app.go('cases'));
document.getElementById('settingsBtn').addEventListener('click', () => app.go('settings'));
window.addEventListener('hashchange', route);
window.addEventListener('online', () => {
  updateNet();
  log.info('網路', '已連線');
});
window.addEventListener('offline', () => {
  updateNet();
  log.info('網路', '已離線');
});
updateNet();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => log.error('離線功能', '背景程式註冊失敗，離線可能無法使用', e.message));
}

// 有網路時檢查是否有新版，有的話在頂部提示
let updateDismissed = false;
async function showUpdateBar() {
  if (updateDismissed) return;
  const u = await checkUpdate();
  const bar = document.getElementById('updateBar');
  bar.hidden = u.status !== 'update';
  document.body.classList.toggle('has-update', !bar.hidden);
  if (u.status === 'update') document.getElementById('updateText').textContent = `有新版本（${u.latest}），目前 ${u.current}`;
}
document.getElementById('updateBtn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = '更新中…';
  if (!(await applyUpdate())) {
    e.target.disabled = false;
    e.target.textContent = '再試一次';
    document.getElementById('updateText').textContent = '更新失敗，請稍後再試（需要穩定的網路）';
  }
});
document.getElementById('updateLater').addEventListener('click', () => {
  updateDismissed = true;
  document.getElementById('updateBar').hidden = true;
  document.body.classList.remove('has-update');
});
window.addEventListener('online', showUpdateBar);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && showUpdateBar());
showUpdateBar();

// 版本有變（更新完成或第一次開啟）時記一筆
const lastVersion = await kv.get('lastVersion').catch(() => null);
if (lastVersion !== APP_VERSION) {
  log.info('更新', lastVersion ? `已更新到 ${APP_VERSION}` : `開始記錄（${APP_VERSION}）`, lastVersion ? `原本 ${lastVersion}` : '');
  kv.set('lastVersion', APP_VERSION).catch(() => {});
}

await app.reload();

// 雲端：登入狀態與資料變動時，重畫不會打斷操作的頁面（地圖、編輯中的頁面不重畫）
let currentTab = () => (location.hash.match(/^#\/(\w+)/) || [])[1] || 'summary';
const SAFE_RERENDER = ['summary', 'tasks', 'cases'];
window.addEventListener('cloud-data', () => SAFE_RERENDER.includes(currentTab()) && route());
let lastCloud = '';
cloud.onChange((s) => {
  const key = `${s.user?.email}|${s.role}|${s.status}`;
  if (key === lastCloud) return;
  lastCloud = key;
  if (currentTab() === 'cases') route();
});
cloud.start(app);

if (!app.current && !location.hash.startsWith('#/cases')) app.go('cases');
else await route();
