// 管理頁（只有管理員）：成員名單、各手機的使用記錄、匯入案件 JSON。
// 真正的權限檢查在 firestore.rules；這裡只是不讓非管理員看到操作介面。
import { esc, toast, copyText, pickFile, sheet, closeSheet, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { state, isAdmin, listMembers, setMember, removeMember, listLogs, saveAndUpload } from '../cloud.js';
import { validateCase } from '../lib/caseSchema.js';
import { fmtStamp } from '../lib/logFormat.js';

const ROLE = { admin: '管理員', member: '隊員' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function render(el, app) {
  if (!state.user || !isAdmin()) {
    el.innerHTML = `<div class="card empty"><p>只有管理員可以使用這一頁。</p><a class="btn" href="#/settings">回一般設定</a></div>`;
    return;
  }
  const root = document.createElement('div');
  root.className = 'stack';
  el.append(root);
  root.innerHTML = `
    <h1 style="font-size:1.3rem">管理</h1>
    <section class="card">
      <h2>成員名單</h2>
      <p class="muted small">只有名單上的 Google 帳號能登入看到案件。移除後，對方的手機下次連線時就讀不到，並會清除手機上的雲端資料。</p>
      <form id="addForm" class="stack" style="margin-top:10px">
        <div class="fld"><label for="mEmail">Gmail</label><input type="text" id="mEmail" inputmode="email" autocomplete="off" placeholder="example@gmail.com"></div>
        <div class="fld"><label for="mName">名字（選填）</label><input type="text" id="mName" placeholder="例如：王小明"><small>只用來在這份名單上認出是誰，不影響登入與權限</small></div>
        <div class="seg" role="group" aria-label="角色">
          <button type="button" class="btn small" data-role="member" aria-pressed="true">隊員</button>
          <button type="button" class="btn small" data-role="admin" aria-pressed="false">管理員</button>
        </div>
        <button type="submit" class="btn primary">${icon('plus', { size: 18 })}加入成員</button>
      </form>
      <ul class="member-list" id="members" style="margin-top:12px"><li class="muted">讀取中…</li></ul>
    </section>
    <section class="card">
      <h2>使用記錄</h2>
      <p class="muted small">每支手機的記錄，連線時自動上傳（最多每 10 分鐘一次）。</p>
      <ul class="member-list" id="logs" style="margin-top:8px"><li class="muted">讀取中…</li></ul>
    </section>
    <section class="card">
      <h2>匯入案件 JSON</h2>
      <p class="muted small">把舊的案件檔（例如原本放在 Drive 的 JSON）搬進雲端。同代號的案件會被覆蓋。</p>
      <div class="btn-row" style="margin-top:10px"><button type="button" class="btn" id="importBtn">選擇 JSON 檔</button></div>
    </section>`;

  let role = 'member';
  root.querySelectorAll('[data-role]').forEach((b) => {
    b.onclick = () => {
      role = b.dataset.role;
      root.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    };
  });

  const drawMembers = async () => {
    const ul = root.querySelector('#members');
    try {
      const list = await listMembers();
      ul.innerHTML = list
        .map(
          (m) => `<li>
            <div style="flex:1;min-width:0"><b>${esc(m.name || m.email.split('@')[0])}</b> <span class="chip ${m.role === 'admin' ? 'warn' : 'muted'}">${ROLE[m.role] || m.role}</span>
              <br><span class="muted small mono">${esc(m.email)}</span></div>
            ${m.owner ? '<span class="muted small">第一位管理員</span>' : `<button type="button" class="btn small" data-act="role" data-email="${esc(m.email)}" data-role="${m.role}" data-name="${esc(m.name || '')}">${m.role === 'admin' ? '改成隊員' : '設為管理員'}</button>
              <button type="button" class="btn small danger" data-act="remove" data-email="${esc(m.email)}" aria-label="移除 ${esc(m.email)}">${icon('x')}</button>`}
          </li>`
        )
        .join('');
    } catch (e) {
      ul.innerHTML = `<li class="muted">讀不到成員名單：${esc(e.message)}</li>`;
    }
  };

  const drawLogs = async () => {
    const ul = root.querySelector('#logs');
    try {
      const logs = await listLogs();
      ul.innerHTML = logs.length
        ? logs
            .map(
              (l) => `<li><div style="flex:1;min-width:0"><b>${esc(l.account.split('@')[0])}</b> <span class="muted small">${esc(l.device || '')}</span>
                <br><span class="muted small">${esc(l.version || '')}・${l.updatedAt ? fmtStamp(l.updatedAt) : ''}・${(l.text.match(/\[錯誤\]/g) || []).length} 個錯誤</span></div>
                <button type="button" class="btn small" data-log="${esc(l.id)}">查看</button></li>`
            )
            .join('')
        : '<li class="muted">還沒有任何手機上傳記錄</li>';
      ul.onclick = (e) => {
        const id = e.target.closest('[data-log]')?.dataset.log;
        const l = logs.find((x) => x.id === id);
        if (!l) return;
        const s = sheet(`<h2>${esc(l.account)}</h2><p class="muted small">${esc(l.device)}・${esc(l.version)}</p>
          <pre class="log-text">${esc(l.text)}</pre>
          <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="cpLog">複製</button></div>`);
        s.querySelector('#cpLog').onclick = () => copyText(l.text);
      };
    } catch (e) {
      ul.innerHTML = `<li class="muted">讀不到使用記錄：${esc(e.message)}</li>`;
    }
  };

  root.querySelector('#addForm').onsubmit = async (e) => {
    e.preventDefault();
    const mail = root.querySelector('#mEmail').value.trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) return toast('請輸入正確的 email');
    try {
      await setMember(mail, { role, name: root.querySelector('#mName').value.trim() });
      root.querySelector('#mEmail').value = '';
      root.querySelector('#mName').value = '';
      toast(`已加入 ${mail}`);
      drawMembers();
    } catch (err) {
      toast(`加入失敗：${err.message}`, 5000);
    }
  };

  root.querySelector('#members').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const mail = b.dataset.email;
    try {
      if (b.dataset.act === 'remove') {
        if (!(await confirmBox(`把 ${mail} 移出成員名單？對方之後就看不到任何案件。`))) return;
        await removeMember(mail);
        toast('已移除');
      } else {
        await setMember(mail, { role: b.dataset.role === 'admin' ? 'member' : 'admin', name: b.dataset.name });
        toast('已更新角色');
      }
      drawMembers();
    } catch (err) {
      toast(`操作失敗：${err.message}`, 5000);
    }
  };

  root.querySelector('#importBtn').onclick = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('不是有效的 JSON');
    }
    const errors = validateCase(data);
    if (errors.length) return toast(errors.join('；'), 6000);
    if (!(await confirmBox(`匯入「${data.meta.name}」到雲端？全隊同步後都會看到。`))) return;
    const { _sync, ...clean } = data;
    const r = await saveAndUpload({ ...clean, routes: (clean.routes || []).map((x) => ({ ...x, id: x.id || `r${Math.random().toString(36).slice(2, 8)}` })) });
    toast(r.uploaded ? `已匯入「${data.meta.name}」` : r.reason, 5000);
    await app.reload();
  };

  drawMembers();
  drawLogs();
}

export function destroy() {
  closeSheet();
}
