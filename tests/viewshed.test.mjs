import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewshed, VIEWSHED_DEFAULTS } from '../js/lib/viewshed.js';

const at = (v, w, x, y) => v[y * w + x];

test('預設參數：觀測者 1 m、目標 1 m、30 km', () => {
  assert.deepEqual(VIEWSHED_DEFAULTS, { observerHeight: 1, targetHeight: 1, maxDistance: 30000 });
});

test('平地：近處看得到，地球曲率讓遠處看不到', () => {
  // 觀測者與目標都高 1 m，考慮曲率與折射後視距約 7.7 km
  const w = 1001;
  const v = viewshed(new Float32Array(w * w), w, w, 500, 500);
  assert.equal(v.length, w * w);
  assert.equal(at(v, w, 500, 500), 1);
  assert.equal(at(v, w, 750, 500), 1); // 5 km
  assert.equal(at(v, w, 950, 500), 0); // 9 km
  assert.equal(at(v, w, 500, 150), 1); // 往北 7 km
  assert.equal(at(v, w, 500, 50), 0); // 往北 9 km
});

test('牆本身看得到、牆後面看不到', () => {
  const w = 201;
  const dem = new Float32Array(w * w);
  for (let y = 0; y < w; y++) dem[y * w + 120] = 100;
  const v = viewshed(dem, w, w, 100, 100);
  assert.equal(at(v, w, 120, 100), 1);
  assert.equal(at(v, w, 140, 100), 0);
  assert.equal(at(v, w, 140, 110), 0);
  assert.equal(at(v, w, 80, 100), 1);
});

test('超過 maxDistance 一律看不到', () => {
  const w = 201;
  const v = viewshed(new Float32Array(w * w), w, w, 100, 100, { maxDistance: 1000 });
  assert.equal(at(v, w, 140, 100), 1); // 800 m
  assert.equal(at(v, w, 160, 100), 0); // 1200 m
  assert.equal(at(v, w, 140, 140), 0); // 斜向 1131 m
});

test('觀測點在角落也能算', () => {
  const w = 101;
  const v = viewshed(new Float32Array(w * w), w, w, 0, 0);
  assert.equal(v.length, w * w);
  assert.equal(at(v, w, 0, 0), 1);
  assert.equal(at(v, w, 50, 50), 1);
  assert.equal(at(v, w, 100, 0), 1);
});

test('不修改輸入的 dem', () => {
  const w = 21;
  const dem = Float32Array.from({ length: w * w }, (_, i) => i % 7);
  const copy = Float32Array.from(dem);
  viewshed(dem, w, w, 10, 10);
  assert.deepEqual(dem, copy);
});

test('nodata（NaN 或指定值）不擋視線、本身看不到，也不會讓後面變成看得到', () => {
  const w = 201;
  for (const bad of [NaN, -999]) {
    const dem = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
      dem[y * w + 120] = 500; // 牆
      dem[y * w + 130] = bad; // 牆後面一欄沒有資料
    }
    const v = viewshed(dem, w, w, 100, 100, { nodata: -999 });
    assert.equal(at(v, w, 130, 100), 0);
    let behind = 0;
    for (let y = 0; y < w; y++) for (let x = 131; x < w; x++) behind += at(v, w, x, y);
    assert.equal(behind, 0, `bad=${bad}`);
  }
});
