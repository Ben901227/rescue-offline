// IndexedDB 小包裝。所有案件資料只存在本機。
//   cases  : 案件 JSON（keyPath id）
//   tracks : 匯入的 GPX/KML（caseId 索引）
//   points : 使用者打點／長按加的標記（caseId 索引）
//   kv     : 其他設定，例如檢查清單勾選、標記補座標

const DB_NAME = 'rescue-offline';
const DB_VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('cases', { keyPath: 'id' });
      db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true }).createIndex('caseId', 'caseId');
      db.createObjectStore('points', { keyPath: 'id', autoIncrement: true }).createIndex('caseId', 'caseId');
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const db = {
  async all(name) { return wrap((await store(name)).getAll()); },
  async get(name, key) { return wrap((await store(name)).get(key)); },
  async put(name, value, key) { return wrap((await store(name, 'readwrite')).put(value, key)); },
  async delete(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },
  async byCase(name, caseId) { return wrap((await store(name)).index('caseId').getAll(caseId)); },
  async deleteByCase(name, caseId) {
    const s = await store(name, 'readwrite');
    const keys = await wrap(s.index('caseId').getAllKeys(caseId));
    await Promise.all(keys.map((k) => wrap(s.delete(k))));
  },
};

export const kv = {
  get: (key) => db.get('kv', key),
  set: (key, value) => db.put('kv', value, key),
  del: (key) => db.delete('kv', key),
};
