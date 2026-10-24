// 雲端同步（Firebase）。
//   登入：Google 帳號，只要求 email；登入狀態存在手機，離線也維持。
//   權限：Firestore 規則 + members 名單（見 firestore.rules）。
//   資料：cases/{id}（案件）、cases/{id}/routes/{id}（路線）、cases/{id}/photos/{id}（照片）、
//         cases/{id}/tracks/{id}（匯入的 GPX/KML 航跡）、
//         logs/{帳號_手機代號}（使用記錄）、members/{email}（成員名單）。
//   畫面仍讀本機 IndexedDB 的 cases：雲端有變動時，這裡把案件（含路線）同步寫回本機。
//   離線時的寫入由 Firestore 自動排隊，上線後送出。

import { GOOGLE_CLIENT_ID, FIREBASE, OWNER_EMAIL } from './config.js';
import { db as local, kv } from './db.js';
import { esc, toast } from './ui.js';
import { validateCase } from './lib/caseSchema.js';
import { encode, decode } from './lib/fsCodec.js';
import { slimTracks, pointCount } from './lib/gpx.js';
import { APP_VERSION, APP_CHANNEL } from './version.js';
import * as log from './log.js';
import {
  initializeApp, initializeAuth, indexedDBLocalPersistence, GoogleAuthProvider, signInWithCredential, onAuthStateChanged, signOut as fbSignOut,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
  doc, collection, getDoc, getDocs, getDocsFromServer, setDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy,
  terminate, clearIndexedDbPersistence,
} from '../vendor/firebase/firebase.js';

const fbApp = initializeApp(FIREBASE);
export const auth = initializeAuth(fbApp, { persistence: indexedDBLocalPersistence });
export const fs = initializeFirestore(fbApp, {
  // 照片也存在 Firestore，離線快取不設上限，避免舊照片被清掉
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED }),
});

// ---------- 狀態 ----------
export const state = { user: null, role: null, status: 'signed-out', error: null };
const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn(state));
const setState = (patch) => {
  Object.assign(state, patch);
  emit();
};
export const email = () => state.user?.email?.toLowerCase() || null;
export const isAdmin = () => state.role === 'admin';

// ---------- Google 登入（GIS 取得 token → Firebase 登入） ----------
const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisPromise = null;
let tokenClient = null;
let pending = null;

function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('無法載入 Google 登入（需要網路）'));
    };
    document.head.append(s);
  });
  return gisPromise;
}

// 頁面開啟時先載好，按下登入時才能直接跳出視窗（不被擋）
export async function prepare() {
  if (!navigator.onLine || tokenClient) return;
  await loadGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'openid email profile',
    // 不要把以前（Drive 版）授權過的雲端硬碟權限一起帶進來
    include_granted_scopes: false,
    callback: (res) => (res.error ? pending?.reject(new Error(res.error_description || res.error)) : pending?.resolve(res.access_token)),
    error_callback: (err) =>
      pending?.reject(new Error(err.type === 'popup_closed' ? '已取消登入' : err.type === 'popup_failed_to_open' ? '登入視窗被瀏覽器擋住，請允許此網站開啟彈出視窗後再按一次' : err.message || '登入失敗')),
  });
}

// 必須在點擊事件中同步呼叫（第一步就跳出視窗）
export function signIn() {
  if (!navigator.onLine) return Promise.reject(new Error('需要網路才能登入'));
  if (!tokenClient) return Promise.reject(new Error('Google 登入尚未就緒，請稍候再按一次'));
  const tokenP = new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: '' });
  });
  return tokenP.then(async (accessToken) => {
    const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(null, accessToken));
    log.info('登入', '已登入', cred.user.email);
    kv.set('cloudLast', { email: cred.user.email, at: new Date().toISOString() }).catch(() => {});
    return cred.user;
  });
}

export async function signOut({ wipe = true } = {}) {
  window.dispatchEvent(new Event('cloud-signout'));
  await kv.del('cloudLast').catch(() => {});
  stopListeners();
  await fbSignOut(auth).catch(() => {});
  if (wipe) await wipeCloudData('已登出');
  setState({ user: null, role: null, status: 'signed-out' });
}

// ---------- 本機鏡像 ----------
let app = null; // App 狀態（app.js 傳入），雲端資料變動時重新載入
const caseCache = new Map(); // caseId -> { data, routes: Map }
let caseUnsub = null;
const routeUnsubs = new Map();
const trackUnsubs = new Map();
let memberUnsub = null;
let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await app?.reload();
    window.dispatchEvent(new CustomEvent('cloud-data'));
  }, 300);
}

