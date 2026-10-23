// 底部面板裡的小地圖：點選一個座標，或取用目前畫面當作搜索範圍。

import { sheet, closeSheet } from './ui.js';
import { BASEMAPS } from './tiles.js';
import { wgs84ToTwd97 } from './lib/twd97.js';
import { last as lastPos } from './geo.js';

const TAIWAN = [23.7, 121];

function makeMap(el, center, zoom) {
  const b = BASEMAPS[0];
  const map = L.map(el, { zoomControl: true }).setView(center, zoom);
  L.tileLayer(b.url, { attribution: b.attribution, maxNativeZoom: b.maxNativeZoom, maxZoom: 19, crossOrigin: true }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

// 回傳 {lat, lng} 或 null（取消）
export function pickPoint({ title = '在地圖上選點', value, near } = {}) {
  return new Promise((resolve) => {
    const start = value?.lat != null ? [value.lat, value.lng] : near || (lastPos ? [lastPos.lat, lastPos.lng] : TAIWAN);
    const s = sheet(`
      <h2>${title}</h2>
      <div id="pickMap" style="height:55vh;border-radius:12px;overflow:hidden"></div>
      <p class="mono small" id="pickInfo" style="margin-top:8px">點地圖選擇位置</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn primary" id="pickOk" ${value?.lat != null ? '' : 'disabled'}>使用這個位置</button>
        <button class="btn" id="pickCancel">取消</button>
      </div>`);
    const map = makeMap(s.querySelector('#pickMap'), start, value?.lat != null || near ? 15 : lastPos ? 14 : 8);
    let chosen = value?.lat != null ? { lat: value.lat, lng: value.lng } : null;
    const pin = L.marker(start, { icon: L.divIcon({ className: '', html: '<div class="pin poi"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) });
    const show = () => {
      if (!chosen) return;
      pin.setLatLng([chosen.lat, chosen.lng]).addTo(map);
      const t = wgs84ToTwd97(chosen.lat, chosen.lng);
      s.querySelector('#pickInfo').textContent = `${chosen.lat.toFixed(6)}, ${chosen.lng.toFixed(6)}　TWD97 ${Math.round(t.x)}, ${Math.round(t.y)}`;
      s.querySelector('#pickOk').disabled = false;
    };
    show();
    map.on('click', (e) => {
      chosen = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
      show();
    });
    const done = (v) => {
      map.remove();
      closeSheet();
      resolve(v);
    };
    s.querySelector('#pickOk').onclick = () => done(chosen);
    s.querySelector('#pickCancel').onclick = () => done(null);
    document.querySelector('.sheet-backdrop').onclick = () => done(null);
  });
}

// 回傳 [[南, 西], [北, 東]] 或 null
export function pickBounds({ value, near } = {}) {
  return new Promise((resolve) => {
    const s = sheet(`
      <h2>設定搜索範圍</h2>
      <p class="muted small">移動、縮放地圖，讓畫面剛好涵蓋搜索區域。這個範圍會用於地圖初始畫面與離線圖磚下載。</p>
      <div id="pickMap" style="height:55vh;border-radius:12px;overflow:hidden;margin-top:8px"></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn primary" id="pickOk">使用目前畫面範圍</button>
        <button class="btn" id="pickCancel">取消</button>
      </div>`);
    const map = makeMap(s.querySelector('#pickMap'), near || TAIWAN, near ? 13 : 8);
    if (value) setTimeout(() => map.fitBounds(value), 80);
    const done = (v) => {
      map.remove();
      closeSheet();
      resolve(v);
    };
    s.querySelector('#pickOk').onclick = () => {
      const b = map.getBounds();
      const r = (n) => +n.toFixed(4);
      done([[r(b.getSouth()), r(b.getWest())], [r(b.getNorth()), r(b.getEast())]]);
    };
    s.querySelector('#pickCancel').onclick = () => done(null);
    document.querySelector('.sheet-backdrop').onclick = () => done(null);
  });
}
