import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { validateCase, normalizeCase, caseStatus } from '../js/lib/caseSchema.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('空白範本通過驗證', () => {
  assert.deepEqual(validateCase(load('../cases/template.json')), []);
});

test('牡丹岩案資料通過驗證', { skip: !existsSync(new URL('../private/mudanyan-2026-10.json', import.meta.url)) }, () => {
  const c = load('../private/mudanyan-2026-10.json');
  assert.deepEqual(validateCase(c), []);
  assert.equal(caseStatus(normalizeCase(c)), '已尋獲');
});

test('缺少必要欄位會回報', () => {
  const errs = validateCase({ meta: {}, area: { markers: [{ name: 'x', lat: 'a', lng: 1 }] } });
  assert.equal(errs.length, 3);
});

test('normalizeCase 把字串清單項目轉成物件', () => {
  const c = normalizeCase({ id: 'a', meta: { name: 'a' }, checklist: [{ group: '個人', items: ['頭燈'] }] });
  assert.deepEqual(c.checklist[0].items[0], { id: '0-0', text: '頭燈' });
  assert.equal(caseStatus(c), '搜索中');
});

test('routes 驗證', () => {
  const base = { id: 'a', meta: { name: 'a' } };
  assert.deepEqual(validateCase({ ...base, routes: [{ id: 'r1', name: 'A', points: [[23.9, 121.3], [23.91, 121.31]] }] }), []);
  assert.equal(validateCase({ ...base, routes: [{ id: 'r1', points: [[23.9, 121.3]] }] }).length, 1);
  assert.equal(validateCase({ ...base, routes: {} }).length, 1);
  assert.deepEqual(normalizeCase(base).routes, []);
});
