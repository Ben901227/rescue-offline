// 握手範圍遮罩：TWD97 格網上「看得到／看不到」的二元資料。
//   grid = { x0, y0, cell, w, h }：x0, y0 是左上角格子的外緣座標（公尺），cell 是格距。
//   bits：第 i 格（row-major、左上起）在 bits[i >> 3] 的第 (i & 7) 位。
//   存雲端前裁到有值的最小外框，再用 deflate 壓縮（30 km 半徑的結果約 6 KB）。

// GeoTIFF 的格距常帶浮點誤差（19.999999999999996），取到微米
export const cellSize = (resolution) => Math.round(Math.abs(resolution[0]) * 1e6) / 1e6;

// 太大的影像（例如誤選全台 DEM）讀進來會讓瀏覽器當掉
const MAX_CELLS = 50e6;
export function assertMaskSize(w, h) {
  if (w * h > MAX_CELLS) throw new Error(`影像太大（${w}×${h}），這不像視域分析結果，是否選到 DEM？`);
}

export function tiffToMask({ width, height, samplesPerPixel, data, origin, resolution, epsg, nodata = null }) {
  if (epsg !== 3826) throw new Error('只支援 TWD97 TM2（EPSG:3826）的 GeoTIFF');
  const n = width * height;
  const mask = new Uint8Array(n);
  if (samplesPerPixel === 4) {
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  } else {
    // 視域分析只有 0 和一種「看得到」的值；值很多種就是選錯檔（例如 DEM）
    let seen = null;
    for (let i = 0; i < n; i++) {
      const v = data[i * samplesPerPixel];
      if (!(v > 0) || v === nodata) continue;
      if (seen === null) seen = v;
      else if (v !== seen) throw new Error('這不像視域分析結果（值有很多種），是否選到 DEM？');
      mask[i] = 1;
    }
  }
  const cell = cellSize(resolution);
  const [x0, y0] = origin;
  return { mask, grid: { x0, y0, cell, w: width, h: height }, center: { x: x0 + (width * cell) / 2, y: y0 - (height * cell) / 2 } };
}

export function cropMask(mask, grid) {
  const { w, h } = grid;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const bits = new Uint8Array(Math.ceil((cw * ch) / 8));
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!mask[(y + minY) * w + x + minX]) continue;
      const i = y * cw + x;
      bits[i >> 3] |= 1 << (i & 7);
    }
  }
  return { grid: { x0: grid.x0 + minX * grid.cell, y0: grid.y0 - minY * grid.cell, cell: grid.cell, w: cw, h: ch }, bits };
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export const encodeBits = (bits) => pipe(bits, new CompressionStream('deflate'));
export const decodeBits = (bytes) => pipe(bytes, new DecompressionStream('deflate'));

export function maskAt({ grid, bits }, x, y) {
  const cx = Math.floor((x - grid.x0) / grid.cell);
  const cy = Math.floor((grid.y0 - y) / grid.cell);
  if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return false;
  const i = cy * grid.w + cx;
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}
