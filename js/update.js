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

// 下載新版並重新載入。新的 service worker 安裝時就會把新版檔案存好。
// 安裝失敗（例如網路中斷、伺服器剛部署還沒同步完成）時回傳 false，不重新載入
export async function applyUpdate() {
  await log.info('更新', '開始更新', `目前 ${APP_VERSION}`);
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) {
    await reg.update().catch(() => {});
    const sw = reg.installing || reg.waiting;
    if (sw) {
      const state = await new Promise((resolve) => {
        if (sw.state === 'activated' || sw.state === 'redundant') return resolve(sw.state);
        sw.addEventListener('statechange', () => (sw.state === 'activated' || sw.state === 'redundant') && resolve(sw.state));
        setTimeout(() => resolve('timeout'), 30000);
      });
      if (state !== 'activated') {
        await log.warn('更新', '更新沒有完成，仍使用目前版本', state === 'redundant' ? '新版檔案下載失敗' : '等待逾時');
        return false;
      }
    }
  }
  location.reload();
  return true;
}