async function writeMirror(caseId) {
  const entry = caseCache.get(caseId);
  if (!entry?.data) return;
  const routes = [...entry.routes.values()].sort((a, b) => (a.created || '').localeCompare(b.created || ''));
  await local.put('cases', { ...entry.data, routes, _sync: { source: 'cloud', updatedAt: entry.data.updatedAt || null } });
  scheduleRefresh();
}

// 移除本機所有雲端案件，並清掉 Firestore 離線快取（被移出名單或登出時）
async function wipeCloudData(reason) {
  for (const c of await local.all('cases')) {
    if (c._sync?.source !== 'cloud') continue;
    await Promise.all([local.delete('cases', c.id), local.deleteByCase('tracks', c.id), local.deleteByCase('points', c.id)]);
  }
  caseCache.clear();
  try {
    await terminate(fs);
    await clearIndexedDbPersistence(fs);
  } catch {
    /* 下次重新開啟 App 時會清 */
  }
  log.info('同步', `已清除手機上的雲端資料（${reason}）`);
  await app?.reload();
  window.dispatchEvent(new CustomEvent('cloud-data'));
}

function stopListeners() {
  caseUnsub?.();
  caseUnsub = null;
  memberUnsub?.();
  memberUnsub = null;
  routeUnsubs.forEach((u) => u());
  routeUnsubs.clear();
  trackUnsubs.forEach((u) => u());
  trackUnsubs.clear();
}

function listenRoutes(caseId) {
  if (routeUnsubs.has(caseId)) return;
  const unsub = onSnapshot(
    collection(fs, 'cases', caseId, 'routes'),
    (snap) => {
      const entry = caseCache.get(caseId);
      if (!entry) return;
      entry.routes = new Map(snap.docs.map((d) => [d.id, { ...decode(d.data()), id: d.id }]));
      writeMirror(caseId);
    },
    (err) => log.warn('同步', '路線同步失敗', err.message)
  );
  // 握手範圍：地圖頁自己讀，這裡只負責在背景同步到離線快取（沒開過地圖也能離線看）
  const hsUnsub = onSnapshot(
    collection(fs, 'cases', caseId, 'handshakes'),
    () => {},
    (err) => log.warn('同步', '握手範圍同步失敗', err.message)
  );
  routeUnsubs.set(caseId, () => {
    unsub();
    hsUnsub();
  });
}

// 航跡：雲端的每一份寫進本機 tracks（id 用雲端文件 id），只在這支手機的那些不動；
// 「隱藏」是各手機自己的顯示設定，同步時保留
function listenTracks(caseId) {
  if (trackUnsubs.has(caseId)) return;
  const unsub = onSnapshot(
    collection(fs, 'cases', caseId, 'tracks'),
    async (snap) => {
      const prev = new Map((await local.byCase('tracks', caseId)).filter((t) => t.cloudId).map((t) => [t.cloudId, t]));
      for (const d of snap.docs) {
        await local.put('tracks', { ...decode(d.data()), id: d.id, cloudId: d.id, caseId, hidden: prev.get(d.id)?.hidden || false });
        prev.delete(d.id);
      }
      for (const id of prev.keys()) await local.delete('tracks', id);
      window.dispatchEvent(new CustomEvent('tracks-data', { detail: caseId }));
    },
    (err) => log.warn('同步', '航跡同步失敗', err.message)
  );
  trackUnsubs.set(caseId, unsub);
}

function startCaseListener() {
  caseUnsub = onSnapshot(
    collection(fs, 'cases'),
    // 也要收「伺服器確認資料沒變」的通知，否則先讀到手機快取後狀態會一直停在「連線中」
    { includeMetadataChanges: true },
    async (snap) => {
      for (const ch of snap.docChanges()) {
        const id = ch.doc.id;
        if (ch.type === 'removed') {
          caseCache.delete(id);
          routeUnsubs.get(id)?.();
          routeUnsubs.delete(id);
          trackUnsubs.get(id)?.();
          trackUnsubs.delete(id);
          const c = await local.get('cases', id);
          if (c?._sync?.source === 'cloud') await Promise.all([local.delete('cases', id), local.deleteByCase('tracks', id)]);
          scheduleRefresh();
          continue;
        }
        const entry = caseCache.get(id) || { routes: new Map() };
        entry.data = decode(ch.doc.data());
        caseCache.set(id, entry);
        listenRoutes(id);
        listenTracks(id);
        await writeMirror(id);
      }
      if (!snap.metadata.fromCache && state.status !== 'synced') {
        setState({ status: 'synced', error: null, lastSync: new Date().toISOString() });
        kv.set('cloudLast', { email: email(), at: new Date().toISOString() }).catch(() => {});
        maybeUploadLogs();
      }
    },
    (err) => handleError(err)
  );
}

