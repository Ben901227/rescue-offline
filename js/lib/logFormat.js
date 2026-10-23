// 使用記錄的文字格式（純函式，方便測試）。

export const LEVEL_LABEL = { info: '資訊', warn: '注意', error: '錯誤' };

const pad = (n) => String(n).padStart(2, '0');
export const fmtStamp = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const formatEntry = (e) => `${fmtStamp(e.t)} [${LEVEL_LABEL[e.level] || e.level}][${e.cat}] ${e.msg}${e.detail ? `｜${e.detail}` : ''}${e.ver ? ` (${e.ver})` : ''}`;

// 複製給資料組的完整文字：裝置資訊 + 由新到舊的記錄
export function formatReport(entries, info) {
  const head = [
    '搜救資訊 使用記錄',
    `App 版本：${info.version}`,
    `產生時間：${fmtStamp(info.now)}`,
    `裝置：${info.device}`,
    `從主畫面開啟：${info.standalone ? '是' : '否'}　網路：${info.online ? '連線' : '離線'}`,
    `記錄筆數：${entries.length}`,
    '----',
  ];
  return [...head, ...entries.map(formatEntry)].join('\n');
}

// 由 User-Agent 推出簡短的裝置描述，不含可識別個人的資訊
export function describeDevice(ua) {
  const os = /iPhone|iPad|iPod/.test(ua) ? `iOS ${(ua.match(/OS (\d+)[_.](\d+)/) || []).slice(1).join('.')}`.trim() : /Android (\d+(\.\d+)?)/.test(ua) ? `Android ${ua.match(/Android (\d+(\.\d+)?)/)[1]}` : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : '其他';
  const br = /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome' : /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '瀏覽器';
  return `${os} ${br}`;
}
