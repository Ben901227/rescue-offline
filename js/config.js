// 雲端設定。這些值不是機密：能讀寫什麼，完全由 firestore.rules 與成員名單決定。
// 隊員端不需要也不能修改。

// Google 登入用的 OAuth 用戶端 ID（只要求 email 與基本資料）
export const GOOGLE_CLIENT_ID = '654601285785-9fop2ge46r1uisumpa2grbupsu2d30is.apps.googleusercontent.com';

// Firebase 網頁應用程式設定（Firebase 主控台 → 專案設定 → 你的應用程式）
export const FIREBASE = {
  apiKey: 'AIzaSyBGXLZgs5dZ7BKYkF1dGrBDcToD50TGi5k',
  authDomain: 'escue-offline-test.firebaseapp.com',
  projectId: 'escue-offline-test',
  storageBucket: 'escue-offline-test.firebasestorage.app',
  messagingSenderId: '654601285785',
  appId: '1:654601285785:web:d45faa958bb4e2fa0e8808',
};

// 第一位管理員（與 firestore.rules 的 OWNER 相同）
export const OWNER_EMAIL = 'ben901227@gmail.com';
