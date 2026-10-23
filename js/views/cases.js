import { esc, toast, pickFile, downloadFile, sheet, closeSheet } from '../ui.js';
import { icon } from '../icons.js';
import { db, kv } from '../db.js';
import { validateCase, caseStatus } from '../lib/caseSchema.js';
import { cachedTileCount } from '../tiles.js';
import { syncCardHtml, bindSyncCard } from '../drive.js';

async function importCase(text, app) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON');
  }
  const errors = validateCase(data);
  if (errors.length) throw new Error(errors.join('；'));
  const exists = await db.get('cases', data.id);
  if (exists && !confirm(`已有「${data.meta.name}」，要用新檔案覆蓋嗎？（本機打點、航跡、勾選會保留）`)) return;
  await db.put('cases', data);
  navigator.storage?.persist?.();
  await app.select(data.id);
  toast(`已匯入「${data.meta.name}」`);
}

// 離線準備清單的一項：完成打勾，未完成空圈；文字說明狀態，不只靠顏色
const step = (done, text) =>
  `<li class="${done ? 'done' : ''}">${icon(done ? 'checkCircle' : 'circle')}<span><span class="sr-only">${done ? '已完成：' : '待辦：'}</span>${esc(text)}</span></li>`;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

export async function render(el, app) {
  const [tiles, est] = await Promise.all([cachedTileCount().catch(() => 0), navigator.storage?.estimate?.().catch(() => null)]);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);

  el.innerHTML = `
    <div class="stack">
      ${app.cases.length ? '' : `<div class="card empty"><p style="font-size:1.1rem;color:var(--text);font-weight:700">還沒有案件資料</p><p style="margin-top:6px">向指揮或資料組索取案件 JSON 檔後匯入。<br>資料只會存在這支手機。</p></div>`}
      ${app.cases
        .map((c) => {
          const s = caseStatus(c);
          const cur = app.current?.id === c.id;
          return `<section class="card case-item ${cur ? 'current' : ''}">
            <div class="info"><b>${esc(c.meta.name)}</b> <span class="chip ${s === '已尋獲' ? 'ok' : ''}">${esc(s)}</span><br>
              <small>${esc(c.meta.reportDate || '')} ${esc(c.meta.location || '')}${c._sync?.source === 'drive' ? '・Drive' : ''}</small></div>
            ${cur ? '<span class="chip muted">目前</span>' : `<button class="btn small primary" data-open="${esc(c.id)}">開啟</button>`}
            <button class="btn small" data-more="${esc(c.id)}" aria-label="${esc(c.meta.name)} 更多操作">${icon('more')}</button>
          </section>`;
        })
        .join('')}
      <section class="card" id="syncCard">${await syncCardHtml()}</section>
      <div class="btn-row">
        <a class="btn primary" href="#/edit">${icon('plus', { size: 18 })}新增案件</a>
        <button class="btn" id="importFile">匯入案件檔</button>
        <button class="btn" id="importPaste">貼上 JSON</button>
      </div>
      <section class="card">
        <h2>離線準備</h2>
        <ul class="todo">
          ${step(standalone, standalone ? '已從主畫面開啟' : isIOS ? '在 Safari 按「分享」→「加入主畫面」，之後從主畫面圖示開啟' : '在瀏覽器選單選「安裝應用程式」或「加到主畫面」')}
          ${step(app.cases.length, '已匯入案件資料')}
          ${step(tiles, tiles ? `已存 ${tiles} 張離線圖磚` : '到「地圖」按下載鈕，存好離線底圖')}
          ${step(persisted, persisted ? '已啟用持久儲存' : '持久儲存未啟用（系統空間不足時可能被清除；加到主畫面通常可避免）')}
        </ul>
        ${est ? `<p class="muted small" style="margin-top:8px">本機已使用約 ${(est.usage / 1048576).toFixed(1)} MB</p>` : ''}
      </section>
      <div class="banner">案件資料含個人資料，只限搜救人員使用，請勿轉傳給非搜救人員。</div>
      <p class="muted small" style="text-align:center"><a href="cases/template.json" download>下載空白案件範本</a>・<a href="cases/schema.md" target="_blank">欄位說明</a></p>
    </div>`;

  bindSyncCard(el.querySelector('#syncCard'), app, () => render(el, app));

  el.querySelector('#importFile').onclick = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      await importCase(await file.text(), app);
      app.go('summary');
    } catch (e) {
      toast(`匯入失敗：${e.message}`, 5000);
    }
  };

  el.querySelector('#importPaste').onclick = () => {
    const s = sheet(`
      <h2>貼上案件 JSON</h2>
      <textarea id="pasteBox" placeholder='{"id": "...", "meta": {...}}'></textarea>
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="pasteOk">匯入</button></div>`);
    s.querySelector('#pasteOk').onclick = async () => {
      try {
        await importCase(s.querySelector('#pasteBox').value, app);
        closeSheet();
        app.go('summary');
      } catch (e) {
        toast(`匯入失敗：${e.message}`, 5000);
      }
    };
  };

  el.firstElementChild.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-open],[data-more]');
    const open = t?.dataset.open;
    const more = t?.dataset.more;
    if (open) {
      await app.select(open);
      app.go('summary');
    }
    if (more) {
      const c = app.cases.find((x) => x.id === more);
      const s = sheet(`
        <h2>${esc(c.meta.name)}</h2>
        <div class="stack">
          <a class="btn" style="width:100%" href="#/edit?id=${encodeURIComponent(c.id)}">編輯案件資料</a>
          <a class="btn" style="width:100%" href="#/settings">編輯裝備清單</a>
          <button class="btn" style="width:100%" id="exp">匯出案件 JSON</button>
          <button class="btn danger" style="width:100%" id="del">從這支手機刪除</button>
        </div>`);
      s.querySelector('#exp').onclick = async () => {
        downloadFile(`${c.id}.json`, JSON.stringify(await db.get('cases', c.id), null, 2), 'application/json');
      };
      s.querySelector('#del').onclick = async () => {
        if (!confirm(`刪除「${c.meta.name}」以及本機的打點、航跡、勾選？`)) return;
        await Promise.all([db.delete('cases', c.id), db.deleteByCase('tracks', c.id), db.deleteByCase('points', c.id), kv.del(`checklist:${c.id}`), kv.del(`coords:${c.id}`)]);
        if ((await kv.get('currentCase')) === c.id) await kv.del('currentCase');
        closeSheet();
        await app.reload();
        render(el, app);
      };
    }
  });
}
