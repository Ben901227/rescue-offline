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
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36'), 'Android 15 三星瀏覽器');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; U; Android 15; zh-tw; CPH2701) AppleWebKit/537.36 Chrome/115.0 Mobile Safari/537.36 HeyTapBrowser/45.0'), 'Android 15 OPPO 瀏覽器');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 14; K; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0 Mobile Safari/537.36 Line/14.0'), 'Android 14 LINE 內建瀏覽器');
  assert.equal(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'), 'iOS 18.1 Safari（主畫面）');
});
