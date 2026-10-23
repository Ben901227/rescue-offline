// 手機本機的使用記錄：錯誤、同步上傳結果、更新等。只存在這支手機，最多留 MAX 筆。
// 記錄本身出錯時一律吞掉，絕不影響 App 運作。
import { db } from './db.js';
import { APP_VERSION } from './version.js';
import { formatReport, describeDevice } from './lib/logFormat.js';

const MAX = 500;
let writing = Promise.resolve();

export function log(level, cat, msg, detail) {
  const entry = { t: new Date().toISOString(), level, cat, msg: String(msg).slice(0, 500), ver: APP_VERSION };
  if (detail) entry.detail = String(detail).slice(0, 1000);
  // 依序寫入，避免同時修剪時互相干擾
  writing = writing
    .then(async () => {
      await db.put('logs', entry);
      const all = await db.keys('logs');
      for (const k of all.slice(0, Math.max(0, all.length - MAX))) await db.delete('logs', k);
    })
    .catch(() => {});
  return writing;
}

export const info = (cat, msg, detail) => log('info', cat, msg, detail);
export const warn = (cat, msg, detail) => log('warn', cat, msg, detail);
export const error = (cat, msg, detail) => log('error', cat, msg, detail);

// 由新到舊
export async function readLogs() {
  try {
    return (await db.all('logs')).reverse();
  } catch {
    return [];
  }
}

export async function clearLogs() {
  for (const k of await db.keys('logs')) await db.delete('logs', k);
}

export async function reportText() {
  return formatReport(await readLogs(), {
    version: APP_VERSION,
    now: new Date().toISOString(),
    device: describeDevice(navigator.userAgent),
    standalone: matchMedia('(display-mode: standalone)').matches || !!navigator.standalone,
    online: navigator.onLine,
  });
}

// 全域錯誤：程式例外與沒處理的 Promise 失敗
let lastErr = '';
function capture(msg, detail) {
  const key = `${msg}|${detail}`;
  if (key === lastErr) return; // 同一個錯誤連續發生只記一次
  lastErr = key;
  error('程式錯誤', msg, detail);
}
window.addEventListener('error', (e) => {
  if (e.target && e.target !== window && (e.target.src || e.target.href)) return; // 圖磚等資源載入失敗不算
  capture(e.message || '未知錯誤', e.filename ? `${e.filename.split('/').slice(-2).join('/')}:${e.lineno}` : '');
});
window.addEventListener('unhandledrejection', (e) => capture(e.reason?.message || String(e.reason), e.reason?.stack?.split('\n')[1]?.trim()));
