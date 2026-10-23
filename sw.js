// 改了任何 App 檔案就把版本號 +1，手機下次連線時會更新快取。
const VERSION = 'v14';
const SHELL_CACHE = `shell-${VERSION}`;
const TILE_CACHE = 'tiles-v1';
const TILE_HOSTS = ['tile.happyman.idv.tw', 'wmts.nlsc.gov.tw'];

const SHELL = [
  './',
  'index.html',
  'guide.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/ui.js',
  'js/geo.js',
  'js/markers.js',
  'js/tiles.js',
  'js/version.js',
  'js/update.js',
  'js/log.js',
  'js/lib/logFormat.js',
  'js/icons.js',
  'js/mapPicker.js',
  'js/lib/path.js',
  'js/lib/route.js',
  'js/config.js',
  'js/drive.js',
  'js/lib/twd97.js',
  'js/lib/gpx.js',
  'js/lib/caseSchema.js',
  'js/views/summary.js',
  'js/views/map.js',
  'js/views/gps.js',
  'js/views/tasks.js',
  'js/views/cases.js',
  'js/views/settings.js',
  'js/views/editor.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'cases/template.json',
  'cases/schema.md',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // 瀏覽過的圖磚也順便存起來
    if (res.ok || res.type === 'opaque') cache.put(req.url, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

// 先回快取（離線也秒開），同時在背景更新，下次開啟就是新版
async function shell(req, event) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req)
    .then((res) => {
      // 只更新預快取清單內的檔案，其他（例如案件檔）不進快取
      if (hit && res.ok && !res.redirected) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(update);
    return hit;
  }
  return (await update) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.hostname)) return e.respondWith(tile(req));
  if (url.origin !== self.location.origin) return;
  // App 本身的網址（/、index.html、#/…）一律回 index.html；其他頁面（例如 guide.html）照常回應
  const isApp = req.mode === 'navigate' && !/\.html?$/.test(url.pathname.replace(/index\.html?$/, ''));
  return e.respondWith(shell(isApp ? new Request('index.html') : req, e));
});
