# 握手範圍 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理員能在雲端案件中匯入 GDAL viewshed GeoTIFF、或在電腦瀏覽器用本機 DEM 計算基地台視域；所有握手資料聯集後以半透明紅色顯示在全隊手機地圖上，離線可看。

**Architecture:** 純函式放 `js/lib/`（`viewshed.js` 演算法、`mask.js` 遮罩格網與編解碼），可在 Node 測試。GeoTIFF 讀取與計算都在 module Web Worker（`js/handshakeWorker.js`）裡用 vendored geotiff.js 做，主執行緒只拿到裁切後的遮罩。`js/handshakes.js` 負責 Firestore 讀寫與 Worker 溝通；`js/handshakeLayer.js` 是 Leaflet GridLayer，逐像素 WGS84→TWD97 查遮罩；`js/views/map.js` 的「航跡與標記」面板加入口。

**Tech Stack:** Vanilla ES modules、Leaflet、Firebase Firestore 13.1.0（vendored）、geotiff.js 2.1.3（vendored UMD）、`node --test`、Firebase 模擬器。

**Spec:** [docs/superpowers/specs/2026-10-23-handshake-design.md](../specs/2026-10-23-handshake-design.md)

## Global Constraints

- 只支援 EPSG:3826（TWD97 TM2）GeoTIFF；其他直接拒絕，訊息：`只支援 TWD97 TM2（EPSG:3826）的 GeoTIFF`。
- 計算預設參數：觀測者高 1 m、目標高 1 m、最大距離 30 km；曲率係數 0.85714、地球直徑 12,741,994 m。
- 顯示顏色 `rgba(255,0,0,156/255)`；多筆一律聯集，聯集只在顯示時算，不另存。
- 只有管理員能建立／刪除握手資料；不允許 update；遮罩 bytes ≤ 700 KB。
- 只在手機的案件（`c._sync?.source !== 'cloud'`）不提供，顯示 `上傳到雲端後才能使用握手範圍`。
- geotiff.js 只在匯入／計算時（Worker 內）載入，不在 App 啟動路徑上。
- 測試資料（`~/Downloads/握手測試資料/*`）與真實座標**不得**進 repo、測試、文件、commit 訊息。
- 使用者規矩：每個看得到的改動要同步更新 `guide.html`；**先在 localhost 驗證、等使用者確認才 commit／push／部署**（本計畫各 task 不 commit，最後一個 task 統一處理）。
- 改任何 App 檔案要升版：`js/version.js` 的 `APP_VERSION`／`APP_DATE` 與 `sw.js` 的 `VERSION` 一致（`tests/version.test.mjs` 會檢查）。

## Review Focus

1. **非 20 m 格距或格網原點不同的 TIFF**（例如 10 m DEM 算出的）：遮罩要照檔案自己的格距與原點顯示在正確位置 → Task 2 加 10 m 測試。
2. **基地台靠近 DEM 邊緣**，30 km 視窗會被裁到 DEM 範圍內：仍要算得出來，觀測點在視窗內的位置要對 → Task 1 觀測點在角落的測試、Task 3 視窗裁切。
3. **算出／匯入的遮罩全部看不到**：不能存一筆空資料，要提示 `範圍內沒有看得到的格子` → Task 2 `cropMask` 回傳 `null` 的測試。
4. **隊員（非管理員）**：看不到匯入／計算／刪除按鈕，伺服器也要擋 → Task 3 rules 測試、Task 4 UI 檢查。
5. **手機離線開地圖**：已同步過的握手範圍要照樣畫出來（Firestore 離線快取）→ Task 5 手動驗證步驟。

---

### Task 1: Viewshed 演算法

**Files:**
- Create: `js/lib/viewshed.js`
- Create: `tools/compare-viewshed.mjs`
- Modify: `package.json`（devDependencies 加 `"geotiff": "2.1.3"`）
- Test: `tests/viewshed.test.mjs`

