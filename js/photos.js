// 照片：手機上先壓縮（長邊 1280px、約 300KB 內＋縮圖），存在 Firestore 的 cases/{id}/photos。
// 看過或同步過的照片留在手機的離線快取，沒網路也能看。
import { fs, email, state } from './cloud.js';
import { esc, pickFile, toast, ask } from './ui.js';
import * as log from './log.js';
import { collection, doc, getDocs, setDoc, deleteDoc, query, orderBy, Bytes } from '../vendor/firebase/firebase.js';

export const KIND_LABEL = { subject: '失聯者', scene: '現場' };
const MAX_EDGE = 1280;
const MAX_BYTES = 300 * 1024;
const THUMB_EDGE = 320;

async function loadImage(file) {
  // createImageBitmap 會依 EXIF 轉正手機直拍的照片
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 舊瀏覽器改用 <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function resize(src, maxEdge, maxBytes) {
  const w0 = src.width;
  const h0 = src.height;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * scale);
  canvas.height = Math.round(h0 * scale);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  let q = 0.8;
  let blob = await toBlob(canvas, q);
  while (blob.size > maxBytes && q > 0.35) {
    q -= 0.1;
    blob = await toBlob(canvas, q);
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height };
}

export async function compress(file) {
  const img = await loadImage(file);
  const big = await resize(img, MAX_EDGE, MAX_BYTES);
  const thumb = await resize(img, THUMB_EDGE, 40 * 1024);
  img.close?.();
  return { big, thumb };
}

export async function addPhoto(caseId, file, { kind = 'scene', caption = '', lat = null, lng = null } = {}) {
  if (!state.user) throw new Error('請先登入才能上傳照片');
  const { big, thumb } = await compress(file);
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const data = {
    kind,
    caption,
    lat,
    lng,
    w: big.w,
    h: big.h,
    image: Bytes.fromUint8Array(big.bytes),
    thumb: Bytes.fromUint8Array(thumb.bytes),
    by: email(),
    created: new Date().toISOString(),
  };
  // 離線時 Firestore 會排隊，連線後送出
  const p = setDoc(doc(fs, 'cases', caseId, 'photos', id), data);
  if (navigator.onLine) {
    await Promise.race([p, new Promise((r) => setTimeout(r, 20000))]);
  } else {
    p.catch((e) => log.warn('照片', '照片上傳失敗', e.message));
  }
  log.info('照片', `新增${KIND_LABEL[kind] || ''}照片 ${Math.round(big.bytes.length / 1024)} KB`, caption);
  return id;
}

export async function listPhotos(caseId) {
  if (!state.user) return [];
  try {
    const snap = await getDocs(query(collection(fs, 'cases', caseId, 'photos'), orderBy('created')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    log.warn('照片', '讀取照片失敗', e.message);
    return [];
  }
}

export async function deletePhoto(caseId, id) {
  await deleteDoc(doc(fs, 'cases', caseId, 'photos', id));
  log.info('照片', '刪除照片', id);
}

// Bytes → 可顯示的網址（同一張重複使用，換頁時釋放）
const urls = new Map();
export function photoUrl(p, which = 'thumb') {
  const key = `${p.id}:${which}`;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(new Blob([p[which].toUint8Array()], { type: 'image/jpeg' })));
  return urls.get(key);
}
export function releaseUrls() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
}

export function thumbsHtml(list, { empty = '' } = {}) {
  if (!list.length) return empty ? `<p class="muted small">${empty}</p>` : '';
  return `<div class="thumbs">${list
    .map((p) => `<button type="button" class="thumb" data-photo="${esc(p.id)}" aria-label="放大照片${p.caption ? `：${esc(p.caption)}` : ''}"><img src="${photoUrl(p)}" alt="" loading="lazy"></button>`)
    .join('')}</div>`;
}

// 全螢幕看照片
export function openLightbox(p) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', '照片');
  box.innerHTML = `
    <img src="${photoUrl(p, 'image')}" alt="${esc(p.caption || '照片')}">
    <div class="lightbox-info">
      ${p.caption ? `<p><b>${esc(p.caption)}</b></p>` : ''}
      <p class="small">${esc(KIND_LABEL[p.kind] || '')}照片・${esc((p.created || '').replace('T', ' ').slice(0, 16))}・${esc(p.by || '')}</p>
    </div>
    <button type="button" class="btn lightbox-close" aria-label="關閉">關閉</button>`;
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  box.addEventListener('click', (e) => (e.target === box || e.target.closest('.lightbox-close')) && close());
  document.addEventListener('keydown', onKey);
  document.body.append(box);
  box.querySelector('.lightbox-close').focus();
}

// 讓一個容器裡的縮圖可以點開
export function bindThumbs(container, list) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-photo]');
    if (!b) return;
    const p = list.find((x) => x.id === b.dataset.photo);
    if (p) openLightbox(p);
  });
}

// 選照片（或拍照）→ 壓縮 → 上傳；回傳是否有上傳
export async function pickAndUpload(caseId, kind, { caption, lat = null, lng = null, camera = false } = {}) {
  let file;
  if (camera) {
    file = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  } else {
    file = await pickFile('image/*');
  }
  if (!file) return false;
  const text = await ask('照片說明（可留空）', { value: caption ?? (kind === 'subject' ? '失聯者照片' : ''), placeholder: '例如：發現腳印', ok: '上傳' });
  if (text === null) return false;
  toast('壓縮並上傳中…', 4000);
  try {
    await addPhoto(caseId, file, { kind, caption: text, lat, lng });
    toast(navigator.onLine ? '照片已上傳' : '照片已存在手機，連線後上傳');
    return true;
  } catch (err) {
    toast(`照片上傳失敗：${err.message}`, 5000);
    return false;
  }
}
