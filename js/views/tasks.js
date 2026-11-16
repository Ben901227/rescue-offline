import { esc, has, confirmBox, toast } from '../ui.js';
import { kv } from '../db.js';
import { icon } from '../icons.js';
import { routeLength } from '../lib/route.js';
import { fmtDist } from '../markers.js';
import { state as cloud } from '../cloud.js';
import { listPhotos, deletePhoto, photoUrl, openLightbox, releaseUrls, pickAndUpload } from '../photos.js';

// 路線圖：別的 App 截的航跡／規劃圖，存成 kind=route 的照片。每張列出說明，上傳者或管理員可刪。
let routePhotos = [];
async function loadRoutePhotos(el, c) {
  const box = el.querySelector('#routePhotos');
  if (!box) return;
  routePhotos = (await listPhotos(c.id)).filter((p) => p.kind === 'route');
  box.innerHTML = routePhotos.length
    ? `<ul class="photo-admin">${routePhotos
        .map(
          (p) => `<li><button type="button" class="thumb" data-photo-view="${esc(p.id)}" aria-label="放大路線圖${p.caption ? `：${esc(p.caption)}` : ''}"><img src="${photoUrl(p)}" alt=""></button>
            <span style="flex:1;min-width:0">${esc(p.caption || '（沒有說明）')}
            <br><span class="muted small">${esc((p.created || '').slice(0, 10))}・${esc((p.by || '').split('@')[0])}</span></span>
            <button type="button" class="btn small danger" data-photo-del="${esc(p.id)}" aria-label="刪除路線圖">${icon('x')}</button></li>`
        )
        .join('')}</ul>`
    : '<p class="muted small">還沒有路線圖。可上傳其他 App 的航跡或規劃截圖。</p>';
}

export function destroy() {
  releaseUrls();
}

const key = (c) => `checklist:${c.id}`;

export async function render(el, app) {
  const c = app.current;
  if (!c) return;
  let checked = (await kv.get(key(c))) || {};

  const byDate = c.teams.reduce((acc, t) => {
    (acc[t.date || '未指定日期'] ||= []).push(t);
    return acc;
  }, {});
  const dates = Object.keys(byDate);

  el.innerHTML = `
    <div class="stack">
      <section class="card">
        <h2>無線電</h2>
        <dl class="kv">
          <dt>公頻</dt><dd class="mono">${esc(c.radio.public) || '<span class="muted">未設定</span>'}</dd>
          <dt>小隊頻</dt><dd class="mono">${esc(c.radio.team) || '<span class="muted">未設定</span>'}</dd>
        </dl>
      </section>
      <section class="card">
        <h2>任務分組</h2>
        ${
          dates.length
            ? dates
                .map(
                  (d, i) => `<details ${i === dates.length - 1 ? 'open' : ''} style="margin-top:${i ? 8 : 0}px">
                    <summary>${esc(d)}（${byDate[d].length} 組）</summary>
                    ${byDate[d]
                      .map(
                        (t) => `<div class="team"><b>${esc(t.name)}</b>${t.channel ? ` <span class="chip muted">${esc(t.channel)}</span>` : ''}
                          ${t.members ? `<div class="who">${esc(t.members)}</div>` : ''}
                          ${t.area ? `<div>負責：${esc(t.area)}</div>` : ''}
                          ${t.note ? `<div class="muted small">${esc(t.note)}</div>` : ''}</div>`
                      )
                      .join('')}
                  </details>`
                )
                .join('')
            : '<p class="muted">尚無分組資料</p>'
        }
      </section>
      <section class="card">
        <h2>搜救路線</h2>
        ${
          c.routes.length
            ? c.routes
                .map(
                  (r) => `<a class="team route-link" href="#/map?route=${encodeURIComponent(r.id)}">
                    <span class="route-dot" style="background:${esc(r.color || '#e11d48')}"></span>
                    <span style="flex:1"><b>${esc(r.name)}</b>${r.team ? `<span class="who">　${esc(r.team)}</span>` : ''}
                    <br><span class="muted small">${fmtDist(routeLength(r.points))}・${r.points.length} 點${r.note ? `・${esc(r.note)}` : ''}</span></span>
                    ${icon('map')}</a>`
                )
                .join('')
            : '<p class="muted">尚未規劃路線。到「地圖」按路線按鈕，點地圖即可畫出搜救路線（離線也可以）。</p>'
        }
        ${cloud.user ? `<h3 style="margin-top:12px">路線圖</h3><div id="routePhotos"><p class="muted small">讀取中…</p></div>
          <div class="btn-row" style="margin-top:8px"><button type="button" class="btn small" id="addRoutePhoto">${icon('camera', { size: 18 })}上傳路線圖</button></div>` : ''}
      </section>
      <div id="checklists" class="stack"></div>
      <div class="btn-row"><a class="btn" href="#/case">編輯裝備清單</a>${has(c.checklist) ? '<button class="btn danger" id="resetBtn">重置所有勾選</button>' : ''}</div>
      <p class="muted small" style="text-align:center">勾選狀態只存在這支手機。</p>
    </div>`;

  loadRoutePhotos(el, c);
  el.querySelector('#addRoutePhoto')?.addEventListener('click', async () => {
    if (await pickAndUpload(c.id, 'route', { caption: '', placeholder: '例如：第一組 上午' })) loadRoutePhotos(el, c);
  });
  el.querySelector('#routePhotos')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-photo-view],[data-photo-del]');
    if (!b) return;
    if (b.dataset.photoView) return openLightbox(routePhotos.find((p) => p.id === b.dataset.photoView), routePhotos);
    if (!(await confirmBox('刪除這張路線圖？全隊都會移除。'))) return;
    try {
      await deletePhoto(c.id, b.dataset.photoDel);
    } catch (err) {
      return toast(err.code === 'permission-denied' ? '只能刪除自己上傳的路線圖（管理員可刪全部）' : `刪除失敗：${err.message}`, 5000);
    }
    loadRoutePhotos(el, c);
  });

  const lists = el.querySelector('#checklists');
  const draw = () => {
    lists.innerHTML = c.checklist
      .map((g, gi) => {
        const done = g.items.filter((it) => checked[it.id]).length;
        return `<section class="card">
          <h2>${esc(g.group)} <span class="muted small" style="margin-left:auto">${done}/${g.items.length}</span></h2>
          <div class="progress"><div style="width:${g.items.length ? (done / g.items.length) * 100 : 0}%"></div></div>
          ${g.items.map((it) => `<label class="check ${checked[it.id] ? 'done' : ''}"><input type="checkbox" data-id="${esc(it.id)}" ${checked[it.id] ? 'checked' : ''}><span>${esc(it.text)}</span></label>`).join('')}
        </section>`;
      })
      .join('');
  };
  draw();

  lists.addEventListener('change', async (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    checked = { ...checked, [id]: e.target.checked };
    await kv.set(key(c), checked);
    draw();
  });
  el.querySelector('#resetBtn')?.addEventListener('click', async () => {
    if (!(await confirmBox('清除所有勾選？'))) return;
    checked = {};
    await kv.set(key(c), checked);
    draw();
  });
}
