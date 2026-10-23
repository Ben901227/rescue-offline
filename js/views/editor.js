// 案件編輯器：用表單填寫案件，存到本機或下載 JSON 上傳到 Drive。
// 表單由下方 SECTIONS 描述產生，要加欄位只需改這份描述。

import { esc, toast, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { db, kv } from '../db.js';
import { validateCase } from '../lib/caseSchema.js';
import { getPath, setPath, tidy } from '../lib/path.js';
import { parseCoordinate, wgs84ToTwd97 } from '../lib/twd97.js';
import { pickPoint, pickBounds } from '../mapPicker.js';
import { TYPE_LABEL } from '../markers.js';
import { saveAndUpload, state as cloud } from '../cloud.js';
import { listPhotos, deletePhoto, photoUrl, openLightbox, releaseUrls, pickAndUpload } from '../photos.js';

const MARKER_TYPES = ['ipp', 'camp', 'cp', 'poi'];
const DRAFT_KEY = 'editorDraft';

// type: text | textarea | number | date | select | lines（一行一項）| coord | bbox | repeat
const SECTIONS = [
  {
    key: 'basic',
    title: '基本資料',
    fields: [
      { path: 'meta.name', label: '案件短名', hint: '顯示在頂部，例如：牡丹岩', required: true },
      { path: 'meta.title', label: '完整名稱', hint: '例如：2026.10 牡丹岩失蹤案' },
      { path: 'meta.status', label: '狀態', type: 'select', options: [['', '自動（有發現點＝已尋獲）'], ['搜索中', '搜索中'], ['已尋獲', '已尋獲'], ['暫停', '暫停'], ['結案', '結案']] },
      { path: 'meta.reportDate', label: '通報日期', type: 'date' },
      { path: 'meta.location', label: '案件所在地' },
      { path: 'meta.commandPost', label: '前進指揮所' },
      { path: 'meta.dailyMeeting', label: '每日會議時間地點' },
      { path: 'meta.assembly', label: '集合與出發時間', type: 'lines' },
      { path: 'meta.team', label: '搜救單位' },
      { path: 'meta.notice', label: '頂部提醒文字', type: 'textarea' },
    ],
  },
  { key: 'report', title: '通報事由', fields: [{ path: 'report', label: '哪裡、何時、原因、什麼、如何發生', type: 'textarea' }] },
  {
    key: 'subject',
    title: '失聯者',
    fields: [
      { path: 'subject.name', label: '姓名' },
      { path: 'subject.nickname', label: '暱稱' },
      { path: 'subject.gender', label: '性別', type: 'select', options: [['', '—'], ['男', '男'], ['女', '女'], ['其他', '其他']] },
      { path: 'subject.age', label: '年齡', type: 'number' },
      { path: 'subject.height', label: '身高 (cm)' },
      { path: 'subject.weight', label: '體重 (kg)' },
      { path: 'subject.hair', label: '髮型' },
      { path: 'subject.medical', label: '疾病史', type: 'textarea' },
      { path: 'subject.phone', label: '手機號碼', inputmode: 'tel' },
      { path: 'subject.phoneOS', label: '手機系統／電信', hint: '例如：iOS、中華電信，會用離線地圖' },
      { path: 'subject.mapReading', label: '讀圖能力' },
      { path: 'subject.styles', label: '行路風格', type: 'lines', hint: '一行一項，例如：傳統路、探勘' },
      { path: 'subject.experience', label: '登山經歷', type: 'textarea' },
      { path: 'subject.social', label: '社群帳號', type: 'repeat', add: '新增帳號', fields: [{ path: 'type', label: '類型', hint: 'FB / IG / Line' }, { path: 'value', label: '帳號或網址' }] },
      { path: 'subject.notes', label: '質性分析', type: 'repeat', add: '新增一則', fields: [{ path: 'source', label: '來源（誰說的）' }, { path: 'text', label: '內容', type: 'textarea' }] },
    ],
  },
  {
    key: 'reporter',
    title: '通報人',
    fields: [
      { path: 'reporter.name', label: '姓名' },
      { path: 'reporter.relation', label: '與失聯者關係' },
      { path: 'reporter.phone', label: '手機', inputmode: 'tel' },
      { path: 'reporter.line', label: 'Line' },
    ],
  },
  {
    key: 'clothing',
    title: '穿著與裝備',
    fields: [
      { path: 'clothing', label: '當天穿著', type: 'repeat', add: '新增穿著', fields: [{ path: 'part', label: '部位', hint: '頭／上身／下身／腳' }, { path: 'item', label: '物品' }, { path: 'desc', label: '顏色與品牌' }] },
      { path: 'gear', label: '登山裝備', type: 'repeat', add: '新增裝備', fields: [{ path: 'item', label: '物品' }, { path: 'desc', label: '顏色與品牌' }] },
    ],
  },
  {
    key: 'ipp',
    title: '最後已知點（IPP）',
    fields: [
      { path: 'ipp.lastSeen', label: '最後目擊時間／地點', type: 'textarea' },
      { path: 'ipp.likelyArea', label: '最有可能出現的地點' },
      { path: 'ipp.lastContact', label: '最後可能交談的人' },
      { path: 'ipp', label: 'IPP 座標', type: 'coord' },
      { path: 'ipp.contacts', label: '可提供訊息的人', type: 'repeat', add: '新增聯絡人', fields: [{ path: 'name', label: '姓名' }, { path: 'phone', label: '電話', inputmode: 'tel' }, { path: 'note', label: '備註' }] },
    ],
  },
  {
    key: 'itinerary',
    title: '原定行程',
    fields: [
      { path: 'itinerary', label: '每日行程', type: 'repeat', add: '新增一天', fields: [{ path: 'day', label: '天', hint: 'D1' }, { path: 'date', label: '日期', hint: '10/09' }, { path: 'plan', label: '行程', type: 'textarea' }] },
      { path: 'retreatPlan', label: '撤退計畫及隊伍其他資訊', type: 'textarea' },
    ],
  },
  {
    key: 'area',
    title: '案件所在地與地圖',
    fields: [
      { path: 'area.bbox', label: '搜索範圍', type: 'bbox' },
      { path: 'area.markers', label: '地圖標記', type: 'repeat', add: '新增標記', fields: [{ path: 'name', label: '名稱' }, { path: 'type', label: '類型', type: 'select', options: MARKER_TYPES.map((t) => [t, TYPE_LABEL[t]]) }, { path: '', label: '座標', type: 'coord' }, { path: 'note', label: '備註' }] },
      { path: 'area.signal', label: '訊號握手資訊', type: 'textarea' },
      { path: 'area.weather', label: '天氣概況', type: 'textarea' },
      { path: 'area.localContacts', label: '當地聯絡人', type: 'repeat', add: '新增聯絡人', fields: [{ path: 'name', label: '頭銜／姓名' }, { path: 'phone', label: '電話', inputmode: 'tel' }, { path: 'note', label: '備註' }] },
    ],
  },
  {
    key: 'teams',
    title: '任務分組與無線電',
    fields: [
      { path: 'radio.public', label: '公頻' },
      { path: 'radio.team', label: '小隊頻' },
      { path: 'teams', label: '分組', type: 'repeat', add: '新增分組', fields: [{ path: 'date', label: '日期', hint: '10/12' }, { path: 'name', label: '隊名' }, { path: 'members', label: '成員' }, { path: 'area', label: '負責區域' }, { path: 'channel', label: '頻道' }, { path: 'note', label: '備註' }] },
    ],
  },
  {
    key: 'log',
    title: '每日搜救紀錄',
    fields: [
      { path: 'log', label: '紀錄', type: 'repeat', add: '新增一天', fields: [{ path: 'date', label: '日期', hint: '10/11' }, { path: 'personnel', label: '出勤人員' }, { path: 'entries', label: '搜救紀錄', type: 'lines', hint: '一行一則' }, { path: 'meeting', label: '晚會內容', type: 'textarea' }] },
    ],
  },
  {
    key: 'found',
    title: '發現失聯者',
    found: true,
    fields: [
      { path: 'found.time', label: '發現時間', hint: '2026-10-12 11:36' },
      { path: 'found', label: '發現座標', type: 'coord' },
      { path: 'found.distanceFromIpp', label: '距 IPP 直線距離' },
      { path: 'found.condition', label: '狀況（意識、傷勢）', type: 'textarea' },
      { path: 'found.narrative', label: '經過', type: 'textarea' },
      { path: 'found.by', label: '紀錄者' },
    ],
  },
];

function blankCase(template) {
  const today = new Date().toISOString().slice(0, 10);
  return { ...structuredClone(template), id: '', meta: { ...template.meta, name: '', reportDate: today, updated: today } };
}

// 案件代號由程式產生：通報日期＋4 碼亂數，例如 2026-10-11-k3x9
async function generateId(reportDate) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(reportDate || '') ? reportDate : new Date().toISOString().slice(0, 10);
  for (;;) {
    const id = `${day}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
    if (!(await db.get('cases', id))) return id;
  }
}

const join = (base, p) => [base, p].filter((x) => x !== '' && x != null).join('.');

function fieldHtml(f, draft, base = '') {
  const path = join(base, f.path);
  const v = getPath(draft, path);
  const id = `f_${path.replace(/\./g, '_')}`;
  const label = `<label for="${id}">${esc(f.label)}${f.required ? ' <span style="color:var(--accent)">*</span>' : ''}</label>`;
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
  const common = `id="${id}" data-path="${esc(path)}" data-type="${f.type || 'text'}"`;
  switch (f.type) {
    case 'textarea':
      return `<div class="fld">${label}<textarea ${common} rows="3">${esc(v ?? '')}</textarea>${hint}</div>`;
    case 'lines':
      return `<div class="fld">${label}<textarea ${common} rows="3">${esc((v || []).join('\n'))}</textarea>${hint || '<small>一行一項</small>'}</div>`;
    case 'number':
      return `<div class="fld">${label}<input type="number" inputmode="numeric" ${common} value="${esc(v ?? '')}">${hint}</div>`;
    case 'date':
      return `<div class="fld">${label}<input type="date" ${common} value="${esc(v ?? '')}">${hint}</div>`;
    case 'select':
      return `<div class="fld">${label}<select ${common}>${f.options.map(([val, text]) => `<option value="${esc(val)}" ${String(v ?? '') === val ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>${hint}</div>`;
    case 'coord': {
      const o = getPath(draft, path) || {};
      const has = o.lat != null && o.lng != null;
      const t = has ? wgs84ToTwd97(o.lat, o.lng) : null;
      return `<div class="fld">${label}
        <div class="cl-row"><input type="text" ${common} inputmode="decimal" value="${has ? `${o.lat}, ${o.lng}` : ''}" placeholder="緯度, 經度 或 TWD97 X Y">
        <button class="btn small" type="button" data-pick="${esc(path)}" aria-label="在地圖上選點">${icon('pin')}</button></div>
        <small>${has ? `TWD97 ${Math.round(t.x)}, ${Math.round(t.y)}` : '未知可留空（之後可在地圖長按補上）'}</small></div>`;
    }
    case 'bbox':
      return `<div class="fld">${label}<div class="cl-row"><input type="text" readonly value="${v ? esc(v.map((p) => p.join(', ')).join(' → ')) : '未設定'}">
        <button class="btn small" type="button" data-pickbox="${esc(path)}" aria-label="用地圖設定範圍">${icon('frame')}</button></div><small>用地圖框出搜索區域</small></div>`;
    case 'repeat': {
      const rows = Array.isArray(v) ? v : [];
      return `<div class="fld"><label>${esc(f.label)}</label>
        ${rows
          .map(
            (_, i) => `<div class="rep-row">
              <div class="rep-head"><b>#${i + 1}</b>
                <button class="btn small" type="button" data-rep="up" data-path="${esc(path)}" data-i="${i}" ${i ? '' : 'disabled'} aria-label="上移">${icon('up')}</button>
                <button class="btn small danger" type="button" data-rep="del" data-path="${esc(path)}" data-i="${i}" aria-label="刪除">${icon('x')}</button></div>
              ${f.fields.map((sf) => fieldHtml(sf, draft, `${path}.${i}`)).join('')}
            </div>`
          )
          .join('')}
        <button class="btn small" type="button" data-rep="add" data-path="${esc(path)}">${icon('plus', { size: 18 })}${esc(f.add || '新增')}</button></div>`;
    }
    default:
      return `<div class="fld">${label}<input type="text" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${common} value="${esc(v ?? '')}">${hint}</div>`;
  }
}

// 新增一列時的空白物件
function blankRow(path) {
  const spec = SECTIONS.flatMap((s) => s.fields).find((f) => f.type === 'repeat' && path.endsWith(f.path));
  const row = {};
  for (const sf of spec?.fields || []) {
    if (sf.type === 'coord') Object.assign(row, { lat: null, lng: null });
    else setPath(row, sf.path, sf.type === 'lines' ? [] : sf.type === 'select' ? sf.options[0][0] : '');
  }
  return row;
}

export async function render(el, app) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const editId = params.get('id');
  const template = await fetch('cases/template.json').then((r) => r.json()).catch(() => ({ meta: {}, checklist: [] }));
  const original = editId ? await db.get('cases', editId) : null;
  if (editId && !original) {
    el.innerHTML = `<div class="card empty"><p>找不到案件 ${esc(editId)}</p><a class="btn" href="#/list">回案件目錄</a></div>`;
    return;
  }
  const draftKey = editId || '__new';
  const savedDraft = await kv.get(DRAFT_KEY);
  let draft = structuredClone(original || blankCase(template));
  delete draft._sync;
  // 從摘要頁的「編輯」按鈕進來時，打開對應的區塊（?sec=subject,clothing），照片則捲到照片區
  const wanted = (params.get('sec') || '').split(',').filter(Boolean);
  const openSections = new Set(wanted.length ? SECTIONS.map((sec, i) => (wanted.includes(sec.key) ? i : -1)).filter((i) => i >= 0) : [0]);
  let restoreOffer = savedDraft?.key === draftKey && JSON.stringify(savedDraft.data) !== JSON.stringify(draft);


  // 地圖選點的起始位置：搜索範圍中心，否則用已知的任一座標
  const nearPoint = () => {
    const box = draft.area?.bbox;
    if (box) return [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
    const p = [draft.ipp, draft.found, ...(draft.area?.markers || [])].find((x) => x?.lat != null);
    return p ? [p.lat, p.lng] : null;
  };

  const saveDraft = () => kv.set(DRAFT_KEY, { key: draftKey, data: draft, at: Date.now() });

  // 監聽器掛在自己的容器上，換頁時隨容器一起丟掉
  const root = document.createElement('div');
  el.append(root);

  const draw = () => {
    const scrollY = window.scrollY;
    root.innerHTML = `
      <div class="stack editor">
        <h1 style="font-size:1.3rem">${original ? `編輯：${esc(original.meta.name)}` : '新增案件'}</h1>
        ${original ? `<p class="muted small">案件代號：<span class="mono">${esc(original.id)}</span></p>` : ''}
        ${restoreOffer ? `<div class="banner">有上次未儲存的草稿（${new Date(savedDraft.at).toLocaleString('zh-TW', { hour12: false })}）。<div class="btn-row" style="margin-top:8px"><button class="btn small primary" id="restore">還原草稿</button><button class="btn small" id="discard">捨棄</button></div></div>` : ''}
        ${SECTIONS.map(
          (s, si) => `<details class="card" data-sec="${si}" ${openSections.has(si) ? 'open' : ''}>
            <summary><h2 style="display:inline">${esc(s.title)}</h2></summary>
            <div style="margin-top:10px">
              ${s.found ? `<label class="check" style="border:0"><input type="checkbox" id="foundToggle" ${draft.found ? 'checked' : ''}><span>已尋獲失聯者</span></label>` : ''}
              ${s.key === 'subject' && original && cloud.user ? `<div class="fld"><label>失蹤者照片</label>
                <ul class="photo-admin" id="subjectPhotoList"><li class="muted small">讀取中…</li></ul>
                <button type="button" class="btn small" data-photo-add="subject" style="margin-top:6px">${icon('camera', { size: 18 })}上傳失蹤者照片</button>
                <small>顯示在摘要「失聯者」區塊最上面。上傳前會自動壓縮。</small></div>` : ''}
              ${s.found && !draft.found ? '' : s.fields.map((f) => fieldHtml(f, draft)).join('')}
            </div>
          </details>`
        ).join('')}
        <section class="card">
          <h2>裝備清單</h2>
          <p class="small">${(draft.checklist || []).map((g) => `${esc(g.group)}（${g.items.length}）`).join('、') || '無'}</p>
          <p class="muted small" style="margin-top:4px">${original ? '<a href="#/case">到「案件設定」編輯裝備清單</a>' : '新案件會套用東搜預設清單，儲存後可到「案件設定」調整。'}</p>
        </section>
        ${original && cloud.user ? `<section class="card" id="photoCard">
          <h2>現場照片</h2>
          <p class="muted small">顯示在摘要的「現場照片」區塊（失蹤者照片在上方「失聯者」區）。上傳前會自動壓縮，離線時先存在手機，連線後上傳。也可以在地圖上按住某個位置拍照，照片會標在那裡。</p>
          <div class="btn-row" style="margin-top:10px">
            <button type="button" class="btn" data-photo-add="scene">${icon('camera', { size: 18 })}上傳現場照片</button>
          </div>
          <ul class="photo-admin" id="photoList"><li class="muted small">讀取中…</li></ul>
        </section>` : ''}
        <div class="btn-row editor-actions">
          <button class="btn primary" id="saveCase">${icon('cloud')}儲存並上傳</button>
        </div>
        <p class="muted small" style="text-align:center">儲存後會同時上傳到雲端，全隊會自動收到更新。<br>輸入內容會自動保存為草稿，離開頁面也不會遺失。</p>
      </div>`;
    window.scrollTo(0, scrollY);
    drawPhotos();
  };

  let photos = [];
  const photoItem = (p) => `<li><button type="button" class="thumb" data-photo-view="${esc(p.id)}" aria-label="放大"><img src="${photoUrl(p)}" alt=""></button>
              <span style="flex:1;min-width:0">${esc(p.caption || '')}
              <br><span class="muted small">${esc((p.created || '').slice(0, 10))}・${esc((p.by || '').split('@')[0])}</span></span>
              <button type="button" class="btn small danger" data-photo-del="${esc(p.id)}" aria-label="刪除照片">${icon('x')}</button></li>`;

  async function drawPhotos() {
    if (!original || !cloud.user) return;
    photos = await listPhotos(original.id);
    const subj = root.querySelector('#subjectPhotoList');
    if (subj) {
      const list = photos.filter((p) => p.kind === 'subject');
      subj.innerHTML = list.length ? list.map(photoItem).join('') : '<li class="muted small">還沒有失蹤者照片</li>';
    }
    const ul = root.querySelector('#photoList');
    if (!ul) return;
    const scene = photos.filter((p) => p.kind !== 'subject');
    ul.innerHTML = scene.length
      ? scene
          .map(photoItem)
          .join('')
      : '<li class="muted small">還沒有現場照片</li>';
  }

  draw();
  if (wanted.length) {
    requestAnimationFrame(() => {
      const target = wanted[0] === 'photos' ? root.querySelector('#photoCard') : root.querySelector(`details[data-sec="${[...openSections][0]}"]`);
      target?.scrollIntoView({ block: 'start' });
    });
  }
  root.addEventListener('click', async (e) => {
    const pb = e.target.closest('[data-photo-add],[data-photo-view],[data-photo-del]');
    if (!pb) return;
    if (pb.dataset.photoView) return openLightbox(photos.find((p) => p.id === pb.dataset.photoView));
    if (pb.dataset.photoDel) {
      if (!(await confirmBox('刪除這張照片？全隊都會移除。'))) return;
      try {
        await deletePhoto(original.id, pb.dataset.photoDel);
      } catch (err) {
        return toast(err.code === 'permission-denied' ? '只能刪除自己上傳的照片（管理員可刪全部）' : `刪除失敗：${err.message}`, 5000);
      }
      return drawPhotos();
    }
    pb.disabled = true;
    await pickAndUpload(original.id, pb.dataset.photoAdd);
    pb.disabled = false;
    drawPhotos();
  });

  root.addEventListener('toggle', (e) => {
    const si = e.target.dataset?.sec;
    if (si == null) return;
    e.target.open ? openSections.add(+si) : openSections.delete(+si);
  }, true);

  root.addEventListener('input', (e) => {
    const t = e.target;
    const path = t.dataset.path;
    if (!path) return;
    const type = t.dataset.type;
    if (type === 'coord') return; // 離開欄位時再解析
    let v = t.value;
    if (type === 'number') v = v === '' ? null : Number(v);
    if (type === 'lines') v = v.split('\n');
    setPath(draft, path, v);
    saveDraft();
  });

  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'foundToggle') {
      if (!t.checked && draft.found && Object.values(draft.found).some((x) => x) && !(await confirmBox('取消「已尋獲」會清除發現失聯者的資料，確定？'))) {
        t.checked = true;
        return;
      }
      draft.found = t.checked ? { time: '', lat: null, lng: null, distanceFromIpp: '', condition: '', narrative: '', by: '' } : null;
      saveDraft();
      return draw();
    }
    if (t.dataset.type === 'coord') {
      const path = t.dataset.path;
      if (!t.value.trim()) {
        setPath(draft, `${path}.lat`, null);
        setPath(draft, `${path}.lng`, null);
      } else {
        const r = parseCoordinate(t.value);
        if (!r) return toast('無法辨識座標，請輸入「緯度, 經度」或「TWD97 X Y」', 4000);
        setPath(draft, `${path}.lat`, +r.lat.toFixed(6));
        setPath(draft, `${path}.lng`, +r.lng.toFixed(6));
      }
      saveDraft();
      draw();
    }
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.rep) {
      const path = b.dataset.path;
      const arr = getPath(draft, path) || [];
      const i = +b.dataset.i;
      if (b.dataset.rep === 'add') arr.push(blankRow(path));
      if (b.dataset.rep === 'del') {
        if (!(await confirmBox('刪除這一筆？'))) return;
        arr.splice(i, 1);
      }
      if (b.dataset.rep === 'up') [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      setPath(draft, path, arr);
      saveDraft();
      return draw();
    }

    if (b.dataset.pick != null) {
      const path = b.dataset.pick;
      const cur = getPath(draft, path) || {};
      const p = await pickPoint({ value: cur, near: nearPoint() });
      if (!p) return;
      setPath(draft, `${path}.lat`, p.lat);
      setPath(draft, `${path}.lng`, p.lng);
      saveDraft();
      return draw();
    }

    if (b.dataset.pickbox != null) {
      const cur = getPath(draft, b.dataset.pickbox);
      const box = await pickBounds({ value: cur, near: nearPoint() });
      if (!box) return;
      setPath(draft, b.dataset.pickbox, box);
      saveDraft();
      return draw();
    }

    if (b.id === 'restore') {
      draft = savedDraft.data;
      restoreOffer = false;
      return draw();
    }
    if (b.id === 'discard') {
      restoreOffer = false;
      await kv.del(DRAFT_KEY);
      return draw();
    }

    if (b.id === 'saveCase') {
      // 先同步檢查表單，有錯就不跳出 Google 登入
      const out = tidy(structuredClone(draft));
      out.schemaVersion = 1;
      out.meta.updated = new Date().toISOString().slice(0, 10);
      const errors = validateCase({ ...out, id: original ? out.id : 'pending' });
      if (errors.length) {
        openSections.add(0);
        draw();
        // 錯誤顯示在欄位旁，並把焦點移過去
        const nameField = root.querySelector('[data-path="meta.name"]');
        if (!out.meta?.name && nameField) {
          const fld = nameField.closest('.fld');
          fld.classList.add('err');
          nameField.setAttribute('aria-invalid', 'true');
          fld.insertAdjacentHTML('beforeend', '<span class="err-msg" role="alert">請填寫案件短名</span>');
          nameField.focus();
          return;
        }
        return toast(errors.join('；'), 5000);
      }
      if (!original) out.id = await generateId(out.meta.reportDate);
      b.disabled = true;
      b.textContent = '儲存中…';
      const r = await saveAndUpload({ ...out, routes: original?.routes || [] });
      await kv.del(DRAFT_KEY);
      await app.select(out.id);
      toast(r.uploaded ? '已儲存並上傳到 Drive' : r.reason, r.uploaded ? 2400 : 6000);
      app.go('summary');
    }
  });

}

export function destroy() {
  releaseUrls();
}
