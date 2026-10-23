// 以 "subject.notes.1.text" 這種路徑讀寫巢狀物件，給案件編輯器用。

const keys = (path) => (path ? String(path).split('.') : []);

export function getPath(obj, path) {
  return keys(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const ks = keys(path);
  let o = obj;
  ks.slice(0, -1).forEach((k, i) => {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[k];
  });
  o[ks[ks.length - 1]] = value;
  return obj;
}

// 存檔前清理：去掉字串陣列裡的空行、修剪前後空白
export function tidy(value) {
  if (Array.isArray(value)) {
    const arr = value.map(tidy);
    return arr.every((v) => typeof v === 'string') ? arr.filter((v) => v !== '') : arr;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tidy(v)]));
  }
  return typeof value === 'string' ? value.trim() : value;
}
