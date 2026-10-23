import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../js/version.js';

test('js/version.js 與 sw.js 的版本一致', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.equal(sw.match(/VERSION\s*=\s*'([^']+)'/)[1], APP_VERSION);
});

test('sw.js 的預快取清單包含所有 js 檔', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['js/version.js', 'js/update.js', 'js/log.js', 'js/lib/logFormat.js', 'guide.html']) assert.ok(sw.includes(`'${f}'`), f);
});
