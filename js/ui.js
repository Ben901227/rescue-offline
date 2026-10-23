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

// 取代 window.prompt（部分瀏覽器／App 內嵌網頁不支援）：在底部面板輸入一行文字
// 回傳輸入內容；按取消或點背景回傳 null
export function ask(title, { value = '', placeholder = '', ok = '確定', hint = '' } = {}) {
  return new Promise((resolve) => {
    const s = sheet(`
      <h2>${esc(title)}</h2>
      <form id="askForm">
        <input type="text" id="askInput" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
        ${hint ? `<p class="muted small" style="margin-top:6px">${esc(hint)}</p>` : ''}
        <div class="btn-row" style="margin-top:12px">
          <button type="submit" class="btn primary">${esc(ok)}</button>
          <button type="button" class="btn" id="askCancel">取消</button>
        </div>
      </form>`);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      closeSheet();
      resolve(v);
    };
    const input = s.querySelector('#askInput');
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
    s.querySelector('#askForm').onsubmit = (e) => {
      e.preventDefault();
      finish(input.value);
    };
    s.querySelector('#askCancel').onclick = () => finish(null);
    document.querySelector('.sheet-backdrop')?.addEventListener('click', () => finish(null));
  });
}
