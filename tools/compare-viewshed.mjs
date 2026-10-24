// 本機工具：拿 QGIS 算好的握手範圍，和 App 的視域演算法比對。
//   node tools/compare-viewshed.mjs <DEM.tif> <GIS結果.tif> <基地台緯度> <基地台經度> [觀測者高 目標高 最大距離m]
// DEM 與握手結果含案件位置，只放在自己電腦，不要放進 repo。
import { fromFile } from 'geotiff';
import { viewshed, VIEWSHED_DEFAULTS } from '../js/lib/viewshed.js';
import { wgs84ToTwd97 } from '../js/lib/twd97.js';

const [demPath, gisPath, lat, lng, oh, th, md] = process.argv.slice(2);
if (!demPath || !gisPath || !lat || !lng) {
  console.error('用法：node tools/compare-viewshed.mjs <DEM.tif> <GIS結果.tif> <緯度> <經度> [觀測者高 目標高 最大距離m]');
  process.exit(2);
}
const opts = {
  observerHeight: oh ? Number(oh) : VIEWSHED_DEFAULTS.observerHeight,
  targetHeight: th ? Number(th) : VIEWSHED_DEFAULTS.targetHeight,
  maxDistance: md ? Number(md) : VIEWSHED_DEFAULTS.maxDistance,
};

const gis = await (await fromFile(gisPath)).getImage();
const w = gis.getWidth();
const h = gis.getHeight();
const [gx, gy] = gis.getOrigin();
const spp = gis.getSamplesPerPixel();
const raw = await gis.readRasters({ interleave: true });
const truth = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) truth[i] = (spp === 4 ? raw[i * 4 + 3] : raw[i]) > 0 ? 1 : 0;

const dem = await (await fromFile(demPath)).getImage();
const [dx, dy] = dem.getOrigin();
const [cell] = dem.getResolution();
const c0 = Math.round((gx - dx) / cell);
const r0 = Math.round((dy - gy) / cell);
const z = (await dem.readRasters({ window: [c0, r0, c0 + w, r0 + h] }))[0];

const st = wgs84ToTwd97(Number(lat), Number(lng));
const ox = Math.floor((st.x - gx) / cell);
const oy = Math.floor((gy - st.y) / cell);

const t = Date.now();
const mine = viewshed(z, w, h, ox, oy, { ...opts, cell });
const ms = Date.now() - t;

let a = 0;
let b = 0;
let both = 0;
for (let i = 0; i < w * h; i++) {
  a += mine[i];
  b += truth[i];
  both += mine[i] & truth[i];
}
console.log({ 參數: opts, 計算毫秒: ms, App格數: a, GIS格數: b, 重疊: both, 差異格數: a + b - 2 * both, IoU: (both / (a + b - both)).toFixed(4) });
