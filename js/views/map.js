import { esc, sheet, closeSheet, toast, copyText, pickFile, fmtTime, downloadFile, ask } from '../ui.js';
import { icon } from '../icons.js';
import { db } from '../db.js';
import { wgs84ToTwd97 } from '../lib/twd97.js';
import { parseTrackFile, toGpx } from '../lib/gpx.js';
import { routeLength, ROUTE_COLORS } from '../lib/route.js';
import { validateCase } from '../lib/caseSchema.js';
import { saveAndUpload, state as cloud } from '../cloud.js';
import { listPhotos, photoUrl, openLightbox, releaseUrls, pickAndUpload } from '../photos.js';
import * as log from '../log.js';
import { subscribe } from '../geo.js';
import { caseMarkers, setMarkerCoords, clearMarkerCoords, addPoint, deletePoint, TYPE_LABEL, fmtDist } from '../markers.js';
import { BASEMAPS, tileUrls, downloadTiles, cachedTileCount, clearTiles } from '../tiles.js';

const TRACK_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];
const MAX_TILES = 5000;

let map = null;
let unsub = null;
let abort = null;

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
  el.querySelector('#routeCancel').onclick = () => {
    if (drawing.points.length > 1 && !drawing.base && !confirm('放棄這條路線？')) return;
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
      if (!confirm('刪除這條路線？全隊同步後都會移除。')) return;
      map.closePopup();
      await saveRoutes((routes) => routes.filter((r) => r.id !== id));
      drawRoutes();
    });
    node.querySelector('[data-del-point]')?.addEventListener('click', async (ev) => {
      if (!confirm('刪除這個標記？')) return;
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
    const s = sheet(`
      <h2>航跡與標記</h2>
      <div id="trackList">${
        tracks.length
          ? tracks.map((t, i) => `<label class="check"><input type="checkbox" data-track="${t.id}" ${t.hidden ? '' : 'checked'}><span style="flex:1"><b style="color:${t.color || TRACK_COLORS[i % TRACK_COLORS.length]}">━</b> ${esc(t.name)}<br><span class="muted small">${t.data.tracks.length} 條航跡、${t.data.waypoints.length} 個航點</span></span><button class="btn small danger" data-deltrack="${t.id}">刪除</button></label>`).join('')
          : '<p class="muted">尚未匯入航跡</p>'
      }</div>
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="importTrack">匯入 GPX / KML</button></div>
      ${missing.length ? `<h3 style="margin-top:16px">座標待補</h3><ul style="margin:6px 0 0;padding-left:18px">${missing.map((m) => `<li>${esc(m.name)}${m.note ? ` <span class="muted small">${esc(m.note)}</span>` : ''}</li>`).join('')}</ul><p class="muted small" style="margin-top:6px">在地圖上長按該位置即可補上。</p>` : ''}
      <h3 style="margin-top:16px">圖例</h3>
      <div class="looks" style="margin-top:6px">${['ipp', 'found', 'camp', 'cp', 'poi', 'mark', 'gps', 'wpt'].map((t) => `<span style="display:inline-flex;gap:6px;align-items:center"><span class="pin ${t}" style="display:inline-block;width:14px;height:14px;border-width:2px"></span>${TYPE_LABEL[t]}</span>`).join('')}</div>
    `);
    s.querySelector('#importTrack').onclick = async () => {
      const file = await pickFile('.gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml');
      if (!file) return;
      try {
        const data = parseTrackFile(await file.text());
        if (!data.tracks.length && !data.waypoints.length) throw new Error('檔案中沒有航跡或航點');
        await db.put('tracks', { caseId: c.id, name: file.name.replace(/\.(gpx|kml)$/i, ''), data, added: new Date().toISOString() });
        closeSheet();
        await drawTracks();
        if (trackLayer.getLayers().length) map.fitBounds(trackLayer.getBounds(), { padding: [30, 30] });
        toast(`已匯入 ${file.name}`);
      } catch (e) {
        log.warn('航跡匯入', `${file.name} 匯入失敗`, e.message);
        toast(`匯入失敗：${e.message}`, 4000);
      }
    };
    s.querySelectorAll('[data-track]').forEach((cb) => {
      cb.onchange = async () => {
        const t = tracks.find((x) => x.id === Number(cb.dataset.track));
        t.hidden = !cb.checked;
        await db.put('tracks', t);
        drawTracks();
      };
    });
    s.querySelectorAll('[data-deltrack]').forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault();
        if (!confirm('刪除這份航跡？')) return;
        await db.delete('tracks', Number(b.dataset.deltrack));
        closeSheet();
        drawTracks();
      };
    });
  };

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
      if (!confirm('清除後離線時將看不到地圖，確定？')) return;
      await clearTiles();
      closeSheet();
      toast('已清除離線圖磚');
    };
  };
}

export function destroy() {
  releaseUrls();
  abort?.abort();
  unsub?.();
  unsub = null;
  closeSheet();
  map?.remove();
  map = null;
}
