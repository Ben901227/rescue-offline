// 握手範圍圖層：所有遮罩聯集，畫成半透明紅色（與 QGIS 匯出的顏色相同）。
// 遮罩在 TWD97 格網上，地圖是 Web Mercator：每張圖磚切成 16×16 小格，
// 小格角點換算 TWD97 後內插到像素，再查遮罩，任何縮放層級位置都準。
import { wgs84ToTwd97 } from './lib/twd97.js';
import { maskAt } from './lib/mask.js';

const COLOR = [255, 0, 0, 156];
const STEP = 16;

const boundsOf = ({ grid }) => ({ minX: grid.x0, maxX: grid.x0 + grid.w * grid.cell, minY: grid.y0 - grid.h * grid.cell, maxY: grid.y0 });

export function createHandshakeLayer(pane = 'overlayPane') {
  const layer = L.gridLayer({ pane, updateWhenIdle: true });
  let masks = [];

  layer.setMasks = (list) => {
    masks = list.map((m) => ({ ...m, box: boundsOf(m) }));
    if (layer._map) layer.redraw();
  };

  layer.createTile = (coords) => {
    const size = layer.getTileSize();
    const canvas = document.createElement('canvas');
    canvas.width = size.x;
    canvas.height = size.y;
    const map = layer._map;
    const nw = coords.scaleBy(size);
    const n = size.x / STEP + 1;
    const pts = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const ll = map.unproject(nw.add([i * STEP, j * STEP]), coords.z);
        pts.push(wgs84ToTwd97(ll.lat, ll.lng));
      }
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const tile = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const hits = masks.filter(({ box }) => box.minX < tile.maxX && box.maxX > tile.minX && box.minY < tile.maxY && box.maxY > tile.minY);
    if (!hits.length) return canvas;

    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size.x, size.y);
    for (let py = 0; py < size.y; py++) {
      const j = Math.floor(py / STEP);
      const fy = (py + 0.5 - j * STEP) / STEP;
      for (let px = 0; px < size.x; px++) {
        const i = Math.floor(px / STEP);
        const fx = (px + 0.5 - i * STEP) / STEP;
        const a = pts[j * n + i];
        const b = pts[j * n + i + 1];
        const c = pts[(j + 1) * n + i];
        const d = pts[(j + 1) * n + i + 1];
        const x = (a.x * (1 - fx) + b.x * fx) * (1 - fy) + (c.x * (1 - fx) + d.x * fx) * fy;
        const y = (a.y * (1 - fx) + b.y * fx) * (1 - fy) + (c.y * (1 - fx) + d.y * fx) * fy;
        if (!hits.some((m) => maskAt(m, x, y))) continue;
        img.data.set(COLOR, (py * size.x + px) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  };

  return layer;
}
