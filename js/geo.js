// 單一 GPS 監聽，地圖與定位頁共用；沒有訂閱者時自動停止以省電。
import * as log from './log.js';

const loggedErrors = new Set();

const subs = new Set();
let watchId = null;
export let last = null;
let lastError = null;
let heading = null;

function emit() {
  for (const fn of subs) fn({ pos: last, error: lastError, heading });
}

function onOrientation(e) {
  // iOS 提供 webkitCompassHeading；Android 用 absolute alpha
  const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
  if (h == null) return;
  heading = h;
  emit();
}

function start() {
  if (watchId != null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      lastError = null;
      last = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        acc: p.coords.accuracy,
        alt: p.coords.altitude,
        altAcc: p.coords.altitudeAccuracy,
        gpsHeading: p.coords.heading,
        speed: p.coords.speed,
        time: p.timestamp,
      };
      emit();
    },
    (err) => {
      lastError = err.code === 1 ? '未允許定位權限，請到瀏覽器／系統設定開啟' : err.code === 3 ? '定位逾時，請移到開闊處' : '無法取得定位';
      if (!loggedErrors.has(err.code)) {
        loggedErrors.add(err.code); // 同一種定位問題只記一次
        log.warn('定位', lastError, err.message);
      }
      emit();
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 }
  );
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
}

function stop() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
}

export function subscribe(fn) {
  subs.add(fn);
  start();
  if (last || lastError) fn({ pos: last, error: lastError, heading });
  return () => {
    subs.delete(fn);
    if (!subs.size) stop();
  };
}

// iOS 13+ 需要使用者手勢才能要求羅盤權限
export async function requestCompass() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    try {
      return (await D.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}
