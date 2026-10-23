// Google 登入 + 從 Drive 資料夾同步案件。
// 權限控管＝Drive 資料夾的共用設定：沒被分享的帳號讀不到資料夾，
// 被移除權限的帳號下次同步時，本機從 Drive 來的案件也會一併刪除。
//
// 資料夾內容：
//   <案件>.json                 案件檔（格式見 cases/schema.md）
//   <案件 id>*.gpx / *.kml      航跡，檔名開頭是案件 id 就會掛到該案件
//
// 在 App 內儲存案件時會直接上傳回這個資料夾（需要 drive 寫入權限）；
// 離線時先標記 _pendingUpload，下次同步時補傳。

import { GOOGLE } from './config.js';
import { db, kv } from './db.js';
import { esc, toast } from './ui.js';
import { validateCase } from './lib/caseSchema.js';
import { parseTrackFile } from './lib/gpx.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPES = 'https://www.googleapis.com/auth/drive openid email';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const API = 'https://www.googleapis.com/drive/v3';

let gisPromise = null;
let tokenClient = null;
let tokenClientId = null;
let pending = null;
let token = null; // { access_token, expires_at }，只放記憶體
let hintEmail = null;
let cfgCache = null;

// 用戶端 ID 與資料夾只由 js/config.js 控制，使用者不需要也不能修改
export async function getConfig() {
  cfgCache = { clientId: GOOGLE.clientId, folderId: GOOGLE.folderId };
  return cfgCache;
}

// prepare() 之後可同步判斷，給點擊事件用
export const isConfigured = () => !!(cfgCache?.clientId && cfgCache?.folderId);

function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('無法載入 Google 登入（需要網路）'));
    };
    document.head.append(s);
  });
  return gisPromise;
}

// 頁面開啟時先載好，按下按鈕時才能直接跳出登入視窗（不被擋 popup）
export async function prepare() {
  const { clientId } = await getConfig();
  hintEmail = (await kv.get('driveLast'))?.email || null;
  if (!clientId || !navigator.onLine) return false;
  await loadGis();
  if (tokenClientId !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (res) => {
        if (res.error) return pending?.reject(new Error(res.error_description || res.error));
        token = { access_token: res.access_token, expires_at: Date.now() + (res.expires_in - 60) * 1000 };
        pending?.resolve(token);
      },
      error_callback: (err) =>
        pending?.reject(
          new Error(
            err.type === 'popup_closed' ? '已取消登入' : err.type === 'popup_failed_to_open' ? '登入視窗被瀏覽器擋住，請允許此網站開啟彈出視窗後再按一次' : err.message || '登入失敗'
          )
        ),
    });
    tokenClientId = clientId;
  }
  return true;
}

// 必須在按鈕的點擊事件中同步呼叫
function requestToken(hint) {
  if (token && token.expires_at > Date.now()) return Promise.resolve(token);
  if (!tokenClient) return Promise.reject(new Error('Google 登入尚未就緒，請稍候再按一次'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: '', login_hint: hint || undefined });
  });
}

// 在點擊事件一開始同步呼叫，必要時跳出 Google 登入；未設定或離線時回傳 null
export function beginAuth() {
  if (!isConfigured() || !navigator.onLine) return null;
  const p = requestToken(hintEmail);
  p.catch(() => {}); // 由實際等待的地方處理錯誤
  return p;
}

