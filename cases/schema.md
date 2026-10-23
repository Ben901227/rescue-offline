# 案件 JSON 欄位說明

對應「東搜搜救紀錄 v1.1」範本。複製 `template.json` 填寫後，在 App「案件」頁匯入。
空白欄位不會顯示。**案件檔含個資，只在搜救人員間傳遞，不要放到公開網站。**

| 欄位 | 說明 |
| --- | --- |
| `id` | 案件代號，唯一，例如 `mudanyan-2026-10`（必填） |
| `meta.name` | 案件短名，顯示在頂部（必填） |
| `meta.title` / `team` / `reportDate`(YYYY-MM-DD) / `location` / `commandPost` / `dailyMeeting` / `updated` | 案件基本資料 |
| `meta.assembly` | 集合與出發時間，字串陣列 |
| `meta.status` | 選填，覆寫狀態；未填時有 `found` 即為「已尋獲」，否則「搜索中」 |
| `meta.notice` | 頂部提醒文字 |
| `report` | 通報事由（哪裡、何時、原因、如何發生） |
| `subject` | 失聯者：`name` `nickname` `gender` `age` `height` `weight` `hair` `medical` `phone` `phoneOS` `mapReading` `experience`；`styles` 行路風格陣列；`social` `[{type, value}]`；`notes` 質性分析 `[{source, text}]` |
| `reporter` | 通報人：`name` `relation` `phone` `line` |
| `clothing` | 當天穿著 `[{part, item, desc}]` |
| `gear` | 登山裝備 `[{item, desc}]` |
| `ipp` | 最後已知點：`lastSeen` `likelyArea` `lastContact`；`contacts` `[{name, phone, note}]`；`lat` `lng` |
| `itinerary` | 原定行程 `[{day, date, plan}]` |
| `retreatPlan` | 撤退計畫及隊伍其他資訊 |
| `area.signal` / `area.weather` | 訊號握手、天氣 |
| `area.localContacts` | 當地聯絡人 `[{name, phone, note}]` |
| `area.bbox` | 搜索範圍 `[[南緯度, 西經度], [北緯度, 東經度]]`，用於地圖初始畫面與離線下載 |
| `area.markers` | 地圖標記 `[{name, type, lat, lng, note}]`；`type` 可為 `ipp` `camp` `cp`(指揮所) `poi`；座標未知填 `null`，隊員可在地圖長按補上（只存本機） |
| `teams` | 任務分組 `[{date, name, members, area, channel, note}]` |
| `routes` | 搜救路線 `[{id, name, team, color, note, points: [[緯度, 經度], ...], updated}]`；在 App 地圖上規劃，離線也可畫，儲存時上傳 |
| `radio` | 無線電 `{public, team}` |
| `checklist` | 檢查清單 `[{group, items: ["項目", ...]}]` |
| `log` | 每日搜救紀錄 `[{date, personnel, entries: [...], meeting}]` |
| `found` | 發現失聯者 `{time, lat, lng, distanceFromIpp, condition, narrative, by}`；未尋獲填 `null` |
| `debrief` | 行後會議（保留欄位） |

座標一律用 WGS84 十進位（緯度, 經度）。手上只有 TWD97 時，可在 App「定位」頁的座標換算輸入 `X Y` 取得經緯度。
