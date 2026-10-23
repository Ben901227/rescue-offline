import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEntry, formatReport, describeDevice } from '../js/lib/logFormat.js';

test('formatEntry 顯示等級、分類、內容與版本', () => {
  const s = formatEntry({ t: new Date(2026, 9, 23, 8, 5, 9).toISOString(), level: 'error', cat: '同步', msg: '上傳失敗', detail: 'Google API 403', ver: 'v12' });
  assert.equal(s, '2026-10-23 08:05:09 [錯誤][同步] 上傳失敗｜Google API 403 (v12)');
});

test('formatReport 含裝置資訊表頭', () => {
  const r = formatReport([], { version: 'v12', now: new Date().toISOString(), device: 'iOS 18.1 Safari', standalone: true, online: false });
  assert.match(r, /App 版本：v12/);
  assert.match(r, /從主畫面開啟：是　網路：離線/);
  assert.match(r, /記錄筆數：0/);
  assert.doesNotMatch(r, /帳號：/);
  assert.match(formatReport([], { version: 'v0.0.15', now: new Date().toISOString(), device: 'x', account: 'a@b.c' }), /帳號：a@b\.c/);
});

test('describeDevice', () => {
  assert.equal(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1'), 'iOS 18.1 Safari');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'), 'Android 14 Chrome');
});