async function api(path, { raw = false, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    body,
    headers: { Authorization: `Bearer ${token.access_token}`, ...headers },
  });
  if (!res.ok) {
    const err = new Error(`Google API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return raw ? res.text() : res.json();
}

async function listFolder(folderId) {
  const files = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const r = await api(
      `/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`
    );
    files.push(...r.files);
    pageToken = r.nextPageToken;
  } while (pageToken);
  return files;
}

const cleanForUpload = (c) => {
  const { _sync, _pendingUpload, _localEdit, ...rest } = c;
  return JSON.stringify(rest, null, 2);
};

// 上傳案件 JSON：已有 Drive 檔就覆蓋，沒有就在資料夾新建。
// Drive 上的版本比本機上次同步新時丟出 conflict，呼叫端決定要不要 force。
export async function uploadCase(c, { force = false } = {}) {
  const { folderId } = await getConfig();
  const body = cleanForUpload(c);
  const fields = 'fields=id,name,modifiedTime&supportsAllDrives=true';
  let meta;
  if (c._sync?.fileId) {
    let remote = null;
    try {
      remote = await api(`/files/${c._sync.fileId}?fields=modifiedTime,trashed&supportsAllDrives=true`);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    if (remote && !remote.trashed) {
      if (!force && remote.modifiedTime !== c._sync.modifiedTime) {
        const err = new Error('Drive 上有其他人更新過的版本');
        err.conflict = true;
        throw err;
      }
      meta = await api(`${UPLOAD}/files/${c._sync.fileId}?uploadType=media&${fields}`, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json' } });
    }
  }
  if (!meta) {
    const boundary = `b${Math.random().toString(36).slice(2)}`;
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: `${c.id}.json`, parents: [folderId], mimeType: 'application/json' }) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    meta = await api(`${UPLOAD}/files?uploadType=multipart&${fields}`, { method: 'POST', body: multipart, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } });
  }
  return { source: 'drive', fileId: meta.id, fileName: meta.name, modifiedTime: meta.modifiedTime, syncedAt: new Date().toISOString() };
}

// 存到本機並上傳 Drive。auth 是點擊當下 beginAuth() 的結果
export async function saveAndUpload(c, auth) {
  const local = { ...c, _pendingUpload: true };
  await db.put('cases', local);
  if (!auth) return { uploaded: false, reason: isConfigured() ? '目前離線，已存在本機，下次同步時會自動上傳' : '尚未設定 Google Drive，只存在本機' };
  try {
    await auth;
    let sync;
    try {
      sync = await uploadCase(local);
    } catch (e) {
      if (!e.conflict || !confirm('Drive 上的這個案件已被其他人更新。要用你的版本覆蓋嗎？\n（取消則只存在本機，可先同步取得最新版）')) throw e;
      sync = await uploadCase(local, { force: true });
    }
    const { _pendingUpload, _localEdit, ...rest } = local;
    await db.put('cases', { ...rest, _sync: sync });
    return { uploaded: true };
  } catch (e) {
    return {
      uploaded: false,
      reason: e.conflict ? '已存在本機，未上傳：Drive 上有其他人更新的版本。請先同步取得最新版，再重新編輯儲存' : `已存在本機，但上傳失敗：${e.message}。下次同步時會再試`,
    };
  }
}

const download = (id) => api(`/files/${id}?alt=media&supportsAllDrives=true`, { raw: true });

async function removeDriveCases(keepIds = new Set(), { keepPending = false } = {}) {
  const removed = [];
  for (const c of await db.all('cases')) {
    if (c._sync?.source !== 'drive' || keepIds.has(c.id) || (keepPending && c._pendingUpload)) continue;
    await Promise.all([db.delete('cases', c.id), db.deleteByCase('tracks', c.id), db.deleteByCase('points', c.id)]);
    removed.push(c.meta?.name || c.id);
  }
  return removed;
}

// 從 Drive 同步。回傳摘要給畫面顯示
// 必須直接在點擊事件中呼叫：第一步就同步地跳出登入視窗，iOS Safari 才不會擋
export async function sync() {
  const tokenReady = requestToken(hintEmail);
  const { folderId } = await getConfig();
  if (!folderId) throw new Error('尚未設定 Drive 資料夾');
  await tokenReady;

  const me = await api('https://openidconnect.googleapis.com/v1/userinfo').catch(() => ({}));
  let files;
  try {
    await api(`/files/${folderId}?fields=id,name&supportsAllDrives=true`);
    files = await listFolder(folderId);
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      // 沒有（或被移除）資料夾權限：清掉本機從 Drive 同步來的案件
      const removed = await removeDriveCases();
      await kv.set('driveLast', { email: me.email, at: new Date().toISOString(), denied: true });
      const err = new Error(`帳號 ${me.email || ''} 沒有此資料夾的權限，請聯絡資料組。${removed.length ? `已移除本機的 ${removed.join('、')}` : ''}`);
      err.denied = true;
      throw err;
    }
    throw e;
  }

  const result = { email: me.email, added: [], updated: [], unchanged: [], errors: [], tracks: 0, removed: [], uploaded: [] };

  // 先補傳離線時存的案件
  for (const c of (await db.all('cases')).filter((x) => x._pendingUpload)) {
    try {
      const { _pendingUpload, _localEdit, ...rest } = c;
      await db.put('cases', { ...rest, _sync: await uploadCase(c) });
      result.uploaded.push(c.meta.name);
    } catch (e) {
      result.errors.push(`${c.meta.name} 上傳失敗：${e.conflict ? 'Drive 上有較新版本，請到編輯頁重新儲存' : e.message}`);
    }
  }
  if (result.uploaded.length) files = await listFolder(folderId);
  const remoteIds = new Set();

  for (const f of files.filter((f) => /\.json$/i.test(f.name) || f.mimeType === 'application/json')) {
    try {
      let data;
      try {
        data = JSON.parse(await download(f.id));
      } catch {
        throw new Error('不是有效的 JSON');
      }
      const errs = validateCase(data);
      if (errs.length) throw new Error(errs[0]);
      remoteIds.add(data.id);
      const local = await db.get('cases', data.id);
      if (local?._pendingUpload) continue; // 本機有未上傳的修改，不要被 Drive 版本蓋掉（錯誤已在上傳步驟回報）
      if (local?._sync?.fileId === f.id && local._sync.modifiedTime === f.modifiedTime) {
        result.unchanged.push(data.meta.name);
        continue;
      }
      await db.put('cases', { ...data, _sync: { source: 'drive', fileId: f.id, fileName: f.name, modifiedTime: f.modifiedTime, syncedAt: new Date().toISOString() } });
      (local ? result.updated : result.added).push(data.meta.name);
    } catch (e) {
      result.errors.push(`${f.name}：${e.message}`);
    }
  }

  const tracks = await db.all('tracks');
  for (const f of files.filter((f) => /\.(gpx|kml)$/i.test(f.name))) {
    const caseId = [...remoteIds].sort((a, b) => b.length - a.length).find((id) => f.name.startsWith(id));
    if (!caseId) continue;
    const existing = tracks.find((t) => t.driveFileId === f.id);
    if (existing?.modifiedTime === f.modifiedTime) continue;
    try {
      const data = parseTrackFile(await download(f.id));
      await db.put('tracks', {
        ...(existing ? { id: existing.id, hidden: existing.hidden } : {}),
        caseId,
        name: f.name.replace(/\.(gpx|kml)$/i, ''),
        data,
        driveFileId: f.id,
        modifiedTime: f.modifiedTime,
        added: new Date().toISOString(),
      });
      result.tracks++;
    } catch (e) {
      result.errors.push(`${f.name}：${e.message}`);
    }
  }

  // Drive 上已刪除的案件，本機同步副本也移除
  result.removed = await removeDriveCases(remoteIds, { keepPending: true });
  await kv.set('driveLast', { email: me.email, at: new Date().toISOString() });
  navigator.storage?.persist?.();
  return result;
}

export async function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
  hintEmail = null;
  await kv.del('driveLast');
}

export function summarize(r) {
  const parts = [];
  if (r.uploaded?.length) parts.push(`上傳 ${r.uploaded.join('、')}`);
  if (r.added.length) parts.push(`新增 ${r.added.join('、')}`);
  if (r.updated.length) parts.push(`更新 ${r.updated.join('、')}`);
  if (r.tracks) parts.push(`航跡 ${r.tracks} 份`);
  if (r.removed.length) parts.push(`移除 ${r.removed.join('、')}`);
  if (!parts.length) parts.push(r.unchanged.length ? '已是最新' : '資料夾中沒有案件檔');
  if (r.errors.length) parts.push(`${r.errors.length} 個檔案有問題`);
  return parts.join('；');
}

// 案件頁的同步卡片
export async function syncCardHtml() {
  const cfg = await getConfig();
  const last = await kv.get('driveLast');
  if (!cfg.clientId || !cfg.folderId) {
    return `<h2>Google Drive 同步</h2><p class="muted small">此版本尚未設定 Google 同步，請聯絡資料組。</p>`;
  }
  return `
    <h2>Google Drive 同步</h2>
    <p class="small">${last?.email ? `已登入：<b>${esc(last.email)}</b>` : '用搜救帳號登入 Google，取得有權限的案件資料。'}</p>
    ${last?.at ? `<p class="muted small">上次同步：${new Date(last.at).toLocaleString('zh-TW', { hour12: false })}</p>` : ''}
    <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="driveSync">${last?.email ? '同步最新資料' : '以 Google 登入並同步'}</button></div>
    <p class="muted small" id="driveMsg" style="margin-top:8px"></p>`;
}

export function bindSyncCard(card, app, onDone) {
  const btn = card.querySelector('#driveSync');
  if (!btn) return;
  prepare().catch(() => {});
  btn.onclick = async () => {
    if (!navigator.onLine) return toast('需要網路才能同步');
    const msg = card.querySelector('#driveMsg');
    btn.disabled = true;
    msg.textContent = '同步中…';
    try {
      const r = await sync();
      msg.innerHTML = esc(summarize(r)) + (r.errors.length ? `<br>${r.errors.map(esc).join('<br>')}` : '');
      await app.reload();
      onDone?.();
      toast(summarize(r));
    } catch (e) {
      msg.textContent = e.message;
      if (e.denied) {
        await app.reload();
        onDone?.();
      }
    } finally {
      btn.disabled = false;
    }
  };
}

// 設定頁的 Google 區塊：只顯示登入帳號與登出
export function driveSettingsHtml() {
  return `
    <h2>Google 帳號</h2>
    <p class="muted small">案件資料存在只分享給搜救人員的 Google 雲端硬碟資料夾，用 Google 帳號登入後同步。</p>
    <p id="cfgInfo" style="margin-top:8px"></p>
    <div class="btn-row" style="margin-top:10px"><button class="btn danger" id="cfgOut">登出 Google</button></div>`;
}

export async function bindDriveSettings(card) {
  const last = await kv.get('driveLast');
  const info = card.querySelector('#cfgInfo');
  info.textContent = last?.email ? `目前登入：${last.email}` : '尚未登入（到「案件」頁按同步即可登入）';
  card.querySelector('#cfgOut').disabled = !last?.email;
  card.querySelector('#cfgOut').onclick = async () => {
    await signOut();
    info.textContent = '已登出（手機上的案件資料保留，可到案件頁刪除）';
    card.querySelector('#cfgOut').disabled = true;
  };
}