**Interfaces:**
- Produces: `viewshed(dem: Float32Array|Float64Array, w: number, h: number, ox: number, oy: number, opts?: { cell?: number = 20, observerHeight?: number = 1, targetHeight?: number = 1, maxDistance?: number = 30000, curvCoeff?: number = 0.85714 }) -> Uint8Array`（長度 w*h，1 = 看得到；觀測點本身 1；超過 maxDistance 一律 0）。`ox, oy` 是觀測格在 `dem` 中的欄、列（整數）。不修改輸入的 `dem`。
- Produces: `export const VIEWSHED_DEFAULTS = { observerHeight: 1, targetHeight: 1, maxDistance: 30000 }`。

- [ ] **Step 1: 寫失敗的測試** `tests/viewshed.test.mjs`（合成 DEM，不用真實資料）

```js
test('平地：近處看得到，地球曲率讓遠處看不到', () => {
  // 1001×1001、全 0、20 m，觀測點在中心；視距約 2×√(2·(D/2/0.85714)·1) ≈ 7.7 km
  const v = viewshed(new Float32Array(1001 * 1001), 1001, 1001, 500, 500);
  assert.equal(at(v, 500 + 250, 500), 1); // 5 km
  assert.equal(at(v, 500 + 450, 500), 0); // 9 km
  assert.equal(at(v, 500, 500), 1);
});
test('牆後面看不到、牆本身看得到', () => {
  // 201×201 全 0，x = 120 那一欄高 100 m，觀測點 (100,100)
  assert.equal(at(v, 120, 100), 1);
  assert.equal(at(v, 140, 100), 0);
  assert.equal(at(v, 80, 100), 1);
});
test('超過 maxDistance 一律看不到', () => {
  // 201×201 全 0、maxDistance 1000 → (100+40,100) 看得到、(100+60,100) 看不到
});
test('觀測點在角落也能算', () => {
  // 101×101 全 0、觀測點 (0,0) → (50,50) 看得到，回傳長度 101*101
});
test('不修改輸入 dem', () => { /* 算完後 dem 每格仍為原值 */ });
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node --test tests/viewshed.test.mjs`
Expected: FAIL（找不到 `../js/lib/viewshed.js`）

- [ ] **Step 3: 實作 `viewshed()`**（GDAL viewshed 演算法；這段測試決定不了，照抄邏輯）

```js
// 1) z = dem 複本，每格減掉 curvCoeff * r² / 12741994（r 為到觀測點的水平距離，公尺）
// 2) zo = dem[oy*w+ox] + observerHeight；vis[觀測點] = 1
// 3) set(i, horizon): vis[i] = z[i] + targetHeight < horizon ? 0 : 1；if (z[i] < horizon) z[i] = horizon
//    line(i, Za)          = i === 1 ? Za : (Za - zo) / (i - 1) * i + zo
//    edge(i, j, Za, Zb)   = i === j ? line(i, Za) : ((Za - zo) * i + (Zb - zo) * (j - i)) / (j - 1) + zo
// 4) 觀測列：往右 x = ox+1..w-1 用 line(x-ox, z[同列 x-1])；往左對稱
// 5) 其他列由觀測列往上、往下逐列處理（p = 上一處理列，靠近觀測點；c = 本列；ny = |y-oy|）：
//    中心欄：set(c+ox, line(ny, z[p+ox]))
//    往左、往右（sd = ±1，nx = |x-ox|）：
//      nx === ny ? (nx === 1 ? z[p+x-sd] : line(nx, z[p+x-sd]))
//      nx >  ny ? edge(ny, nx, z[p+x-sd], z[c+x-sd])   // 斜向鄰格、同列鄰格
//      nx <  ny ? edge(nx, ny, z[p+x-sd], z[p+x])      // 斜向鄰格、上一列同欄
// 6) r > maxDistance 的格子設 0
```

- [ ] **Step 4: 執行，確認通過**

Run: `node --test tests/viewshed.test.mjs`
Expected: 5 tests PASS

- [ ] **Step 5: 寫本機比對工具 `tools/compare-viewshed.mjs`**

