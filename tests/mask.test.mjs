import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiffToMask, cropMask, encodeBits, decodeBits, maskAt, cellSize, assertMaskSize } from '../js/lib/mask.js';

const rgba = {
  width: 3,
  height: 2,
  samplesPerPixel: 4,
  data: Uint8Array.from([0, 0, 0, 0, 255, 0, 0, 156, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  origin: [1000, 5000],
  resolution: [20, -20],
  epsg: 3826,
};

test('RGBA：alpha > 0 才算看得到，center 為整張圖中心', () => {
  const r = tiffToMask(rgba);
  assert.deepEqual([...r.mask], [0, 1, 0, 0, 0, 0]);
  assert.deepEqual(r.grid, { x0: 1000, y0: 5000, cell: 20, w: 3, h: 2 });
  assert.deepEqual(r.center, { x: 1030, y: 4980 });
});

test('單波段：大於 0 且不是 nodata', () => {
  const r = tiffToMask({ ...rgba, width: 2, height: 2, samplesPerPixel: 1, data: Float32Array.from([0, 255, -999, 255]), nodata: -999 });
  assert.deepEqual([...r.mask], [0, 1, 0, 1]);
});

test('不是 EPSG:3826 會拒絕', () => {
  assert.throws(() => tiffToMask({ ...rgba, epsg: 4326 }), /EPSG:3826/);
});

test('cropMask 裁到最小外框，10 m 格距也正確', () => {
  const mask = new Uint8Array(25);
  mask[1 * 5 + 2] = 1;
  mask[3 * 5 + 3] = 1;
  const m = cropMask(mask, { x0: 2000, y0: 9000, cell: 10, w: 5, h: 5 });
  assert.deepEqual(m.grid, { x0: 2020, y0: 8990, cell: 10, w: 2, h: 3 });
  assert.equal(maskAt(m, 2025, 8985), true); // (2,1)
  assert.equal(maskAt(m, 2035, 8985), false); // (3,1)
  assert.equal(maskAt(m, 2035, 8965), true); // (3,3)
});

test('全空回傳 null', () => {
  assert.equal(cropMask(new Uint8Array(9), { x0: 0, y0: 0, cell: 20, w: 3, h: 3 }), null);
});

test('encodeBits / decodeBits 來回一致，且有壓縮', async () => {
  const bits = new Uint8Array(125000);
  bits[10] = 0b1010;
  bits[99999] = 255;
  const packed = await encodeBits(bits);
  assert.ok(packed.length < 2000, String(packed.length));
  assert.deepEqual(await decodeBits(packed), bits);
});

test('maskAt 超出範圍為 false', () => {
  const m = cropMask(Uint8Array.from([1]), { x0: 0, y0: 100, cell: 20, w: 1, h: 1 });
  assert.equal(maskAt(m, 10, 90), true);
  assert.equal(maskAt(m, -1, 90), false);
  assert.equal(maskAt(m, 10, 101), false);
  assert.equal(maskAt(m, 20, 90), false);
  assert.equal(maskAt(m, 10, 80), false);
});

test('格距的浮點誤差會修正（GeoTIFF 常見 19.999999999999996）', () => {
  assert.equal(cellSize([19.999999999999996, -19.999999999999996]), 20);
  assert.equal(cellSize([10, -10]), 10);
  assert.equal(tiffToMask({ ...rgba, resolution: [19.999999999999996, -19.999999999999996] }).grid.cell, 20);
});

test('單波段有很多種值（像 DEM）會拒絕', () => {
  const data = Float32Array.from({ length: 16 }, (_, i) => 1000 + i * 3.5);
  assert.throws(() => tiffToMask({ ...rgba, width: 4, height: 4, samplesPerPixel: 1, data }), /DEM/);
});

test('太大的影像會拒絕', () => {
  assert.throws(() => assertMaskSize(10175, 19112), /太大/);
  assert.doesNotThrow(() => assertMaskSize(3001, 3001));
});
