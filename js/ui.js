// 共用的小工具：HTML 跳脫、提示訊息、底部面板、剪貼簿、下載。

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 有內容才輸出，空欄位自動隱藏
export const has = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);

export const nl2br = (v) => esc(v).replace(/\n/g, '<br>');

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function sheet(html) {
  closeSheet();
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="grab"></div>${html}`;
  const title = el.querySelector('h2');
  if (title) {
    title.id ||= 'sheetTitle';
    el.setAttribute('aria-labelledby', title.id);
  }
  bd.addEventListener('click', closeSheet);
  document.body.append(bd, el);
  lastFocus = document.activeElement;
  el.setAttribute('tabindex', '-1');
  el.focus();
  document.addEventListener('keydown', onSheetKey);
  return el;
}

let lastFocus = null;
function onSheetKey(e) {
  if (e.key === 'Escape') {
    // 讓面板自己的取消邏輯（例如地圖選點）優先處理
    const backdrop = document.querySelector('.sheet-backdrop');
    backdrop ? backdrop.click() : closeSheet();
  }
}

export function closeSheet() {
  document.querySelectorAll('.sheet, .sheet-backdrop').forEach((n) => n.remove());
  document.removeEventListener('keydown', onSheetKey);
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 舊版 iOS 或非安全環境的備案
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('已複製');
}

export async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  copyText(text);
}

export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

export const fmtTime = (d = new Date()) =>
  `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
