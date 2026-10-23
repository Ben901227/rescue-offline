import { db, kv } from './db.js';

export const TYPE_LABEL = { ipp: 'IPP 最後已知點', found: '發現點', camp: '營地', cp: '指揮所', poi: '地點', mark: '自訂標記', gps: 'GPS 打點', wpt: '航點' };

const overrideKey = (caseId) => `coords:${caseId}`;

// 案件內建標記 + 本機補上的座標 + 發現點 + 使用者自己加的點
export async function caseMarkers(c) {
  const overrides = (await kv.get(overrideKey(c.id))) || {};
  const list = [];
  const ippInMarkers = c.area.markers.some((m) => m.type === 'ipp');
  if (!ippInMarkers && (c.ipp.lat != null || overrides['IPP'])) {
    const o = overrides['IPP'] || c.ipp;
    list.push({ key: 'IPP', name: 'IPP 最後已知點', type: 'ipp', lat: o.lat, lng: o.lng, note: c.ipp.lastSeen, source: 'case' });
  }
  for (const m of c.area.markers) {
    const o = overrides[m.name];
    list.push({ key: m.name, ...m, lat: o?.lat ?? m.lat, lng: o?.lng ?? m.lng, patched: !!o, source: 'case' });
  }
  if (c.found?.lat != null) {
    list.push({ key: '發現點', name: '發現點', type: 'found', lat: c.found.lat, lng: c.found.lng, note: c.found.time, source: 'case' });
  }
  for (const p of await db.byCase('points', c.id)) {
    list.push({ key: `p${p.id}`, id: p.id, name: p.name, type: p.type, lat: p.lat, lng: p.lng, note: p.note, time: p.time, ele: p.ele, acc: p.acc, source: 'user' });
  }
  return list;
}

export async function setMarkerCoords(caseId, key, lat, lng) {
  const all = (await kv.get(overrideKey(caseId))) || {};
  all[key] = { lat, lng };
  await kv.set(overrideKey(caseId), all);
}

export async function clearMarkerCoords(caseId, key) {
  const all = (await kv.get(overrideKey(caseId))) || {};
  delete all[key];
  await kv.set(overrideKey(caseId), all);
}

export const addPoint = (p) => db.put('points', p);
export const deletePoint = (id) => db.delete('points', id);

// 0–360 方位角
export function bearing(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

export const compass = (deg) => ['北', '東北', '東', '東南', '南', '西南', '西', '西北'][Math.round(deg / 45) % 8];

export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