用法：`node tools/compare-viewshed.mjs <DEM.tif> <GIS結果.tif> <lat> <lng>`。用 Node 版 `geotiff`（`npm i` 後）讀 GIS 結果的範圍與遮罩（alpha > 0 或單波段 > 0），從 DEM 讀同一個視窗，用 `wgs84ToTwd97` 找觀測格，跑 `viewshed()`，印出 `IoU`、兩邊格數與差異格數。檔頭註解寫明：資料不進 repo。

- [ ] **Step 6: 用測試資料驗證與 GDAL 一致**

Run: `npm i && node tools/compare-viewshed.mjs ~/Downloads/握手測試資料/TW20m_2022-06_twd97.tif <握手結果.tif> <基地台緯度> <基地台經度>`（座標向使用者要或看 session 紀錄，不寫進任何檔案）
Expected: `IoU` ≥ 0.98（評估時為 0.9852）

---

### Task 2: 遮罩格網與編解碼

**Files:**
- Create: `js/lib/mask.js`
- Test: `tests/mask.test.mjs`

**Interfaces:**
- Produces（`Grid` = `{ x0: number, y0: number, cell: number, w: number, h: number }`，x0/y0 為 TWD97 左上角**格邊**座標，公尺；`bits` 為 row-major、左上起，第 i 格在 `bits[i >> 3]` 的 `1 << (i & 7)`）:
  - `tiffToMask({ width, height, samplesPerPixel, data, origin: [x, y], resolution: [rx, ry], epsg, nodata = null }) -> { mask: Uint8Array, grid: Grid, center: { x, y } }`。`data` 為 interleaved；RGBA（spp 4）用 alpha > 0，單波段用 `value > 0 && value !== nodata`；`epsg !== 3826` 丟 `Error('只支援 TWD97 TM2（EPSG:3826）的 GeoTIFF')`；`cell = Math.abs(rx)`；`center` 是整張圖（裁切前）的中心 TWD97 座標。
  - `cropMask(mask: Uint8Array, grid: Grid) -> { grid: Grid, bits: Uint8Array } | null`：裁到有值的最小外框並打包成 bitset；全空回傳 `null`。
  - `encodeBits(bits: Uint8Array) -> Promise<Uint8Array>` / `decodeBits(bytes: Uint8Array) -> Promise<Uint8Array>`：`CompressionStream('deflate')`。
  - `maskAt(m: { grid: Grid, bits: Uint8Array }, x: number, y: number) -> boolean`：TWD97 座標落在哪一格、該格是否有值；超出範圍 false。

- [ ] **Step 1: 寫失敗的測試**

```js
test('RGBA：alpha > 0 才算看得到，center 為整張圖中心', () => {
  // 3×2 RGBA，只有 (1,0) alpha 156；origin [1000, 5000]、resolution [20, -20]、epsg 3826
  // → mask = [0,1,0,0,0,0]、grid { x0:1000, y0:5000, cell:20, w:3, h:2 }、center { x:1030, y:4980 }
});
test('單波段：>0 且不是 nodata', () => { /* data [0,255,-999,255]、nodata -999 → [0,1,0,1] */ });
test('不是 EPSG:3826 會拒絕', () => { assert.throws(() => tiffToMask({ ...t, epsg: 4326 }), /EPSG:3826/); });
test('cropMask 裁到最小外框，10 m 格距也正確', () => {
  // 5×5、cell 10、x0 2000、y0 9000，只有 (2,1)、(3,3) 有值
  // → grid { x0:2020, y0:8990, cell:10, w:2, h:3 }，maskAt(… , 2025, 8985) true、maskAt(…, 2035, 8985) false
});
test('全空回傳 null', () => { assert.equal(cropMask(new Uint8Array(9), g3x3), null); });
test('encodeBits/decodeBits 來回一致，且有壓縮', async () => { /* 125000 bytes 稀疏 → 壓縮後 < 2000、解回相同 */ });
test('maskAt 超出範圍為 false', () => {});
```

- [ ] **Step 2: 執行，確認失敗**

