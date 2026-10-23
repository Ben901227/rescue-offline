// 案件目錄：列出這支手機上所有案件，可搜尋、依狀態篩選，點一下打開摘要。
// 底部「案件」分頁或頂部案件名稱進入；登入與離線準備在「同步與登入」頁（cases.js）。
import { esc, sheet, closeSheet, toast, ask, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { db, kv } from '../db.js';
import { caseStatus } from '../lib/caseSchema.js';
import { isAdmin, deleteCase, saveAndUpload, state as cloud } from '../cloud.js';
import { listPhotos, photoUrl, releaseUrls } from '../photos.js';

const FILTERS = [
  ['all', '全部'],
  ['active', '搜索中'],
  ['found', '已尋獲'],
  ['other', '其他'],
];
let filter = 'all';
let keyword = '';
const PAGE = 20; // 一次顯示的案件數，其餘按「顯示更多」
let limit = PAGE;

function daysSince(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(+d) ? null : Math.floor((Date.now() - d) / 86400000) + 1;
}

const matches = (c) => {
  const s = caseStatus(c);
  if (filter === 'active' && s !== '搜索中') return false;
  if (filter === 'found' && s !== '已尋獲') return false;
  if (filter === 'other' && (s === '搜索中' || s === '已尋獲')) return false;
  if (!keyword) return true;
  const hay = [c.meta.name, c.meta.title, c.meta.location, c.subject?.name, c.meta.reportDate].join(' ').toLowerCase();
  return hay.includes(keyword.toLowerCase());
};

function cardHtml(c, current) {
  const s = caseStatus(c);
  const days = s === '搜索中' && c.meta.reportDate ? daysSince(c.meta.reportDate) : null;
  return `<article class="card dir-card ${current ? 'current' : ''}">
    <button type="button" class="dir-main" data-open="${esc(c.id)}" aria-label="打開「${esc(c.meta.name)}」">
      <span class="dir-photo" data-photo-for="${esc(c.id)}">${icon('list', { size: 26 })}</span>
      <span class="dir-text">
        <span class="dir-title"><b>${esc(c.meta.name)}</b> <span class="chip ${s === '已尋獲' ? 'ok' : s === '搜索中' ? '' : 'muted'}">${esc(s)}</span>${current ? ' <span class="chip muted">目前</span>' : ''}</span>
        ${c.meta.title && c.meta.title !== c.meta.name ? `<span class="small">${esc(c.meta.title)}</span>` : ''}
        <span class="muted small">${esc([c.meta.reportDate, c.meta.location, days ? `搜索第 ${days} 天` : ''].filter(Boolean).join('・'))}</span>
        <span class="muted small">${c._sync?.source === 'cloud' ? '雲端・全隊共用' : '只在這支手機'}</span>
      </span>
    </button>
    <button type="button" class="btn small dir-more" data-more="${esc(c.id)}" aria-label="「${esc(c.meta.name)}」更多操作">${icon('more')}</button>
  </article>`;
}

export async function render(el, app) {
  const root = document.createElement('div');
  root.className = 'stack';
  el.append(root);

  root.innerHTML = `
    <h1 style="font-size:1.3rem">案件目錄</h1>
    <input type="search" id="dirSearch" placeholder="搜尋案件名稱、地點、失聯者" value="${esc(keyword)}" aria-label="搜尋案件">
    <div class="seg" role="group" aria-label="依狀態篩選">${FILTERS.map(([k, label]) => `<button type="button" class="btn small" data-filter="${k}" aria-pressed="${k === filter}">${label}</button>`).join('')}</div>
    <div id="dirList" class="stack"></div>
    <button type="button" class="btn hidden" id="dirMore" style="width:100%"></button>
    <div class="btn-row"><a class="btn" href="#/edit">${icon('plus', { size: 18 })}新增案件</a><a class="btn" href="#/cases">${icon('cloud', { size: 18 })}同步與登入</a></div>`;

  const list = root.querySelector('#dirList');
  const more = root.querySelector('#dirMore');
  const draw = () => {
    const matched = app.cases.filter(matches);
    const shown = matched.slice(0, limit);
    const rest = matched.length - shown.length;
    more.classList.toggle('hidden', rest <= 0);
    more.textContent = `顯示更多（還有 ${rest} 個案件）`;
    list.innerHTML = app.cases.length
      ? shown.length
        ? shown.map((c) => cardHtml(c, app.current?.id === c.id)).join('') + (matched.length > PAGE ? `<p class="muted small" style="text-align:center">顯示 ${shown.length} / ${matched.length} 個案件</p>` : '')
        : '<p class="muted" style="text-align:center">沒有符合的案件</p>'
      : `<div class="card empty"><p style="font-size:1.1rem;color:var(--text);font-weight:700">還沒有案件</p><p style="margin-top:6px">${cloud.user ? '雲端上沒有你能看到的案件，可以按「新增案件」建立。' : '按下方「同步與登入」用 Google 帳號登入，就會取得案件。'}</p></div>`;
    loadPhotos(shown);
  };

  // 有失蹤者照片的案件用照片當封面（只讀手機上的快取或雲端，讀不到就用圖示）
  async function loadPhotos(shown) {
    if (!cloud.user) return;
    for (const c of shown) {
      if (c._sync?.source !== 'cloud') continue;
      const p = (await listPhotos(c.id)).find((x) => x.kind === 'subject');
      const box = list.querySelector(`[data-photo-for="${CSS.escape(c.id)}"]`);
      if (p && box) box.innerHTML = `<img src="${photoUrl(p)}" alt="">`;
    }
  }

  more.onclick = () => {
    limit += PAGE;
    draw();
  };
  draw();
  root.querySelector('#dirSearch').addEventListener('input', (e) => {
    keyword = e.target.value.trim();
    limit = PAGE;
    draw();
  });
  root.querySelectorAll('[data-filter]').forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.filter;
      limit = PAGE;
      root.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw();
    };
  });

  list.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-open],[data-more]');
    if (!t) return;
    if (t.dataset.open) {
      await app.select(t.dataset.open);
      return app.go('summary');
    }
    const c = app.cases.find((x) => x.id === t.dataset.more);
    const s = sheet(`
      <h2>${esc(c.meta.name)}</h2>
      <div class="stack">
        <a class="btn" style="width:100%" href="#/edit?id=${encodeURIComponent(c.id)}">編輯案件資料</a>
        <a class="btn" style="width:100%" href="#/case?id=${encodeURIComponent(c.id)}">案件設定（裝備清單、無線電）</a>
        ${c._sync?.source !== 'cloud' && cloud.user ? '<button class="btn primary" style="width:100%" id="up">上傳到雲端，給全隊使用</button>' : ''}
        ${c._sync?.source === 'cloud' ? (isAdmin() ? '<button class="btn danger" style="width:100%" id="delCloud">從雲端刪除（全隊都會移除）</button>' : '') : '<button class="btn danger" style="width:100%" id="del">從這支手機刪除</button>'}
      </div>`);
    s.querySelector('#up')?.addEventListener('click', async () => {
      const r = await saveAndUpload({ ...(await db.get('cases', c.id)), _sync: undefined });
      closeSheet();
      toast(r.uploaded ? '已上傳到雲端' : r.reason, 5000);
      await app.reload();
      draw();
    });
    s.querySelector('#delCloud')?.addEventListener('click', async () => {
      if (!(await confirmBox(`從雲端刪除「${c.meta.name}」？全隊的手機都會移除這個案件、路線與照片，無法復原。`))) return;
      if ((await ask(`請輸入案件名稱「${c.meta.name}」確認刪除`, { ok: '刪除', hint: '刪除後全隊都會移除，無法復原' })) !== c.meta.name) return toast('名稱不符，已取消');
      try {
        await deleteCase(c.id);
        toast('已從雲端刪除');
      } catch (err) {
        toast(`刪除失敗：${err.message}`, 5000);
      }
    });
    s.querySelector('#del')?.addEventListener('click', async () => {
      if (!(await confirmBox(`刪除「${c.meta.name}」以及本機的打點、航跡、勾選？`))) return;
      await Promise.all([db.delete('cases', c.id), db.deleteByCase('tracks', c.id), db.deleteByCase('points', c.id), kv.del(`checklist:${c.id}`), kv.del(`coords:${c.id}`)]);
      if ((await kv.get('currentCase')) === c.id) await kv.del('currentCase');
      await app.reload();
      draw();
      toast('已從這支手機刪除');
    });
  });
}

export function destroy() {
  closeSheet();
  releaseUrls();
}
