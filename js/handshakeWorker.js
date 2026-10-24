// 握手範圍的背景執行緒：讀 GeoTIFF、算視域，不卡住畫面。
//   { type: 'import', file }：讀 QGIS 算好的握手範圍 TIFF
//   { type: 'compute', file, station: { x, y }, params }：用 DEM 算基地台（TWD97 座標）的視域
//   回傳 { type: 'progress', text } … { type: 'done', grid, bits[, center] } 或 { type: 'error', message }
import '../vendor/geotiff/geotiff.js';
import { viewshed } from './lib/viewshed.js';
import { tiffToMask, cropMask, cellSize, assertMaskSize } from './lib/mask.js';

const { fromBlob } = globalThis.GeoTIFF;
const EMPTY = '範圍內沒有看得到的格子';

async function info(file) {
  let image;
  try {
    image = await (await fromBlob(file)).getImage();
  } catch {
    throw new Error('讀不到這個檔案，請確認是 GeoTIFF（.tif）');
  }
  const nd = image.fileDirectory.GDAL_NODATA;
  return {
    image,
    epsg: image.getGeoKeys()?.ProjectedCSTypeGeoKey,
    origin: image.getOrigin(),
    resolution: image.getResolution(),
    nodata: nd == null ? null : Number(String(nd).replace(/\0/g, '')),
  };
}

async function importTiff(file) {
  postMessage({ type: 'progress', text: '讀取檔案中…' });
  const { image, epsg, origin, resolution, nodata } = await info(file);
  assertMaskSize(image.getWidth(), image.getHeight());
  const data = await image.readRasters({ interleave: true });
  const r = tiffToMask({ width: image.getWidth(), height: image.getHeight(), samplesPerPixel: image.getSamplesPerPixel(), data, origin, resolution, epsg, nodata });
  const m = cropMask(r.mask, r.grid);
  if (!m) throw new Error(EMPTY);
  return { ...m, center: r.center };
}

async function compute(file, station, params) {
  postMessage({ type: 'progress', text: '讀取 DEM 中…' });
  const { image, epsg, origin, resolution, nodata } = await info(file);
  if (epsg !== 3826) throw new Error('只支援 TWD97 TM2（EPSG:3826）的 GeoTIFF');
  const cell = cellSize(resolution);
  const W = image.getWidth();
  const H = image.getHeight();
  const col = Math.floor((station.x - origin[0]) / cell);
  const row = Math.floor((origin[1] - station.y) / cell);
  if (col < 0 || row < 0 || col >= W || row >= H) throw new Error('基地台不在 DEM 範圍內');
  const R = Math.floor(params.maxDistance / cell);
  const c0 = Math.max(0, col - R);
  const r0 = Math.max(0, row - R);
  const c1 = Math.min(W, col + R + 1);
  const r1 = Math.min(H, row + R + 1);
  const [dem] = await image.readRasters({ window: [c0, r0, c1, r1] });
  const w = c1 - c0;
  const h = r1 - r0;
  const z = dem[(row - r0) * w + (col - c0)];
  if (!Number.isFinite(z) || z === nodata) throw new Error('基地台位置沒有高程資料');
  postMessage({ type: 'progress', text: '計算中…' });
  const vis = viewshed(dem, w, h, col - c0, row - r0, { ...params, cell, nodata });
  const m = cropMask(vis, { x0: origin[0] + c0 * cell, y0: origin[1] - r0 * cell, cell, w, h });
  if (!m) throw new Error(EMPTY);
  return m;
}

onmessage = async ({ data: msg }) => {
  try {
    const out = msg.type === 'import' ? await importTiff(msg.file) : await compute(msg.file, msg.station, msg.params);
    postMessage({ type: 'done', ...out }, [out.bits.buffer]);
  } catch (e) {
    postMessage({ type: 'error', message: e.message || String(e) });
  }
};
