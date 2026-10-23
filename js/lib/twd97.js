// TWD97 TM2（中央經線 121°E）與 WGS84 經緯度互轉。
// GRS80 橢球與 WGS84 在此精度下可視為相同（差異 < 0.1 mm）。

const a = 6378137.0;
const f = 1 / 298.257222101;
const k0 = 0.9999;
const lon0 = (121 * Math.PI) / 180;
const FE = 250000;

const e2 = f * (2 - f);
const ep2 = e2 / (1 - e2);
const n = f / (2 - f);

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// 子午線弧長
function meridianArc(phi) {
  const A0 = 1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256;
  const A2 = (3 / 8) * (e2 + e2 ** 2 / 4 + (15 * e2 ** 3) / 128);
  const A4 = (15 / 256) * (e2 ** 2 + (3 * e2 ** 3) / 4);
  const A6 = (35 * e2 ** 3) / 3072;
  return a * (A0 * phi - A2 * Math.sin(2 * phi) + A4 * Math.sin(4 * phi) - A6 * Math.sin(6 * phi));
}

export function wgs84ToTwd97(lat, lng) {
  const phi = rad(lat);
  const dl = rad(lng) - lon0;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan;
  const C = ep2 * cos * cos;
  const A = dl * cos;
  const M = meridianArc(phi);

  const x =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y =
    k0 *
    (M +
      N *
        tan *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return { x: x + FE, y };
}

export function twd97ToWgs84(x, y) {
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin = Math.sin(phi1);
  const cos = Math.cos(phi1);
  const tan = Math.tan(phi1);
  const C1 = ep2 * cos * cos;
  const T1 = tan * tan;
  const N1 = a / Math.sqrt(1 - e2 * sin * sin);
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
  const D = (x - FE) / (N1 * k0);

  const lat =
    phi1 -
    ((N1 * tan) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lng =
    lon0 +
    (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
      cos;
  return { lat: deg(lat), lng: deg(lng) };
}

// 度分秒字串，例如 23°56'25.7"N
export function toDMS(value, isLat) {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  let v = Math.abs(value);
  let d = Math.floor(v);
  let m = Math.floor((v - d) * 60);
  let s = (v - d - m / 60) * 3600;
  if (s >= 59.95) { s = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemi}`;
}

// 解析使用者輸入的座標：「23.94, 121.31」或「281345 2648739」（TWD97）
export function parseCoordinate(text) {
  const nums = String(text).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const [p, q] = nums.map(Number);
  if (Math.abs(p) <= 90 && Math.abs(q) <= 180) return { lat: p, lng: q, source: 'wgs84' };
  if (p > 100000 && p < 400000 && q > 2400000 && q < 2800000) return { ...twd97ToWgs84(p, q), source: 'twd97' };
  if (q > 100000 && q < 400000 && p > 2400000 && p < 2800000) return { ...twd97ToWgs84(q, p), source: 'twd97' };
  return null;
}

// 兩點大圓距離（公尺）
export function distance(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
