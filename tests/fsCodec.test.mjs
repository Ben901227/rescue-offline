import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from '../js/lib/fsCodec.js';

const hasNested = (v) => Array.isArray(v) ? v.some((x) => Array.isArray(x) || hasNested(x)) : v && typeof v === 'object' ? Object.values(v).some(hasNested) : false;

test('內層陣列被包起來，且能完整還原', () => {
  const c = { id: 'a', area: { bbox: [[23.9, 121.2], [24, 121.3]], markers: [{ name: 'x', lat: 1, lng: 2 }] }, meta: { assembly: ['a', 'b'] }, found: null };
  const e = encode(c);
  assert.equal(hasNested(e), false);
  assert.deepEqual(e.area.bbox, [{ a: [23.9, 121.2] }, { a: [24, 121.3] }]);
  assert.deepEqual(decode(e), c);
});

test('路線點與三層巢狀', () => {
  const r = { points: [[1, 2], [3, 4]], deep: [[[1]]] };
  assert.equal(hasNested(encode(r)), false);
  assert.deepEqual(decode(encode(r)), r);
});

test('undefined 欄位會被移除（Firestore 不接受 undefined）', () => {
  assert.deepEqual(encode({ a: 1, b: undefined }), { a: 1 });
});
