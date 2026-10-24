// 視域分析（基地台看得到哪裡）：照 GDAL viewshed 的演算法，結果與 QGIS「Viewshed」一致。
//   由觀測點那一列往上、往下逐列推，每格的「地平線高度」用靠近觀測點的兩個鄰格內插；
//   地形高度先扣掉地球曲率與大氣折射（係數 0.85714，同 GDAL 預設）。

export const VIEWSHED_DEFAULTS = { observerHeight: 1, targetHeight: 1, maxDistance: 30000 };

const EARTH_DIAMETER = 12741994;

// dem：w×h 高程（row-major，左上起）；ox, oy：觀測點的欄、列。回傳 1 = 看得到。
// 沒有資料的格子（NaN 或 nodata）當成很深的谷：不擋視線，本身算看不到。
const NO_DATA_Z = -1e6;

export function viewshed(dem, w, h, ox, oy, opts = {}) {
  const { cell = 20, curvCoeff = 0.85714, nodata = null } = opts;
  const { observerHeight, targetHeight, maxDistance } = { ...VIEWSHED_DEFAULTS, ...opts };
  const z = new Float64Array(w * h);
  const missing = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r2 = ((x - ox) ** 2 + (y - oy) ** 2) * cell * cell;
      const d = dem[i];
      if (!Number.isFinite(d) || d === nodata) {
        missing[i] = 1;
        z[i] = NO_DATA_Z;
      } else z[i] = d - (curvCoeff * r2) / EARTH_DIAMETER;
    }
  }
  const vis = new Uint8Array(w * h);
  const zo = dem[oy * w + ox] + observerHeight;
  vis[oy * w + ox] = 1;

  const line = (i, za) => (i === 1 ? za : ((za - zo) / (i - 1)) * i + zo);
  const edge = (i, j, za, zb) => (i === j ? line(i, za) : ((za - zo) * i + (zb - zo) * (j - i)) / (j - 1) + zo);
  const set = (i, horizon) => {
    vis[i] = z[i] + targetHeight < horizon ? 0 : 1;
    if (z[i] < horizon) z[i] = horizon;
  };

  // 觀測點所在的列
  const r0 = oy * w;
  for (let x = ox + 1; x < w; x++) set(r0 + x, line(x - ox, z[r0 + x - 1]));
  for (let x = ox - 1; x >= 0; x--) set(r0 + x, line(ox - x, z[r0 + x + 1]));

  // 其他列：p 是上一個處理的列（較靠近觀測點），c 是這一列
  for (const dir of [-1, 1]) {
    for (let y = oy + dir; y >= 0 && y < h; y += dir) {
      const ny = Math.abs(y - oy);
      const p = (y - dir) * w;
      const c = y * w;
      set(c + ox, line(ny, z[p + ox]));
      for (const sd of [1, -1]) {
        for (let x = ox + sd; x >= 0 && x < w; x += sd) {
          const nx = Math.abs(x - ox);
          let horizon;
          if (nx === ny) horizon = nx === 1 ? z[p + x - sd] : line(nx, z[p + x - sd]);
          else if (nx > ny) horizon = edge(ny, nx, z[p + x - sd], z[c + x - sd]);
          else horizon = edge(nx, ny, z[p + x - sd], z[p + x]);
          set(c + x, horizon);
        }
      }
    }
  }

  for (let i = 0; i < w * h; i++) if (missing[i]) vis[i] = 0;
  const max2 = (maxDistance / cell) ** 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if ((x - ox) ** 2 + (y - oy) ** 2 > max2) vis[y * w + x] = 0;
  }
  return vis;
}
