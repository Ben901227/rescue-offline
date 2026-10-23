import { esc, toast, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { APP_VERSION, APP_CHANNEL, APP_DATE } from '../version.js';
import { checkUpdate, applyUpdate } from '../update.js';
import { state as cloud, signOut, isAdmin } from '../cloud.js';


export async function render(el, app) {
  const c = app.current;
  el.innerHTML = `
    <div class="stack">
      <h1 style="font-size:1.3rem">一般設定</h1>

      ${c ? `<a class="card link-card" href="#/case">${icon('tasks')}<span><b>案件設定：${esc(c.meta.name)}</b><br><span class="muted small">裝備清單、無線電與分組、案件資料</span></span><span aria-hidden="true">›</span></a>` : ''}
      <section class="card" id="accountCard">
        <h2>帳號</h2>
        <p>${cloud.user ? `目前登入：<b>${esc(cloud.user.email)}</b>${cloud.role ? ` <span class="chip ${cloud.role === 'admin' ? 'warn' : 'muted'}">${cloud.role === 'admin' ? '管理員' : '隊員'}</span>` : ''}` : '尚未登入（到「案件」→「同步與登入」登入）'}</p>
        <p class="muted small" style="margin-top:4px">登入時只分享 email，App 不會存取你的 Google 雲端硬碟。</p>
        <div class="btn-row" style="margin-top:10px">
          ${isAdmin() ? `<a class="btn" href="#/admin">${icon('settings')}管理成員與使用記錄</a>` : ''}
          <button class="btn danger" id="signOutBtn" ${cloud.user ? '' : 'disabled'}>登出</button>
        </div>
      </section>
      <section class="card" id="themeCard">
        <h2>外觀</h2>
        <div class="seg" role="group" aria-label="顯示模式">
          <button type="button" class="btn small" data-theme-opt="auto">自動</button>
          <button type="button" class="btn small" data-theme-opt="light">淺色</button>
          <button type="button" class="btn small" data-theme-opt="dark">深色</button>
        </div>
        <p class="muted small" style="margin-top:6px">「自動」跟著手機的深色模式設定。晚上或省電時建議用深色。</p>
      </section>
      <section class="card" id="verCard">
        <h2>App 版本</h2>
        <p>目前版本：<b class="mono">${APP_VERSION}</b> ${APP_CHANNEL ? `<span class="chip warn">${APP_CHANNEL}</span>` : ''} <span class="muted small">${APP_DATE}</span></p>
        <p id="verStatus" class="small" style="margin-top:4px">檢查中…</p>
        <div class="btn-row" style="margin-top:10px"><button class="btn" id="verCheck">重新檢查</button><button class="btn primary hidden" id="verUpdate">立即更新</button></div>
      </section>
      <a class="btn" style="width:100%" href="guide.html">${icon('help')}使用教學</a>
      <p class="muted small" style="text-align:center"><a href="#/list">← 回案件目錄</a></p>
    </div>`;
  el.querySelector('#signOutBtn').onclick = async () => {
    if (!(await confirmBox('登出後，這支手機上的雲端案件與照片會一併清除（離線準備要重做）。確定登出？'))) return;
    await signOut();
    toast('已登出');
    app.go('cases');
  };
  const verStatus = el.querySelector('#verStatus');
  const verUpdate = el.querySelector('#verUpdate');
  const runCheck = async () => {
    verStatus.textContent = '檢查中…';
    const u = await checkUpdate();
    verStatus.innerHTML =
      u.status === 'latest' ? `${icon('checkCircle', { size: 18 })} 已是最新版` : u.status === 'update' ? `有新版本 <b class="mono">${esc(u.latest)}</b> 可以更新` : '目前離線，連上網路後才能檢查';
    verStatus.style.color = u.status === 'latest' ? 'var(--ok)' : u.status === 'update' ? 'var(--accent)' : 'var(--muted)';
    verUpdate.classList.toggle('hidden', u.status !== 'update');
  };
  el.querySelector('#verCheck').onclick = runCheck;
  verUpdate.onclick = async () => {
    verUpdate.disabled = true;
    verUpdate.textContent = '更新中…';
    if (!(await applyUpdate())) {
      verUpdate.disabled = false;
      verUpdate.textContent = '再試一次';
      verStatus.textContent = '更新失敗，請稍後再試（需要穩定的網路）';
      verStatus.style.color = 'var(--danger)';
    }
  };
  runCheck();

  // 外觀：存在這支手機（localStorage），index.html 開頭會先套用
  const themeBtns = el.querySelectorAll('[data-theme-opt]');
  const currentTheme = () => document.documentElement.dataset.theme || 'auto';
  const markTheme = () => themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeOpt === currentTheme())));
  themeBtns.forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.themeOpt;
      if (t === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = t;
      try {
        t === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t);
      } catch {
        /* 私密瀏覽時存不了，只套用到這次 */
      }
      markTheme();
    };
  });
  markTheme();

}