Run: `node --test tests/mask.test.mjs`
Expected: FAIL（找不到 `../js/lib/mask.js`）

- [ ] **Step 3: 實作 `js/lib/mask.js` 的五個函式**

- [ ] **Step 4: 執行全部測試**

Run: `npm test`
Expected: 全部 PASS

---

### Task 3: 資料層：geotiff、Worker、Firestore、權限規則

**Files:**
- Create: `vendor/geotiff/geotiff.js`（複製 `node_modules/geotiff/dist-browser/geotiff.js`，2.1.3）、`vendor/geotiff/README.txt`（版本、MIT、來源）
- Create: `js/handshakeWorker.js`（module worker）
- Create: `js/handshakes.js`
- Modify: `firestore.rules`（`match /cases/{caseId}` 內加 `handshakes`）
- Test: `rules-tests/firestore.test.mjs`

**Interfaces:**
- Consumes: `viewshed`, `VIEWSHED_DEFAULTS`（Task 1）；`tiffToMask`, `cropMask`, `encodeBits`, `decodeBits`（Task 2）；`wgs84ToTwd97`, `twd97ToWgs84`（`js/lib/twd97.js`）。
- Worker 協定（`new Worker(new URL('./handshakeWorker.js', import.meta.url), { type: 'module' })`；Worker 以 `import '../vendor/geotiff/geotiff.js'` 取得 `globalThis.GeoTIFF`）：
  - in `{ type: 'import', file: File }` → out `{ type: 'done', grid, bits, center }` 或 `{ type: 'error', message }`
  - in `{ type: 'compute', file: File, station: { x, y }, params: { observerHeight, targetHeight, maxDistance } }` → `{ type: 'progress', text }`（讀檔中／計算中）… → `{ type: 'done', grid, bits }` 或 `{ type: 'error', message }`
  - compute 只讀以基地台為中心、半徑 `maxDistance / cell` 格、並裁到 DEM 範圍內的視窗；基地台在 DEM 外或落在 nodata 上回 error（`基地台不在 DEM 範圍內`／`基地台位置沒有高程資料`）；結果全空回 error `範圍內沒有看得到的格子`。
- Produces（`js/handshakes.js`）：
  - `type Handshake = { id, name, source: 'import'|'compute', station: { lat, lng } | null, params: {observerHeight,targetHeight,maxDistance} | null, grid: Grid, bits: Uint8Array, by, created }`
  - `listenHandshakes(caseId: string, cb: (list: Handshake[]) => void) -> () => void`（`onSnapshot` on `cases/{caseId}/handshakes`，依 `created` 排序，`bits` 已 decode）
  - `addHandshake(caseId, { name, source, station, params, grid, bits }) -> Promise<void>`（存 `mask: Bytes.fromUint8Array(await encodeBits(bits))`、`grid`、`by: email()`、`created: ISO`；id 用 `h${Date.now().toString(36)}…`，比照 photos；離線不等伺服器）
  - `deleteHandshake(caseId, id) -> Promise<void>`
  - `readTiff(file: File) -> Promise<{ grid, bits, center: { lat, lng } }>`、`computeFromDem(file: File, station: { lat, lng }, params, onProgress: (text) => void) -> Promise<{ grid, bits }>`（各開一個 Worker，完成後 terminate）

- [ ] **Step 1: 寫失敗的 rules 測試**（`beforeEach` 不需改；新增一個 test）

```js
test('握手範圍：成員可讀，只有管理員能新增／刪除，不能修改', async () => {
  const data = (by, n = 10) => ({ name: '台A', source: 'import', grid: { x0: 0, y0: 0, cell: 20, w: 1, h: 1 }, mask: bytes(n), by, created: 'x' });
  const ref = (who, id = 'h1') => doc(as(who), 'cases', 'c1', 'handshakes', id);
  await assertFails(setDoc(ref(MEMBER), data(MEMBER)));
  await assertSucceeds(setDoc(ref(ADMIN), data(ADMIN)));
  await assertSucceeds(getDoc(ref(MEMBER)));
  await assertFails(getDoc(ref(STRANGER)));
  await assertFails(setDoc(ref(ADMIN, 'h2'), data(MEMBER)));            // by 不是自己
  await assertFails(setDoc(ref(ADMIN, 'h3'), data(ADMIN, 701 * 1024))); // 超過 700 KB
  await assertFails(setDoc(ref(ADMIN), { ...data(ADMIN), name: '改名' })); // 不能 update
  await assertFails(deleteDoc(ref(MEMBER)));
  await assertSucceeds(deleteDoc(ref(ADMIN)));
});
```