function handleError(err) {
  if (err.code === 'permission-denied') {
    log.warn('同步', '沒有權限讀取案件，可能已被移出成員名單', email());
    setState({ status: 'denied', error: '你的帳號不在成員名單內，請把 Gmail 告訴管理員' });
    stopListeners();
    wipeCloudData('沒有權限');
  } else {
    log.warn('同步', '雲端同步發生問題', err.message);
    setState({ status: 'error', error: err.message });
  }
}

function startListeners() {
  stopListeners();
  const me = email();
  setState({ status: 'connecting' });
  if (me === OWNER_EMAIL) setState({ role: 'admin' });
  memberUnsub = onSnapshot(
    doc(fs, 'members', me),
    (snap) => {
      const role = me === OWNER_EMAIL ? 'admin' : snap.exists() ? snap.data().role : null;
      if (!role && !snap.metadata.fromCache) return handleError({ code: 'permission-denied' });
      if (role) setState({ role });
      if (role && !caseUnsub) startCaseListener();
    },
    (err) => handleError(err)
  );
}

// App 啟動時呼叫一次
export function start(appState) {
  app = appState;
  let explicitSignOut = false;
  window.addEventListener('cloud-signout', () => (explicitSignOut = true));
  onAuthStateChanged(auth, async (user) => {
    // 之前登入過、這次沒按登出卻變成未登入：記下來方便追查
    const last = await kv.get('cloudLast').catch(() => null);
    if (!user && last?.email && !explicitSignOut) {
      log.warn('登入', '登入狀態遺失，需要重新登入', `上次登入 ${last.email}・${navigator.onLine ? '連線中' : '離線'}`);
      kv.del('cloudLast').catch(() => {});
    }
    setState({ user, role: null, status: user ? 'connecting' : 'signed-out', error: null });
    if (user) startListeners();
    else stopListeners();
  });
  window.addEventListener('online', () => {
    if (state.user) maybeUploadLogs(true);
  });
}

