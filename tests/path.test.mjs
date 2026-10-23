import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPath, setPath, tidy } from '../js/lib/path.js';

test('getPath / setPath 處理物件與陣列', () => {
  const o = { subject: { notes: [{ text: 'a' }] } };
  assert.equal(getPath(o, 'subject.notes.0.text'), 'a');
  assert.equal(getPath(o, 'subject.missing.x'), undefined);
  setPath(o, 'subject.notes.1.text', 'b');
  assert.deepEqual(o.subject.notes[1], { text: 'b' });
  setPath(o, 'area.bbox.0', [1, 2]);
  assert.ok(Array.isArray(o.area.bbox));
});

test('tidy 去掉空行並修剪', () => {
  assert.deepEqual(tidy({ a: [' x ', '', 'y'], b: '  z ', c: [{ t: ' q ' }], n: 3, nul: null }), { a: ['x', 'y'], b: 'z', c: [{ t: 'q' }], n: 3, nul: null });
});
