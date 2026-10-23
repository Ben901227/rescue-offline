import { esc, has, nl2br } from '../ui.js';
import { icon } from '../icons.js';
import { caseStatus } from '../lib/caseSchema.js';
import { wgs84ToTwd97 } from '../lib/twd97.js';

const telLink = (phone) => `<a class="btn small primary" href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">撥打</a>`;

function row(label, value) {
  return has(value) ? `<dt>${esc(label)}</dt><dd>${nl2br(value)}</dd>` : '';
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(+d)) return null;
  return Math.floor((Date.now() - d) / 86400000) + 1;
}

function statusCard(c) {
  const s = caseStatus(c);
  const found = s === '已尋獲';
  const day = daysSince(c.meta.reportDate);
  return `
    <section class="card ${found ? '' : 'accent'}">
      <div class="big-status">
        <span class="state ${found ? 'found' : 'active'}">${esc(s)}</span>
        ${!found && day ? `<span class="chip">搜索第 ${day} 天</span>` : ''}
      </div>
      <dl class="kv" style="margin-top:8px">
        ${row('案件', c.meta.title || c.meta.name)}
        ${row('通報日期', c.meta.reportDate)}
        ${row('地點', c.meta.location)}
        ${row('前進指揮所', c.meta.commandPost)}
        ${row('每日會議', c.meta.dailyMeeting)}
        ${row('資料更新', c.meta.updated)}
      </dl>
      ${has(c.meta.assembly) ? `<h3 style="margin-top:10px">集合與出發</h3><ul style="margin:4px 0 0;padding-left:18px">${c.meta.assembly.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

function foundCard(c) {
  const f = c.found;
  if (!f) return '';
  const t = f.lat != null ? wgs84ToTwd97(f.lat, f.lng) : null;
  return `
    <section class="card" style="border-color:var(--ok)">
      <h2>發現失聯者 <span class="chip ok">${esc(f.time || '')}</span></h2>
      <dl class="kv">
        ${f.lat != null ? `<dt>座標</dt><dd class="mono">${f.lat}, ${f.lng}<br>TWD97 ${Math.round(t.x)}, ${Math.round(t.y)}</dd>` : ''}
        ${row('距 IPP', f.distanceFromIpp)}
        ${row('狀況', f.condition)}
        ${row('經過', f.narrative)}
        ${row('紀錄', f.by)}
      </dl>
      ${f.lat != null ? `<div class="btn-row" style="margin-top:10px"><a class="btn small" href="#/map?focus=發現點">在地圖上看</a></div>` : ''}
    </section>`;
}

function subjectCard(c) {
  const s = c.subject;
  const head = [s.name, s.nickname && `（${s.nickname}）`].filter(Boolean).join('');
  const basics = [s.gender, s.age && `${s.age} 歲`, s.height && `${s.height} cm`, s.weight && `${s.weight} kg`].filter(Boolean).join('・');
  return `
    <section class="card">
      <h2>失聯者</h2>
      <p style="font-size:1.25rem;font-weight:700">${esc(head || '（未填）')}</p>
      ${basics ? `<p class="muted">${esc(basics)}</p>` : ''}
      ${has(c.clothing) ? `<h3 style="margin-top:10px">當天穿著</h3><div class="looks" style="margin-top:6px">${c.clothing.map((x) => `<span><b>${esc(x.item)}</b>${esc(x.desc)}</span>`).join('')}</div>` : ''}
      ${has(c.gear) ? `<h3 style="margin-top:10px">裝備</h3><div class="looks" style="margin-top:6px">${c.gear.map((x) => `<span><b>${esc(x.item)}</b>${esc(x.desc)}</span>`).join('')}</div>` : ''}
      <dl class="kv" style="margin-top:10px">
        ${row('髮型', s.hair)}
        ${row('疾病史', s.medical)}
        ${row('讀圖能力', s.mapReading)}
        ${row('行路風格', (s.styles || []).join('、'))}
        ${row('登山經歷', s.experience)}
        ${row('手機系統', s.phoneOS)}
        ${s.phone ? `<dt>手機</dt><dd class="mono">${esc(s.phone)}</dd>` : ''}
        ${(s.social || []).map((x) => `<dt>${esc(x.type)}</dt><dd>${/^https?:/.test(x.value) ? `<a href="${esc(x.value)}" target="_blank" rel="noopener">${esc(x.value.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : esc(x.value)}</dd>`).join('')}
      </dl>
      ${has(s.notes) ? `<h3 style="margin:12px 0 6px">質性分析</h3>${s.notes.map((n) => `<div class="quote">${esc(n.text)}<cite>— ${esc(n.source)}</cite></div>`).join('')}` : ''}
    </section>`;
}

function ippCard(c) {
  const i = c.ipp;
  if (!has(i.lastSeen) && !has(i.likelyArea)) return '';
  return `
    <section class="card">
      <h2>最後已知點（IPP）</h2>
      <dl class="kv">
        ${row('最後目擊', i.lastSeen)}
        ${row('最可能地點', i.likelyArea)}
        ${row('最後交談', i.lastContact)}
      </dl>
    </section>`;
}

function contactsCard(c) {
  const people = [
    ...(c.ipp.contacts || []),
    c.reporter?.phone ? { name: `${c.reporter.name || '通報人'}（${c.reporter.relation || ''}）`, phone: c.reporter.phone } : null,
    ...(c.area.localContacts || []),
  ].filter((p) => p && p.phone);
  if (!people.length) return '';
  return `
    <section class="card">
      <h2>聯絡窗口</h2>
      ${people.map((p) => `<div class="tel"><div><b>${esc(p.name)}</b>${p.note ? `<br><span class="muted small">${esc(p.note)}</span>` : ''}<br><span class="mono">${esc(p.phone)}</span></div>${telLink(p.phone)}</div>`).join('')}
    </section>`;
}

function timelineCard(c) {
  const items = [
    ...c.itinerary.map((d) => ({ cls: 'plan', when: `${d.day} ${d.date}`, tag: '原定行程', body: `<p>${esc(d.plan)}</p>` })),
    ...c.log.map((l) => ({
      cls: 'search',
      when: l.date,
      tag: '搜救紀錄',
      body: `${l.personnel ? `<p class="muted small">出勤：${esc(l.personnel)}</p>` : ''}<ul>${(l.entries || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>${l.meeting ? `<p class="small" style="margin-top:4px"><b>晚會：</b>${esc(l.meeting)}</p>` : ''}`,
    })),
  ];
  if (c.found?.time) items.push({ cls: 'found', when: c.found.time, tag: '尋獲', body: `<p>${esc(c.found.narrative || '')}</p>` });
  if (!items.length) return '';
  return `
    <section class="card">
      <h2>時間軸</h2>
      <ul class="timeline">
        ${items.map((it) => `<li class="${it.cls}"><div class="when">${esc(it.when)} <span class="chip ${it.cls === 'plan' ? 'muted' : it.cls === 'found' ? 'ok' : ''}">${it.tag}</span></div>${it.body}</li>`).join('')}
      </ul>
      ${c.retreatPlan ? `<details style="margin-top:10px"><summary>撤退計畫及隊伍其他資訊</summary><p>${nl2br(c.retreatPlan)}</p></details>` : ''}
    </section>`;
}

function areaCard(c) {
  const a = c.area;
  if (!has(a.signal) && !has(a.weather)) return '';
  return `
    <section class="card">
      <h2>案件所在地</h2>
      <dl class="kv">
        ${row('通訊', a.signal)}
        ${row('天氣', a.weather)}
      </dl>
    </section>`;
}

export function render(el, app) {
  const c = app.current;
  if (!c) return;
  el.innerHTML = `
    <div class="stack">
      ${c.meta.notice ? `<div class="banner" role="note">${icon('alert')}<span>${esc(c.meta.notice)}</span></div>` : ''}
      ${statusCard(c)}
      ${foundCard(c)}
      ${c.report ? `<section class="card"><h2>通報事由</h2><p>${nl2br(c.report)}</p></section>` : ''}
      ${subjectCard(c)}
      ${ippCard(c)}
      ${contactsCard(c)}
      ${timelineCard(c)}
      ${areaCard(c)}
      <div class="btn-row"><a class="btn" href="#/edit?id=${encodeURIComponent(c.id)}">編輯案件資料</a></div>
      <p class="muted small" style="text-align:center">資料來源：${esc(c.meta.source || '')}　更新：${esc(c.meta.updated || '')}</p>
    </div>`;
}
