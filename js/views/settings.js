import { esc, toast } from '../ui.js';
import { icon } from '../icons.js';
import { db } from '../db.js';
import { validateCase } from '../lib/caseSchema.js';
import { driveSettingsHtml, bindDriveSettings, prepare, beginAuth, saveAndUpload } from '../drive.js';

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
      <section class="card" id="clCard"></section>
      <section class="card" id="driveCard">${driveSettingsHtml()}</section>
      <p class="muted small" style="text-align:center"><a href="#/cases">← 回案件列表</a></p>
    </div>`;
  bindDriveSettings(el.querySelector('#driveCard'), app);
  prepare().catch(() => {});

  const card = el.querySelector('#clCard');
  if (!c) {
    card.innerHTML = '<h2>裝備清單</h2><p class="muted">請先匯入或選擇案件。</p>';
    return;
  }

  const raw = await db.get('cases', c.id);
  let groups = editable(raw.checklist);
  const others = app.cases.filter((x) => x.id !== c.id && x.checklist.length);

  const draw = () => {
    card.innerHTML = `
      <h2>裝備清單：${esc(c.meta.name)}</h2>
      <p class="muted small">依案件調整裝備清單，儲存後會同時上傳到 Google Drive，全隊同步即可看到。</p>
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
    const auth = beginAuth(); // 點擊後第一件事，Google 登入視窗才不會被擋
    const out = { ...raw, checklist: clean(groups) };
    const errors = validateCase(out);
    if (errors.length) return toast(errors.join('；'), 4000);
    b.disabled = true;
    const r = await saveAndUpload(out, auth);
    Object.assign(raw, await db.get('cases', c.id));
    await app.reload();
    b.disabled = false;
    toast(r.uploaded ? '已儲存並上傳，任務頁已更新' : r.reason, r.uploaded ? 2400 : 6000);
  });
}