// ---------- 寫入 ----------
const stripLocal = (c) => {
  const { _sync, _pendingUpload, _localEdit, routes, ...rest } = c;
  return rest;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 存案件（含路線差異）。沿用舊介面：auth 參數已不需要
export async function saveAndUpload(c) {
  if (!state.user) {
    await local.put('cases', c);
    return { uploaded: false, reason: '尚未登入，只存在這支手機。登入後請重新儲存' };
  }
  const errors = validateCase(c);
  if (errors.length) return { uploaded: false, reason: errors.join('；') };
  const prev = (await local.get('cases', c.id)) || {};
  const body = stripLocal(c);
  const writes = [];
  // 還沒上過雲端的案件（只在這支手機、或舊版 Drive 來的）一律整份上傳
  const fromCloud = prev._sync?.source === 'cloud' && prev._sync?.updatedAt;
  if (!fromCloud || !same(body, stripLocal(prev))) {
    writes.push(setDoc(doc(fs, 'cases', c.id), encode({ ...body, updatedAt: new Date().toISOString(), updatedBy: email() })));
  }
  // 路線：只寫有變動的、刪掉這次被移除的（別人新增、本機還沒收到的不受影響）
  const prevRoutes = new Map((prev.routes || []).map((r) => [r.id, r]));
  for (const r of c.routes || []) {
    if (!fromCloud || !same(r, prevRoutes.get(r.id))) writes.push(setDoc(doc(fs, 'cases', c.id, 'routes', r.id), encode({ ...r, created: r.created || new Date().toISOString(), by: r.by || email() })));
    prevRoutes.delete(r.id);
  }
  for (const id of prevRoutes.keys()) writes.push(deleteDoc(doc(fs, 'cases', c.id, 'routes', id)));

  await local.put('cases', { ...c, _sync: { source: 'cloud', updatedAt: fromCloud ? prev._sync.updatedAt : null } });
  const name = c.meta?.name || c.id;
  if (!writes.length) return { uploaded: true };
  // 離線時 Firestore 會排隊，不等伺服器回應
  if (!navigator.onLine) {
    Promise.all(writes).then(() => log.info('上傳', `「${name}」已在連線後上傳`)).catch((e) => log.warn('上傳', `「${name}」上傳失敗`, e.message));
    log.info('上傳', `「${name}」先存在手機，連線後自動上傳`);
    return { uploaded: false, reason: '目前離線，已存在手機，連線後會自動上傳' };
  }
  try {
    await Promise.race([Promise.all(writes), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
    log.info('上傳', `「${name}」已上傳`);
    return { uploaded: true };
  } catch (e) {
    const denied = e.code === 'permission-denied';
    log.warn('上傳', `「${name}」${denied ? '沒有權限上傳' : '上傳較慢，連線穩定後會自動完成'}`, e.message);
    return { uploaded: false, reason: denied ? '沒有權限上傳，請聯絡管理員' : '網路不穩，已存在手機，連線穩定後會自動上傳' };
  }
}

// 等雲端寫入：離線時 Firestore 會排隊，不等伺服器回應
async function settle(write, what) {
  if (!navigator.onLine) {
    write.then(() => log.info('上傳', `${what}已在連線後上傳`)).catch((e) => log.warn('上傳', `${what}上傳失敗`, e.message));
    return { uploaded: false, reason: '目前離線，連線後會自動上傳' };
  }
  try {
    await Promise.race([write, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
    log.info('上傳', `${what}已上傳`);
    return { uploaded: true };
  } catch (e) {
    const denied = e.code === 'permission-denied';
    log.warn('上傳', `${what}${denied ? '沒有權限上傳' : '上傳較慢，連線穩定後會自動完成'}`, e.message);
    return { uploaded: false, denied, reason: denied ? '沒有權限上傳，請聯絡管理員' : '網路不穩，連線穩定後會自動上傳' };
  }
}

// 把本機匯入的航跡分享給全隊（精簡點數後存到 cases/{id}/tracks）
export async function shareTrack(t) {
  if (!state.user) throw new Error('請先登入');
  const data = slimTracks(t.data);
  const body = encode({ name: t.name, data, pointCount: pointCount(data), added: t.added || new Date().toISOString(), by: email() });
  if (JSON.stringify(body).length > 900 * 1024) throw new Error('航跡太大，無法分享');
  const ref = doc(collection(fs, 'cases', t.caseId, 'tracks'));
  const write = setDoc(ref, body);
  // 先換成雲端那份，離線時地圖也會顯示為已分享
  await local.put('tracks', { ...decode(body), id: ref.id, cloudId: ref.id, caseId: t.caseId, hidden: t.hidden || false });
  if (!t.cloudId) await local.delete('tracks', t.id);
  const r = await settle(write, `航跡「${t.name}」`);
  // 被拒絕就換回本機那份，不要顯示成已分享
  if (r.denied) await Promise.all([local.delete('tracks', ref.id), local.put('tracks', t)]);
  return r;
}

export async function deleteTrack(t) {
  if (!t.cloudId) return local.delete('tracks', t.id);
  const write = deleteDoc(doc(fs, 'cases', t.caseId, 'tracks', t.cloudId));
  await local.delete('tracks', t.id);
  const r = await settle(write, `刪除航跡「${t.name}」`);
  if (r.denied) {
    await local.put('tracks', t);
    throw new Error('只有上傳者或管理員能刪除這份航跡');
  }
}

// 手動「同步最新資料」：重新向伺服器拿一次，並上傳使用記錄
export async function syncNow() {
  if (!state.user) throw new Error('請先登入');
  if (!navigator.onLine) throw new Error('需要網路才能同步');
  const snap = await getDocsFromServer(collection(fs, 'cases'));
  setState({ status: 'synced', error: null, lastSync: new Date().toISOString() });
  await maybeUploadLogs(true);
  return snap.size;
}

// ---------- 使用記錄 ----------
let lastLogUpload = 0;
async function deviceId() {
  let id = await kv.get('deviceId');
  if (!id) {
    id = Math.random().toString(36).slice(2, 6);
    await kv.set('deviceId', id);
  }
  return id;
}

export async function maybeUploadLogs(force = false) {
  if (!state.user || !navigator.onLine) return;
  if (!force && Date.now() - lastLogUpload < 10 * 60 * 1000) return;
  lastLogUpload = Date.now();
  try {
    const me = email();
    const text = (await log.reportText(me)).slice(-300 * 1024);
    await setDoc(doc(fs, 'logs', `${me}_${await deviceId()}`), {
      account: me,
      device: log.deviceName(),
      version: APP_CHANNEL ? `${APP_VERSION}（${APP_CHANNEL}）` : APP_VERSION,
      text,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    log.warn('使用記錄', '上傳使用記錄失敗', e.message);
  }
}

export async function listLogs() {
  const snap = await getDocs(query(collection(fs, 'logs'), orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- 成員名單（管理員） ----------
export async function listMembers() {
  const snap = await getDocs(collection(fs, 'members'));
  const list = snap.docs.map((d) => ({ email: d.id, ...d.data() }));
  if (!list.some((m) => m.email === OWNER_EMAIL)) list.unshift({ email: OWNER_EMAIL, role: 'admin', name: '第一位管理員', owner: true });
  return list.map((m) => ({ ...m, owner: m.email === OWNER_EMAIL })).sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
}

export async function setMember(mail, data) {
  const id = mail.trim().toLowerCase();
  await setDoc(doc(fs, 'members', id), { role: data.role, name: data.name || '', addedBy: email(), addedAt: new Date().toISOString() });
  log.info('成員', `${data.role === 'admin' ? '設為管理員' : '加入成員'}：${id}`);
}

export async function removeMember(mail) {
  await deleteDoc(doc(fs, 'members', mail));
  log.info('成員', `移除成員：${mail}`);
}

export async function deleteCase(id) {
  for (const d of (await getDocs(collection(fs, 'cases', id, 'routes'))).docs) await deleteDoc(d.ref);
  for (const d of (await getDocs(collection(fs, 'cases', id, 'photos'))).docs) await deleteDoc(d.ref);
  for (const d of (await getDocs(collection(fs, 'cases', id, 'handshakes'))).docs) await deleteDoc(d.ref);
  for (const d of (await getDocs(collection(fs, 'cases', id, 'tracks'))).docs) await deleteDoc(d.ref);
  await deleteDoc(doc(fs, 'cases', id));
  log.info('案件', `刪除雲端案件：${id}`);
}

// ---------- 畫面：案件頁的雲端卡片 ----------
const ROLE_LABEL = { admin: '管理員', member: '隊員' };

export function cloudCardHtml() {
  const s = state;
  if (!s.user) {
    return `<h2>雲端同步</h2>
      <p class="small">用 Google 帳號登入，取得你有權限的案件。登入時只會分享你的 email，<b>不會存取你的雲端硬碟</b>。</p>
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="cloudLogin">以 Google 登入</button></div>
      <p class="muted small" id="cloudMsg" style="margin-top:8px"></p>`;
  }
  const statusText = {
    connecting: '連線中…',
    synced: '已同步，資料有變動會自動更新',
    denied: s.error,
    error: `同步有問題：${s.error || ''}`,
  }[s.status] || '';
  return `<h2>雲端同步</h2>
    <p class="small">已登入：<b>${esc(s.user.email)}</b>${s.role ? ` <span class="chip ${s.role === 'admin' ? 'warn' : 'muted'}">${ROLE_LABEL[s.role]}</span>` : ''}</p>
    <p class="small" style="margin-top:4px;color:${s.status === 'denied' || s.status === 'error' ? 'var(--danger)' : 'var(--muted)'}">${navigator.onLine ? esc(statusText) : '目前離線，使用手機上的資料；修改會在連線後自動上傳'}</p>
    <div class="btn-row" style="margin-top:10px"><button class="btn" id="cloudSync" ${s.status === 'denied' ? 'disabled' : ''}>同步最新資料</button></div>
    <p class="muted small" id="cloudMsg" style="margin-top:8px"></p>`;
}

export function bindCloudCard(card, onDone) {
  prepare().catch(() => {});
  const msg = () => card.querySelector('#cloudMsg');
  card.querySelector('#cloudLogin')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const p = signIn(); // 同步呼叫，避免登入視窗被擋
    btn.disabled = true;
    msg().textContent = '登入中…';
    try {
      await p;
      onDone?.();
    } catch (err) {
      msg().textContent = err.message;
      log.warn('登入', '登入失敗', err.message);
      btn.disabled = false;
    }
  });
  card.querySelector('#cloudSync')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    msg().textContent = '同步中…';
    try {
      const n = await syncNow();
      msg().textContent = `已同步，共 ${n} 個案件`;
      log.info('同步', `手動同步完成，共 ${n} 個案件`);
      toast('已同步');
    } catch (err) {
      msg().textContent = err.code === 'permission-denied' ? '你的帳號不在成員名單內，請把 Gmail 告訴管理員' : err.message;
      if (err.code === 'permission-denied') handleError(err);
      else log.warn('同步', '手動同步失敗', err.message);
    } finally {
      btn.disabled = false;
    }
  });
}
