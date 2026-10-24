import { esc, sheet, closeSheet, toast, copyText, pickFile, fmtTime, downloadFile, ask, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { db } from '../db.js';
import { wgs84ToTwd97, parseCoordinate } from '../lib/twd97.js';
import { parseTrackFile, toGpx } from '../lib/gpx.js';
import { routeLength, ROUTE_COLORS } from '../lib/route.js';
import { validateCase } from '../lib/caseSchema.js';
import { saveAndUpload, shareTrack, deleteTrack, email, isAdmin, state as cloud, onChange as onCloudChange } from '../cloud.js';
import { listPhotos, photoUrl, openLightbox, releaseUrls, pickAndUpload } from '../photos.js';
import * as log from '../log.js';
import { subscribe } from '../geo.js';
import { caseMarkers, setMarkerCoords, clearMarkerCoords, addPoint, deletePoint, TYPE_LABEL, fmtDist } from '../markers.js';
import { BASEMAPS, tileUrls, downloadTiles, cachedTileCount, clearTiles } from '../tiles.js';
import { listenHandshakes, addHandshake, deleteHandshake, readTiff, computeFromDem } from '../handshakes.js';
import { createHandshakeLayer } from '../handshakeLayer.js';
import { VIEWSHED_DEFAULTS } from '../lib/viewshed.js';

const TRACK_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];
const MAX_TILES = 5000;

let map = null;
let unsub = null;
let hsUnsub = null;
let cloudUnsub = null;
let abort = null;
let onTracks = null;

const pref = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 私密模式 */ } },
};

