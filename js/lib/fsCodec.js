// Firestore 不支援「陣列裡面再放陣列」（例如路線點 [[緯度, 經度], …]、搜索範圍 bbox）。
// 寫入前把內層陣列包成 { a: [...] }，讀出時再還原；其他資料原樣保留。

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

export function encode(value, inArray = false) {
  if (Array.isArray(value)) {
    const arr = value.map((v) => encode(v, true));
    return inArray ? { a: arr } : arr;
  }
  if (isPlain(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = encode(v, false);
    return out;
  }
  return value;
}

export function decode(value) {
  if (Array.isArray(value)) return value.map((v) => (isPlain(v) && Object.keys(v).length === 1 && Array.isArray(v.a) ? decode(v.a) : decode(v)));
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  return value;
}
