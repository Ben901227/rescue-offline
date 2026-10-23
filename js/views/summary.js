import { esc, has, nl2br } from '../ui.js';
import { icon } from '../icons.js';
import { caseStatus } from '../lib/caseSchema.js';
import { wgs84ToTwd97 } from '../lib/twd97.js';
import { listPhotos, thumbsHtml, bindThumbs, releaseUrls, photoUrl, openLightbox, pickAndUpload } from '../photos.js';
import { state as cloud } from '../cloud.js';

const telLink = (phone) => `<a class="btn small primary" href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">撥打</a>`;

function row(label, value) {
  return has(value) ? `<dt>${esc(label)}</dt><dd>${nl2br(value)}</dd>` : '';
}

// 可摺疊的區塊；開合狀態記在這支手機（localStorage），下次打開維持
const FOLD_KEY = 'summaryFolds';
const folds = (() => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY)) || {};
  } catch {
    return {};
  }
})();

// 每個區塊對應到編輯頁要打開的分區
const EDIT_SEC = {
  status: 'basic',
  found: 'found',
  report: 'report',
  subject: 'subject,clothing',
  ipp: 'ipp',
  contacts: 'ipp,reporter,area',
  itinerary: 'itinerary',
  searchlog: 'log',
  timeline: 'itinerary,log',
  area: 'area',
  photos: 'photos',
};
let currentId = '';

function fold(key, title, body, { cls = '', style = '', extra = '' } = {}) {
  const open = folds[key] !== false;
  const edit = EDIT_SEC[key] ? `<a class="btn small fold-edit" href="#/edit?id=${encodeURIComponent(currentId)}&sec=${EDIT_SEC[key]}" aria-label="編輯「${title}」">編輯</a>` : '';
  return `
    <details class="card fold ${cls}" data-fold="${key}" ${style ? `style="${style}"` : ''} ${open ? 'open' : ''}>
      <summary><h2>${title}${extra}</h2>${edit}</summary>
      <div class="fold-body">${body}</div>
    </details>`;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(+d)) return null;
  return Math.floor((Date.now() - d) / 86400000) + 1;
}

