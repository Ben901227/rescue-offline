// 握手範圍（基地台視域）：每筆存在 cases/{id}/handshakes/{id}，遮罩壓縮成 Bytes。
// 地圖上把所有筆數聯集顯示；手機離線時從 Firestore 快取讀。
// 讀 TIFF、算視域都在 handshakeWorker.js 背景執行緒做。
import { fs, email } from './cloud.js';
import { encodeBits, decodeBits } from './lib/mask.js';
import { wgs84ToTwd97, twd97ToWgs84 } from './lib/twd97.js';
import * as log from './log.js';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, Bytes } from '../vendor/firebase/firebase.js';

const col = (caseId) => collection(fs, 'cases', caseId, 'handshakes');

export function listenHandshakes(caseId, cb) {
  let seq = 0;
  return onSnapshot(
    query(col(caseId), orderBy('created')),
    async (snap) => {
      const mine = ++seq;
      const list = await Promise.all(
        snap.docs.map(async (d) => {
          const { mask, ...rest } = d.data();
          return { id: d.id, ...rest, bits: await decodeBits(mask.toUint8Array()) };
        })
      );
      if (mine === seq) cb(list);
    },
    (err) => log.warn('握手範圍', '同步失敗', err.message)
  );
}

// 回傳 true = 已上傳；false = 離線，連線後自動上傳
export async function addHandshake(caseId, { name, source, station = null, params = null, grid, bits }) {
  const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const mask = await encodeBits(bits);
  const p = setDoc(doc(col(caseId), id), { name, source, station, params, grid, mask: Bytes.fromUint8Array(mask), by: email(), created: new Date().toISOString() });
  log.info('握手範圍', `新增「${name}」（${source === 'compute' ? '計算' : '匯入'}，${Math.round(mask.length / 1024)} KB）`);
  if (!navigator.onLine) {
    p.catch((e) => log.warn('握手範圍', `「${name}」上傳失敗`, e.message));
    return false;
  }
  await Promise.race([p, new Promise((r) => setTimeout(r, 20000))]);
  return true;
}

export async function deleteHandshake(caseId, id) {
  await deleteDoc(doc(col(caseId), id));
  log.info('握手範圍', '刪除', id);
}

function run(msg, onProgress) {
  const worker = new Worker(new URL('./handshakeWorker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return onProgress?.(data.text);
      worker.terminate();
      if (data.type === 'done') resolve(data);
      else reject(new Error(data.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || '背景計算失敗'));
    };
    worker.postMessage(msg);
  });
}

export async function readTiff(file, onProgress) {
  const { grid, bits, center } = await run({ type: 'import', file }, onProgress);
  return { grid, bits, center: twd97ToWgs84(center.x, center.y) };
}

export async function computeFromDem(file, station, params, onProgress) {
  const { grid, bits } = await run({ type: 'compute', file, station: wgs84ToTwd97(station.lat, station.lng), params }, onProgress);
  return { grid, bits };
}