const pinIcon = (type) => L.divIcon({ className: '', html: `<div class="pin ${type}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] });
const coordText = (lat, lng) => {
  const t = wgs84ToTwd97(lat, lng);
  return `TWD97 ${Math.round(t.x)}, ${Math.round(t.y)}<br>${lat.toFixed(6)}, ${lng.toFixed(6)}`;
};

function hashParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

export async function render(el, app) {
  let c = app.current;
  el.className = 'full';
  el.innerHTML = `
    <div class="map-wrap">
      <div id="map"></div>
      <div class="map-hint" id="hint">長按地圖可查座標、加標記</div>
      <div class="route-bar hidden" id="routeBar" role="toolbar" aria-label="規劃路線">
        <div class="route-info"><b id="routeDist">0 m</b><span class="muted small" id="routeCount">點地圖加入路線點</span></div>
        <button class="btn small" id="routeUndo" aria-label="復原上一點">${icon('undo')}</button>
        <button class="btn small" id="routeCancel">取消</button>
        <button class="btn small primary" id="routeDone">完成</button>
      </div>
      <div class="map-tools">
        <button class="btn" id="routeBtn" title="規劃搜救路線" aria-label="規劃搜救路線">${icon('route', { size: 22 })}</button>
        <button class="btn" id="layersBtn" title="圖層與航跡" aria-label="航跡與標記">${icon('layers', { size: 22 })}</button>
        <button class="btn" id="dlBtn" title="離線地圖" aria-label="離線地圖">${icon('download', { size: 22 })}</button>
        <button class="btn" id="locBtn" title="我的位置" aria-label="跟隨我的位置" aria-pressed="false">${icon('locate', { size: 22 })}</button>
      </div>
    </div>`;

  const layers = Object.fromEntries(
    BASEMAPS.map((b) => [b.id, L.tileLayer(b.url, { attribution: b.attribution, maxNativeZoom: b.maxNativeZoom, maxZoom: 19, crossOrigin: true })])
  );
  const baseId = layers[pref.get('basemap')] ? pref.get('basemap') : 'rudy';

  map = L.map(el.querySelector('#map'), { zoomControl: false, layers: [layers[baseId]], tap: false });
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
  L.control.layers(Object.fromEntries(BASEMAPS.map((b) => [b.name, layers[b.id]])), null, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', (e) => pref.set('basemap', BASEMAPS.find((b) => layers[b.id] === e.layer).id));

  const routeLayer = L.featureGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const photoLayer = L.layerGroup().addTo(map);
  let photos = [];
  // 有座標的照片標在地圖上（相機圖示），點開看縮圖，再點放大
  async function drawPhotos() {
    photoLayer.clearLayers();
    if (!c || !cloud.user) return;
    photos = (await listPhotos(c.id)).filter((p) => p.lat != null);
    for (const p of photos) {
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="pin photo">${icon('camera', { size: 14 })}</div>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] }) })
        .bindPopup(`<button type="button" class="popup-photo" data-photo-open="${esc(p.id)}" aria-label="放大照片"><img src="${photoUrl(p)}" alt=""></button>${p.caption ? `<br><b>${esc(p.caption)}</b>` : ''}<br><span class="muted small">${esc((p.created || '').replace('T', ' ').slice(0, 16))}・${esc((p.by || '').split('@')[0])}</span>`)
        .addTo(photoLayer);
    }
  }
  const trackLayer = L.featureGroup().addTo(map);
  let markers = [];
  let tracks = [];

  async function drawMarkers() {
    markerLayer.clearLayers();
    if (!c) return;
    markers = await caseMarkers(c);
    for (const m of markers) {
      if (m.lat == null) continue;
      const mk = L.marker([m.lat, m.lng], { icon: pinIcon(m.type), title: m.name }).addTo(markerLayer);
      mk.bindPopup(
        `<b>${esc(m.name)}</b> <span class="muted">${esc(TYPE_LABEL[m.type] || '')}</span><br>
         <span class="mono">${coordText(m.lat, m.lng)}</span>
         ${m.patched ? '<br><span class="small">座標由本機補上</span>' : m.note ? `<br><span class="small">${esc(m.note)}</span>` : ''}
         ${m.source === 'user' ? `<br><button class="btn small danger" data-del-point="${m.id}" style="margin-top:6px">刪除</button>` : ''}
         ${m.patched ? `<br><button class="btn small" data-clear="${esc(m.key)}" style="margin-top:6px">清除補上的座標</button>` : ''}`
      );
      m._leaflet = mk;
    }
  }

  async function drawTracks() {
    trackLayer.clearLayers();
    if (!c) return;
    tracks = await db.byCase('tracks', c.id);
    tracks.forEach((t, i) => {
      if (t.hidden) return;
      const color = t.color || TRACK_COLORS[i % TRACK_COLORS.length];
      for (const tr of t.data.tracks) {
        L.polyline(tr.points.map((p) => [p[0], p[1]]), { color, weight: 4, opacity: 0.85 }).bindPopup(`<b>${esc(tr.name || t.name)}</b><br>${esc(t.name)}`).addTo(trackLayer);
      }
      for (const w of t.data.waypoints) {
        L.marker([w.lat, w.lng], { icon: pinIcon('wpt') })
          .bindPopup(`<b>${esc(w.name || '航點')}</b>${w.ele != null ? ` ${Math.round(w.ele)} m` : ''}<br><span class="mono">${coordText(w.lat, w.lng)}</span>`)
          .addTo(trackLayer);
      }
    });
  }

  // 搜救路線（存在案件 JSON 的 routes，儲存時上傳 Drive 與全隊共享）
  const routeById = {};
  let drawing = null; // 規劃中的路線 { id, points: [[lat, lng]], base }
  function drawRoutes() {
    routeLayer.clearLayers();
    for (const r of c?.routes || []) {
      if (drawing?.id === r.id) continue; // 編輯中的路線改用草稿顯示
      const color = r.color || ROUTE_COLORS[0];
      const line = L.polyline(r.points, { color, weight: 5, opacity: 0.9, dashArray: '10 8' }).addTo(routeLayer);
      L.circleMarker(r.points[0], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(routeLayer);
      L.circleMarker(r.points[r.points.length - 1], { radius: 6, color, weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(routeLayer);
      line.bindPopup(
        `<b>${esc(r.name)}</b>${r.team ? `<br>負責：${esc(r.team)}` : ''}<br>長度 ${fmtDist(routeLength(r.points))}・${r.points.length} 點
         ${r.note ? `<br><span class="small">${esc(r.note)}</span>` : ''}
         <div class="btn-row" style="margin-top:8px">
           <button class="btn small" data-route-edit="${esc(r.id)}">編輯</button>
           <button class="btn small" data-route-gpx="${esc(r.id)}">GPX</button>
           <button class="btn small danger" data-route-del="${esc(r.id)}">刪除</button>
         </div>`
      );
      routeById[r.id] = line;
    }
  }

  // 握手範圍（只有雲端案件有）：所有筆數聯集成一個圖層，基地台另外標出
  // 放在路線、航跡（overlayPane 400）下面，不要把路線染紅
  map.createPane('handshake').style.zIndex = 350;
  const hsLayer = createHandshakeLayer('handshake');
  const stationLayer = L.layerGroup();
  const cloudCase = () => c?._sync?.source === 'cloud' && !!cloud.user;
  let handshakes = [];
  function drawHandshakes() {
    const show = pref.get('handshake') !== '0';
    hsLayer.setMasks(handshakes);
    stationLayer.clearLayers();
    for (const h of handshakes) {
      if (!h.station) continue;
      L.marker([h.station.lat, h.station.lng], { icon: pinIcon('station'), title: h.name })
        .bindPopup(`<b>${esc(h.name)}</b> <span class="muted">基地台</span><br><span class="mono">${coordText(h.station.lat, h.station.lng)}</span>`)
        .addTo(stationLayer);
    }
    for (const l of [hsLayer, stationLayer]) show && handshakes.length ? l.addTo(map) : l.remove();
  }
  // 直接重新整理在地圖頁時，登入狀態比畫面晚到：登入後再開始讀
  function startHandshakes() {
    if (hsUnsub || !cloudCase()) return;
    hsUnsub = listenHandshakes(c.id, (list) => {
      handshakes = list;
      drawHandshakes();
    });
    const box = document.querySelector('#hsBox');
    if (box) {
      box.innerHTML = handshakeSection();
      bindHandshakeSection(box);
    }
  }
  startHandshakes();
  cloudUnsub = onCloudChange(() => startHandshakes());

  // 別人分享的航跡同步進來時重畫
  onTracks = (e) => e.detail === c?.id && drawTracks();
  window.addEventListener('tracks-data', onTracks);

  await Promise.all([drawMarkers(), drawTracks()]);
  drawPhotos();
  drawRoutes();

  // 初始視角：網址指定 > 案件範圍 > 標記與航跡 > 台灣
  const q = hashParams();
  const focus = q.focus && markers.find((m) => m.name === q.focus && m.lat != null);
  if (q.lat && q.lng) {
    map.setView([+q.lat, +q.lng], 16);
    L.marker([+q.lat, +q.lng], { icon: pinIcon('poi') }).addTo(markerLayer).bindPopup(`<span class="mono">${coordText(+q.lat, +q.lng)}</span>`).openPopup();
  } else if (q.route && routeById[q.route]) {
    map.fitBounds(routeById[q.route].getBounds(), { padding: [40, 40] });
    routeById[q.route].openPopup();
  } else if (focus) {
    map.setView([focus.lat, focus.lng], 16);
    focus._leaflet.openPopup();
  } else if (c?.area.bbox) {
    map.fitBounds(c.area.bbox);
  } else {
    const pts = markers.filter((m) => m.lat != null).map((m) => [m.lat, m.lng]);
    const b = L.latLngBounds(pts);
    if (trackLayer.getLayers().length) b.extend(trackLayer.getBounds());
    if (b.isValid()) map.fitBounds(b, { padding: [30, 30], maxZoom: 15 });
    else map.setView([23.7, 121], 8);
  }

  // 目前位置
  const me = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 });
  const accCircle = L.circle([0, 0], { radius: 1, color: '#2563eb', weight: 1, fillOpacity: 0.1, interactive: false });
  let follow = false;
  let lastPos = null;
  unsub = subscribe(({ pos, error }) => {
    if (error && !pos) el.querySelector('#hint').textContent = error;
    if (!pos) return;
    lastPos = pos;
    me.setLatLng([pos.lat, pos.lng]).addTo(map);
    accCircle.setLatLng([pos.lat, pos.lng]).setRadius(pos.acc).addTo(map);
    if (follow) map.panTo([pos.lat, pos.lng]);
  });
  const locBtn = el.querySelector('#locBtn');
  locBtn.onclick = () => {
    follow = !follow;
    locBtn.classList.toggle('on', follow);
    locBtn.setAttribute('aria-pressed', String(follow));
    if (follow && lastPos) map.setView([lastPos.lat, lastPos.lng], Math.max(map.getZoom(), 15));
    else if (follow) toast('正在取得定位…');
  };
  map.on('dragstart', () => {
    follow = false;
    locBtn.classList.remove('on');
    locBtn.setAttribute('aria-pressed', 'false');
  });

  // 規劃路線模式：點地圖加點，完成後填名稱與負責隊伍
  const draft = L.polyline([], { color: '#f97316', weight: 5, opacity: 0.95 });
  const vertexLayer = L.layerGroup();
  const bar = el.querySelector('#routeBar');
  const tools = el.querySelector('.map-tools');

  function redrawDraft() {
    draft.setLatLngs(drawing.points).addTo(map);
    vertexLayer.clearLayers().addTo(map);
    drawing.points.forEach((p, i) => L.circleMarker(p, { radius: i === drawing.points.length - 1 ? 7 : 5, color: '#fff', weight: 2, fillColor: '#f97316', fillOpacity: 1, interactive: false }).addTo(vertexLayer));
    el.querySelector('#routeDist').textContent = fmtDist(routeLength(drawing.points));
    el.querySelector('#routeCount').textContent = drawing.points.length ? `${drawing.points.length} 點・繼續點地圖延伸` : '點地圖加入路線點';
    el.querySelector('#routeUndo').disabled = !drawing.points.length;
  }

  function startDrawing(route) {
    if (!c) return toast('請先選擇案件');
    map.closePopup();
    drawing = { id: route?.id || null, points: route ? route.points.map((p) => [...p]) : [], base: route || null };
    bar.classList.remove('hidden');
    tools.classList.add('hidden');
    el.querySelector('#hint').classList.add('hidden');
    drawRoutes();
    redrawDraft();
  }

  function stopDrawing() {
    drawing = null;
    draft.remove();
    vertexLayer.remove();
    bar.classList.add('hidden');
    tools.classList.remove('hidden');
    el.querySelector('#hint').classList.remove('hidden');
    drawRoutes();
  }

  map.on('click', (e) => {
    if (!drawing) return;
    drawing.points.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
    redrawDraft();
  });
  el.querySelector('#routeBtn').onclick = () => startDrawing(null);
  el.querySelector('#routeUndo').onclick = () => {
    drawing.points.pop();
    redrawDraft();
  };
  el.querySelector('#routeCancel').onclick = async () => {
    if (drawing.points.length > 1 && !drawing.base && !(await confirmBox('放棄這條路線？'))) return;
    stopDrawing();
  };
  el.querySelector('#routeDone').onclick = () => {
    if (drawing.points.length < 2) return toast('至少需要兩個點');
    const base = drawing.base;
    const teams = [...new Set((c.teams || []).map((t) => t.name).filter(Boolean))];
    const color = base?.color || ROUTE_COLORS[(c.routes || []).length % ROUTE_COLORS.length];
    const s = sheet(`
      <h2>${base ? '更新路線' : '儲存路線'}</h2>
      <p class="small">長度 <b>${fmtDist(routeLength(drawing.points))}</b>・${drawing.points.length} 點</p>
      <div class="fld"><label for="rtName">路線名稱</label><input type="text" id="rtName" value="${esc(base?.name || `路線 ${(c.routes || []).length + 1}`)}"></div>
      <div class="fld"><label for="rtTeam">負責隊伍</label>
        <input type="text" id="rtTeam" list="rtTeams" value="${esc(base?.team || '')}" placeholder="例如：第二梯">
        <datalist id="rtTeams">${teams.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
      <fieldset class="fld swatches"><legend>顏色</legend>${ROUTE_COLORS.map((col, i) => `<label><input type="radio" name="rtColor" value="${col}" ${col === color ? 'checked' : ''}><span style="background:${col}"></span><span class="sr-only">顏色 ${i + 1}</span></label>`).join('')}</fieldset>
      <div class="fld"><label for="rtNote">備註</label><textarea id="rtNote" rows="2" placeholder="搜索重點、注意事項">${esc(base?.note || '')}</textarea></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="rtSave">${icon('cloud')}儲存並上傳</button></div>
      <p class="muted small" style="margin-top:6px">離線時先存在手機，連線後同步會自動上傳給全隊。</p>`);
    s.querySelector('#rtSave').onclick = async () => {
      const route = {
        id: drawing.id || `r${Date.now().toString(36)}`,
        name: s.querySelector('#rtName').value.trim() || '未命名路線',
        team: s.querySelector('#rtTeam').value.trim(),
        color: s.querySelector('input[name="rtColor"]:checked')?.value || color,
        note: s.querySelector('#rtNote').value.trim(),
        points: drawing.points,
        updated: new Date().toISOString(),
      };
      await saveRoutes((routes) => (routes.some((r) => r.id === route.id) ? routes.map((r) => (r.id === route.id ? route : r)) : [...routes, route]));
      closeSheet();
      stopDrawing();
    };
  };

  async function saveRoutes(change) {
    const raw = await db.get('cases', c.id);
    const next = { ...raw, routes: change(raw.routes || []) };
    const errors = validateCase(next);
    if (errors.length) return toast(errors.join('；'), 5000);
    const r = await saveAndUpload(next);
    await app.reload();
    c = app.current;
    toast(r.uploaded ? '路線已儲存並上傳' : r.reason, r.uploaded ? 2400 : 6000);
  }

  // 彈出視窗內的按鈕
  map.on('popupopen', (e) => {
    if (drawing) return map.closePopup(); // 規劃時點到既有路線只加點，不開資訊框
    const node = e.popup.getElement();
    node.querySelector('[data-photo-open]')?.addEventListener('click', (ev) => {
      const p = photos.find((x) => x.id === ev.currentTarget.dataset.photoOpen);
      if (p) openLightbox(p);
    });
    node.querySelector('[data-route-edit]')?.addEventListener('click', (ev) => {
      startDrawing(c.routes.find((r) => r.id === ev.currentTarget.dataset.routeEdit));
    });
    node.querySelector('[data-route-gpx]')?.addEventListener('click', (ev) => {
      const r = c.routes.find((x) => x.id === ev.currentTarget.dataset.routeGpx);
      downloadFile(`${r.name}.gpx`, toGpx({ name: r.name, tracks: [{ name: r.name, points: r.points.map(([lat, lng]) => [lat, lng, null]) }] }), 'application/gpx+xml');
    });
    node.querySelector('[data-route-del]')?.addEventListener('click', async (ev) => {
      const id = ev.currentTarget.dataset.routeDel;
      if (!(await confirmBox('刪除這條路線？全隊同步後都會移除。'))) return;
      map.closePopup();
      await saveRoutes((routes) => routes.filter((r) => r.id !== id));
      drawRoutes();
    });
    node.querySelector('[data-del-point]')?.addEventListener('click', async (ev) => {
      if (!(await confirmBox('刪除這個標記？'))) return;
      await deletePoint(Number(ev.target.dataset.delPoint));
      map.closePopup();
      drawMarkers();
    });
    node.querySelector('[data-clear]')?.addEventListener('click', async (ev) => {
      await clearMarkerCoords(c.id, ev.target.dataset.clear);
      map.closePopup();
      drawMarkers();
    });
  });

  // 長按（手機）或右鍵（電腦）
  let pressTimer = null;
  let pressStart = null;
  let lastLongPress = 0;
  const container = map.getContainer();
  const onLongPress = (latlng) => {
    if (drawing || Date.now() - lastLongPress < 800) return;
    lastLongPress = Date.now();
    navigator.vibrate?.(30);
    openPointSheet(latlng);
  };
  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    pressStart = [e.clientX, e.clientY];
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => onLongPress(map.mouseEventToLatLng(e)), 600);
  });
  const cancelPress = (e) => {
    if (e.type === 'pointermove' && pressStart && Math.hypot(e.clientX - pressStart[0], e.clientY - pressStart[1]) < 10) return;
    clearTimeout(pressTimer);
  };
  ['pointerup', 'pointercancel', 'pointermove'].forEach((t) => container.addEventListener(t, cancelPress));
  map.on('zoomstart movestart', () => clearTimeout(pressTimer));
  map.on('contextmenu', (e) => onLongPress(e.latlng));

  function openPointSheet({ lat, lng }) {
    if (!c) return toast('請先匯入案件');
    const missing = markers.filter((m) => m.source === 'case' && (m.lat == null || m.patched));
    const s = sheet(`
      <h2>這個位置</h2>
      <p class="mono">${coordText(lat, lng)}</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn primary" id="addMark">加標記</button>
        ${cloud.user ? `<button class="btn" id="addPhoto">${icon('camera', { size: 18 })}拍照／加照片</button>` : ''}
        <button class="btn" id="copyPt">複製座標</button>
      </div>
      ${missing.length ? `
        <h3 style="margin-top:16px">把這裡設為案件地點</h3>
        <div class="btn-row" style="margin-top:6px">${missing.map((m) => `<button class="btn small" data-set="${esc(m.key)}">${esc(m.name)}${m.patched ? '（重設）' : ''}</button>`).join('')}</div>
        <p class="muted small" style="margin-top:6px">只存在本機，不會改動原始案件檔。</p>` : ''}
    `);
    s.querySelector('#addPhoto')?.addEventListener('click', async () => {
      // 手機會直接開相機（也可以選相簿），照片標在這個位置
      closeSheet();
      if (await pickAndUpload(c.id, 'scene', { caption: '', lat: +lat.toFixed(6), lng: +lng.toFixed(6), camera: true })) drawPhotos();
    });
    s.querySelector('#addMark').onclick = async () => {
      const name = await ask('標記名稱', { value: `標記 ${fmtTime()}`, ok: '儲存' });
      if (name == null) return;
      await addPoint({ caseId: c.id, type: 'mark', name: name || '標記', lat, lng, time: new Date().toISOString() });
      closeSheet();
      drawMarkers();
    };
    s.querySelector('#copyPt').onclick = () => {
      const t = wgs84ToTwd97(lat, lng);
      copyText(`TWD97 ${Math.round(t.x)},${Math.round(t.y)} WGS84 ${lat.toFixed(6)},${lng.toFixed(6)}`);
    };
    s.querySelectorAll('[data-set]').forEach((b) => {
      b.onclick = async () => {
        await setMarkerCoords(c.id, b.dataset.set, lat, lng);
        closeSheet();
        drawMarkers();
        toast(`已設定 ${b.dataset.set}`);
      };
    });
  }

  // 圖層與航跡管理
  el.querySelector('#layersBtn').onclick = () => {
    if (!c) return toast('請先匯入案件');
    const missing = markers.filter((m) => m.source === 'case' && m.lat == null);
    // 雲端案件、已登入時，匯入的航跡會分享給全隊
    const canShare = !!cloud.user && c._sync?.source === 'cloud';
    const trackInfo = (t) =>
      t.cloudId
        ? `已分享・${esc((t.by || '').split('@')[0])}${t.pointCount != null ? `・${t.pointCount} 點` : ''}`
        : `只在這支手機・${t.data.tracks.length} 條航跡、${t.data.waypoints.length} 個航點`;
    const canDelete = (t) => !t.cloudId || t.by === email() || isAdmin();
    const s = sheet(`
      <h2>航跡與標記</h2>
      <div id="trackList">${
        tracks.length
          ? tracks.map((t, i) => `<label class="check"><input type="checkbox" data-track="${esc(t.id)}" ${t.hidden ? '' : 'checked'}><span style="flex:1"><b style="color:${t.color || TRACK_COLORS[i % TRACK_COLORS.length]}">━</b> ${esc(t.name)}<br><span class="muted small">${trackInfo(t)}</span></span>${canShare && !t.cloudId ? `<button class="btn small" data-sharetrack="${esc(t.id)}">分享給全隊</button>` : ''}${canDelete(t) ? `<button class="btn small danger" data-deltrack="${esc(t.id)}">刪除</button>` : ''}</label>`).join('')
          : '<p class="muted">尚未匯入航跡</p>'
      }</div>
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="importTrack">匯入 GPX / KML</button></div>
      <p class="muted small" style="margin-top:6px">${canShare ? '匯入的航跡會分享給全隊（點數太多時會精簡）。' : cloud.user ? '這個案件還沒上傳雲端，航跡只存在這支手機。' : '登入後匯入的航跡才會分享給全隊，目前只存在這支手機。'}</p>
      ${missing.length ? `<h3 style="margin-top:16px">座標待補</h3><ul style="margin:6px 0 0;padding-left:18px">${missing.map((m) => `<li>${esc(m.name)}${m.note ? ` <span class="muted small">${esc(m.note)}</span>` : ''}</li>`).join('')}</ul><p class="muted small" style="margin-top:6px">在地圖上長按該位置即可補上。</p>` : ''}
      <h3 style="margin-top:16px">握手範圍</h3>
      <div id="hsBox" style="margin-top:6px">${handshakeSection()}</div>
      <h3 style="margin-top:16px">圖例</h3>
      <div class="looks" style="margin-top:6px">${['ipp', 'found', 'camp', 'cp', 'poi', 'mark', 'gps', 'wpt'].map((t) => `<span style="display:inline-flex;gap:6px;align-items:center"><span class="pin ${t}" style="display:inline-block;width:14px;height:14px;border-width:2px"></span>${TYPE_LABEL[t]}</span>`).join('')}
        <span style="display:inline-flex;gap:6px;align-items:center"><span class="pin station" style="display:inline-block;width:12px;height:12px;padding:0;margin:0 2px;border-width:2px"></span>基地台</span>
        <span style="display:inline-flex;gap:6px;align-items:center"><span style="display:inline-block;width:14px;height:14px;padding:0;background:rgba(255,0,0,.61);border-radius:2px"></span>握手範圍（基地台看得到的地方）</span></div>
    `);
    bindHandshakeSection(s);
    s.querySelector('#importTrack').onclick = async () => {
      const file = await pickFile('.gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml');
      if (!file) return;
      try {
        const data = parseTrackFile(await file.text());
        if (!data.tracks.length && !data.waypoints.length) throw new Error('檔案中沒有航跡或航點');
        const t = { caseId: c.id, name: file.name.replace(/\.(gpx|kml)$/i, ''), data, added: new Date().toISOString() };
        t.id = await db.put('tracks', t);
        const r = canShare ? await shareTrack(t) : null;
        closeSheet();
        await drawTracks();
        if (trackLayer.getLayers().length) map.fitBounds(trackLayer.getBounds(), { padding: [30, 30] });
        toast(r ? (r.uploaded ? `已匯入 ${file.name}，並分享給全隊` : `已匯入 ${file.name}；${r.reason}`) : `已匯入 ${file.name}`, r && !r.uploaded ? 4000 : 2500);
      } catch (e) {
        log.warn('航跡匯入', `${file.name} 匯入失敗`, e.message);
        toast(`匯入失敗：${e.message}`, 4000);
      }
    };
    s.querySelectorAll('[data-track]').forEach((cb) => {
      cb.onchange = async () => {
        const t = tracks.find((x) => String(x.id) === cb.dataset.track);
        t.hidden = !cb.checked;
        await db.put('tracks', t);
        drawTracks();
      };
    });
    s.querySelectorAll('[data-deltrack]').forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault();
        const t = tracks.find((x) => String(x.id) === b.dataset.deltrack);
        if (!(await confirmBox(t.cloudId ? '刪除這份航跡？全隊都會看不到。' : '刪除這份航跡？'))) return;
        try {
          await deleteTrack(t);
        } catch (err) {
          toast(err.message, 4000);
        }
        closeSheet();
        drawTracks();
      };
    });
    s.querySelectorAll('[data-sharetrack]').forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault();
        const t = tracks.find((x) => String(x.id) === b.dataset.sharetrack);
        b.disabled = true;
        try {
          const r = await shareTrack(t);
          toast(r.uploaded ? `已分享「${t.name}」給全隊` : r.reason, 4000);
        } catch (err) {
          log.warn('航跡分享', `${t.name} 分享失敗`, err.message);
          toast(`分享失敗：${err.message}`, 4000);
        }
        closeSheet();
        drawTracks();
      };
    });
  };

  // 握手範圍：清單、開關；成員可匯入 TIFF、計算，管理員可刪除
  function handshakeSection() {
    if (!cloudCase()) return '<p class="muted small">上傳到雲端後才能使用握手範圍</p>';
    const admin = isAdmin();
    return `
      <label class="check"><input type="checkbox" id="hsShow" ${pref.get('handshake') !== '0' ? 'checked' : ''}><span>顯示握手範圍（聯集）</span></label>
      ${handshakes.length
        ? handshakes.map((h) => `<div class="check"><span style="flex:1"><b style="color:#dc2626">■</b> ${esc(h.name)} <span class="muted small">${h.source === 'compute' ? '計算' : '匯入'}</span><br><span class="muted small">${esc((h.by || '').split('@')[0])}・${esc((h.created || '').replace('T', ' ').slice(0, 16))}</span></span>${admin ? `<button class="btn small danger" data-hsdel="${esc(h.id)}">刪除</button>` : ''}</div>`).join('')
        : '<p class="muted">尚無握手資料</p>'}
      <div class="btn-row" style="margin-top:10px"><button class="btn" id="hsImport">匯入 TIFF</button><button class="btn" id="hsCompute">計算</button></div>`;
  }

  function bindHandshakeSection(s) {
    s.querySelector('#hsShow')?.addEventListener('change', (e) => {
      pref.set('handshake', e.target.checked ? '1' : '0');
      drawHandshakes();
    });
    s.querySelectorAll('[data-hsdel]').forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmBox('刪除這筆握手範圍？全隊都會移除'))) return;
        // 離線時 Firestore 會排隊，不等伺服器回應
        closeSheet();
        deleteHandshake(c.id, b.dataset.hsdel).catch((e) => toast(`刪除失敗：${e.message}`, 4000));
      };
    });
    s.querySelector('#hsImport')?.addEventListener('click', importHandshake);
    s.querySelector('#hsCompute')?.addEventListener('click', computeHandshake);
  }

  const latLngText = (p) => (p ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}` : '');
  // 空白 → null；看不懂 → undefined
  const readStation = (text) => (text.trim() ? parseCoordinate(text) || undefined : null);

  async function saveHandshake(entry) {
    let online;
    try {
      online = await addHandshake(c.id, entry);
    } catch (e) {
      log.warn('握手範圍', `「${entry.name}」上傳失敗`, e.message);
      toast(e.code === 'permission-denied' ? '上傳失敗：沒有權限，請確認帳號在成員名單內' : `上傳失敗：${e.message}`, 5000);
      return false;
    }
    closeSheet();
    toast(online ? '已上傳，全隊會自動收到' : '目前離線，已存在手機，連線後會自動上傳', online ? 2400 : 5000);
    return true;
  }

  async function importHandshake() {
    const file = await pickFile('.tif,.tiff,image/tiff');
    if (!file) return;
    const s = sheet('<h2>匯入握手範圍</h2><p class="small" id="hsMsg">讀取檔案中…</p>');
    let r;
    try {
      r = await readTiff(file);
    } catch (e) {
      log.warn('握手範圍', `${file.name} 匯入失敗`, e.message);
      closeSheet();
      return toast(`匯入失敗：${e.message}`, 5000);
    }
    if (!s.isConnected) return;
    s.querySelector('#hsMsg').outerHTML = `
      <p class="muted small">${esc(file.name)}</p>
      <div class="fld"><label for="hsName">名稱</label><input type="text" id="hsName" value="${esc(file.name.replace(/\.tiff?$/i, ''))}"></div>
      <div class="fld"><label for="hsStation">基地台座標</label><input type="text" id="hsStation" value="${latLngText(r.center)}" placeholder="緯度, 經度 或 TWD97"></div>
      <p class="muted small">預填的是 TIFF 的中心點（QGIS 視域分析以基地台為中心）。清空就不在地圖上標基地台。</p>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="hsSave">${icon('cloud')}儲存並上傳</button></div>`;
    s.querySelector('#hsSave').onclick = async () => {
      const station = readStation(s.querySelector('#hsStation').value);
      if (station === undefined) return toast('座標格式看不懂');
      await saveHandshake({ name: s.querySelector('#hsName').value.trim() || '握手範圍', source: 'import', station: station && { lat: station.lat, lng: station.lng }, grid: r.grid, bits: r.bits });
    };
  }

  function computeHandshake() {
    let dem = null;
    const d = VIEWSHED_DEFAULTS;
    const s = sheet(`
      <h2>計算握手範圍</h2>
      <p class="muted small">用 DEM 算基地台看得到的範圍（同 QGIS 視域分析）。請在電腦上操作。</p>
      <div class="fld"><label for="hsName">名稱</label><input type="text" id="hsName" placeholder="例如：中華電信 某某基地台"></div>
      <div class="fld"><label for="hsStation">基地台座標</label><input type="text" id="hsStation" placeholder="緯度, 經度 或 TWD97"></div>
      <div class="fld"><label for="hsOh">觀測者高度（m）</label><input type="number" id="hsOh" value="${d.observerHeight}" min="0" step="any"></div>
      <div class="fld"><label for="hsTh">目標高度（m）</label><input type="number" id="hsTh" value="${d.targetHeight}" min="0" step="any"></div>
      <div class="fld"><label for="hsMd">最大距離（km）</label><input type="number" id="hsMd" value="${d.maxDistance / 1000}" min="0.1" step="any"></div>
      <div class="fld"><button class="btn" id="hsDem">選擇 DEM 檔</button> <span class="small" id="hsDemName">尚未選擇（內政部 20 m DEM，TWD97 GeoTIFF）</span></div>
      <p class="small" id="hsMsg"></p>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="hsRun">${icon('cloud')}計算並上傳</button></div>`);
    s.querySelector('#hsDem').onclick = async () => {
      const f = await pickFile('.tif,.tiff,image/tiff');
      if (!f) return;
      dem = f;
      s.querySelector('#hsDemName').textContent = `${f.name}（${Math.round(f.size / 1048576)} MB）`;
    };
    s.querySelector('#hsRun').onclick = async () => {
      const name = s.querySelector('#hsName').value.trim() || '握手範圍';
      const station = readStation(s.querySelector('#hsStation').value);
      if (!station) return toast(station === null ? '請輸入基地台座標' : '座標格式看不懂');
      if (!dem) return toast('請先選擇 DEM 檔');
      const params = { observerHeight: +s.querySelector('#hsOh').value, targetHeight: +s.querySelector('#hsTh').value, maxDistance: +s.querySelector('#hsMd').value * 1000 };
      if (!(params.observerHeight >= 0 && params.targetHeight >= 0 && params.maxDistance > 0)) return toast('高度與距離請填正數');
      const run = s.querySelector('#hsRun');
      const msg = s.querySelector('#hsMsg');
      run.disabled = true;
      try {
        const r = await computeFromDem(dem, station, params, (text) => (msg.textContent = text));
        if (!s.isConnected) return;
        msg.textContent = '上傳中…';
        if (await saveHandshake({ name, source: 'compute', station: { lat: station.lat, lng: station.lng }, params, grid: r.grid, bits: r.bits })) return;
        msg.textContent = '';
        run.disabled = false;
      } catch (e) {
        log.warn('握手範圍', `「${name}」計算失敗`, e.message);
        msg.textContent = '';
        run.disabled = false;
        toast(`計算失敗：${e.message}`, 5000);
      }
    };
  }

  // 離線地圖下載
  el.querySelector('#dlBtn').onclick = async () => {
    const current = BASEMAPS.find((b) => map.hasLayer(layers[b.id]));
    const caseBox = c?.area.bbox;
    const vb = map.getBounds();
    const viewBox = [[vb.getSouth(), vb.getWest()], [vb.getNorth(), vb.getEast()]];
    const plan = (box, maxZ) => tileUrls(current, box, 11, maxZ);
    const pickZ = (box) => [17, 16, 15, 14].find((z) => plan(box, z).length <= MAX_TILES) ?? 13;
    const options = [
      caseBox && { id: 'case', label: '案件搜索範圍', box: caseBox },
      { id: 'view', label: '目前畫面範圍', box: viewBox },
    ].filter(Boolean).map((o) => ({ ...o, maxZ: pickZ(o.box) })).map((o) => ({ ...o, urls: plan(o.box, o.maxZ) }));
    const count = await cachedTileCount();
    const s = sheet(`
      <h2>離線地圖</h2>
      <p class="small">底圖：<b>${esc(current.name)}</b>（切換右上角圖層可下載其他底圖）</p>
      <p class="muted small">本機已存 ${count} 張圖磚。瀏覽過的區域也會自動存下來。</p>
      <div style="margin-top:12px" class="stack">
        ${options.map((o) => `<button class="btn" style="width:100%" data-dl="${o.id}">下載${o.label}<br><span class="small muted">縮放 11–${o.maxZ}，${o.urls.length} 張，約 ${Math.ceil((o.urls.length * current.avgKB) / 1024)} MB</span></button>`).join('')}
      </div>
      <div id="dlProgress" class="hidden" style="margin-top:12px">
        <div class="progress"><div id="dlBar" style="width:0"></div></div>
        <p class="small" id="dlText"></p>
        <button class="btn small" id="dlStop">停止</button>
      </div>
      <p class="muted small" style="margin-top:12px">請在有網路時下載，進山前確認已完成。下載會放慢速度以減少對魯地圖伺服器的負擔。</p>
      <div class="btn-row" style="margin-top:8px"><button class="btn small danger" id="dlClear">清除所有離線圖磚</button></div>
    `);
    s.querySelectorAll('[data-dl]').forEach((b) => {
      b.onclick = async () => {
        if (!navigator.onLine) return toast('目前離線，無法下載');
        const o = options.find((x) => x.id === b.dataset.dl);
        navigator.storage?.persist?.();
        s.querySelectorAll('[data-dl]').forEach((x) => (x.disabled = true));
        s.querySelector('#dlProgress').classList.remove('hidden');
        abort = new AbortController();
        s.querySelector('#dlStop').onclick = () => abort.abort();
        const r = await downloadTiles(o.urls, {
          signal: abort.signal,
          onProgress: (p) => {
            s.querySelector('#dlBar').style.width = `${(p.done / p.total) * 100}%`;
            s.querySelector('#dlText').textContent = `${p.done} / ${p.total}${p.skipped ? `（已有 ${p.skipped}）` : ''}${p.failed ? `，失敗 ${p.failed}` : ''}`;
          },
        });
        const stopped = abort.signal.aborted;
        (r.failed ? log.warn : log.info)('離線地圖', `${current.name}：${stopped ? '已停止' : '下載完成'} ${r.done - r.failed}/${r.total} 張`, r.failed ? `${r.failed} 張失敗` : '');
        abort = null;
        s.querySelector('#dlText').textContent = stopped ? `已停止（${r.done} / ${r.total}）` : `完成：${r.total - r.failed} 張可離線使用${r.failed ? `，${r.failed} 張失敗，可再按一次補下載` : ''}`;
        s.querySelector('#dlStop').classList.add('hidden');
        s.querySelectorAll('[data-dl]').forEach((x) => (x.disabled = false));
      };
    });
    s.querySelector('#dlClear').onclick = async () => {
      if (!(await confirmBox('清除後離線時將看不到地圖，確定？'))) return;
      await clearTiles();
      closeSheet();
      toast('已清除離線圖磚');
    };
  };
}

export function destroy() {
  releaseUrls();
  hsUnsub?.();
  hsUnsub = null;
  cloudUnsub?.();
  cloudUnsub = null;
  abort?.abort();
  unsub?.();
  unsub = null;
  if (onTracks) window.removeEventListener('tracks-data', onTracks);
  onTracks = null;
  closeSheet();
  map?.remove();
  map = null;
}