function statusCard(c) {
  const s = caseStatus(c);
  const found = s === '已尋獲';
  const day = daysSince(c.meta.reportDate);
  return fold(
    'status',
    '案件狀態',
    `
      <div class="big-status">
        <span class="state ${found ? 'found' : 'active'}">${esc(s)}</span>
        ${!found && day ? `<span class="chip">搜索第 ${day} 天</span>` : ''}
      </div>
      <dl class="kv" style="margin-top:8px">
        ${row('案件', c.meta.title || c.meta.name)}
        ${row('通報日期', c.meta.reportDate)}
        ${row('地點', c.meta.location)}
        ${row('前進指揮所', c.meta.commandPost)}
        ${row('每日會議', c.meta.dailyMeeting)}
        ${row('資料更新', c.meta.updated)}
      </dl>
      ${has(c.meta.assembly) ? `<h3 style="margin-top:10px">集合與出發</h3><ul style="margin:4px 0 0;padding-left:18px">${c.meta.assembly.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`,
    { cls: found ? '' : 'accent' }
  );
}

function foundCard(c) {
  const f = c.found;
  if (!f) return '';
  const t = f.lat != null ? wgs84ToTwd97(f.lat, f.lng) : null;
  return fold(
    'found',
    '發現失聯者',
    `
      <dl class="kv">
        ${f.lat != null ? `<dt>座標</dt><dd class="mono">${f.lat}, ${f.lng}<br>TWD97 ${Math.round(t.x)}, ${Math.round(t.y)}</dd>` : ''}
        ${row('距 IPP', f.distanceFromIpp)}
        ${row('狀況', f.condition)}
        ${row('經過', f.narrative)}
        ${row('紀錄', f.by)}
      </dl>
      ${f.lat != null ? `<div class="btn-row" style="margin-top:10px"><a class="btn small" href="#/map?focus=發現點">在地圖上看</a></div>` : ''}`,
    { style: 'border-color:var(--ok)', extra: f.time ? ` <span class="chip ok">${esc(f.time)}</span>` : '' }
  );
}

function subjectCard(c) {
  const s = c.subject;
  const head = [s.name, s.nickname && `（${s.nickname}）`].filter(Boolean).join('');
  const basics = [s.gender, s.age && `${s.age} 歲`, s.height && `${s.height} cm`, s.weight && `${s.weight} kg`].filter(Boolean).join('・');
  return fold(
    'subject',
    '失聯者',
    `
      <div id="subjectPhotos"></div>
      <p style="font-size:1.25rem;font-weight:700">${esc(head || '（未填）')}</p>
      ${basics ? `<p class="muted">${esc(basics)}</p>` : ''}
      ${has(c.clothing) ? `<h3 style="margin-top:10px">當天穿著</h3><div class="looks" style="margin-top:6px">${c.clothing.map((x) => `<span><b>${esc(x.item)}</b>${esc(x.desc)}</span>`).join('')}</div>` : ''}
      ${has(c.gear) ? `<h3 style="margin-top:10px">裝備</h3><div class="looks" style="margin-top:6px">${c.gear.map((x) => `<span><b>${esc(x.item)}</b>${esc(x.desc)}</span>`).join('')}</div>` : ''}
      <dl class="kv" style="margin-top:10px">
        ${row('髮型', s.hair)}
        ${row('疾病史', s.medical)}
        ${row('讀圖能力', s.mapReading)}
        ${row('行路風格', (s.styles || []).join('、'))}
        ${row('登山經歷', s.experience)}
        ${row('手機系統', s.phoneOS)}
        ${s.phone ? `<dt>手機</dt><dd class="mono">${esc(s.phone)}</dd>` : ''}
        ${(s.social || []).map((x) => `<dt>${esc(x.type)}</dt><dd>${/^https?:/.test(x.value) ? `<a href="${esc(x.value)}" target="_blank" rel="noopener">${esc(x.value.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : esc(x.value)}</dd>`).join('')}
      </dl>
      ${has(s.notes) ? `<h3 style="margin:12px 0 6px">質性分析</h3>${s.notes.map((n) => `<div class="quote">${esc(n.text)}<cite>— ${esc(n.source)}</cite></div>`).join('')}` : ''}`
  );
}

function ippCard(c) {
  const i = c.ipp;
  if (!has(i.lastSeen) && !has(i.likelyArea)) return '';
  return fold(
    'ipp',
    '最後已知點（IPP）',
    `
      <dl class="kv">
        ${row('最後目擊', i.lastSeen)}
        ${row('最可能地點', i.likelyArea)}
        ${row('最後交談', i.lastContact)}
      </dl>`
  );
}

function contactsCard(c) {
  const people = [
    ...(c.ipp.contacts || []),
    c.reporter?.phone ? { name: `${c.reporter.name || '通報人'}（${c.reporter.relation || ''}）`, phone: c.reporter.phone } : null,
    ...(c.area.localContacts || []),
  ].filter((p) => p && p.phone);
  if (!people.length) return '';
  return fold(
    'contacts',
    '聯絡窗口',
    people.map((p) => `<div class="tel"><div><b>${esc(p.name)}</b>${p.note ? `<br><span class="muted small">${esc(p.note)}</span>` : ''}<br><span class="mono">${esc(p.phone)}</span></div>${telLink(p.phone)}</div>`).join('')
  );
}

function timelineCard(c) {
  const items = [
    ...c.itinerary.map((d) => ({ cls: 'plan', when: `${d.day} ${d.date}`, tag: '原定行程', body: `<p>${esc(d.plan)}</p>` })),
    ...c.log.map((l) => ({
      cls: 'search',
      when: l.date,
      tag: '搜救紀錄',
      body: `${l.personnel ? `<p class="muted small">出勤：${esc(l.personnel)}</p>` : ''}<ul>${(l.entries || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>${l.meeting ? `<p class="small" style="margin-top:4px"><b>晚會：</b>${esc(l.meeting)}</p>` : ''}`,
    })),
  ];
  if (c.found?.time) items.push({ cls: 'found', when: c.found.time, tag: '尋獲', body: `<p>${esc(c.found.narrative || '')}</p>` });
  if (!items.length) return '';
  return fold(
    'timeline',
    '時間軸',
    `
      <ul class="timeline">
        ${items.map((it) => `<li class="${it.cls}"><div class="when">${esc(it.when)} <span class="chip ${it.cls === 'plan' ? 'muted' : it.cls === 'found' ? 'ok' : ''}">${it.tag}</span></div>${it.body}</li>`).join('')}
      </ul>
      ${c.retreatPlan ? `<details style="margin-top:10px"><summary>撤退計畫及隊伍其他資訊</summary><p>${nl2br(c.retreatPlan)}</p></details>` : ''}`
  );
}

// 失蹤者原定行程（單獨一區）
function itineraryCard(c) {
  if (!has(c.itinerary) && !c.retreatPlan) return '';
  return fold(
    'itinerary',
    '失蹤者行程',
    `
      <ol class="day-list">
        ${c.itinerary.map((d) => `<li><div class="when">${esc(d.day)} <span class="muted">${esc(d.date)}</span></div><p>${nl2br(d.plan)}</p></li>`).join('')}
      </ol>
      ${c.retreatPlan ? `<h3 style="margin-top:10px">撤退計畫及隊伍其他資訊</h3><p>${nl2br(c.retreatPlan)}</p>` : ''}`,
    { extra: has(c.itinerary) ? ` <span class="chip muted">${c.itinerary.length} 天</span>` : '' }
  );
}

// 每日搜救紀錄（單獨一區）
function searchLogCard(c) {
  if (!has(c.log)) return '';
  return fold(
    'searchlog',
    '搜救紀錄',
    `
      <ol class="day-list">
        ${c.log
          .map(
            (l) => `<li><div class="when">${esc(l.date)}</div>
              ${l.personnel ? `<p class="muted small">出勤：${esc(l.personnel)}</p>` : ''}
              ${has(l.entries) ? `<ul>${l.entries.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
              ${l.meeting ? `<p class="small" style="margin-top:4px"><b>晚會：</b>${nl2br(l.meeting)}</p>` : ''}</li>`
          )
          .join('')}
      </ol>`,
    { extra: ` <span class="chip">${c.log.length} 天</span>` }
  );
}

function areaCard(c) {
  const a = c.area;
  if (!has(a.signal) && !has(a.weather)) return '';
  return fold(
    'area',
    '案件所在地',
    `
      <dl class="kv">
        ${row('通訊', a.signal)}
        ${row('天氣', a.weather)}
      </dl>`
  );
}

export function render(el, app) {
  const c = app.current;
  if (!c) return;
  currentId = c.id;
  el.innerHTML = `
    <div class="stack">
      ${c.meta.notice ? `<div class="banner" role="note">${icon('alert')}<span>${esc(c.meta.notice)}</span></div>` : ''}
      ${statusCard(c)}
      ${foundCard(c)}
      ${c.report ? fold('report', '通報事由', `<p>${nl2br(c.report)}</p>`) : ''}
      ${subjectCard(c)}
      ${ippCard(c)}
      ${contactsCard(c)}
      ${itineraryCard(c)}
      ${searchLogCard(c)}
      ${timelineCard(c)}
      ${areaCard(c)}
      ${cloud.user ? fold('photos', '現場照片', '<div id="scenePhotos"><p class="muted small">讀取中…</p></div>') : ''}
      <div class="btn-row"><a class="btn" href="#/edit?id=${encodeURIComponent(c.id)}">編輯案件資料</a></div>
      <p class="muted small" style="text-align:center">資料來源：${esc(c.meta.source || '')}　更新：${esc(c.meta.updated || '')}</p>
    </div>`;

  const wrap = el.firstElementChild;
  loadPhotos(wrap, c);
  // 全部展開／收合
  wrap.insertAdjacentHTML(
    'afterbegin',
    `<div class="fold-tools"><button type="button" class="btn small" data-fold-all="open">全部展開</button><button type="button" class="btn small" data-fold-all="close">全部收合</button></div>`
  );
  const save = () => {
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
    } catch {
      /* 私密瀏覽時不記 */
    }
  };
  wrap.addEventListener(
    'toggle',
    (e) => {
      const key = e.target.dataset?.fold;
      if (!key) return;
      folds[key] = e.target.open;
      save();
    },
    true
  );
  wrap.querySelectorAll('[data-fold-all]').forEach((b) => {
    b.onclick = () => {
      const open = b.dataset.foldAll === 'open';
      wrap.querySelectorAll('details.fold').forEach((d) => (d.open = open));
    };
  });
}

// 照片：失聯者照片放在「失聯者」區塊最上面；現場照片另成一區（離線時用手機上的快取）
async function loadPhotos(wrap, c) {
  if (!cloud.user) return;
  const list = await listPhotos(c.id);
  const subject = list.filter((p) => p.kind === 'subject');
  const scene = list.filter((p) => p.kind !== 'subject');
  const sp = wrap.querySelector('#subjectPhotos');
  if (sp) {
    const [main, ...more] = subject;
    sp.innerHTML = main
      ? `<div class="portrait-row">
          <button type="button" class="portrait" data-photo="${esc(main.id)}" aria-label="放大失蹤者照片"><img src="${photoUrl(main, 'image')}" alt="${esc(main.caption || '失蹤者照片')}"></button>
          ${more.length ? `<div class="portrait-more">${thumbsHtml(more)}</div>` : ''}
        </div>
        <button type="button" class="btn small" id="addSubjectPhoto">${icon('camera', { size: 18 })}再加一張</button>`
      : `<div class="portrait-empty">${icon('camera', { size: 28 })}<span>還沒有失蹤者照片</span>
          <button type="button" class="btn small primary" id="addSubjectPhoto">上傳失蹤者照片</button></div>`;
    bindThumbs(sp, subject);
    sp.querySelector('#addSubjectPhoto')?.addEventListener('click', async () => {
      if (await pickAndUpload(c.id, 'subject')) loadPhotos(wrap, c);
    });
  }
  const sc = wrap.querySelector('#scenePhotos');
  if (sc) {
    sc.innerHTML = scene.length
      ? thumbsHtml(scene) +
        `<ul class="photo-notes">${scene
          .filter((p) => p.caption || p.lat != null)
          .map((p) => `<li>${esc(p.caption || '（無說明）')}${p.lat != null ? `　<a href="#/map?lat=${p.lat}&lng=${p.lng}">在地圖上看</a>` : ''}</li>`)
          .join('')}</ul>`
      : '<p class="muted small">還沒有現場照片。在地圖上按住某個位置，可以拍照並標在那裡。</p>';
    bindThumbs(sc, scene);
  }
}

export function destroy() {
  releaseUrls();
}