- [ ] **Step 2: 執行，確認失敗**

Run: `npm run test:rules`
Expected: 新測試 FAIL（`assertSucceeds` 被拒）

- [ ] **Step 3: 在 `firestore.rules` 加規則**

`match /handshakes/{hid}`：`read: isMember()`；`create: isAdmin() && mask is bytes && mask.size() <= 700 * 1024 && by == myEmail() && name is string`；`update: false`；`delete: isAdmin()`。上方加一行中文註解，風格同 photos。

- [ ] **Step 4: 執行，確認通過**

Run: `npm run test:rules`
Expected: 全部 PASS

- [ ] **Step 5: vendor geotiff、實作 Worker 與 `js/handshakes.js`**

Worker 用 `GeoTIFF.fromBlob(file)`、`image.getGeoKeys().ProjectedCSTypeGeoKey` 取 epsg、`image.fileDirectory.GDAL_NODATA` 取 nodata（去掉尾端 `\0` 後 `Number`）、`readRasters({ window, interleave: true })`。

- [ ] **Step 6: 在瀏覽器確認 Worker 能載入**

`npm run serve`，在 http://localhost:5173 的 console 動態 `import('./js/handshakes.js')`，對測試 TIFF 呼叫 `readTiff`（透過 `<input type=file>`）。Expected: 回傳 `grid.cell === 20`、`center` 在基地台附近（誤差 < 30 m）、`bits.length` > 0。

---

### Task 4: 地圖顯示與操作介面

**Files:**
- Create: `js/handshakeLayer.js`
- Modify: `js/views/map.js`（render 內：圖層、基地台標記、`#layersBtn` 面板新區塊、匯入與計算面板、`destroy()` 取消監聽）
- Modify: `css/app.css`（`.pin.station`）

**Interfaces:**
- Consumes: `listenHandshakes`, `addHandshake`, `deleteHandshake`, `readTiff`, `computeFromDem`（Task 3）；`maskAt`（Task 2）；`VIEWSHED_DEFAULTS`（Task 1）；`parseCoordinate`, `wgs84ToTwd97`, `twd97ToWgs84`；`isAdmin`, `state`（`js/cloud.js`）；`sheet`, `closeSheet`, `pickFile`, `confirmBox`, `toast`, `esc`（`js/ui.js`）。
- Produces: `createHandshakeLayer() -> L.GridLayer & { setMasks(list: Array<{ grid, bits }>): void }`。每個圖磚 canvas 逐像素：圖磚像素 → `map.unproject` 得 WGS84 → `wgs84ToTwd97` → 任一 `maskAt` 為 true 就畫 `rgba(255,0,0,156/255)`；圖磚範圍和所有遮罩外框都不相交時直接回空白圖磚；`setMasks` 後 `redraw()`。

UI（文案照寫）：
- 「航跡與標記」面板在「圖例」之前加 `<h3>握手範圍</h3>`：
  - 只在手機的案件：`<p class="muted small">上傳到雲端後才能使用握手範圍</p>`，其他都不顯示。
  - 開關 checkbox `顯示握手範圍（聯集）`，狀態存 `pref`（key `handshake`，預設開）。
  - 每筆：名稱、`匯入`／`計算`、建立者帳號前綴與時間；管理員多一個 `刪除`（`confirmBox('刪除這筆握手範圍？全隊都會移除')`）。沒有資料時 `尚無握手資料`。
  - 管理員：按鈕 `匯入 TIFF`、`計算`。
