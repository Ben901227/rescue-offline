// Google 登入與 Drive 同步的預設值。兩者都不是機密：
// 實際能讀到哪些資料，完全由 Drive 資料夾的共用設定決定。
// 隊員也可以在 App 的「設定」頁覆寫。
export const GOOGLE = {
  // Google Cloud Console → API 和服務 → 憑證 → OAuth 用戶端 ID（網頁應用程式）
  clientId: '654601285785-9fop2ge46r1uisumpa2grbupsu2d30is.apps.googleusercontent.com',
  // 只分享給搜救人員的 Drive 資料夾 ID（網址 drive.google.com/drive/folders/<這一段>）
  folderId: '1dj9bft_SGt0UHLrBM5FrLzS9B7pubGXg',
};
