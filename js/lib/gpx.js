// GPX / KML 解析與 GPX 匯出。用正規表示式處理，瀏覽器與 Node 測試都能跑。

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const escape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i'));
  return m ? decode(m[1]) : '';
}

function attr(tagOpen, name) {
  const m = tagOpen.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return m ? m[1] : null;
}

function blocks(xml, tag) {
  return xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[\\s\\S]*?</(?:\\w+:)?${tag}>`, 'gi')) || [];
}

// 同時處理 <trkpt ...>...</trkpt> 與自閉合 <trkpt .../>
function gpxPoints(xml, tag) {
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'gi');
  const out = [];
  for (const m of xml.matchAll(re)) {
    const lat = parseFloat(attr(m[1], 'lat'));
    const lng = parseFloat(attr(m[1], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const body = m[2] || '';
    const ele = parseFloat(tagText(body, 'ele'));
    out.push({ lat, lng, ele: Number.isFinite(ele) ? ele : null, name: tagText(body, 'name'), time: tagText(body, 'time') });
  }
  return out;
}

function parseGpx(xml) {
  const tracks = [];
  for (const trk of blocks(xml, 'trk')) {
    for (const seg of blocks(trk, 'trkseg')) {
      const pts = gpxPoints(seg, 'trkpt');
      if (pts.length) tracks.push({ name: tagText(trk.replace(/<trkseg[\s\S]*/i, ''), 'name'), points: pts.map((p) => [p.lat, p.lng, p.ele]) });
    }
  }
  for (const rte of blocks(xml, 'rte')) {
    const pts = gpxPoints(rte, 'rtept');
    if (pts.length) tracks.push({ name: tagText(rte.replace(/<rtept[\s\S]*/i, ''), 'name'), points: pts.map((p) => [p.lat, p.lng, p.ele]) });
  }
  const waypoints = gpxPoints(xml, 'wpt').map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, ele: p.ele }));
  return { tracks, waypoints };
}

function kmlCoords(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((t) => t.split(',').map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat, ele]) => [lat, lng, Number.isFinite(ele) ? ele : null]);
}

function parseKml(xml) {
  const tracks = [];
  const waypoints = [];
  for (const pm of blocks(xml, 'Placemark')) {
    const name = tagText(pm.replace(/<(LineString|Point|gx:Track)[\s\S]*/i, ''), 'name');
    for (const ls of blocks(pm, 'LineString')) {
      const pts = kmlCoords(tagText(ls, 'coordinates'));
      if (pts.length) tracks.push({ name, points: pts });
    }
    for (const pt of blocks(pm, 'Point')) {
      const [c] = kmlCoords(tagText(pt, 'coordinates'));
      if (c) waypoints.push({ name, lat: c[0], lng: c[1], ele: c[2] });
    }
    // Google 我的地圖 / Earth 的 gx:Track
    const coords = pm.match(/<gx:coord>([^<]+)<\/gx:coord>/g);
    if (coords) {
      const pts = coords.map((c) => c.replace(/<\/?gx:coord>/g, '').trim().split(/\s+/).map(Number)).map(([lng, lat, ele]) => [lat, lng, Number.isFinite(ele) ? ele : null]);
      if (pts.length) tracks.push({ name, points: pts });
    }
  }
  return { tracks, waypoints };
}

export function parseTrackFile(text) {
  if (/<kml\b/i.test(text)) return parseKml(text);
  if (/<gpx\b/i.test(text)) return parseGpx(text);
  throw new Error('不是 GPX 或 KML 檔案');
}

export function toGpx({ name = 'export', waypoints = [], tracks = [] }) {
  const wpts = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat}" lon="${w.lng}">${w.ele != null ? `<ele>${w.ele}</ele>` : ''}${w.time ? `<time>${escape(w.time)}</time>` : ''}<name>${escape(w.name || '')}</name></wpt>`
    )
    .join('\n');
  const trks = tracks
    .map(
      (t) =>
        `  <trk><name>${escape(t.name || '')}</name><trkseg>\n${t.points
          .map(([lat, lng, ele]) => `    <trkpt lat="${lat}" lon="${lng}">${ele != null ? `<ele>${ele}</ele>` : ''}</trkpt>`)
          .join('\n')}\n  </trkseg></trk>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="搜救資訊離線版" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escape(name)}</name></metadata>
${wpts}
${trks}
</gpx>
`;
}

// 上傳雲端前精簡航跡：座標取 6 位小數（約 10 cm）、高度取整數，
// 總點數超過上限時平均抽點（保留每段頭尾），避免超過 Firestore 單一文件 1 MB。
export const MAX_SHARED_POINTS = 10000;

export const pointCount = (data) => data.tracks.reduce((n, t) => n + t.points.length, 0);

export function slimTracks(data, max = MAX_SHARED_POINTS) {
  const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  const total = pointCount(data);
  const step = total > max ? total / max : 1;
  const tracks = data.tracks.map((t) => {
    const last = t.points.length - 1;
    const keep = step === 1 ? t.points : t.points.filter((_, i) => i === last || Math.floor(i / step) !== Math.floor((i - 1) / step));
    return { name: t.name || '', points: keep.map(([lat, lng, ele]) => [round(lat, 6), round(lng, 6), round(ele, 0)]) };
  });
  const waypoints = data.waypoints.map((w) => ({ name: w.name || '', lat: round(w.lat, 6), lng: round(w.lng, 6), ele: round(w.ele, 0) }));
  return { tracks, waypoints };
}
