import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeLength } from '../js/lib/route.js';

test('routeLength 加總各段距離', () => {
  assert.equal(routeLength([[23.9, 121.3]]), 0);
  const d = routeLength([[23.940475, 121.313395], [23.942948, 121.307948], [23.940475, 121.313395]]);
  assert.ok(d > 1200 && d < 1280, String(d));
});
