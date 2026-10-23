import { esc, sheet, closeSheet, toast, ask } from '../ui.js';
import { icon } from '../icons.js';
import { db, kv } from '../db.js';
import { caseStatus } from '../lib/caseSchema.js';
import { cachedTileCount } from '../tiles.js';
import { cloudCardHtml, bindCloudCard, isAdmin, deleteCase, state as cloud } from '../cloud.js';

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
      ${app.cases.length ? '' : `<div class="card empty"><p style="font-size:1.1rem;color:var(--text);font-weight:700">還沒有案件資料</p><p style="margin-top:6px">用 Google 帳號同步取得有權限的案件，或按「新增案件」建立。</p></div>`}
      ${app.cases
        .map((c) => {
          const s = caseStatus(c);
          const cur = app.current?.id === c.id;
          return `<section class="card case-item ${cur ? 'current' : ''}">
            <div class="info"><b>${esc(c.meta.name)}</b> <span class="chip ${s === '已尋獲' ? 'ok' : ''}">${esc(s)}</span><br>
              <small>${esc(c.meta.reportDate || '')} ${esc(c.meta.location || '')}${c._sync?.source === 'cloud' ? '・雲端' : '・只在這支手機'}</small></div>
            ${cur ? '<span class="chip muted">目前</span>' : `<button class="btn small primary" data-open="${esc(c.id)}">開啟</button>`}
            <button class="btn small" data-more="${esc(c.id)}" aria-label="${esc(c.meta.name)} 更多操作">${icon('more')}</button>
          </section>`;
        })
        .join('')}
      <section class="card" id="syncCard">${cloudCardHtml()}</section>
      <a class="btn" style="width:100%" href="#/edit">${icon('plus', { size: 18 })}新增案件</a>
      <section class="card">
        <h2>離線準備</h2>
        <p class="small" style="margin-bottom:6px">第一次使用？<a href="guide.html">${icon('help', { size: 18 })} 看圖文使用教學</a></p>
        <ul class="todo">
          ${step(standalone, standalone ? '已從主畫面開啟' : isIOS ? '在 Safari 按「分享」→「加入主畫面」，之後從主畫面圖示開啟' : '在瀏覽器選單選「安裝應用程式」或「加到主畫面」')}
          ${step(app.cases.length, app.cases.length ? '已有案件資料' : '同步或新增案件資料')}
          ${step(tiles, tiles ? `已存 ${tiles} 張離線圖磚` : '到「地圖」按下載鈕，存好離線底圖')}
          ${step(persisted, persisted ? '已啟用持久儲存' : '持久儲存未啟用（系統空間不足時可能被清除；加到主畫面通常可避免）')}
        </ul>
        ${est ? `<p class="muted small" style="margin-top:8px">本機已使用約 ${(est.usage / 1048576).toFixed(1)} MB</p>` : ''}
      </section>
      <div class="banner">案件資料含個人資料，只限搜救人員使用，請勿轉傳給非搜救人員。</div>
    </div>`;

  bindCloudCard(el.querySelector('#syncCard'), () => render(el, app));

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
          ${c._sync?.source !== 'cloud' && cloud.user ? '<button class="btn primary" style="width:100%" id="up">上傳到雲端，給全隊使用</button>' : ''}
          ${c._sync?.source === 'cloud' ? (isAdmin() ? '<button class="btn danger" style="width:100%" id="delCloud">從雲端刪除（全隊都會移除）</button>' : '') : '<button class="btn danger" style="width:100%" id="del">從這支手機刪除</button>'}
        </div>`);
      s.querySelector('#up')?.addEventListener('click', async () => {
        const { saveAndUpload } = await import('../cloud.js');
        const r = await saveAndUpload({ ...(await db.get('cases', c.id)), _sync: undefined });
        closeSheet();
        toast(r.uploaded ? '已上傳到雲端' : r.reason, 5000);
        await app.reload();
        render(el, app);
      });
      s.querySelector('#delCloud')?.addEventListener('click', async () => {
        if (!confirm(`從雲端刪除「${c.meta.name}」？全隊的手機都會移除這個案件、路線與照片，無法復原。`)) return;
        if ((await ask(`請輸入案件名稱「${c.meta.name}」確認刪除`, { ok: '刪除', hint: '刪除後全隊都會移除，無法復原' })) !== c.meta.name) return toast('名稱不符，已取消');
        try {
          await deleteCase(c.id);
          closeSheet();
          toast('已從雲端刪除');
        } catch (e) {
          toast(`刪除失敗：${e.message}`, 5000);
        }
      });
      s.querySelector('#del')?.addEventListener('click', async () => {
        if (!confirm(`刪除「${c.meta.name}」以及本機的打點、航跡、勾選？`)) return;
        await Promise.all([db.delete('cases', c.id), db.deleteByCase('tracks', c.id), db.deleteByCase('points', c.id), kv.del(`checklist:${c.id}`), kv.del(`coords:${c.id}`)]);
        if ((await kv.get('currentCase')) === c.id) await kv.del('currentCase');
        closeSheet();
        await app.reload();
        render(el, app);
      });
    }
  });
}
