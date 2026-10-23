// 案件 JSON 的最低限度驗證與正規化。欄位說明見 cases/schema.md。

export const SCHEMA_VERSION = 1;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isCoord = (p) => isObj(p) && Number.isFinite(p.lat) && Number.isFinite(p.lng);

export function validateCase(data) {
  const errors = [];
  if (!isObj(data)) return ['檔案內容不是 JSON 物件'];
  if (!data.id || typeof data.id !== 'string') errors.push('缺少 id（案件代號，例如 mudanyan-2026-10）');
  if (!isObj(data.meta) || !data.meta.name) errors.push('缺少 meta.name（案件名稱）');

  for (const key of ['itinerary', 'log', 'teams', 'checklist', 'markers']) {
    const v = key === 'markers' ? data.area?.markers : data[key];
    if (v != null && !Array.isArray(v)) errors.push(`${key === 'markers' ? 'area.markers' : key} 必須是陣列`);
  }
  (data.area?.markers || []).forEach((m, i) => {
    if (m.lat == null && m.lng == null) return; // 座標待補
    if (!isCoord(m)) errors.push(`area.markers[${i}]（${m.name || '未命名'}）座標格式錯誤`);
  });
  if (data.found?.lat != null && !isCoord(data.found)) errors.push('found 座標格式錯誤');
  (data.checklist || []).forEach((g, i) => {
    if (!Array.isArray(g.items)) errors.push(`checklist[${i}].items 必須是陣列`);
  });
  return errors;
}

// 補上預設值，讓畫面不用到處判斷 undefined
export function normalizeCase(data) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ...data,
    meta: { ...data.meta },
    report: data.report || '',
    subject: { ...data.subject },
    clothing: data.clothing || [],
    gear: data.gear || [],
    ipp: { ...data.ipp },
    itinerary: data.itinerary || [],
    area: { markers: [], localContacts: [], ...data.area },
    teams: data.teams || [],
    radio: { ...data.radio },
    checklist: (data.checklist || []).map((g, gi) => ({
      ...g,
      items: (g.items || []).map((it, ii) => (typeof it === 'string' ? { id: `${gi}-${ii}`, text: it } : { id: it.id || `${gi}-${ii}`, ...it })),
    })),
    log: data.log || [],
    found: data.found || null,
    debrief: data.debrief || null,
  };
}

// 案件狀態：有 found 視為已尋獲
export function caseStatus(c) {
  if (c.meta?.status) return c.meta.status;
  return c.found ? '已尋獲' : '搜索中';
}
