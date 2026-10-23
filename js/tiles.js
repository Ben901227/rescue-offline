// 底圖定義與離線圖磚下載。圖磚存在 Cache Storage 的 TILE_CACHE，
// sw.js 會用同一個名稱以「快取優先」回應地圖請求。

export const TILE_CACHE = 'tiles-v1';

export const BASEMAPS = [
  {
    id: 'rudy',
    name: '魯地圖（登山）',
    url: 'https://tile.happyman.idv.tw/map/moi_osm/{z}/{x}/{y}.png',
    attribution: '<a href="https://rudy.basecamp.tw/" target="_blank" rel="noopener">魯地圖 Rudy Map</a> © OpenStreetMap 貢獻者',
    maxNativeZoom: 18,
    avgKB: 40,
  },
  {
    id: 'emap',
    name: '國土測繪 通用電子地圖',
    url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '© 內政部國土測繪中心',
    maxNativeZoom: 18,
    avgKB: 25,
  },
  {
    id: 'photo',
    name: '國土測繪 正射影像',
    url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',
    attribution: '© 內政部國土測繪中心',
    maxNativeZoom: 19,
    avgKB: 30,
  },
];

const lng2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
};

export function tileUrls(basemap, [[s, w], [n, e]], minZ, maxZ) {
  const urls = [];
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = lng2x(w, z); x <= lng2x(e, z); x++) {
      for (let y = lat2y(n, z); y <= lat2y(s, z); y++) {
        urls.push(basemap.url.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      }
    }
  }
  return urls;
}

// 低併發下載，避免對社群維護的魯地圖伺服器造成負擔
export async function downloadTiles(urls, { concurrency = 3, onProgress, signal } = {}) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  let failed = 0;
  let skipped = 0;
  let i = 0;
  async function worker() {
    while (i < urls.length && !signal?.aborted) {
      const url = urls[i++];
      try {
        if (await cache.match(url)) {
          skipped++;
        } else {
          const res = await fetch(url, { mode: 'cors', signal });
          if (res.ok) await cache.put(url, res);
          else failed++;
        }
      } catch (e) {
        if (signal?.aborted) break;
        failed++;
      }
      done++;
      onProgress?.({ done, failed, skipped, total: urls.length });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { done, failed, skipped, total: urls.length };
}

export async function cachedTileCount() {
  if (!('caches' in window)) return 0;
  const cache = await caches.open(TILE_CACHE);
  return (await cache.keys()).length;
}

export const clearTiles = () => caches.delete(TILE_CACHE);
