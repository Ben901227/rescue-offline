import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wgs84ToTwd97, twd97ToWgs84, parseCoordinate, toDMS, distance } from '../js/lib/twd97.js';

// 參考值由 proj4（+proj=tmerc +lon_0=121 +k=0.9999 +x_0=250000 +ellps=GRS80）計算
const refs = [
  [23.940475, 121.313395, 281900.065, 2648466.329],
  [25.033964, 121.564472, 306962.724, 2769658.224],
  [22.0, 120.5, 198373.614, 2433641.484],
  [24.5, 121.8, 331077.459, 2710633.249],
];

test('WGS84 → TWD97 誤差小於 1 公分', () => {
  for (const [lat, lng, x, y] of refs) {
    const r = wgs84ToTwd97(lat, lng);
    assert.ok(Math.abs(r.x - x) < 0.01, `x ${r.x} vs ${x}`);
    assert.ok(Math.abs(r.y - y) < 0.01, `y ${r.y} vs ${y}`);
  }
});

test('TWD97 → WGS84 與參考值一致', () => {
  const r = twd97ToWgs84(281345, 2648739);
  assert.ok(Math.abs(r.lat - 23.942948) < 1e-6);
  assert.ok(Math.abs(r.lng - 121.307948) < 1e-6);
  for (const [lat, lng, x, y] of refs) {
    const back = twd97ToWgs84(x, y);
    assert.ok(Math.abs(back.lat - lat) < 1e-7 && Math.abs(back.lng - lng) < 1e-7);
  }
});

test('parseCoordinate 辨識兩種格式', () => {
  assert.deepEqual(parseCoordinate('23.940475, 121.313395'), { lat: 23.940475, lng: 121.313395, source: 'wgs84' });
  const t = parseCoordinate('TWD X:281345.Y:2648739');
  assert.equal(t.source, 'twd97');
  assert.ok(Math.abs(t.lat - 23.942948) < 1e-6);
  assert.equal(parseCoordinate('hello'), null);
});

test('toDMS 與距離', () => {
  assert.equal(toDMS(23.940475, true), `23°56'25.7"N`);
  assert.equal(toDMS(121.313395, false), `121°18'48.2"E`);
  const d = distance(23.940475, 121.313395, 23.942948, 121.307948);
  assert.ok(d > 600 && d < 640, String(d));
});
