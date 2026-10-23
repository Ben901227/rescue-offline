import { esc, toast } from '../ui.js';
import { icon } from '../icons.js';
import { APP_VERSION, APP_CHANNEL, APP_DATE } from '../version.js';
import { checkUpdate, applyUpdate } from '../update.js';
import { db } from '../db.js';
import { validateCase } from '../lib/caseSchema.js';
import { saveAndUpload, state as cloud, signOut, isAdmin } from '../cloud.js';

const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 把案件的清單轉成可編輯的形式；保留既有 id，讓已勾選的項目在編輯後仍維持勾選
function editable(checklist = []) {
  return checklist.map((g, gi) => ({
    group: g.group || '',
    items: (g.items || []).map((it, ii) => (typeof it === 'string' ? { id: `${gi}-${ii}`, text: it } : { id: it.id || `${gi}-${ii}`, text: it.text || '' })),
  }));
}

const clean = (groups) =>
  groups
    .map((g) => ({ group: g.group.trim(), items: g.items.filter((it) => it.text.trim()).map((it) => ({ id: it.id, text: it.text.trim() })) }))
    .filter((g) => g.group || g.items.length);

export async function render(el, app) {
  const c = app.current;
  el.innerHTML = `
    <div class="stack">
      <h1 style="font-size:1.3rem">設定</h1>

      <h2 class="settings-group">目前案件${c ? `：${esc(c.meta.name)}` : ''}</h2>
      ${c ? `<div class="btn-row"><a class="btn" href="#/edit?id=${encodeURIComponent(c.id)}">編輯案件資料</a><a class="btn" href="#/cases">切換案件</a></div>` : ''}
      <section class="card" id="clCard"></section>

      <h2 class="settings-group">一般設定</h2>
      <section class="card" id="accountCard">
        <h2>帳號</h2>
        <p>${cloud.user ? `目前登入：<b>${esc(cloud.user.email)}</b>${cloud.role ? ` <span class="chip ${cloud.role === 'admin' ? 'warn' : 'muted'}">${cloud.role === 'admin' ? '管理員' : '隊員'}</span>` : ''}` : '尚未登入（到「案件」頁登入）'}</p>
        <p class="muted small" style="margin-top:4px">登入時只分享 email，App 不會存取你的 Google 雲端硬碟。</p>
        <div class="btn-row" style="margin-top:10px">
          ${isAdmin() ? `<a class="btn" href="#/admin">${icon('settings')}管理成員與使用記錄</a>` : ''}
          <button class="btn danger" id="signOutBtn" ${cloud.user ? '' : 'disabled'}>登出</button>
        </div>
      </section>
      <section class="card" id="themeCard">
        <h2>外觀</h2>
        <div class="seg" role="group" aria-label="顯示模式">
          <button type="button" class="btn small" data-theme-opt="auto">自動</button>
          <button type="button" class="btn small" data-theme-opt="light">淺色</button>
          <button type="button" class="btn small" data-theme-opt="dark">深色</button>
        </div>
        <p class="muted small" style="margin-top:6px">「自動」跟著手機的深色模式設定。晚上或省電時建議用深色。</p>
      </section>
      <section class="card" id="verCard">
        <h2>App 版本</h2>
        <p>目前版本：<b class="mono">${APP_VERSION}</b> ${APP_CHANNEL ? `<span class="chip warn">${APP_CHANNEL}</span>` : ''} <span class="muted small">${APP_DATE}</span></p>
        <p id="verStatus" class="small" style="margin-top:4px">檢查中…</p>
        <div class="btn-row" style="margin-top:10px"><button class="btn" id="verCheck">重新檢查</button><button class="btn primary hidden" id="verUpdate">立即更新</button></div>
      </section>
      <a class="btn" style="width:100%" href="guide.html">${icon('help')}使用教學</a>
      <p class="muted small" style="text-align:center"><a href="#/cases">← 回案件列表</a></p>
    </div>`;
  el.querySelector('#signOutBtn').onclick = async () => {
    if (!confirm('登出後，這支手機上的雲端案件與照片會一併清除（離線準備要重做）。確定登出？')) return;
    await signOut();
    toast('已登出');
    app.go('cases');
  };
  const verStatus = el.querySelector('#verStatus');
  const verUpdate = el.querySelector('#verUpdate');
  const runCheck = async () => {
    verStatus.textContent = '檢查中…';
    const u = await checkUpdate();
    verStatus.innerHTML =
      u.status === 'latest' ? `${icon('checkCircle', { size: 18 })} 已是最新版` : u.status === 'update' ? `有新版本 <b class="mono">${esc(u.latest)}</b> 可以更新` : '目前離線，連上網路後才能檢查';
    verStatus.style.color = u.status === 'latest' ? 'var(--ok)' : u.status === 'update' ? 'var(--accent)' : 'var(--muted)';
    verUpdate.classList.toggle('hidden', u.status !== 'update');
  };
  el.querySelector('#verCheck').onclick = runCheck;
  verUpdate.onclick = async () => {
    verUpdate.disabled = true;
    verUpdate.textContent = '更新中…';
    if (!(await applyUpdate())) {
      verUpdate.disabled = false;
      verUpdate.textContent = '再試一次';
      verStatus.textContent = '更新失敗，請稍後再試（需要穩定的網路）';
      verStatus.style.color = 'var(--danger)';
    }
  };
  runCheck();

  // 外觀：存在這支手機（localStorage），index.html 開頭會先套用
  const themeBtns = el.querySelectorAll('[data-theme-opt]');
  const currentTheme = () => document.documentElement.dataset.theme || 'auto';
  const markTheme = () => themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeOpt === currentTheme())));
  themeBtns.forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.themeOpt;
      if (t === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = t;
      try {
        t === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t);
      } catch {
        /* 私密瀏覽時存不了，只套用到這次 */
      }
      markTheme();
    };
  });
  markTheme();

  const card = el.querySelector('#clCard');
  if (!c) {
    card.innerHTML = '<h2>裝備清單</h2><p class="muted">請先匯入或選擇案件。</p>';
    return;
  }

  const raw = await db.get('cases', c.id);
  if (!raw) {
    card.innerHTML = '<h2>裝備清單</h2><p class="muted">找不到這個案件，請到「案件」頁重新選擇。</p>';
    return;
  }
  let groups = editable(raw.checklist);
  const others = app.cases.filter((x) => x.id !== c.id && x.checklist.length);

  const draw = () => {
    card.innerHTML = `
      <h2>裝備清單：${esc(c.meta.name)}</h2>
      <p class="muted small">依案件調整裝備清單，儲存後會同時上傳到雲端，全隊會自動收到。</p>
      <div class="btn-row" style="margin-top:10px">
        <select id="copyFrom" style="flex:1">
          <option value="">從範本或其他案件複製…</option>
          <option value="__template">東搜預設清單</option>
          ${others.map((o) => `<option value="${esc(o.id)}">${esc(o.meta.name)}</option>`).join('')}
        </select>
      </div>
      <div id="groups">
        ${groups
          .map(
            (g, gi) => `
          <div class="cl-group" data-g="${gi}">
            <div class="cl-row">
              <input type="text" class="cl-title" data-g="${gi}" value="${esc(g.group)}" placeholder="分類名稱，例如：公裝">
              <button class="btn small" data-act="gup" data-g="${gi}" aria-label="分類上移" ${gi === 0 ? 'disabled' : ''}>${icon('up')}</button>
              <button class="btn small danger" data-act="gdel" data-g="${gi}" aria-label="刪除分類">${icon('x')}</button>
            </div>
            ${g.items
              .map(
                (it, ii) => `
              <div class="cl-row cl-item">
                <input type="text" data-g="${gi}" data-i="${ii}" value="${esc(it.text)}" placeholder="裝備項目">
                <button class="btn small" data-act="up" data-g="${gi}" data-i="${ii}" aria-label="上移" ${ii === 0 ? 'disabled' : ''}>${icon('up')}</button>
                <button class="btn small danger" data-act="del" data-g="${gi}" data-i="${ii}" aria-label="刪除">${icon('x')}</button>
              </div>`
              )
              .join('')}
            <button class="btn small" data-act="add" data-g="${gi}" style="margin:6px 0 0 14px">${icon('plus', { size: 18 })}新增項目</button>
          </div>`
          )
          .join('')}
      </div>
      <button class="btn" data-act="gadd" style="width:100%;margin-top:12px">${icon('plus', { size: 18 })}新增分類</button>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" id="saveCl">${icon('cloud')}儲存並上傳</button>
      </div>`;
  };
  draw();

  const focusLast = (gi) => {
    const inputs = card.querySelectorAll(`.cl-item input[data-g="${gi}"]`);
    inputs[inputs.length - 1]?.focus();
  };

  card.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.g == null) return;
    const g = groups[+t.dataset.g];
    if (t.classList.contains('cl-title')) g.group = t.value;
    else if (t.dataset.i != null) g.items[+t.dataset.i].text = t.value;
  });

  card.addEventListener('keydown', (e) => {
    // 在項目上按 Enter 直接新增下一項
    if (e.key === 'Enter' && e.target.dataset.i != null) {
      e.preventDefault();
      const gi = +e.target.dataset.g;
      groups[gi].items.splice(+e.target.dataset.i + 1, 0, { id: newId(), text: '' });
      draw();
      card.querySelectorAll(`.cl-item input[data-g="${gi}"]`)[+e.target.dataset.i + 1]?.focus();
    }
  });

  card.addEventListener('change', async (e) => {
    if (e.target.id !== 'copyFrom' || !e.target.value) return;
    let src;
    if (e.target.value === '__template') {
      try {
        src = (await fetch('cases/template.json').then((r) => r.json())).checklist;
      } catch {
        return toast('無法載入預設清單');
      }
    } else {
      src = (await db.get('cases', e.target.value)).checklist;
    }
    if (groups.some((g) => g.items.length) && !confirm('用選取的清單取代目前內容？')) return draw();
    groups = editable(src).map((g) => ({ ...g, items: g.items.map((it) => ({ ...it, id: newId() })) }));
    draw();
  });

  card.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const gi = b.dataset.g != null ? +b.dataset.g : null;
    const ii = b.dataset.i != null ? +b.dataset.i : null;
    switch (b.dataset.act) {
      case 'add':
        groups[gi].items.push({ id: newId(), text: '' });
        draw();
        focusLast(gi);
        return;
      case 'del':
        groups[gi].items.splice(ii, 1);
        return draw();
      case 'up':
        [groups[gi].items[ii - 1], groups[gi].items[ii]] = [groups[gi].items[ii], groups[gi].items[ii - 1]];
        return draw();
      case 'gadd':
        groups.push({ group: '', items: [{ id: newId(), text: '' }] });
        draw();
        card.querySelectorAll('.cl-title')[groups.length - 1]?.focus();
        return;
      case 'gdel':
        if (groups[gi].items.some((it) => it.text.trim()) && !confirm(`刪除「${groups[gi].group || '未命名'}」整個分類？`)) return;
        groups.splice(gi, 1);
        return draw();
      case 'gup':
        [groups[gi - 1], groups[gi]] = [groups[gi], groups[gi - 1]];
        return draw();
    }

    if (b.id !== 'saveCl') return;
    const out = { ...raw, checklist: clean(groups) };
    const errors = validateCase(out);
    if (errors.length) return toast(errors.join('；'), 4000);
    b.disabled = true;
    const r = await saveAndUpload(out);
    Object.assign(raw, await db.get('cases', c.id));
    await app.reload();
    b.disabled = false;
    toast(r.uploaded ? '已儲存並上傳，任務頁已更新' : r.reason, r.uploaded ? 2400 : 6000);
  });
}

