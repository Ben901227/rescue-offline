import { esc, has, confirmBox } from '../ui.js';
import { kv } from '../db.js';
import { icon } from '../icons.js';
import { routeLength } from '../lib/route.js';
import { fmtDist } from '../markers.js';

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
      </section>
      <div id="checklists" class="stack"></div>
      <div class="btn-row"><a class="btn" href="#/case">編輯裝備清單</a>${has(c.checklist) ? '<button class="btn danger" id="resetBtn">重置所有勾選</button>' : ''}</div>
      <p class="muted small" style="text-align:center">勾選狀態只存在這支手機。</p>
    </div>`;

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
