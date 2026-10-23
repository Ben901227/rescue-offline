// 檢查手機上的 App 是否為最新版，並提供一鍵更新。
import { APP_VERSION } from './version.js';
import * as log from './log.js';

let announced = null;

// 伺服器上最新的版本（讀 sw.js 的 VERSION，不經快取）；離線或失敗回傳 null
export async function latestVersion() {
  if (!navigator.onLine) return null;
  try {
    const res = await fetch(`sw.js?check=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).match(/VERSION\s*=\s*'([^']+)'/)?.[1] || null;
  } catch {
    return null;
  }
}

// { current, latest, status: 'latest' | 'update' | 'offline' }
export async function checkUpdate() {
  const latest = await latestVersion();
  if (latest && latest !== APP_VERSION && announced !== latest) {
    announced = latest;
    log.info('更新', `發現新版本 ${latest}`, `目前 ${APP_VERSION}`);
  }
  return { current: APP_VERSION, latest, status: latest == null ? 'offline' : latest === APP_VERSION ? 'latest' : 'update' };
}

// 下載新版並重新載入。新的 service worker 安裝時就會把新版檔案存好
export async function applyUpdate() {
  await log.info('更新', '開始更新', `目前 ${APP_VERSION}`);
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) {
    await reg.update().catch(() => {});
    const sw = reg.installing || reg.waiting;
    if (sw) {
      await new Promise((resolve) => {
        sw.addEventListener('statechange', () => sw.state === 'activated' && resolve());
        setTimeout(resolve, 20000);
      });
    }
  }
  location.reload();
}
