import { esc } from '../ui.js';
import { icon } from '../icons.js';
import { cachedTileCount } from '../tiles.js';
import { cloudCardHtml, bindCloudCard } from '../cloud.js';

// 同步頁：登入、雲端同步狀態、新增案件、離線準備。案件列表在「案件目錄」（directory.js）。

// 離線準備清單的一項：完成打勾，未完成空圈；文字說明狀態，不只靠顏色
const step = (done, text) =>
  `<li class="${done ? 'done' : ''}">${icon(done ? 'checkCircle' : 'circle')}<span><span class="sr-only">${done ? '已完成：' : '待辦：'}</span>${esc(text)}</span></li>`;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

export async function render(el, app) {
  const [tiles, est] = await Promise.all([cachedTileCount().catch(() => 0), navigator.storage?.estimate?.().catch(() => null)]);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);

  el.innerHTML = `
    <div class="stack">
      <p><a href="#/list">← 回案件目錄</a></p>
      <h1 style="font-size:1.3rem">同步與登入</h1>
      <section class="card" id="syncCard">${cloudCardHtml()}</section>
      <a class="btn" style="width:100%" href="#/edit">${icon('plus', { size: 18 })}新增案件</a>
      <section class="card">
        <h2>離線準備</h2>
        <p class="small" style="margin-bottom:6px">第一次使用？<a href="guide.html">${icon('help', { size: 18 })} 看圖文使用教學</a></p>
        <ul class="todo">
          ${step(standalone, standalone ? '已從主畫面開啟' : isIOS ? '在 Safari 按「分享」→「加入主畫面」，之後從主畫面圖示開啟' : '在瀏覽器選單選「安裝應用程式」或「加到主畫面」')}
          ${step(app.cases.length, app.cases.length ? '已有案件資料' : '同步或新增案件資料')}
          ${step(tiles, tiles ? `已存 ${tiles} 張離線圖磚` : '到「地圖」按下載鈕，存好離線底圖')}
          ${step(persisted, persisted ? '已啟用持久儲存' : '持久儲存未啟用（系統空間不足時可能被清除；加到主畫面通常可避免）')}
        </ul>
        ${est ? `<p class="muted small" style="margin-top:8px">本機已使用約 ${(est.usage / 1048576).toFixed(1)} MB</p>` : ''}
      </section>
      <div class="banner">案件資料含個人資料，只限搜救人員使用，請勿轉傳給非搜救人員。</div>
    </div>`;

  bindCloudCard(el.querySelector('#syncCard'), () => render(el, app));

}
