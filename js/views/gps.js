import { esc, copyText, shareText, toast, downloadFile, fmtTime, ask, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { wgs84ToTwd97, toDMS, parseCoordinate, distance } from '../lib/twd97.js';
import { toGpx } from '../lib/gpx.js';
import { subscribe, requestCompass } from '../geo.js';
import { caseMarkers, addPoint, deletePoint, bearing, compass, fmtDist, TYPE_LABEL } from '../markers.js';

let unsub = null;

function reportText(c, pos) {
  const t = wgs84ToTwd97(pos.lat, pos.lng);
  const parts = [
    `[${c?.meta.name || '搜救'}] ${fmtTime(new Date(pos.time))}`,
    `TWD97 ${Math.round(t.x)},${Math.round(t.y)}`,
    `WGS84 ${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`,
    `±${Math.round(pos.acc)}m${pos.alt != null ? ` 高度${Math.round(pos.alt)}m` : ''}`,
  ];
  return parts.join(' ');
}

export async function render(el, app) {
  const c = app.current;
  el.innerHTML = `
    <div class="stack">
      <section class="card accent" id="posCard">
        <p class="muted" id="posWait">正在取得定位…（第一次需允許定位權限；山區請到開闊處）</p>
        <div id="posBody" class="hidden">
          <div class="coord-label">TWD97 二度分帶（X, Y）</div>
          <div class="coord-big mono" id="twd"></div>
          <div class="coord-label">WGS84 十進位</div>
          <div class="coord-big mono" id="wgs" style="font-size:1.3rem"></div>
          <div class="coord-label">度分秒</div>
          <div class="mono" id="dms"></div>
          <div class="meta-row"><span id="acc"></span><span id="alt"></span><span id="age"></span></div>
        </div>
      </section>
      <div class="btn-row">
        <button class="btn primary" id="copyBtn" disabled>複製回報</button>
        <button class="btn" id="shareBtn" disabled>分享</button>
        <button class="btn" id="markBtn" disabled>打點</button>
      </div>
      <section class="card">
        <h2>到各標記的距離 <button class="btn small" id="compassBtn" style="margin-left:auto">開啟羅盤</button></h2>
        <ul class="dist-list" id="distList"><li class="muted">等待定位…</li></ul>
      </section>
      <section class="card">
        <h2>座標換算</h2>
        <input type="text" id="convIn" inputmode="decimal" placeholder="貼上 23.9404, 121.3133 或 281345 2648739">
        <div id="convOut" class="mono small" style="margin-top:8px"></div>
      </section>
      <section class="card">
        <h2>我的打點紀錄 <span class="muted small" id="ptCount"></span></h2>
        <ul class="dist-list" id="ptList"></ul>
        <div class="btn-row" style="margin-top:8px"><button class="btn small" id="exportBtn">匯出 GPX</button></div>
      </section>
    </div>`;

  let pos = null;
  let heading = null;
  let markers = c ? await caseMarkers(c) : [];
  const $ = (id) => el.querySelector(`#${id}`);

  const renderDist = () => {
    const targets = markers.filter((m) => m.lat != null && m.type !== 'gps');
    if (!pos) return;
    if (!targets.length) {
      $('distList').innerHTML = '<li class="muted">此案件尚無有座標的標記</li>';
      return;
    }
    $('distList').innerHTML = targets
      .map((m) => ({ m, d: distance(pos.lat, pos.lng, m.lat, m.lng), b: bearing(pos.lat, pos.lng, m.lat, m.lng) }))
      .sort((a, b) => a.d - b.d)
      .map(({ m, d, b }) => {
        const rot = heading != null ? b - heading : b;
        return `<li><span>${esc(m.name)}<br><span class="muted small">${esc(TYPE_LABEL[m.type] || '')}</span></span>
          <span style="text-align:right"><b>${fmtDist(d)}</b><br><span class="muted small"><span class="arrow" style="transform:rotate(${rot}deg)">${icon('nav', { size: 14 })}</span> ${compass(b)} ${Math.round(b)}°</span></span></li>`;
      })
      .join('');
  };

  const renderPoints = () => {
    const pts = markers.filter((m) => m.source === 'user');
    $('ptCount').textContent = pts.length ? `${pts.length} 點` : '';
    $('ptList').innerHTML = pts.length
      ? pts
          .map((p) => {
            const t = wgs84ToTwd97(p.lat, p.lng);
            return `<li><span>${esc(p.name)}<br><span class="muted small mono">${Math.round(t.x)}, ${Math.round(t.y)}</span></span>
              <button class="btn small danger" data-del="${p.id}">刪除</button></li>`;
          })
          .join('')
      : '<li class="muted">尚無打點。按「打點」記錄目前位置，或在地圖上長按新增。</li>';
  };
  renderPoints();

  unsub = subscribe(({ pos: p, error, heading: h }) => {
    heading = h;
    if (error && !p) {
      $('posWait').textContent = error;
      return;
    }
    if (!p) return;
    pos = p;
    const t = wgs84ToTwd97(p.lat, p.lng);
    $('posWait').classList.add('hidden');
    $('posBody').classList.remove('hidden');
    $('twd').textContent = `${Math.round(t.x)}, ${Math.round(t.y)}`;
    $('wgs').textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
    $('dms').textContent = `${toDMS(p.lat, true)} ${toDMS(p.lng, false)}`;
    $('acc').textContent = `精度 ±${Math.round(p.acc)} m`;
    $('alt').textContent = p.alt != null ? `高度 ${Math.round(p.alt)} m` : '高度 —';
    $('age').textContent = fmtTime(new Date(p.time));
    ['copyBtn', 'shareBtn', 'markBtn'].forEach((id) => ($(id).disabled = false));
    renderDist();
  });

  $('copyBtn').onclick = () => pos && copyText(reportText(c, pos));
  $('shareBtn').onclick = () => pos && shareText(reportText(c, pos));
  $('markBtn').onclick = async () => {
    if (!pos || !c) return toast(c ? '尚未定位' : '請先匯入案件');
    const name = await ask('打點名稱', { value: `打點 ${fmtTime()}`, ok: '儲存' });
    if (name == null) return;
    await addPoint({ caseId: c.id, type: 'gps', name: name || `打點 ${fmtTime()}`, lat: pos.lat, lng: pos.lng, ele: pos.alt, acc: pos.acc, time: new Date(pos.time).toISOString() });
    markers = await caseMarkers(c);
    renderPoints();
    renderDist();
    toast('已儲存在本機');
  };
  $('ptList').onclick = async (e) => {
    const id = e.target.dataset.del;
    if (!id || !(await confirmBox('刪除這個點？'))) return;
    await deletePoint(Number(id));
    markers = await caseMarkers(c);
    renderPoints();
    renderDist();
  };
  $('exportBtn').onclick = () => {
    const pts = markers.filter((m) => m.source === 'user');
    if (!pts.length) return toast('沒有可匯出的點');
    downloadFile(`${c.id}-points.gpx`, toGpx({ name: `${c.meta.name} 打點`, waypoints: pts }), 'application/gpx+xml');
  };
  $('compassBtn').onclick = async () => {
    const ok = await requestCompass();
    toast(ok ? '羅盤已開啟，箭頭會依手機方向轉動' : '無法使用羅盤');
  };
  $('convIn').oninput = (e) => {
    const r = parseCoordinate(e.target.value);
    if (!r) {
      $('convOut').textContent = e.target.value ? '無法辨識，請輸入「緯度, 經度」或「TWD97 X Y」' : '';
      return;
    }
    const t = wgs84ToTwd97(r.lat, r.lng);
    $('convOut').innerHTML = `判讀為 ${r.source === 'twd97' ? 'TWD97' : 'WGS84'}<br>
      WGS84：${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}<br>
      度分秒：${toDMS(r.lat, true)} ${toDMS(r.lng, false)}<br>
      TWD97：${Math.round(t.x)}, ${Math.round(t.y)}
      ${pos ? `<br>距目前位置：${fmtDist(distance(pos.lat, pos.lng, r.lat, r.lng))}，方位 ${compass(bearing(pos.lat, pos.lng, r.lat, r.lng))}` : ''}<br>
      <a class="btn small" style="margin-top:6px" href="#/map?lat=${r.lat}&lng=${r.lng}">在地圖上看</a>`;
  };
}

export function destroy() {
  unsub?.();
  unsub = null;
}