- 匯入面板：選檔（`.tif,.tiff`）→ `readTiff` → 表單：名稱（預設檔名去副檔名）、基地台座標（預填中心點 `lat.toFixed(6), lng.toFixed(6)`，可清空；不可解析時 toast `座標格式看不懂`）→ `儲存並上傳`。
- 計算面板：名稱、基地台座標（必填）、觀測者高度 m、目標高度 m、最大距離 km（預設 1／1／30）、`選擇 DEM 檔`（顯示檔名）→ `計算並上傳`；進行中顯示 `onProgress` 文字並停用按鈕；錯誤以 toast 顯示 Worker 的 message 並 `log.warn('握手範圍', …)`。
- 有 `station` 的資料畫 `pin station` 標記，popup：名稱＋`coordText`。
- 儲存成功 toast `已上傳，全隊會自動收到`；離線 toast `目前離線，已存在手機，連線後會自動上傳`。

- [ ] **Step 1: 實作 `js/handshakeLayer.js`、map.js 接線、`.pin.station` 樣式**
- [ ] **Step 2: localhost 驗證匯入**：管理員帳號匯入測試 TIFF → 紅色範圍與 GIS 截圖（簡報第 3 頁）形狀一致；切換底圖、縮放 11–17 位置不偏；基地台標記在中心。
- [ ] **Step 3: localhost 驗證計算**：用同一基地台座標與全台 DEM 計算 → 新增第二筆，聯集後形狀與匯入的幾乎重疊；計算中有進度文字、按鈕停用。
- [ ] **Step 4: 驗證權限與邊界**：隊員帳號看不到 `匯入 TIFF`／`計算`／`刪除`；只在手機的案件顯示提示文字；基地台座標填在 DEM 範圍外 → toast `基地台不在 DEM 範圍內`；選一個非 3826 的 TIFF → toast 拒絕訊息。
- [ ] **Step 5: `npm test`** Expected: 全部 PASS

---

### Task 5: 文件、版本、離線快取、交付

**Files:**
- Modify: `guide.html`（新增「握手範圍」一節：是什麼、隊員怎麼看與開關、管理員怎麼匯入 TIFF、怎麼在電腦上算、DEM 檔哪裡來、只限雲端案件）
- Modify: `README.md`（資料結構加 `cases/{id}/handshakes/{id}`；權限加「只有管理員能新增／刪除握手範圍」；新增「握手範圍」段落，含 `tools/compare-viewshed.mjs` 用法）
- Modify: `sw.js`（`SHELL` 加 `js/lib/viewshed.js`、`js/lib/mask.js`、`js/handshakes.js`、`js/handshakeWorker.js`、`js/handshakeLayer.js`、`vendor/geotiff/geotiff.js`；`VERSION` 升版）
- Modify: `js/version.js`（`APP_VERSION` 同步升版、`APP_DATE` 改當天）
- Modify: `docs/handshake-integration.md`（結論改為已採用方案，指向 spec 與本計畫）

- [ ] **Step 1: 改上述檔案**
- [ ] **Step 2: `npm test` 與 `npm run test:rules`** Expected: 全部 PASS
- [ ] **Step 3: 離線驗證**：localhost 開地圖讓握手範圍同步 → DevTools 切 Offline 重新整理 → 握手範圍與基地台標記仍出現；`guide.html` 新章節可開。
- [ ] **Step 4: 給使用者看 localhost 結果（截圖）並等確認**，不得自行 commit。
- [ ] **Step 5: 使用者同意後 commit**（不含 `docs/superpowers/` 以外的測試資料；確認 `git status` 沒有 .tif）

```bash
git add js css firestore.rules rules-tests tests tools vendor/geotiff sw.js guide.html README.md package.json package-lock.json docs
git commit -m "Handshake range: import GeoTIFF or compute viewshed in app (v0.0.xx)"
```

- [ ] **Step 6: 使用者同意後才部署規則** `npx firebase deploy --only firestore:rules`，push 由使用者決定。
