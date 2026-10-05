## 2026-10-05 通知顯示家長稱呼、點開就算已讀（`feature/admin-notify-names-20261005`）

站內通知頁上線後，使用者對兩個待裁定項目回覆：「點進案件時要不要自動標記已讀：要」「通知要不要顯示家長姓名：要，LINE 的通知也要出現」。規則見 DESIGN.md「通知顯示家長稱呼、點開就算已讀」。

- **後端**：`GET /admin/notifications` 與 `GET /admin/notification-outbox` 多回 `parent_name`（讀取時 join 案件，匿名化後為 null，不寫進 payload）；LINE 推播文字在校區後面加「家長：○○」（推播當下讀案件）。寄給園方的 Email 不變（照舊姓氏＋稱謂）。`contracts/` 重新產生。
- **後台**：通知標題後面接家長稱呼，寄送失敗清單也列出家長；點通知列打開案件時在背景標成已讀（權限照舊 booking.manage，櫃台點開不改），送不成功變回未讀。
- **待園方**：隱私權政策第 6 段要補 LINE（家長稱呼會推到 LINE 群組）。
- **驗證**（Node 22.23.2）：
  - 後端：整套 pytest 1533 passed、1 skipped（9 分 40 秒，獨立測試庫）；通知相關新增／改寫 5 項（站內通知與寄送失敗清單回 `parent_name`、匿名化後為 null 且不在 payload；LINE 推播有「家長：陳媽媽」不帶電話；案件匿名化後推播不帶家長；`line_text` 空白稱呼不出那一行）。`contract:check` 一致。
  - 後台：`vue-tsc -b` 通過；vitest 93 檔 1168 項全過。新增 3 項（家長稱呼、點開標記已讀與失敗復原、櫃台點開不標記），換回 main 版通知頁時前兩項會失敗。
  - 拋棄式測試庫 Playwright：校區管理者點開一則未讀，回到清單重新讀取後未讀 3→2；櫃台點開沒有送出標記、未讀不變；桌機與手機家長稱呼接在標題同一行。
  - stack e2e：75 項 74 過，失敗的是已知間歇的 `media.spec`（`home_about` 的 `payload.photo` 讀回 undefined），單獨重跑 3 項全過。API 準備階段同樣用暫時本機設定把等待放寬到 10 分鐘（沒有進版控）。
  - 合併 main（招生入學、側欄，沒動後端與契約）後：`vue-tsc -b`、`contract:check` 通過；vitest 94 檔 1228 項，8 項在 load 90 時 5 秒逾時（招生入學、內容編輯），負載降下來後單獨重跑 103 項全過；stack e2e 75 項全過。
  - 未驗證：真的 LINE 群組推播（測試用假 LINE 伺服器）、Safari／iOS 實機。

## 2026-10-05 招生入學 UI/UX：轉預繳不用回看板、手機可現場確認到場、數字口徑寫清楚（`feature/admissions-ux-20261005`，10-05 已部署 main `6e0fdf8`）

使用者要「看看招生入學這整個區塊怎麼優化 UI/UX」：對 origin/main 用拋棄式測試庫灌擬真資料（義華 25 筆、追蹤到期、名額超額、待確認到場），桌機 1440／手機 390 拍 56 張，評 25/40（第九輪全後台是 28）。使用者四個方向都選、裁定只做不和園務分歧的改法、手機做待追蹤／官網預約／明細三頁。規則見 DESIGN.md「招生入學 UI/UX」。

- **換階段的入口**：訪視明細每列「標記預繳」／「標記註冊」、歷程抽屜「移到…」，和看板共用確認框；確認鍵寫動作、退出標題寫來源、開啟後焦點進第一個欄位。看板加姓名搜尋。
- **打電話**：記錄聯絡抬頭帶家長、撥號、上次聯絡內容，停用時寫缺什麼；歷程抽屜摘要加聯絡人與電話。
- **手機**：頁首三個篩選收成一顆摘要鈕；官網預約、訪視明細改卡片（到了／沒來各半寬 44px）；明細卡片從約 1284px 提到約 397px。
- **官網預約跟上第九輪**：plain「到了／沒來」與案件列表同一個確認框（寫家長與場次）、參觀人數欄只在舊資料出現、日期今年省略年份；`formatSlotWhen` 的結束時間改選填。
- **減噪**：明細預設 9 欄（加階段、下次聯絡、負責人），其他收進展開列，篩選收進「更多篩選」＋標籤，1280／1440 都不橫捲；待追蹤 1280 不橫捲、「記錄聯絡」改 plain；待追蹤與官網預約停用學年學期並寫明；卡片學期 tag 改中性、hover 有回饋、「移到…」滑鼠裝置 hover 才出現。
- **數字口徑**：看板比率附分子分母與口徑說明（名稱與公式照園務）；統計參考月份移進總覽、四張卡下寫口徑、當月掛「進行中」、月比寫「個百分點」；名額在面板內切學期、合計補超額說明；未預繳明細的開關改成有字的勾選。
- **全站**：列表淺色主色鈕字色加深（約 4.45→5.4:1）；招生入學檔案的錯誤提示全改走 `notify.ts`，守門測試拿掉招生例外。
- **刻意沒改（會和園務分歧）**：比率改名或拿掉、「退費率」、預設分頁改待追蹤、退出欄改色、統計總覽合併重複區塊、月初不上紅。
- **驗證**（Node 22.23.2）：
  - admin：vitest 93 檔 1211 項通過、`vue-tsc -b` 通過、`vite build` 通過（e2e build）；合併 main（站內通知頁、側欄）後重跑 vitest、typecheck、stack 全套。
  - stack e2e（`E2E_DB_NAME=ivy_website_admux1005_e2e_test`、埠 8797／3797）：整套 75 項全過，含招生六個分頁的 axe、鍵盤、招生流程、參觀後追蹤、視覺基準。
  - 拋棄式測試庫畫面（Playwright，寫入請求全攔截）：明細與待追蹤表格 1280 寬 962/962、1440 寬 1122/1122 不橫捲；手機觸控裝置「移到…」顯示；記錄聯絡抬頭與上次內容、抽屜移到…、名額學期切換、統計參考月份位置逐張看過。
  - 沒動後端與 API 型別，沒跑 pytest、`contract:check`、`test:website`；未驗證 Safari／iOS 實機、正式站。

## 2026-10-05 官網後台側欄：標題分兩層、列高收緊、捲動提示、⌘K 搜尋（`feature/admin-sidebar-20261005`，commit `bf00586`，已合 main 待推）

使用者附正式站側欄截圖要「優化側欄的 UI/UX」。從 origin/main `23c6aa2` 開 worktree，拋棄式測試庫（`ivy_website_sidebar1005_test`，API 8761、admin 5311）拍桌機 1440／1280、手機 390 前後對照。規則見 DESIGN.md「官網後台側欄：層級、尺寸與鍵盤」。

- **層級**：第一層（參觀預約／官網內容／系統）統一成小字灰色標題、只用間距分開；第二層子組（首頁／各校／全站與素材）改成像一列選單，箭頭占圖示欄、子項目縮排並有一條細線，三種標題不再長得一樣，左緣對齊。
- **尺寸與捲動**：桌機列高 40→36px（手機維持 44），總管理者全展開 1482→1311px；選單上下緣加捲動陰影（純 CSS），看得出上面／下面還有項目。
- **圖示**：實心的 HomeFilled／Grid／TrendCharts／List 換成線條的 House／Film／PieChart／Memo；更改密碼鑰匙改鎖頭。
- **搜尋與鍵盤**：⌘K／Ctrl+K 跳到搜尋框（框內有提示）；搜尋時先標出 Enter 會開的那一筆；Esc 清除搜尋字；↓↑ 在搜尋框與選單間移動。收起但目前頁面在裡面的分組，標題用選取色。焦點框改往內縮，不再被捲動區裁掉。
- **驗證**（Node 22.23.2）：
  - admin：`vue-tsc -b` 與 `vite build` 通過；vitest 全套 93 檔 1158 過、4 項逾時（招生紀錄、案件列表，load average 33 時 5 秒逾時，單獨重跑兩檔 42 項全過，與側欄無關）；新增 `sidebarNav20261005.test.ts` 9 項（換回 main 的元件跑是 7 紅 2 綠，綠的兩項是「對話框開著／手機抽屜不搶 ⌘K」的反向檢查）；改完後掛到側欄或 nav.ts 的 22 檔 305 項再跑全過。`npx impeccable detect` 側欄 0 筆。
  - stack e2e（`E2E_DB_NAME=ivy_website_sidebar_e2e_test`、埠 8763／3763）：visual、keyboard、roles、a11y 共 46 項全過。視覺基準重拍 4 張後台頁（`--update-snapshots=all`；預設模式只會重寫超過 1% 的五校介紹，其他三張差異在門檻內但圖上仍是舊側欄），登入頁沒變；重拍後再跑 visual 6/6 過。
  - 拋棄式測試庫 Playwright 實按（桌機 1440）：⌘K 聚焦搜尋框、↓ 到營運總覽、再 ↓ 到參觀預約、↑↑ 回搜尋框；搜「素材」標出素材庫、Esc 清空、Enter 到 /media 且搜尋字清掉；更改密碼對話框開著時 ⌘K 焦點不動；收起目前所在的「全站與素材」後標題變選取色。console 無錯誤。
  - 沒動後端與 API 型別，沒跑 pytest 與 `contract:check`；未驗證 Safari／iOS 實機、Windows 的 Ctrl+K、正式站。

## 2026-10-05 官網後台站內通知頁 UI/UX（`feature/admin-notifications-20261005`，10-05 已部署 main `75caffa`）

使用者要「優化 /admin/notifications 的 UI/UX」。用拋棄式測試庫灌三校的預約、改期、取消、提醒、寄送失敗與一筆舊的改期申請，桌機 1440／1280、手機 390 各以總管理者、單校管理者、櫃台三種帳號看過。規則見 DESIGN.md「官網後台站內通知頁」。

- **版面順序**：待核准的改期申請 → 寄送失敗 → 通知清單。原本校區選單與「只看未讀」放在整頁最上面，看起來管整頁，實際只管最下面的清單；現在校區、「全部／未讀」頁籤（同案件列表的樣式）、全部標記已讀、重新整理都在清單自己的頂列。頁首不再有整排篩選卡與摘要列。
- **通知清單**：表格改成一則一列，依「今天／昨天／10/03（週五）」分組、列上只寫時間；種類有圖示色調（新預約綠、改期藍、即將參觀暖黃、逾期紅、取消灰）；整列點了就開案件，拿掉每列重複的「查看案件」。日期一律省略今年的年份。手機每則從約 215px 降到約 90px（灌的 16 則＋3 則失敗＋1 則改期，整頁 10580→6516px），標記已讀在手機只留 44px 打勾圖示。
- **單校帳號**：不出現校區選單（原本是一整張只有「校區 義華」的卡），寄送失敗與改期申請不列校區欄，通知副行不寫校名。
- **頁籤與校區寫進網址**（`?unread=1&campus=`）：點進案件再返回會回到剛才的未讀清單。
- **切回分頁超過 60 秒在背景更新**（同案件列表），不閃骨架；讀取中改骨架，讀取失敗在清單裡給重新載入。
- **全後台**：淺色主色鈕（「到了」「核准」「全部重新寄送」「複製密碼」等）的字改深一階，原本 4.4:1 被 axe 判對比不足；頁籤樣式從案件列表搬到 `style.css` 共用。
- **刻意沒改**：點進案件自動標記已讀（已讀是同校共用狀態，要業主決定）、通知顯示家長姓名（第七輪待裁定）、通知種類篩選。
- **驗證**（Node 22.23.2）：
  - admin：`vue-tsc -b`、`vite build` 通過；vitest 93 檔 1165 項，整套跑兩次各有 1–2 項是機器高負載（load 20–48）時的 5 秒逾時（招生紀錄 2 項、案件列表電話搜尋 1 項），單獨重跑都過；其餘全過。`notificationsUx.test.ts` 新增／改寫 8 項（日期分組、種類色調、網址保留頁籤與校區、單校不列校區、背景重讀、整列連結），換回舊版通知頁時這 8 項都會失敗；`permissionsUx`、`ux20261005` 各 1 項照新結構改寫。
  - 拋棄式測試庫（`ivy_website_notif1005_test`、API 8763、admin vite 5323）Playwright 實際操作 12 項：未讀頁籤 16→8、點通知進案件、返回仍在未讀（`?unread=1`）、單則標記已讀 8→7、全部校區「全部標記已讀」先確認、切義華只剩義華、鍵盤焦點框、讀取中骨架、讀取失敗、單校帳號無校區選單與校區欄、櫃台無標記鈕、手機標記鈕 44×44。
  - axe（WCAG 2.1 A／AA）：總管理者桌機、手機與櫃台手機都是 0 個違規（改之前「核准」「全部重新寄送」淺色鈕對比不足）。案件列表頁籤搬 CSS 後計算樣式不變（桌機 34px、手機 44px）。
  - stack e2e（`E2E_DB_NAME=ivy_website_notif_e2e_test`、埠 8771／3771）：75 項全過，含視覺基準 6 張與 a11y（淺色主色鈕變色沒有讓基準超過門檻）。第一次跑時機器負載 20 以上，API 準備的 `initialize-content` 超過 180 秒被砍；用暫時的本機設定把等待放寬到 10 分鐘重跑才起來（設定檔沒有進版控）。
  - 沒動後端與 API 型別，沒跑 pytest 與 `contract:check`；未驗證 Safari／iOS 實機。

## 2026-10-05 官網後台第九輪 UI/UX：接待少點幾下、說明收起來、字級 token（`feature/admin-ux9-20261005`，10-05 已部署 main `5404854`）

使用者要「看看後台 UI/UX 還有哪裡可以優化，先給方向」：對 origin/main 用拋棄式測試庫灌資料，桌機 1440、手機 390 各拍 31 頁，加自動偵測與歷輪定案對照，評 28/40（09-29 是 26/40），給了四個方向；使用者說「都幫我處理」。規則見 DESIGN.md「官網後台第九輪 UX」。

- **接待**：案件列表與總覽「今天的參觀」名單，場次開始後直接有「到了／沒來」（先確認，寫出家長與場次；招生入學開著時講明會建立招生訪視）。案件明細的改期一律先收成連結、說明改白話；手機明細改成撥號 → 處理 → 聯絡紀錄 → 家長資料（聯絡紀錄從約 1300px 提到約 650px）。
- **篩選**：桌機也收進「更多篩選」，已套用的條件列成可以逐一拿掉的標籤（從總覽點進來也看得到套了什麼）；分頁數字改中性灰（只有舊需求「待處理」暖黃）；面板標題寫目前看哪一組；1280 寬表格原本橫捲 30px，收欄寬後不捲、參觀時間不折行。
- **減噪**：天天用的 8 個頁面頁首說明只留一句，其餘收進「說明」展開；明細不再固定列出官網已不問的參觀人數／想了解的事／同意紀錄（有值的舊資料照列）；總覽「新需求待聯絡」「待園方確認」有數字才出現（第七輪待裁定，使用者交由我決定）；招生看板拿掉和欄標題重複的數字列，欄標題對齊。
- **內容編輯**：有修改時狀態列給「存草稿並預覽 ↗」（點擊當下開分頁、存好才換成預覽頁，存不成功就關掉）。寬螢幕右側嵌即時預覽要動 web 的 `/preview`，這輪沒做。
- **視覺系統**：字級收成 `style.css` 十級 token（12–28，285 處 px 換掉；11→12、17→18、26→24），彩色側條（招生卡片、月曆有預約的色塊）改細框或拿掉，統計長條拿掉 `transition: width`；`ux20261005.test.ts` 守門。使用者列表的「停用帳號」「解除綁定並登出」收進每列「更多」，發布紀錄的「整站還原到這次」改成靠右灰色文字鈕；場次頁「自己設定」按鈕對齊。
- **刻意沒改**：案件明細「頂欄＋返回連結＋家長姓名」三層（返回連結帶著列表篩選，拿掉反而難用）；各校預約方式頁一次看五校狀態（不在這輪四個方向內）。
- **驗證**（Node 22.23.2）：
  - admin：`vue-tsc -b` 與 `vite build` 通過；vitest 93 檔 1160 項通過（新增 `ux20261005.test.ts` 29 項，含字級、側條、layout 動畫三條守門；9 項舊測試照新規則改寫）。`npx impeccable detect admin/src` 從 6 筆降到 2 筆，剩下兩筆是評析時判定的誤報（章節導覽灰軌、用邊框畫的展開三角形）。
  - stack e2e（`E2E_DB_NAME=ivy_website_ux9_e2e_test`、埠 8797／3797）：整套 71 過 2 敗，敗的是視覺基準「案件明細」（預期中的改動）與它連帶的「各校預約方式」（worker 重啟後 `beforeAll` 用同一個識別碼重送預約被擋）。重拍 `visit-detail`、`users` 兩張基準（舊的案件明細基準本來就過時：側欄還寫「分校頁」、有 10-03 已拿掉的參觀人數），再跑 `visual` 6 項全過；a11y（axe）、鍵盤、角色、接待、招生流程都過。
  - 拋棄式測試庫實際操作（Playwright，桌機 1440／1280、手機 390 櫃台帳號）：列表 3 列「到了／沒來」、按下確認後剩 2 列；1280 寬表格不再橫捲、參觀時間不折行；手機明細聯絡紀錄在 653px、家長資料在 901px；手機套用篩選時搜尋框維持 218px；「存草稿並預覽」點擊當下開分頁並導到預覽網址。
  - 沒動後端與 API 型別，沒跑 pytest 與 `contract:check`；未驗證 Safari／iOS 實機、正式站。

## 2026-10-05 效能第四輪：官網字型與圖片、後台按需引入、後端熱路徑、CI 平行（`feature/perf-20261005`，10-05 已部署 main `bcf6005`）

使用者問「專案在效能上有哪裡可以優化」，看完盤點後說「都幫我處理」。規則見 DESIGN.md「效能第四輪」；量測腳本與數字在 `output/playwright/perf-audit-20261005/`（擋非 GET，不寫正式站統計）。

- **官網字型**：LINE Seed 分片改依各頁用字分組（`scripts/page-font-chars.cjs` 從正式站收集 → `scripts/subset-critical-fonts.py` 的 `cluster()`）。每頁 LINE Seed 下載量（同一份用字）：首頁 184→50 KB、/about 387→48、/curriculum 417→59、/admission 336→60、/anniversary 525→72、/news 254→39、/visit 171→36。
- **官網圖片**：響應式圖片預設補 1600w（30 張，`--only` 更新）；預約頁校區卡在 DPR ≥ 2.5 手機挑 800w；30 週年時間軸貼圖改成線頭快走到才逐張載（桌機前 6 秒圖片 2680→1528 KB）；刪 9 支沒被引用的舊雜湊影片（約 28 MB），影片產生器之後自己清。
- **後台**：Element Plus 元件 JS 改按需引入（`unplugin-vue-components`，只解析 Element Plus、不產生 d.ts，型別狀態與原本相同）。入口 JS 849→159 KB（brotli 218→約 49 KB）。**樣式維持整包、在 `style.css` 之前載入**：先試過連樣式一起按需（CSS brotli 42→8.6 KB），元件 CSS 跟著各頁 chunk 晚到、同權重蓋掉 `style.css` 的覆寫，stack 視覺基準三頁差 2–4%（表格列高、輸入框邊框），改回後 CSS 檔與正式站同一個雜湊。
- **後端**：`/public/site` 程序內快取（讀取時用 release／停用分校／台北日期＋素材指紋判斷，命中只付兩個輕量查詢，本文與 ETag 逐位元組相同）；telemetry 與公開點擊的限流檢查合成一個交易（原本 4 個）；`GET /public/booking-config/{campus}` 改唯讀；預約 CSV 匯出改串流（REPEATABLE READ 快照，稽核筆數＝輸出筆數）；migration `4373bcc82d9d` 補預約案件、時段、稽核紀錄的索引（只建索引、不改資料）。
- **CI**：後端 pytest 用 pytest-split 依 `backend/.test_durations` 分 3 組平行；uv 改 `astral-sh/setup-uv`（v10.2.0，以 `backend/uv.lock` 快取）。
- **刻意沒改**：根層 `/assets/*` 維持一天快取（9 月有 5 批同檔名換圖）；站內換頁不會重抓 `/api/published-site`（線上實測，盤點時誤判）。
- **本機 A/B**（origin/main 與本分支各一份 production build，都讀正式站已發布內容；手機 1.6 Mbps／150 ms／CPU 4×、DPR3）：

  | 頁面 | LCP（前→後） | 總傳輸（前→後） |
  |---|---|---|
  | / | 1.70→1.60 s | 761→627 KB |
  | /about | 3.58→2.64 s | 1168→796 KB |
  | /curriculum | 2.67→2.48 s | 844→486 KB |
  | /environment | 3.73→2.57 s | 1388→1130 KB |
  | /admission | 2.36→2.17 s | 838→562 KB |
  | /visit | 5.42→3.40 s | 1203→670 KB |
  | /anniversary | 3.59→3.43 s | 1229→779 KB |
  | /news | 0.72→0.69 s | 684→468 KB |

  CLS 都是 0；本機沒有 edge 往返，LCP 絕對值比線上低，看相對差。
- **驗證**（Node 22.23.2）：
  - web：`nuxt typecheck` 通過；vitest 80 檔 829 項通過（`title-fonts.spec.ts` 新增每頁分片在 inline、每頁 100 KB 預算）。新舊兩版 8 頁 × 桌機／手機截圖逐像素比對，只有每次隨機的水彩暈染不同。30 週年頁桌機（WebGL）從頭捲到結尾：五張卡立起、校徽印進 0，與 origin/main 相同。
  - admin：`vue-tsc -b` 與 `vite build` 通過；vitest 92 檔 1131 項通過。
  - backend（獨立測試庫）：全套 1531 passed、1 skipped（本機沒有 zscale 的 HLG 測試），9 分鐘；`--store-durations` 產生 `.test_durations` 後第 2、3 組單獨跑也全過（各約 2.8 分鐘，沒有順序相依）。migration upgrade／downgrade／upgrade 與 `deploy/check_schema.py` 通過；`npm run contract:check` 一致。
  - stack e2e（`E2E_DB_NAME=ivy_website_perf1005_e2e_test`、埠 8795／3795）：74 過 1 敗，敗的是既有間歇的 `media.spec`（讀後台 API 的 `payload.photo` 時存檔還沒完成，在檢查官網之前），單獨連跑 3 次都過（含發布後官網出現新圖）。`visual.spec` 與 origin/main 對照組同條件都 6 項全過。
  - 未驗證：Safari／iOS 實機、正式站、CI 上三組平行實際耗時（本機估各約 3 分鐘）。

## 2026-10-05 官網公開輸出再拿掉原型預約示範資料（`feature/booking-demo-fields-20261005`，10-05 已部署 main `7d132eb`）

使用者看完 10-04 的回報後說「booking.fields 也幫我清掉」。盤點 `booking` 時發現同一個物件裡另外三個欄位官網也沒讀，而且是原型的示範文字，一併拿掉：

- **拿掉**（`web/app/utils/public-copy.ts` 的 `RETIRED.booking`）：`fields`（原型表單欄位清單，含已拿掉的「想先了解的事」與 `demo-consent` 同意勾選）、`demoNote`（「這是官網互動提案，請使用測試資料。資料不會送出或儲存…」）、`steps`（含「示範完成，尚未送出預約。」）、`isDemo`。這四個在正式站每一頁的 HTML 都看得到。
- **型別**：`BookingContent` 只剩 `privacyNotice`、`ctaLabel`、`ctaLabelEn`，刪除 `BookingField`。`VisitForm` 雖然收 `booking` prop 但沒讀任何欄位（家長看到的隱私說明走後端 `/booking` API），不動。
- **不動**：兩份 fixture（後端也不讀這四個欄位，只是原型抽取時原樣留下）、後端、後台、API 契約。

**驗證**（Node 22.23.2）：
- 先在 `web/tests/public-copy.spec.ts` 加斷言（公開輸出不含「這是官網互動提案」「示範完成，尚未送出預約」「demo-consent」，`booking` 只剩 `ctaLabel`、`ctaLabelEn`），在未修改版確認紅燈再改。
- web：`nuxt typecheck` 通過（沒有 WARN）；vitest 80 檔 817 項通過。
- stack e2e（`npm run e2e:build` 後整套，`E2E_DB_NAME=ivy_website_bookingdemo_e2e_test`、埠 8782／3782）：75 項全過。
- 未驗證：Safari／iOS 實機、正式站。

## 2026-10-04 30 週年分頁 v2：孩子畫的高雄地圖、畫進 0 的結尾、30 支蠟筆蠟燭（`feature/anniversary-v2-20261004`）

使用者要「依對我的了解自己找主題，優化 /anniversary 除了 30 週年影片的內容，盡量展示前端能力」。規則見 DESIGN.md「30 週年分頁 v2」，規格 `docs/superpowers/specs/2026-10-04-anniversary-v2-design.md`。

- **正式站實測到的問題**：2006–2019、2022–2027 時間軸右側約兩個畫面高只有年份；蠟筆線停在左下角，跟影片結尾「孩子跳進 0 變成校徽」沒接上；2027 顯示「第 31 年」。
- **新增**：時間軸旁黏住的「孩子畫的高雄地圖」（真實區界、湖、河與五校門牌座標，跟著年份長出校園與路線）；結尾線畫成 30、孩子跳進 0、校徽印在 0 裡；「幫常春藤吹蠟燭」（按住、劃過、麥克風三種吹法，Web Audio 音樂盒生日快樂歌）；畫板復原／重播／分享與蠟筆沙沙聲；拼圖格子彈簧。2027 改寫「滿 30 年」。
- **資安標頭**：`/anniversary` 文件改 `microphone=(self)`，其他頁不變（`tests/security-headers.spec.ts`）。
- **拿掉開發輔助用字**（使用者看完預覽後要求）：首屏海報說明、各段操作說明、「畫紙準備中」、蠟燭狀態字與麥克風說明、地圖「位置依門牌估算」；地圖只留授權要求的署名，蠟燭剩幾支只在吹到一半時出現。之後 `test:website` 78 檔 793 項、typecheck 通過，Playwright 1440／390 無 console 錯誤、無橫向捲動。
- **rebase 到 main `5f6a0e8` 之後重驗**：web typecheck 通過、`test:website` 78 檔 789 項（main 的分校頁清理刪了幾項自己的測試）、`nuxt build` 通過；production server：`/anniversary` 是 `microphone=(self)`、`/` 與 `/about` 仍是 `microphone=()`，1440／390 開場→略過→整頁往下往回捲無 console 錯誤、無橫向捲動，按住吹氣時「還有 N 支」從 28 數到 1。沒跑 stack e2e（沒有任何 e2e 涵蓋這頁或資安標頭，這次也沒動後端、後台、預約）。
- **地圖資料**：`node scripts/build-anniversary-map.mjs [--fetch]` 產生 `web/app/utils/anniversary/map-data.ts`。
- **驗證**（Node 22）：
  - `test:website` 78 檔 792 項全過（新增 `anniversary-v2.spec.ts` 20 項：地圖資料與年份→地圖、結尾路徑與版面、蠟燭風場、吹氣判斷、生日快樂歌音高、禁用字與 tokens；`security-headers.spec.ts` 加麥克風標頭）；web typecheck 通過；`nuxt build` 通過（兩則 postcss Lexical 警告是首頁 hero 既有的）。
  - production server（fixture）：`/anniversary` 200、`Permissions-Policy` 為 `microphone=(self)`，`/about` 仍是 `microphone=()`；HTML gzip 66.5KB（地圖靜態線條改成掛上後才輸出，原本 72.9KB）。
  - Playwright：1440×900、1366×650、1280×800、1100×800、768×1024、390×844 往下往回捲、減少動態、第一次進站開場自動播放→略過→飛進海報，都沒有 console 錯誤、沒有橫向捲動；axe（wcag2a/aa、best-practice）桌機與手機 0 項。
  - 蠟燭：滑鼠劃過、按住按鈕吹熄、再點一次；麥克風用 Chrome 假裝置餵自製 WAV——寬頻氣流聲約 1 秒吹熄 30 支、吹完自動關麥克風，同樣響的純音不會熄；從別頁站內換頁進來時按麥克風會重新載入 `/anniversary#anni-cake` 一次。
  - 畫板：畫三筆→⌘Z／Ctrl+Z 各復原一筆→重播→存圖與分享按鈕。
  - 未驗證：真人對手機麥克風吹氣（iOS Safari／Android Chrome）、實機 Safari 的 `<use>` 與 container query、聲音實際聽感、stack e2e。

## 2026-10-04 資安掃描複核：15 項中 13 項 main 已修，補 3 處（`fix/security-scan-20261004`，10-05 隨 main `ba32b9b` 部署）

使用者交來 Codex Security 掃描報告（15 項：中 7、低 8）。報告掃的是 `feature/website-admin` 的 `d11d7e79`，落後 `origin/main` 655 個 commit；逐條對 main `15001574` 複核：

- **main 已修（13 項）**：官網代理本文上限與串流上傳（#1 #2 #5，`web/server/routes/api/website/v1/[...].ts` 先驗 Content-Length、chunked 回 411）；訪客 IP 從 X-Forwarded-For 右邊取（#4，`web/shared/request-guard.ts`）；API 解析前限本文、素材上傳先驗 session（#7，`backend/app/common/body_limit.py`）；素材改 FileResponse／串流供檔（#3 #15）；帳號鎖在驗密碼之前（#6）；儀表板通知失敗數依校區（#8）；素材解碼丟 thread 且限 2 件（#10）；到期占位不計名額（#11）；`hide_parameters`（#12 的綁定參數部分）；換發 session 鎖 token 列（#13）；匿名化清聯絡紀錄並回補舊案、年齡與聯絡時段已是選項代碼（#14 的主要部分）。
- **這次補的 3 處**：
  - #12 殘留：asyncpg 例外字串帶 PostgreSQL 的 `DETAIL`（違反 NOT NULL／CHECK 時整列內容、唯一鍵衝突的鍵值），`hide_parameters` 管不到。`backend/app/logging_config.py` 新增 `RedactDatabaseErrorDetail`，掛在 root 與 uvicorn 的 handler 上，格式化堆疊時遮掉 DETAIL 與參數編碼錯誤裡的值；例外類別、錯誤本文、約束與資料表名稱照留。
  - #14 殘留：已匿名化的案件仍可新增聯絡紀錄（要等下一輪清理才補清）。改回 409 `VISIT_REQUEST_ANONYMIZED`；`lock_editable` 在列鎖內重讀 `anonymized_at`，與清理互斥。
  - #9：`design/entrance-curtain-a-velvet-20260922/render-posters.cjs` 本機靜態伺服器用 `startsWith(root)` 判斷，`%2e%2e%2f` 可讀到同前綴兄弟目錄。改用 `path.relative` 判斷、錯誤編碼回 403；不加 realpath 檢查（本機 worktree 常把 `web/node_modules` symlink 到別處）。
- 沒有 migration、API 契約不變（`export_openapi.py --check` 一致）、後台與官網前端沒改。
- 沒處理：`versions/before-seo-performance-20260921-203736` 快照裡的舊代理（#5 附帶，快照不部署、不修改）。
- **驗證**（本機 PostgreSQL，獨立測試庫 `ivy_website_test_secscan`）：
  - 先寫測試、在未修正版確認紅燈再修：`test_retention_policy.py::test_anonymized_case_rejects_new_contact_notes`（原本 201）；`test_secfix_platform.py` 新增 3 項（NOT NULL 違規的 `Failing row contains (…)` 原本整段進日誌、參數編碼錯誤、`configure_logging` 掛到 root 與 uvicorn handler）。
  - 後端全套 1392 passed（機器同時有別的 session 跑測試，耗時 1 小時 41 分）；`export_openapi.py --check` 一致。
  - 以 uvicorn 的 `LOGGING_CONFIG` 加 `configure_logging()` 實際記一筆，`uvicorn.error` 與 `app.*` 輸出都不含原值。
  - `render-posters.cjs`：`node --check` 通過；`resolveInRoot` 對 `%2e%2e%2f<同前綴兄弟目錄>`、`..%2f`、`%00`、錯誤編碼都回 null（舊版放行兄弟目錄），`poster.html` 與 `web/node_modules/three` 照常解析。沒有實際重產海報。
  - 未驗證：web／admin（沒改）、stack e2e、正式站。

## 2026-10-04 後台拿掉官網已不顯示的舊欄位：首屏小標、校園探索熱點（`feature/admin-legacy-fields-20261004`，10-05 已部署 main `5f6a0e8`）

使用者：「後台現在有舊的設計的欄位，可以幫我處理掉嗎」。10-03 的 `83ed17db` 已拿掉常見問題兩頁、分校頁預約橫幅與五校介紹的簡介／詳細介紹／首屏焦點；正式後台只剩兩處「官網不顯示、後台還能編」：首頁大圖標語的「標語上方的小標」（09-30 首屏改版拿掉）與校園探索的熱點（分校頁 10-03 拿掉，環境頁只用場景照片、名稱、說明）。範圍經使用者選定：後台＋後端規則＋官網死碼，後端 schema 舊欄位與已存資料不動。

- **後台**：「首頁大圖標語」拿掉小標欄位；「校園探索」拿掉圖釘、點照片加熱點、拖曳／方向鍵／座標、熱點名稱／說明／提問、上下移與「熱點待複核」，只留場景名稱、照片、說明與場景排序，預覽改成跟環境頁一樣原比例整張顯示（不再是 8:5 拉滿）。舊值（小標、舊場景的熱點）照原樣存回。素材庫替換對話框拿掉「熱點要重新複核」警告；刪掉沒人用的字數提示（小標、熱點說明、分校頁介紹、FAQ、預約橫幅）與 `bannerTitlePreview`／`BANNER_DEFAULTS`、沒人用的 `--on-photo-border`／`--on-photo-shadow`。順手修：「新增場景」按鈕原本夾在 `role="tablist"` 裡（axe critical `aria-required-children`，main 就有），移到 tablist 外。
- **後端**：`HomeHeroPayload.eyebrow` 改選填（預設空字串）；`TourScenePayload.spots` 改選填（0–8 個，舊熱點照原規則驗證）；拿掉 `_mark_tour_spots_for_review`（換照片自動標待複核）與 `_tour_publish_blocker`，上線前存下、標成待複核的草稿也能直接發布。`spots_reviewed` 欄位保留只為舊版本可讀。沒有 migration、不改已存資料；契約只有一行說明文字（已 `contract:generate`）。
- **官網**：刪掉沒人引用的 `CampusTour.vue`、`CampusFaq.vue`、`CampusTestimonials.vue` 與它們的全站 CSS（`styles.css`／`performance.css` 約 8.8KB）；`content-overlay.ts` 拿掉常見問題合併（`mergeCampusFaq`）與沒人讀的欄位轉換（小標、五校區塊說明、出處說明、分校簡介／詳細介紹／臉書備註／首屏焦點、同意文字、預約橫幅、熱點），草稿預覽不再抓 `campus_faq`／`shared_faq`。公開輸出（`public-copy.ts` 的 `withoutRetiredFields`）拿掉這些舊欄位，頁面資料不再帶原型的示範同意文字與常見問題；整份內容 JSON 少約 15.6KB（39.5%，未壓縮）。`site-fixture.json` 不動（後端初始化內容要讀）。
- **DESIGN.md**：「後台欄位要對得上官網」補 10-04；「校園探索後台畫布 8:5」「校園探索照片一定要 8:5」標作廢。

**驗證**（Node 22.23.2；本機 PostgreSQL，獨立測試庫 `ivy_website_legacyfields_test`）：
- 後端：先改 `test_content_rules.py`（沒有熱點的場景可存可發、換照片不擋發布、待複核舊草稿可發、首屏不帶小標可存），在未修正版確認 4 項紅燈再修；整套 pytest 1391 passed。
- admin：vue-tsc 通過；vitest 88 檔 1078 項通過（tablist 修正後再跑校園探索相關 7 檔 150 項通過）。
- web：`nuxt typecheck` 通過；vitest 77 檔 767 項通過（基準比對 `overlay-baseline-20260925.json` 改成先拿掉舊欄位再比，檔案本身沒動）。
- `npm run contract:check` 一致。
- 實機（`tests/stack/start-api.sh` 起拋棄式 API＋admin vite＋nuxt dev live 模式，Playwright 桌機 1440×900、手機 390×844）：兩頁都沒有熱點與小標；把義華舊場景標成待複核、再新增一個場景後發布回 200，新場景 `spots: []`、舊場景 3 個熱點照原樣保留；小標存檔後原值保留。axe：兩頁剩 moderate `heading-order`（後台共通），沒有 serious／critical。`/`、`/environment`、`/visit`、`/about` SSR 200，新場景有渲染，HTML 裡沒有 `spots`、`faq`、`fbNote`、`heroPhotoPos`、原型示範文字。
- stack e2e（`npm run e2e:build` 後整套，`E2E_DB_NAME=ivy_website_legacyfields_e2e_test`、埠 8781／3781）：72 項 71 過；`media.spec.ts`「素材庫上傳照片…發布到官網」失敗（`home_about` 的 `payload.photo` 讀回不符），單獨重跑一次仍失敗、第二次通過，是 main 既有的間歇問題（這次沒動 home_about 與素材選取）。
- 未驗證：Safari／iOS 實機、正式站。

**合併注意**：未合併的 `feature/page-cms-20261004`（`content-overlay.ts` 的 `ContentOverlay` 介面與 campus_profile 附近、`overlay-baseline` JSON、`labels.ts`）與 `feature/media-jobs-20261003`（`content-overlay.ts` 首屏與孩子的一天段落、`MediaSlotField`）改到相鄰段落，後合併的一方會有小衝突。

## 2026-10-04 素材背景轉檔（`feature/media-jobs-20261003`，10-05 已部署 main `11ccc8e`）

影片上傳改成背景轉檔（poster＋桌機／手機 H.264），官網改播轉檔版本；圖片多中圖。規則見 DESIGN.md「素材背景轉檔」。已 merge origin/main `d559cae6`。

- **後端**：新表 `media_jobs`（migration `e5b9c3a7d214`，接在參觀後追蹤的 `b8e3f1a6c4d7` 之後，只新增表與 enum 值）、`app/media/jobs.py`、`app/workers/media_loop.py`、`POST /admin/media/{id}/retry`、指令 `transcode-media-videos [--apply]`；`WEBSITE_MEDIA_VIDEO_PROCESSING`（正式站預設 background）。health 的 `media_jobs.enabled` 看迴圈是否還在跑。
- **後台**：素材庫、選影片、影片版位、上傳清單、替換流程顯示轉檔狀態；處理中可「編輯」，失敗只有「重新處理」。
- **官網**：`slotVideoSrc` 依桌機／手機選轉檔版本，沒有就用原檔；處理中的影片草稿預覽退回內建影片。
- **和計畫不同的地方**：已是可直接播的 H.264 且轉檔版本不小於原檔 90% 時沿用原檔、不寫衍生檔；回補候選排除已有 done 工作與超過 10 分鐘的影片，沒有 `--force`，之後改參數要手動清 `media_jobs`；停機時先放回工作、再中止執行中的 ffmpeg，抽 poster 的 ffmpeg／ffprobe 仍不可中止（最多約 30／15 秒）。
- **已知限制**：inline 模式（本機開發、測試、`import-site-assets`）在呼叫端交易內等 ffmpeg，長影片可能撞 idle_in_transaction 300 秒，正式站全新匯入長影片要先改設 background；`regenerate-media-variants --apply` 因「缺中圖」會把每張圖的縮圖／中圖／大圖全部重產，全站圖片網址會換一次（瀏覽器與 CDN 快取失效一次）；桌機五欄網格的失敗卡片，動作列排成兩行。
- **驗證**（2026-10-04，HEAD `096be30c`）：alembic merge 後只有一個 head `e5b9c3a7d214`，downgrade -1／upgrade 成功；後端 pytest 全套（獨立測試庫）1432 passed、1 skipped（HLG 整合測試，本機 ffmpeg 沒有 zscale）、484 秒；`npm --prefix web run typecheck` 通過、`npm run test:website` 75 檔 757 項全過；`npm --prefix admin run typecheck` 通過、`npm --prefix admin run test:unit` 88 檔 1065 項全過；`npm run contract:check` 一致；stack e2e（`E2E_DB_NAME=ivy_website_mediajobs_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751`）70 passed（2.8 分），含新的 `media-video.spec.ts`。畫面檢查（Playwright 1440×900、390×844）：上傳→處理中→約 4.5 秒自動變可用；首屏影片版位選處理中影片→說明→自動更新；失敗→「重新處理」→轉好；兩種寬度沒有橫向溢出。
- **轉檔成本**（本機 Apple 8 核，轉檔限 2 執行緒，`/usr/bin/time -l`）：孩子的一天桌機母帶（25 秒、1280×720、24fps）→ 桌機版 10.1 秒、峰值記憶體約 235 MB、CPU 約 1.8 核、輸出 7.8 MB；手機版 8.3 秒、約 237 MB、4.8 MB；合成 4K60 6 秒來源 → 桌機版 3.0 秒、約 524 MB。Railway api 容器若只有 2 vCPU，轉檔期間 API 只分到很少 CPU（已 nice 10）；記憶體要拿正式站方案上限來判斷。
- **未驗證**：正式站 ffmpeg 有沒有 zscale（HLG 整合測試本機 skip，push 後要確認 CI 是 pass 不是 skip）、Railway api 記憶體與 `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`、iOS Safari 實機播放轉檔版本、HDR 實片轉色調畫質、正式站回補。
- **需要使用者決定**：(1) 轉檔參數（預設 CRF 20／26、長邊 1920、30fps、不帶聲音、上限 10 分鐘）；(2) Railway api 容器記憶體與 CPU 夠不夠，不夠就升級方案或另開 worker 服務（付費，需本人同意）；(3) 失敗影片不計配額（預設接受）；(4) 正式站回補何時跑，指令見 `deploy/README.md`「素材背景轉檔上線步驟」，由本人執行。

## 2026-10-04 關於常春藤頁開放後台編輯（`feature/page-cms-20261004`，階段 B，10-05 已部署 main `11ccc8e`）

接在階段 A（特色教學頁）之後，同一個分支。

- **後台**：「全站與素材 → 關於常春藤頁」可改首屏、四個章名、一路走來（含沿革五站的年份與說明）、全人教育、我們的期許、結尾，以及三張照片；不開放六大領域與核心素養、家長怎麼說、卡紙位置與顏色、目次標題、紀念章樣式。內容種類 `about_page`，草稿預覽 `?page=about`。
- **官網**：`/about` 讀已發布內容，沒發布過就顯示改版前的內建內容。沿革年份可改，民國年自動換算；`/about` 的搜尋標題、描述與首頁 JSON-LD 的創立年份讀沿革第一站，預設 1997 時輸出不變。30 週年頁與 `llms.txt` 的 1997 仍寫死。
- **規則**：字數兩層（後端硬上限、後台建議值）；一路走來標題逐行上限第一行 6、第二三行 7（避開紀念章）；沿革年份要由早到晚，後台即時紅字提醒；細節見 `DESIGN.md` 最上方「關於常春藤頁」。
- **驗證**（2026-10-04，HEAD `70eb1991`，已合併 origin/main `eab7df4f`）：
  - 後端全套（獨立測試庫）1425 passed（機器負載高，16 分）。
  - 官網 `npm --prefix web run typecheck` 通過；`npm run test:website` 78 檔 792 項全過（`web/vitest.config.ts` 加了 plugin-vue 與 `~` 別名，給 AboutContent 的 SSR 渲染測試用；plugin-vue 是 Nuxt 的間接依賴，沒寫進 package.json）。
  - 後台 `npm --prefix admin run typecheck` 通過；`npm --prefix admin run test:unit` 在另一個 session 跑 ivy-backend 全套、load average 15–40 時，每次有 10–23 項 5 秒逾時，失敗的檔每次不同，單獨重跑通過；加 `--testTimeout=20000` 全套 90 檔 1100 項全過；中等負載下新測試最慢約 1.9 秒（既有 cmsUx 約 2.0 秒）。
  - `npm run contract:check` 一致。
  - 畫面零差異：`/about` 與 `/curriculum` 的 SSR `<main>` 和改版前比對為空；stack 起 API 跑 `initialize-content`（後台已發布路徑）後，兩頁的 `<main>`（去掉 scoped hash）與內建內容相同。
  - 版面硬上限：`node scripts/page-copy-stress.cjs /about` 在 390／820／901／1024／1440 通過，含「一路走來標題 vs 紀念章」重疊檢查。
  - stack e2e（`E2E_DB_NAME=ivy_website_pagecms_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761`）71 passed（3.3 分），hydration 與 axe 檢查新加入 `/about`，都通過；visual 基準沒有更新。
- **未驗證**：實機 iOS／Android、正式站；後台草稿預覽 `/preview?page=about` 只有單元測試，沒在瀏覽器登入後打開看過；後台換照片後在已發布頁面的實際裁切只有單元測試。

## 2026-10-04 特色教學頁開放後台編輯（`feature/page-cms-20261004`，階段 A，10-05 已部署 main `11ccc8e`）

使用者 2026-10-03 裁定文字與照片都開放；章節數量與版面結構固定。

- **後台**：「全站與素材 → 特色教學頁」可改所有段落文字與首屏、年段、課程方向、兒童美術館作品、五件事的照片；清單項目數固定，不能新增、刪除、排序；不開放英文小字、章節編號、年段名稱與年齡、顏料與版面。內容種類 `curriculum_page`，草稿預覽 `?page=curriculum`。
- **官網**：`/curriculum` 讀已發布內容，沒發布過就顯示改版前的內建內容，照片留空也用內建圖。
- **規則**：字數兩層（後端硬上限擋存檔、後台建議值提醒）；品德培養的引言上限 10、說明 20；後台選了照片沒設焦點時官網置中；教學理念超字數時 422 指到第幾項。細節見 `DESIGN.md` 最上方。
- **驗證**（2026-10-04，HEAD `53d1890a`，已合併 origin/main `d559cae6`）：
  - 後端全套（獨立測試庫）1397 passed、1 failed：`test_content_publishing_workflow.py::test_seed_from_fixture_refuses_to_overwrite_and_validates` 因初始化多了特色教學頁而 `assert 19 == 18`，`53d1890` 已修，該檔 19 passed。
  - 官網 `npm --prefix web run typecheck` 通過；`npm run test:website` 76 檔 766 項全過。
  - 後台 `npm --prefix admin run typecheck` 通過；`npm --prefix admin run test:unit` 89 檔 1078 項全過。
  - `npm run contract:check` 一致（payload 是 dict，契約沒變）。
  - 畫面零差異：`scripts/page-ssr-snapshot.cjs` 改版前後 `/curriculum` SSR `<main>` diff 為空；stack 起 API 跑 `initialize-content`（後台已發布路徑）後，`/curriculum` 的 `<main>`（去掉 scoped hash）與內建內容相同。截圖兩次連抓像素就不同（動態、影片幀），只當人工參考。
  - 版面硬上限：`node scripts/page-copy-stress.cjs /curriculum` 在 390／820／1024／1440 全過。
  - stack e2e（`E2E_DB_NAME=ivy_website_pagecms_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761`）69 passed（2.6 分），visual 基準沒有更新。
- **未驗證**：實機 iOS／Android、正式站；「後台已發布且換了照片」的頁面上，沒設焦點時置中只有單元測試，沒在瀏覽器實測；`/about` 見上方階段 B 段落。
- **分支與合併**：已合併 origin/main `d559cae6`（重設密碼連結）。與 `feature/media-jobs-20261003`（背景轉檔）合併時 `web/app/utils/media-image.ts`、`content-overlay.ts`、`admin/src/api/labels.ts` 可自動合併，後合併者重跑 `contract:generate`；`backend/tests/test_content_initialize.py` 的初始化筆數與 `web/tests/fixtures/overlay-baseline-20260925.json` 之後新增初始化 kind 的分支都會撞到。

## 2026-10-04 參觀後追蹤：參觀案件與招生入學接成一條流程（`feature/admissions-follow-up-20261004`，10-04 已部署 main `bd22112`）

使用者要「家長完成參觀後可以有後續追蹤，參觀完成後案件自動導入招生入學，形成一整個流程」。規格 `docs/specs/2026-10-04-admissions-follow-up-design.md`（F-Q1 使用者回「不一定會聯絡」→ 不自動排第一次聯絡；附錄 A 是招生規格 Q1 的隱私權政策與保存天數擬稿）；規則見 DESIGN.md「招生入學」的「參觀後追蹤」。

- **後端**：migration `b8e3f1a6c4d7`（`recruitment_visits` 加 `follow_up_at`、`follow_up_owner_id`、`last_contacted_at` 與 CHECK；新表 `recruitment_contact_logs`；只新增、不改資料）。新模組 `admissions/follow_up.py`；新 API `/follow-ups`、`/records/{id}/contact-logs`、`/records/{id}/follow-up`、`/staff`；`/records` 加 `follow_up`、`owner` 篩選；到場建檔帶負責人（承辦人 → 標記的人）與預約上還沒到的下次聯絡；註冊、退出清掉下次聯絡；保存政策清聯絡內容；預約聯絡紀錄對已到場、已取消不再收下次聯絡（`FOLLOW_UP_NOT_TRACKED`）；總覽加 `admissions_follow_up_due`。匯出多 `recruitment_contact_logs` 延伸檔與 extensions 追蹤欄位（契約 README 記去向）。
- **後台**：招生入學「待追蹤」分頁（已到期／7 天內／未排定、負責人，網址 `fu`、`owner`）；記錄聯絡與改期對話框；歷程抽屜合併參觀前紀錄、招生事件、參觀後聯絡；看板卡片與訪視明細的下次聯絡；官網預約勾選多筆一次標記已到場；預約明細「參觀後追蹤」區塊；總覽待辦「參觀後該聯絡的家長」。
- **驗證**（Node 22.22；本機 PostgreSQL 16，測試庫 `ivy_website_test_followup`）：
  - 後端：新增 `test_admissions_follow_up.py`、`test_admissions_follow_up_schema.py` 共 25 項全過；整套 pytest 第一輪只有 `test_admissions_funnel.py::test_board_groups_cards_by_stage_and_term` 失敗（看板卡片多了 `follow_up_at`，已更新期望，該檔 29 項全過）；修正後第二輪整套 **1388 passed**（14 分 44 秒）；migration 升級、降一版、再升級都成功，`alembic heads` 只有一個。
  - `npm run contract:generate`、`contract:check` 一致；`python3 -m unittest discover -s deploy/tests` 20 項 OK。
  - admin：typecheck 通過、build 成功；vitest 1078 項通過、1 項失敗（`ux20260928F.test.ts` 午夜換日的日期多一個空格，沒改過的 HEAD 一樣失敗，是這台容器 Node 22.22 的 ICU 格式，不是本次改動）。新增 `admissionsFollowUp.test.ts` 21 項。
  - stack e2e（這個容器沒有 Google Chrome，用預裝 Chromium 以本機設定覆寫 `channel`，不進 repo）：`admissions-flow`、`admissions-follow-up`、`a11y`（含待追蹤分頁兩個網址）、`keyboard`、`roles` 共 44 項全過；截圖 `output/playwright/admissions-followups-*.png`、`admissions-contact-dialog-1440.png`。
  - 未驗證：stack e2e 全套、web（本次沒動）、Safari／iOS 實機、正式庫 migration。

## 2026-10-04 官網預約成功只通知園方一則（`fix/booking-notify-once-20261004`，10-04 已部署 main `bdab2ec`）

使用者回報：官網預約成功後，校區 LINE 群組同時收到「新的參觀需求」與「參觀預約已確認」兩則。原因是自選場次（09-30）把送單改成一律預約成立時，沿用了舊「自動確認模式」的寫法：`submit_visit_request` 先排 `visit_request_created`、再排 `visit_request_confirmed`，原本只有自動確認的校才會排第二則，改版後條件被拿掉，每筆都排兩則（LINE、站內通知、園方 Email 都是兩份）。這是 10-01 起列為待裁定的「送單兩則通知」，使用者 10-04 裁定合併。

- **後端**：送單只排 `visit_request_created`，標題由「新的參觀需求」改「新的參觀預約」（案件頁的用語是「排了場次的才叫預約」）。`visit_request_confirmed` 只留給園方確認補登的案件。成效統計的 `request_created`／`visit_confirmed` 兩個事件照記，不受影響。
- **後台**：`NOTIFICATION_KIND_LABELS` 同步改字；舊的站內通知紀錄（同一個 kind）也會顯示新標題。逾期提醒「新的參觀需求超過 24 小時尚未處理」、總覽「新的參觀需求還沒聯絡」講的是還沒排場次的案件，不改。
- **契約**：只有通知 schema 說明文字一行，已 `npm run contract:generate`。
- 沒有 migration。已在 outbox 裡排隊、還沒送出的 `visit_request_confirmed` 會照舊送出（只影響部署當下那幾分鐘的預約）。
- **驗證**（Node 22）：先把 `test_line_notifications.py::test_outbox_pushes_to_campus_group_once` 改成「只推一則、標題是新的參觀預約」，在未修正版上確認紅燈（推了 2 則）再修；把「兩則」寫死的 6 個測試檔改成一則。後端全套 1363 passed（獨立測試庫 `ivy_website_test_notifyonce`）；admin typecheck、vitest 87 檔 1056 項（`--maxWorkers=2`）；`contract:check` 一致。web 沒有改。未驗證：正式站真實 LINE 群組實收。

## 2026-10-04 預約頁背景大字不再被選校區蓋掉（`fix/visit-ghost-fit-20261004`，10-04 已部署 main `503ec36`）

使用者回報 `/visit` 背景大字「參觀」被切掉。原因是 10-02 收短迎賓區後，大字仍是固定字級（`clamp(142px,14vw,208px)`、手機 30vw），而且掛在整個 `.visit-page` 上，第二行落到下方 `.visit-content`，被它的底色蓋掉。10-03 `feature/website-admin` 上的 `cb9bc89` 是在收短前的版面把色帶撐高，跟 10-02 的裁定衝突，所以沒有併進 main。規則見 DESIGN.md「預約頁 UI／UX 優化（2026-10-02）」的迎賓區收短。

- **修法**：`VisitForm.vue` 把 `.visit-ghost` 移進 `<header class="visit-welcome">`。`visit-booking.css` 的 `.visit-ghost` 改成 `inset:0`＋`container-type:size`，`span` 字級取 `min(var(--visit-ghost-size),100cqh / 2.08)`，em 字距改寫在 `span`；手機改設 `--visit-ghost-size:30vw`。不支援 cqh 的瀏覽器退回原字級。
- **驗證**（Node 22）：
  - 新增 `web/tests/visit-ghost-20261004.spec.ts`（2 項，修改前紅燈）；`test:website` 77 檔 771 項全過；web typecheck 通過，沒有 WARN。
  - dev server（fixture）＋Playwright 量「參觀」的行框底與內容區上緣，涵蓋 1920×1080、1440×900、1280×720、1000×800、1024×768、961×700、960×900、768×1024、720×450、390×844、375×667、320×568。修改前有 9 組被蓋 15–241px，修改後 12 組都是 0，也沒有水平溢出。字級變化：1440 從 202 變 195px、1280×720 從 179 變 130px、1000 從 142 變 120px、390 從 117 變 101px；960 以下單欄維持原尺寸。
  - 未驗證：Safari／Firefox 實機、stack e2e。

## 2026-10-04 30 週年改成正式分頁：進主選單、頁尾、sitemap（`feature/anniversary-nav-20261004`，10-04 已部署 main `f935801`）

使用者看完不公開上線的 `/anniversary` 後說「幫我做成一個分頁沒關係」。規則見 DESIGN.md「30 週年分頁」。

- **入口**：fixture 主選單第五項「30 週年 / Anniversary」、頁尾連結（`web/server/data/site-fixture.json`；後台 `DEFAULT_PRIMARY_NAV`／`DEFAULT_FOOTER_LINKS` 同步）。正式站後台沒存過這兩個欄位，部署後直接生效。
- **SEO**：`anniversarySeo`（canonical、麵包屑、分享圖沿用首頁）、`sitemapXml`、`llmsTxt`；頁面改走 `usePageSeo`，拿掉頁面自己的 noindex（收錄照全站設定）。
- **統計**：`contentPages`、後端 telemetry `page` 列舉、`CTA_ENTRIES`（後端、web、後台標籤）加 `anniversary`；`<main data-cta-entry="anniversary">`；`npm run contract:generate` 重產契約。都是字串欄位，不需要 migration。
- **頁首**：五項在 1101–1126px 預約鈕超出視窗，1101–1180px 選單間距 32→20px。
- **驗證**（Node 22）：web `test:website` 76 檔 769 項（`media-slots` 基準快照加兩筆、`environment.spec` 選單斷言、`anniversary.spec` 改測正式分頁）、web typecheck；admin typecheck、vitest 87 檔 1056 項（`--maxWorkers=2`；同時開 dev server 跑時，案件／篩選類有 1–6 項計時偶發，還原成 main 也會發生）；後端 `test_traffic`／`test_analytics_funnel`／`test_site_structure_content` 79 項（獨立測試庫 `ivy_website_test_anninav`，跑完刪除）；`contract:check` 一致。dev server（fixture）＋Playwright：頁首 1920／1440／1366／1280／1200／1101–1180 每幾 px／1100／1024／1000／960／920／901 都一列、不重疊、沒有橫向捲動；桌機膠囊與手機選單面板第 05 項「30 週年」、頁尾有連結。

## 2026-10-04 30 週年分頁 `/anniversary`（`feature/anniversary-page-20261004`，10-04 已部署 main `9068de8`，不公開、不進導覽）

使用者要「依對我的了解自己找主題，做一個 30 週年分頁，盡量展示前端能力，並用《手牽手，走到 30》那支 30 秒影片當進入分頁的開場」。主題定為「孩子畫出的 30」：延續影片的米白水彩紙、綠色蠟筆與立體書卡片。規則見 DESIGN.md「30 週年分頁」。

- **頁面**：`pages/anniversary.vue`（noindex、不進 sitemap 與主選單）＋`AnniversaryContent.vue`＋`AnniversaryIntro.vue`；樣式 `assets/css/anniversary.css`（只用 tokens）；程式 `utils/anniversary/*`；頁首膠囊加 `/anniversary`。
  - 開場：第一次進站自動靜音播放（桌機橫式、手機直式各一支），可開聲音、略過；29.0 秒那一格整個畫面飛進首屏右邊的海報相框（FLIP）。
  - 1997 到 2027：往下捲蠟筆線跟著畫、紙偶在線頭走、翻牌年份與校園數；五校在成立那年像立體書立起，鉛筆線沿測地時間描出、再暈水彩（共用一個 WebGL2 畫到各自的 canvas），可翻面看校舍照片，附地址電話與各校 `BookingCta`；終點把 30 週年校徽印上去。
  - 孩子的作品拼成的 30：沿用特色教學頁的 8 件作品與替代文字，品牌字「30」切格拼圖，縮圖與格子互相亮起，點開燈箱。
  - 換你畫一個 30：WebGL2 蠟筆畫板（一筆用 MAX 混合、放開才依紙紋沉積），品牌五色加深綠、影片同一組「30」虛線導引，存成圖片只在使用者裝置。
- **素材**：`scripts/build-anniversary-media.py` 從展示作輸出（repo 外 `output/ivy-30th-20261003/`）壓影片、抽海報、複製素材場，檔名帶雜湊，產生 `utils/anniversary/media.ts`。影片桌機 11.6MB（1080p 3Mbps）、手機 6.0MB（720×1280）；其餘素材合計約 0.6MB。
- **驗證**（Node 22）：
  - `test:website` 76 檔 768 項全過（rebase 到 main `fb3757c` 後）（新增 `anniversary.spec.ts` 15 項：沿革和 /about 一字不差、作品和特色教學頁一致、禁用字、noindex、素材檔存在、拼圖相鄰不重複、導引幾何）、web typecheck 通過。
  - dev server（fixture）＋Playwright：1440×900 與 390×844 開場自動播放→略過→飛進相框對齊海報、時間軸六個位置、拼圖亮起與燈箱、畫板換色／關導引／存圖、重看開場（展開後有聲播放）、減少動態（不播開場、整頁直接畫完、年份照樣跟捲動）；console 無錯誤。
  - 未驗證：stack e2e、實機 iOS／Android 與 Safari、真人聽開場配樂。
- **業主裁定（10-04）**：先以不公開方式上線（noindex、不進選單與 sitemap）；30 週年校徽同意用在這頁。

## 2026-10-04 後台重設密碼改成寄連結（`feature/admin-password-reset-20261003`，10-04 已部署 main `d559cae`）

使用者 10-03 裁定：只做「總管理者寄重設連結」，登入頁不開放自助忘記密碼。本分支接在後台第八輪 UX 之後開發，期間已把含第一波（UX8＋成效統計）的 origin/main 合入。

- **後台**：「使用者」→「重設密碼」對話框多一種方式「寄重設連結到 <Email>」，「寄重設連結」選項永遠顯示：有寄信且帳號啟用時預設選它；沒設定寄信或目標帳號已停用時是停用狀態並附說明，只能「直接設定新密碼」（原本的做法，保留）。寄出後顯示寄到哪裡、幾點前有效。停用帳號點舊連結會看到「帳號已停用」。新頁 `/admin/reset-password` 不用登入，同事在這裡設定新密碼，完成後回登入頁。
- **API**：`POST /admin/users/{id}/password-reset-link`、`POST /auth/password-reset/verify`、`POST /auth/password-reset/complete`；`/auth/me` 的 `features.password_reset_email`。新表 `password_reset_tokens`（migration `d2b7f4c9e1a3`，只新增表）。
- **規則**：連結 30 分鐘、用一次，寄新的舊的就失效，DB 只存雜湊。信同步寄出，失敗就作廢連結、當場說明原因。設好新密碼後登出所有裝置、解除密碼登入暫停。停用帳號、本人改密碼、總管理者直接設新密碼也會作廢還沒用的連結；直接設新密碼也改成會解除密碼登入暫停（行為改變）。「保留直接設定新密碼」與「直接設定新密碼也會解除密碼登入暫停」兩點是使用者 2026-10-04 確認的。
- **驗證**（Node 22，2026-10-04，HEAD `abd244d`）：後端 pytest 全套 1363 passed；admin typecheck 無錯誤、vitest 1054 passed／2 failed（`admissionsRecords.test.ts` 兩項 5 秒逾時，單獨重跑 24 passed，本分支未動招生）；web typecheck 無錯誤、`npm run test:website` 753 passed；`contract:check` 一致；stack e2e 全套 69 passed（含新的 `password-reset.spec.ts`）。alembic 只有一個 head `d2b7f4c9e1a3`。
- **上線前**：正式站要有 `WEBSITE_SMTP_*` 與 `WEBSITE_ADMIN_ORIGIN`，才能寄重設連結（沒設時該選項停用並說明）。「直接設定新密碼也會解除密碼登入暫停」不論有沒有設定寄信，部署後就生效。push main＝正式部署，由使用者決定。

## 2026-10-04 官網後台第八輪 UX（`feature/admin-ux8-20261003`，10-04 已部署 main `b4bb570`）

09-28 稽核「還沒處理、需要決定的」表格裡使用者選的六項。錯誤定位（哪一則哪一欄）10-02 第七輪已做，這輪不動。規則見 DESIGN.md 同名段落。

- **長編輯頁段落目錄**：首頁消息、各校消息、入學資訊、孩子的一天、隱私權政策。1280 以上在表單右側黏住，較窄時是表單上方一排膠囊。
- **選圖統一**：`MediaFieldCard`（外觀）＋ `MediaSlotField`／`MediaRefField`（資料）。消息封面、內文圖片、分享圖、校園探索都改用；消息封面與內文圖片一樣必填、沒有「移除照片」（後端規定每則消息一定要有照片）。素材不是 ready 時標「處理中」「失敗」，並預留 `status` prop 與 `#status` slot 給背景轉檔計畫。
- **兩人同時處理同一案**：頁首「最後處理：誰・何時・做了什麼」；狀態轉換被擋時重讀並寫出現在的狀態；切回分頁超過 30 秒自動更新、同事剛改過就提示。後端錯誤訊息改寫中文狀態名。案件明細切回分頁重讀時，`focus` 與 `visibilitychange` 連續觸發只重讀一次；只有同事在重讀前之後真的有新動作才點名「某某剛剛…」，變動來自家長或系統時寫「這筆案件剛有更新，畫面已重新整理。」；靜默重讀失敗不蓋掉畫面與草稿，只提示「無法更新案件，畫面可能不是最新。」。
- **我承辦的案件**：總覽列最多 5 筆＋查看全部（不算待辦）；承辦人帳號已停用、還沒結案的算待辦（校區管理者以上）。列表加「只看未結案」與承辦人「承辦人已停用」。停用帳號時若對方還有未結案件，提醒件數。
- **登入逾時**：對話框有「在新分頁打開登入頁」；新分頁登入同一個帳號後這頁自動接續（仍要再按一次儲存），登入的是別的帳號就不接續。登入滿 12 小時前 15 分鐘提醒先儲存。自動接續先比對帳號、相同才寫入身分與 CSRF token；別的帳號在新分頁登入時，這一頁什麼都不寫入，繼續等原帳號登入。

**後端與契約**：`InvalidTransition` 訊息中文化；案件清單、分組計數、匯出加 `open=true`、`assignee=inactive`；`/admin/dashboard` 加 `my_open_cases`、`inactive_assignee_open_cases`；`/auth/me` 加 `session_max_expires_at`。沒有 migration。已跑 `npm run contract:check`。

**驗證**：Node 22，HEAD 6f41e38：後端 pytest 1299 passed；admin typecheck 0 error、vitest 79 檔 990 passed、build 成功；web typecheck 0 error、單元 75 檔 748 passed；`contract:check` 一致；stack e2e keyboard 10 passed、整套 68 passed（截圖基準沒變）。畫面量測（`output/ux8/`）：首頁消息、隱私權政策、分享圖、總覽在 1440／1280／390 都不橫向溢出；1280 與 1366 寬、隱私權政策填 60 字小標時表單仍是 720px、目錄在右側黏住；390 寬目錄是可橫捲的膠囊列、頁面不溢出；手機選圖按鈕 44px；點目錄會把焦點移到該段標題。

**未驗證**：Safari／iOS 實機；LINE 內建瀏覽器的 BroadcastChannel；兩個分頁真的換帳號登入的實機流程（只有單元測試）；總覽「我承辦的案件」與案件明細「最後處理」只有單元測試，沒有截圖。已知限制：沒有未儲存修改的分頁，在別的分頁換成另一個帳號登入後，會直接以那個帳號的身分回到原頁，登入頁的說明不會出現（和 main 原本閒置延長會切換帳號的行為相同）。

- **待使用者確認**：沒有承辦權限的唯讀角色看不到「我承辦的案件」（目前：要有案件讀取權限才顯示）；停用帳號不自動清掉承辦人（目前：只提示件數）；登入滿 12 小時前 15 分鐘提醒。

## 2026-10-04 成效統計補強：預約結果、五校比較、每日趨勢與班別（`feature/admin-analytics-phase1-20261003`，10-04 已部署 main `b4bb570`）

依 `docs/analysis/2026-09-30-enrollment-analytics-report.md` 階段 1；計畫 `docs/superpowers/plans/2026-10-03-admin-analytics-phase1.md`。規則見 DESIGN.md「成效統計補強」。

- **後端**：`GET /admin/analytics/booking-outcomes`（同批案件的結果、到場率、未到率、取消率、現在待處理三種，只列授權校區）、`/event-trend`（每日事件，台北日期）、`/class-distribution`（生日換算班別）；funnel 與 traffic 帶 `as_of`。待處理三種集中到 `booking/pending_kinds.py`，總覽與案件列表共用。不新增資料表、沒有 migration。
- **後台**：`components/analytics/` 新增五個元件；官網瀏覽加每日趨勢與 09/30 標記。三個新面板換期間／校區時，標題與說明列標的是「目前畫面上這批資料」的期間與校區；重抓中舊數字變淡、重抓失敗只顯示錯誤，不留舊數字。
- **驗證**（Node 22，HEAD 3f0fb96）：後端 pytest 1328 passed；admin typecheck 0 error、vitest 80 檔 994 passed、build 成功；web typecheck 0 error、單元 75 檔 748 passed；`contract:check` 一致；stack e2e keyboard 10 passed（含 `/analytics` 390／1440 不溢出），整套 66 passed／2 failed——`a11y.spec` 的入學 arrivals 頁在整套時 axe 逾時（單獨重跑通過），`media.spec` 是 main 既有的間歇失敗（測試在存檔完成前讀 API，本分支沒動到相關程式）。截圖 `output/playwright/analytics-{1440,390}.png`：兩寬度都不溢出，五校比較表在框內橫捲，09/30 標記線看得到。未驗證：Safari／iOS 實機、正式站資料、期間拉到一年時手機直條的實際觀感（只有單元測試與程式審查）。
- **未做**：統計匯出（匯出擴充計畫）、測試案件人工排除（要 migration）、UTM（階段 3）。
- **待使用者確認**：到場率分母（目前：已到場＋未到場，時間已過還沒標記的另列）、班別預設學年（目前學年）、班別含已取消（目前含）。

## 2026-10-03 關於頁第一章：紀念章取代「拉拉看」（`feature/about-medal-20261003`，未部署）

使用者要拿掉第一章右頁的拉鍊時間軸、改用紀念章，比過點擊版與捲動版後選「章名旁＋連續轉」。10-04 使用者發現捲動時只剩反面、想保留正面，比過四種後選**正反交替**（像硬幣，2001／2020 落在米白正面）。規則見 DESIGN.md「關於頁第一章：紀念章取代『拉拉看』」。

- **官網**：新元件 `AboutMedal.vue`（CSS 3D，不載 three）；`AboutContent.vue` 拿掉紙條、第一章外包 `.abk-track`；`about-popup.ts` 的紙條段改成紀念章捲動（`medalTurn`／`medalFaces`／`medalShown`／`medalPinTop`），翻頁進度改量軌道；`about.css` 拿掉紙槽樣式、加紀念章位置與釘住規則。面圖 `web/public/assets/about-medal/`（大校徽、米白正面帶字、墨綠反面三張共 63KB，`scripts/about-medal/build.py` 產生）；翻面順序是 `medalSequence()`。
- **驗證**（Node 22）：
  - `npm --prefix web run typecheck` 0 錯 0 警告；`test:website` 75 檔 753 項（`about.spec.ts` 換成紀念章 10 項，拿掉紙條 4 項與 `mobile-ux-20261002` 的拉拉看字色 1 項）。
  - dev server（fixture）＋Playwright：1440×900 釘住（pin top 52）、1440×780 往上推 8px 釘住、1366×650 不釘（經過時走完五站）、390×844 與 375×667 釘右頁；各捲動點紀念章站數、正反面、卡紙 `--up`、沿革上色一致，往回捲倒著翻；都沒有橫向捲動、沒有 pageerror。減少動態：不釘、卡紙全站、紀念章停在校徽。10-04 正反交替後同一組尺寸重跑一次，並截六步確認米白正面的字在圓心內。
  - 未驗證：`nuxt build`／stack e2e、實機 iOS Safari 的 sticky 與網址列收合、Android。

## 2026-10-03 404 頁加立體書校徽（`feature/404-crest-popup-20261003`，未部署）

使用者要把 logo 做成 3D；比過全站右下角浮動三方向後，改成嵌在分頁某一段，選「404 × 立體書」先做。規則見 DESIGN.md「404 頁加立體書校徽」。

- **官網**：新元件 `CrestPopup.vue`＋`utils/crest-popup.ts`，`error.vue` 只在 404 放；503 不變。純 CSS 3D，不載 three.js；五張紙片 WebP 共 54KB（`scripts/build-crest-popup.py` 產生）。
- **驗證**（Node 22）：
  - `test:website` 76 檔 764 項（新增 `crest-popup.spec.ts` 10 項）、web typecheck 通過。
  - dev server（fixture）＋Playwright：1440／1320／1319／1200／1180／1179／900／390 都不壓字、不橫向捲動；游標靠近會轉、離開後停穩；點擊 5 段動畫跑完歸零；減少動態 0 個動畫；手機點擊可用。
  - 另開後端連不上的 dev server 打出 503：標題「網站暫時無法顯示」、沒有立體書。
  - 未驗證：`nuxt build`／stack e2e、實機 iOS／Android。

## 2026-10-03 關於頁第一章五校卡紙改成一樣大（`feature/about-equal-cards-20261003`）

使用者要求 /about「一路走來」右頁的五校照片「五間都是一樣的比例」。

- **`AboutContent.vue` 的 `STAGE`**：前排國際、仁武從寬 42% 改成和後排一樣 31%，並移到後排兩道縫的正下方（x 17.25／51.75%）；後排 y 50／56／50% → 46／52／46%，收掉卡紙變小後多出來的排間空白。CSS、動畫、左頁沿革都沒動。規則寫在 DESIGN.md 同日一節。

**驗證**（Node 22）：`npm --prefix web run typecheck` 通過；`npm run test:website` 75 檔 754 測試通過。Playwright（fixture dev server、減少動態）量 1440×900、1280×720、768×1024、844×390、390×844、320×640：五張照片框同寬同高（1440 寬約 146×111），卡紙都在舞台內；後排卡紙底到前排年份標籤 53／55／10／10／17／33px，舞台底到紙槽 19–24px。不減少動態時桌機與 390 手機紙條示範跑完五張 `--up` 都是 1、沒有 pageerror。

## 2026-10-03 「孩子的一天」拍立得捲動時不再飄動（`feature/polaroid-no-scroll-wind-20261003`）

使用者要求：拍立得不要捲動時的動畫，保留相紙的感覺；翻面提示已有 F 第一張翻開進場，不需要捲動起風。

- **拿掉**：捲動時右下角被風掀起、整張順風微擺。`DayMomentCard.vue` 不再訂閱捲動，`cornerWind.ts` 只留翻面起手與進場輕掀，`styles.css` 拿掉 `--sway`；WebGL 版折線固定 45°。
- **保留**：點下去翻面時角先捲起、顯影後輕掀一次、F 第一張翻開進場、游標傾斜、顯影。
- **驗證**（Node 22）：web typecheck 通過；`test:website` 743 項通過（`corner-wind.spec.ts` 改寫成守「捲動不動」與起手／輕掀）；dev server Playwright 桌機 1440、手機 390 快速上下捲約 180 格取樣，掀角 0 格、微擺 0 格、傾角固定，F 與點擊翻面照常、無 page error。

## 2026-10-03 後台拿掉官網已沒有頁面顯示的編輯頁（`feature/remove-campus-editors`）

接續「拿掉分校資訊頁」：公開站沒有顯示的地方，後台就不留編輯入口。

- **拿掉**：「各校常見問題」「共用常見問題」編輯頁（舊網址轉到五校介紹）、「預約文案」裡的分校頁預約橫幅欄位、「五校介紹」的一句話簡介／詳細介紹／分校頁首屏焦點；web 的草稿預覽不再附橫幅例子，刪除 `CampusVisitBanner`、`campus-banner.ts`。
- **保留**：「五校介紹」的校名、地址、電話、社群、封面（首頁五校卡、選單、頁尾與預約頁在用）；「校園探索」（常春藤環境頁在用，說明改成環境頁）。側欄分組「分校頁」改名「各校」。
- **不動後端**：campus_faq、shared_faq 等內容種類與已存資料、API 契約都沒改，沒有 migration；之後要找回只要補回後台頁面。
- **未處理**：web 的 `CampusFaq`、`CampusTestimonials`、`CampusTour` 元件目前沒有使用者；後台流量圖表仍保留歷史的分校頁入口名稱。

**驗證**（Node 22）：admin vue-tsc、vitest 75 檔 946 項；web typecheck、vitest 749 項。stack content-flow 改用「地址」欄位並以 `/api/public-site` 驗證，尚未在本機跑 stack。

## 2026-10-03 CI 加速：測試的 bcrypt 降到 rounds 4、只改文件的提交不跑 CI（`feature/ci-speed-20261003`）

使用者問：為什麼每次部署都要那麼久。

- **根因**：部署要等 Backend job，job 裡的 `pytest -q` 在 CI 上約 22.7 分鐘；其中一半花在 bcrypt（建帳號＋登入的 fixture 走正式的 rounds 12，全套 2060 次）。另外最近 25 次 main push 有 14 次是部署紀錄／文件提交，每次都完整測試＋重新部署，main 的 run 又依序排隊，緊接著推的紀錄提交會讓下一次部署多排 20–28 分鐘（最長一次總共 56 分鐘）。
- **測試**：`backend/tests/conftest.py` 把 `_pwd_context` 降到 rounds 4，查無帳號用的假雜湊跟著重算；正式環境不變。
- **workflow**：PR 與 push 加 `paths-ignore`（`**.md`、`docs/**`、`design/**`、`versions/**`），整次變更都只有文件時不跑 CI、不部署。說明補在 `deploy/CICD.md`。

**驗證**（本機、獨立測試庫）：
- 對照實驗：origin/main 全套 1021 秒 → 只降 rounds 450 秒（-56%），失敗清單相同。
- 同時段 A／B 交替（認證、招生紀錄等 4 檔 115 項）：修改後 33／37／37 秒三輪全過，rounds 12 是 141／128 秒；bcrypt 耗時 0.7 秒對 94 秒。
- 本分支全套 1293 項通過（`test_referral_text_matches_admin_labels` 首輪因 sparse checkout 沒抽 `admin/` 讀不到檔，補抽後通過）；當時機器 load 11–12，總時間不具比較性。
- workflow YAML 用 PyYAML 解析確認觸發條件；`paths-ignore` 的實際效果要推上 GitHub 後才看得到。

## 2026-10-03 官網預約拿掉「參觀人數」「想先了解的事」，得知管道改四選項（`feature/visit-no-party-size-20261003`）

使用者要求：/visit 表單拿掉參觀人數；接著也拿掉整個「想先了解的事」欄位；「如何知道常春藤幼兒園？」改成只問來源追蹤看不到的管道，留四個。

- **得知管道**：官網選項改為親友介紹（`friends_family`）、住附近／路過看到（`nearby`）、網路上看到（`online`）、其他（`other`）。媽媽社團、LINE 群組的口碑算親友介紹；網路細節之後由自建來源歸因補（後台目前沒有 referrer／UTM 紀錄）。舊代碼 facebook／google_reviews／parent_community 後端照收，後台、匯出、成效統計照樣顯示舊案件。「親友介紹」不改名：預約轉招生紀錄時來源存文字，改名會讓招生統計拆成兩列。上限從 5 改為代碼總數 7。契約重新產生。

- **官網**：預約表單拿掉人數下拉，送出列與完成頁也不再顯示人數，送單不帶 `party_size`；家長修改頁不能再改人數（舊案件有填的照樣顯示）。
- **後端**：拿掉官網送單「必須有人數」的 422（`PartySizeRequired`）；欄位維持選填 1–10，給更新前快取的舊頁面與後台補登用。
- **想先了解的事**：表單拿掉「其他想告訴我們的事」摺疊區（只裝這一格），送單不帶 `questions`；家長修改頁不能再改（舊案件有填的照樣顯示）。得知管道下方補 32px 間距給送出列。後端 `questions` 本來就選填，未動。
- **後台**：個資說明預設文字拿掉參觀人數與想先了解的事，並把過時的「Email（選填）」改掉。後台補登、案件明細、匯出的人數欄位保留（舊案件與補登仍會有）。

**驗證**（Node 22）：
- web typecheck、vitest 740 項；`contract:check` 一致；admin vue-tsc 通過。
- backend pytest 1262 passed，2 failed（`test_secfix_media` 的 Pillow 版本與 S3，借用的 venv 較舊、缺 `boto3`，與本次無關；`test_media_s3.py` 因此略過收集）。
- dev server＋攔截 API 的 Playwright：桌機 1440、手機 390 選場次後直接接孩子資料，送單不帶 `party_size`，可走到預約成功；拿掉想先了解的事後重跑，送單欄位只剩校區、版本、家長、手機、孩子、Email、得知管道、場次。
- admin vitest 951/952：`ux20260928E`「刪除場景後選旁邊那一個」間歇失敗（單檔重跑一紅一綠，與本次無關）。
- 未驗證：stack e2e（`tests/stack` 已同步拿掉選人數步驟，未實跑）。

## 2026-10-03 隱私權政策頁（`feature/privacy-policy-20261003`，未部署）

使用者決定官網改用 cookie 做行銷分析（自建歸因＋GA4＋廣告像素）、不做 cookie 橫幅；拆三部分，本段是第 1 部分：後台可編輯的隱私權政策。

- **後端**：新共用內容 `privacy_policy`（標題、最後更新日期、1–20 段）；含「【待確認」或沒填日期不能發布；沒有 migration。
- **後台**：「全站與素材 → 隱私權政策」編輯頁，第一次打開帶入初稿（12 段，9 處【待確認】、8 項事項待園方補）。
- **官網**：`/privacy` 頁（目錄、條列、https 連結，不用 `v-html`；未發布 404）、頁尾連結取代個資使用說明按鈕、預約表單對話框加完整政策連結、草稿預覽 `?page=privacy`、sitemap。
- **文件**：`docs/website-admin/seo-performance.md` 的統計儲存說明改成現況。
- **驗證**：stack e2e `privacy-policy` ＋ `keyboard` 15 項全過（含 1440／390 截圖不溢出、axe 無 serious／critical）；整套 stack 73 項，72 過，`media.spec.ts` 整套跑時間歇失敗、單獨重跑通過；`contract:check`、admin／web typecheck 通過；admin 單元 957 項、`test:website` 761 項通過（admin 單元連跑曾兩次各 1 項間歇失敗，第三次全過）；`admin build` 成功；後端整套 pytest 由主控另跑。

## 2026-10-03 拿掉各校分校資訊頁（`feature/remove-campus-pages`）

使用者裁定：不需要「首頁 / 五所校園 / 義華校」這種各校分校資訊頁；指向分校頁的連結、校區常見問題、各校結構化資料都拿掉。首頁五校輪播保留（照片、地址、電話、社群還在），只是不再連到內頁。

- **web**：刪除 `pages/campuses/[key].vue` 與 `CampusPageMain.vue`；`/campuses`、`/campuses/**` 301 轉回首頁；舊 hash `#/<校>` 轉到 `/#campuses`。輪播照片與校名、頁尾與錯誤頁校名改為不可點；選單「找到你的校園」改按鈕（只切換電話與社群）；預約頁拿掉「認識某某校」；預約管理頁改成直接撥各校電話；關於頁時間軸的校名改純文字、緞帶書籤改連到 `/#campuses`；環境頁拿掉「到某某校頁」。
- **SEO**：`pageSeo` 只輸出機構與網站，不再輸出各校 Preschool、FAQPage、麵包屑；sitemap 與 llms.txt 不列分校頁與校區常見問答；草稿預覽不再有 `?page=campus`。
- **後台**：校區內容發布後「查看官網」改開 `/#campuses`，預覽改開首頁預覽；共用常見問題沒有公開頁面，預覽連結隱藏。
- **腳本與 CI**：`deploy/railway_ci.py` 的 smoke、`audit-public-site.mjs`、`check-public-seo.mjs`、`first-screen-chars.cjs`（含產生的 json）不再檢查分校頁；check-public-seo 改驗 `/campuses/*` 為 301。
- **未處理**：後台的分校簡介、常見問題、環境導覽、預約橫幅文案仍可編輯，但公開站已沒有頁面顯示；`CampusTour`、`CampusFaq`、`CampusTestimonials` 等元件目前沒有使用者。

**驗證**（Node 22）：web typecheck、web vitest 74 檔 734 項、admin vue-tsc 通過；admin vitest 全套有 3 項在整套並行時偶發失敗、單獨跑 33 項全過；dev server（fixture）`/campuses/*` 301、首頁與內頁無 `/campuses` 連結、無 Preschool 結構化資料，桌機輪播與選單截圖確認。**未跑** stack／e2e。

## 2026-10-02 後台補登也拿掉同意勾選（`feature/manual-no-consent-20261002`）

使用者追加：補登時「已向家長說明，並取得同意留存聯絡資料」也拿掉。

- **後台**：補登對話框拿掉勾選，送出鈕只看必填欄位；送 `consent_given: false`。案件明細的同意紀錄寫「補登不需勾選同意」。「個資與搜尋設定」頁改寫「官網預約與後台補登都不用勾選同意」。
- **後端**：`_VisitRequestFields.consent_given` 預設 false，拿掉 `_require_consent`。補登沒勾時不記同意時間。
- **契約**：重新產生（`VisitRequestManualCreate` 說明與預設值）。

**驗證**（Node 22，已合併 main 的後台第七輪 UX 後重跑）：
- backend pytest 全套 1270 passed；`contract:check` 一致。
- admin typecheck、vitest 74 檔 952 項；web vitest 741 項。
- stack e2e 整套 68 項全過。
- 未驗證：線上補登（要後台登入），只在單元測試與 stack 驗過。

## 2026-10-02 官網後台第七輪 UI／UX（`feature/admin-ux-20261002`）

使用者要「優化後台整體的 UI/UX」。在拋棄式測試庫灌了示範資料（兩校場次、14 筆不同狀態的預約、三種角色、草稿與送審），把 30 個路由在 1440×900、390×844 兩種尺寸截圖，分五個面向稽核，每條發現都由另一個 agent 試著推翻，最後確認 47 條（駁回 6 條）。規則與理由見 DESIGN.md 同日段落。

**改了什麼**：
- **接待**：
  - 參觀開始後，處理區以「標記已到場／未到場」為主。
  - 狀態用詞全後台統一（預約正常、已到場、場次）。
  - 時間已過還沒標記到場的用暖黃，並能單獨篩出。
  - 改期、補登的場次選擇改善。
  - 拿掉已廢除的「方便接電話時段」。
  - 沒設定寄信時，不再承諾「會寄確認信」。
  - 月曆上同一天的多個場次分得出來，已結束的場次對比達 AA；手機電話連結 44px。
- **總覽**：
  - 「今日參觀」改成捲到今天的名單，名單上標出進行中、已結束。
  - 待辦新增「參觀時間過了，還沒標記到場」。
  - 常用工作去掉重複項，標題層級修正。
  - 側欄的「總覽」不再有空的收合標題。
- **內容編輯**：存檔錯誤定位到欄位、長清單可收合、移除前確認、版本衝突時保留自己的修改、可以「儲存草稿後離開」、分校基本資料空白不能發布（後端擋）、原型文字提示、過時說明更正。
- **設定與紀錄**：
  - 操作紀錄可以載入更早的紀錄、可以排除登入登出、可以點進案件，手機改精簡列。
  - 站內通知每列顯示參觀日期與場次。
  - CSV 匯出改 BOM、中文欄名、台北時間，手機號碼保留前導 0。
  - 停用分校、預約方式、LINE 步驟、成效漏斗、素材備註的說明更正。
- **跨頁**：錯誤提示統一用 `notifyError`（8 秒、可關閉）；危險確認框一律用紅色確定鈕、不自動聚焦；數字欄在手機隱藏微調鈕；文字連結加底線。

**後端與契約**：
- `/admin/dashboard` 加 `awaiting_attendance`。
- `/admin/audit-log` 加 `before`／`before_id` 游標與 `exclude_login`，並回 `target_exists`。
- `/admin/notifications` 改成具型別的 schema，加 `slot`。
- CSV 匯出欄名改中文（新檔 `backend/app/booking/export_labels.py`）。
- 分校基本資料發布前檢查必填。
- 沒有 migration。已跑 `npm run contract:check`。

**驗證**：`npm --prefix admin run typecheck` 通過；admin `vitest run` 73 檔、942 項全過；後端全套 `pytest` 1270 passed（獨立測試庫 `ivy_website_adminux_test`）；`npm run contract:check` 一致。`web/` 沒有改，沒跑 web typecheck。畫面用 Playwright 在本機 dev server 看過總覽（桌機、手機）、案件明細（已到場、時間已過待標記）、待標記篩選列表（手機）、站內通知、操作紀錄。

**待裁定**：總覽固定為 0 的兩格、送單兩則通知、通知是否顯示家長姓名、整站還原要不要用危險色。另外，CSV 改成中文欄名之後，若有外部流程讀英文欄名要先確認。

## 2026-10-02 官網預約拿掉同意勾選、手機場次卡一張一列（`feature/no-consent-20261002`）

業主裁定：正式站同意文字「送出需求後，仍須由園方確認參觀時間」和自選場次矛盾，**整段拿掉、不用勾選**。規則見 DESIGN.md 同日段落。

- **官網**：預約表單拿掉同意勾選框與同意版本邏輯（`utils/visit-consent.ts` 刪除）。有個資使用說明時仍保留「閱讀個資使用說明」。後台草稿預覽改成只預覽個資說明。手機場次卡一張一列。
- **後端**：
  - 公開送單不再要求勾選、不比對版本。
  - readiness、公開設定、總覽都不再因「沒發布同意文字」擋表單或列待辦。
  - 個資說明改成直接讀已發布預約文案，不綁同意文字；`consent_text` 改選填、不擋發布。
  - 補登仍要人員勾選。
- **後台**：拿掉「同意條款文字」欄位與總覽待辦；官網新案的同意紀錄寫「官網預約不需勾選同意」。
- **契約**：重新產生 `contracts/openapi.json`、`website-api.d.ts`。公開設定少了 `consent_revision_id`／`consent_text`，readiness 少了 `consent`，公開送單的 `consent_given` 預設 false。
- **stack 測試**：送單 helper 不帶同意欄位。原本「電話填錯直接點同意框」的位移回歸，改點同樣在電話下方的「親友介紹」勾選框。

**驗證**（Node 22）：
- backend pytest 全套（獨立測試庫 `ivy_website_test_noconsent`）1262 passed。
- `npm run contract:check` 一致。
- admin typecheck、vitest 69 檔 896 項；web typecheck、vitest 74 檔 730 項。
- stack e2e 整套 68 項全過；送出區分隔線修正後重 build，預約相關 5 支 spec 48 項全過。
- dev server＋假 API 390 寬：表單沒有同意勾選，不勾也能送出、結果頁「預約成功」；送單 body 不含 `consent_given`／`consent_revision_id`。場次卡一欄。
- 未驗證：iPhone Safari 實機。

## 2026-10-02 關於常春藤頁精修＋「家長怎麼說」（`feature/about-refine-20261002`）

使用者要「優化 /about 的 UI/UX、做精緻一點，先給 mock-up」，看過 `design/about-refine-mockup-20261002/` 後要「多加內容」，選了「家長怎麼說」，再說「先這樣實作」。J 立體書與 A2 六圈不換，規則與理由見 DESIGN.md 同日段落。

**改了什麼**（只動 `web/`：`AboutContent.vue`、`AboutWholePerson.vue`、`about.css`、`utils/about-popup.ts`、`tests/about.spec.ts`）：
- 首屏一屏放得下整本書、拿掉頁首下的米白縫；右頁兩張卡紙前後站；左頁下半放目次。
- 章名改中文（第一章～第四章）；右頁背面是章節封面，翻頁有背光與左頁影子；書脊改窄折痕；頁緣厚度跟著讀到哪裡變。
- 卡紙平躺時只看得到色紙；紙條改成有年份與校名的紙槽，左頁沿革跟著上色；鍵盤連按不再少走一站。
- 全人教育：領域圓點與六圈同色，滑過時那一圈亮。
- 我們的期許：引言側條改括號；紙房子加瓦片、煙囪、門把與沿牆長出來的常春藤。
- **新增第四章「家長怎麼說」**：讀各校後台的家長分享影片（目前義華 4 支），換人時卡紙倒下再站起來，按播放才載入 YouTube。
- 結尾五校書籤改成書底垂下的緞帶（含行政區），國際校的薄荷色看得見、手機一排五條。
- 首屏照片 alt 改「孩子們笑著圍在創辦人身邊」（使用者確認照片裡是創辦人）。

**驗證**（Node 22，dev server＋fixture）：
- `npm --prefix web run typecheck` 通過；`npm run test:website` 74 檔 743 項通過（`about.spec.ts` 新增 11 項）。
- Playwright 1440×900、390×844（DPR 2）與減少動態：四章翻開、卡紙站好、紙槽到第 5 站且左頁同步、常春藤長好、目次與頁碼 1–10 正確；第四章點第二位後清單與大卡紙、後排小卡正確，手機自動捲到影片，按播放插入 `youtube-nocookie.com/embed/U5kRPt7By90`；紙條 Home → →→ 停在 2005 崇德校；沒有 console error／page error、沒有水平溢出。
- 320／390／600／768／844×390／1280×720／1440×900 量卡紙都在舞台內；1440×900 首屏跨頁底 863px。
- axe（WCAG 2.1 AA，`#main`）1440、390 都沒有違規。
- 未驗證：iPhone Safari／Android 實機的 3D 翻頁與 `backface-visibility`；production build 的 LCP（首屏多一張 lazy 小圖）。
## 2026-10-02 招生入學後續修正（`feature/admissions-followups-20261002`，已部署：推送 `ac79a03`，隨 main `a2ed829` 上線）

招生入學併入 main 後使用者選定的五項後續修正，在同一分支完成（尚未部署）：

- **頁首學年選項放寬、統計子分頁寫進網址（X2a，e572fb3）**：頁首學年選項改為 [3,2,1,0,-1,-2]；統計分頁的子分頁用網址參數 `sub`（只在 `tab=stats` 且非總覽時寫入），重新整理或分享連結會停在同一個子分頁；網址帶 `sub=compare` 但只看得到一校時退回總覽。
- **名額規劃「計畫名額」欄加寬（X2a，7053d5f）**：欄寬 `min-width` 改 152，390px 輸入框不再被截成「..」。
- **功能開關關閉時側欄不顯示招生入學（X2b，b246839）**：`/auth/me` 與登入回應新增 `features.admissions`（取 `WEBSITE_ADMISSIONS_ENABLED`）；後台 auth store 存下（讀不到當關閉），側欄與側欄搜尋用 `canListNavItem` 過濾 `feature: 'admissions'` 的項目。路由守衛不擋，直接輸入網址仍看到「招生入學尚未啟用」。
- **五校比較件數跟頁首學期（X2b，978004f）**：`GET /admin/admissions/compare` 的 `semester` 改選填，沒帶＝件數算整學年（和總覽對得起來），名額剩餘用名額規劃的上學期；回應新增 `seat_semester`，表格上方依回應組說明句（例如「件數為 115 學年整學年；名額剩餘為 115 上學期（同名額規劃）。」）。

驗證（實際跑過）：

- 後端單檔 `pytest -q tests/test_auth_scope.py`（14 通過）、`tests/test_admissions_stats.py`（22 通過）。
- `npm run contract:check` 一致；`npm --prefix admin run typecheck` 無錯誤；`npm --prefix admin run test:unit -- --maxWorkers=2` 69 檔／897 測試全過。
- X2a 的 e2e:build＋admissions-flow 4 項通過、390／1440 截圖已檢視（見 X2a 報告）。

## 2026-10-02 預約頁 UI／UX 優化（`feature/visit-ux-20261002`）

使用者要「優化預約分頁（/visit）的 UI/UX」。先在正式站截 1440×900、390×844 兩種尺寸的選校、表單、聯絡方式三種畫面（沒有送出），再在本機用假 API 改版。規則與理由見 DESIGN.md 同日段落。

**改了什麼**（只動 `web/` 與 stack 測試，沒有後端與 migration）：
- **預約日期改月曆**（新元件 `VisitDatePicker.vue`、`utils/visit-month.ts`）：原本義華一次列 41 個日期的原生下拉。現在一次一個月，只有開放的日子能點，格內寫當天幾場；桌機月曆與當天場次並排。
- **參觀人數**移到「參觀安排」。
- **送出前確認**：送出鈕「送出參觀需求」改「確認預約」，旁邊寫出校區、日期、場次、人數。
- **Email 說明**：正式站沒開寄信（`parent_email_enabled: false`），原本卻寫「確認信與修改連結會寄到這裡」，現在依設定切換。
- **選校卡**標出「可線上預約」「來電洽詢」；所選校不開放線上預約時，步驟第二格寫「參觀方式」。
- **迎賓區收短**：1440×900、1280×720 的第一屏都看得到步驟列與選校卡上緣（原本整屏都是迎賓區）。
- 眉標「VISIT IVY」改「預約校園參觀」。
- 手機「下一步」黏在畫面底部。
- 結果頁標題下直接寫參觀時間與地址。
- `/visit/manage` 改場次也從「列出全部場次的下拉」換成同一個月曆＋當天場次。
- stack 測試：`tests/stack/pages.ts` 加 `pickVisitDate`／`pickVisitDay`（會自動翻月），`booking-flow`、`schedule-flow` 改用它與「確認預約」。

**待園方**：正式站同意文字「送出需求後，仍須由園方確認參觀時間」與自選場次矛盾，要在後台「預約文案」發布新版。

**驗證**（Node 22，已合併 main 的招生入學之後重跑）：
- `npm --prefix web run typecheck` 通過；`npm run test:website` 74 檔 732 項通過（新增 `visit-month.spec.ts`、`visit-ux-20261002.spec.ts`）。
- stack e2e 整套（production build＋真後端＋獨立測試庫 `ivy_website_e2e_visitux_test`）68 項全過。第一次整套是 67 過、1 敗：main 新加的 `admissions-flow.spec` 還用日期下拉，改用 `pickVisitDay` 後重跑全過。
- dev server＋假 API，1440×900／1280×720／390×844 走完選校 → 選日期場次 → 送出 → 結果頁，以及管理頁改場次：
  - 未選日期就送出，焦點到月曆第一個開放日並顯示錯誤；管理頁沒選日／沒選場次分別提示並聚焦。
  - 方向鍵換日會跳過沒開放的日子；翻月到最後一個有場次的月份為止。
  - 320／390 沒有橫向溢出；axe 只有 Nuxt devtools 工具列本身的問題；沒有 hydration 警告。
  - 選校卡標示讀進來前後 CLS 相同（0.0173，來自 dev 模式頁首）。
- 未驗證：iPhone Safari／Android 實機。

## 2026-10-02 招生入學模組（`feature/admissions-20261001`，階段 A–C 完成，2026-10-02 已部署 `2eafc1b`，功能開關關閉）

比照園務系統「招生入學」，在官網後台加參觀後的招生追蹤：已訪視 → 已預繳 → 已註冊 ｜ 退預繳／退註冊、名額規劃、統計分析與五校比較。三張表沿用園務名稱（`recruitment_visits`、`recruitment_event_log`、`grade_intake_targets`），併入園務時可整批轉移。規格 `docs/specs/2026-09-30-website-admissions-design.md`（第 17 節是計畫回寫對照），計畫 `docs/superpowers/plans/2026-10-01-admissions*.md`，規則見 DESIGN.md「招生入學（2026-10-01）」。分支疊在家長自選場次改版（`feature/parent-self-booking-20260930`）上。功能開關 `WEBSITE_ADMISSIONS_ENABLED` 預設關。

- **後端（階段 A）**：migration `4a7e2c9d1b63`（接 `c7d2e9f4a1b8`，三張新表＋`retention_policies.admissions_days`，只新增、不改寫既有資料）；訪視 CRUD、狀態轉換（不允許的 422、版本衝突 409）、保留座位與名額；預約標記「已到場」時在同一個交易建立招生訪視，時間已過還沒確認的預約列成待辦；保存政策新類別（預設不自動清理）；轉移契約 `contracts/ivy-recruitment/`、匯出程式與契約測試。
- **後台（階段 B）**：「招生入學」頁五個分頁（漏斗看板、訪視明細、名額規劃、官網預約、統計分析），篩選與分頁同步網址；看板可拖曳，也能用卡片選單「移到…」；預約明細的「標記已到場」加確認框並連到招生訪視；保存政策頁多「招生訪視」天數。
- **統計與驗收（階段 C）**：移植園務 `_query_stats`（KPI、四個比率、月度、年度、班別、來源、接待、未預繳原因、主管決策摘要、月比、警示、行動入口）與五校比較（`GET /compare` 回 `{as_of, school_year, semester, rows}`）；分母 0 回 `null`、畫面寫「—」；「未預繳原因」列未預繳明細（`/no-deposit-records`，含孩子姓名，不含電話、地址、生日）。stack e2e 跑通「家長自選場次 → 時間過後出現在官網預約 → 已到場 → 看板 → 預繳 → 註冊 → 名額已註冊 → 統計」；1440／390 截圖 12 張在 `output/playwright/admissions-*-{1440,390}.png`。
- **X1（B 留下的小項）**：testkit 預設 options 與 button 型別、轉換權限表測試改讀後端 `funnel.py`、訪視明細第 2 頁以後空狀態、保存政策「啟用後才有資料」。
- **C5 的 stack 調整**：招生流程的家長 context 帶獨立來源 IP，避開「每來源每校每小時 5 筆」的上限；「各校預約方式」截圖隱藏順序相依的通知鈕並重拍基準（含招生入學側欄）。
- 刻意與園務不同、併入時要決定的：`contracts/ivy-recruitment/README.md` 的差異清單（分母 0、月比、同票排序、來源不合併、警示指向、未預繳名單的排序與欄位、唯一幼生對匿名化的列以列 id 計等）。

驗證（實際跑過，log 在 `output/admissions-c6/`）：
- backend pytest 全套（`ivy_website_test_admissions`，先 `alembic upgrade head`）：**1 failed, 1261 passed, 163 warnings in 951.68s (0:15:51)**。唯一失敗 `tests/test_booking_consent_readiness.py::test_dashboard_lists_slots_campuses_without_openings` 是 main 既有、與招生無關的日期相依問題（2026-10-02 週五：規則 weekday=5、`max_advance_days=1`，存規則時場次同步補出明天週六的場次，未套 `min_lead_hours`；預約模組的場次同步程式與 `origin/main` 相同），本階段沒有修。
- `npm run contract:check`：契約型別與 openapi.json 一致。
- admin typecheck 與 build 通過；admin vitest：Test Files  68 passed (68)、Tests  884 passed (884)。
- web vitest（`npm run test:website`）：Test Files  70 passed (70)、Tests  707 passed (707)。
- production build 的 stack e2e 全套（`E2E_DB_NAME=ivy_website_e2e_test_admissions`）：68 passed (2.5m)；第一次整套是 64 passed (2.6m)、2 failed（roles 429、visual 各校預約方式），C5 修正後重跑全過。

**未驗證**：Safari／iOS 實機；看板的原生拖曳只在單元測試以事件模擬（e2e 走「移到…」）；正式庫 migration 與真實資料量下的統計速度。**已知小瑕疵**：390px 名額規劃「計畫名額」欄的輸入框被欄寬截出省略號（`IntakePlanTab.vue`，頁面不溢出）。**上線前必須裁定**規格 Q1（預約同意書是否涵蓋參觀後的招生聯繫與紀錄、招生訪視保存天數），在那之前只在本機與測試環境使用。上線步驟在 `deploy/README.md`「招生入學（A／B／C 完成，仍未部署）」。

## 2026-10-02 手機版第三輪審查修正（`feature/mobile-ux-20261002`，已部署 `f520031`）

使用者要「看看手機版還能怎麼優化」。

**審查範圍**：
- 唯讀審查 12 頁 × 390×844／360×780／320×568／844×390，在 dev server 上以 fixture 模式跑 Chromium。
- 另用 production build 在 390 寬、9 Mbps、CPU 4 倍降速下量載入。
- 09-29 第二輪已修或列為待決定的項目不重複列。
- 每項發現都由我重測確認後才改。只改 `web/`；規則見 DESIGN.md 同日段落。

**修正**：
- **首頁 CLS**：拍立得的 WebGL 畫布（`paperPrints.ts`）原本先停在靜態位置，場景建好才移到 -70px，被算成版面位移。改成插入前就放在最終位置。
  - 捲完首頁：390 寬 0.2947 → 0.0000，1440 寬 → 0.0001。
  - 後台「網頁速度」的 CLS 也來自這裡。
- **關於頁立體書**：寬 490–900px（橫拿手機、平板直拿）時，卡紙比固定高度的舞台還高，往上壓到左頁文字與「往下捲」連結。實測疊到的高度：
  - 844×390：首屏 174px、紙房子 143px。
  - 900 寬：首屏 203px。
  - 改法：舞台最寬 480px 置中，高度下限依舞台寬（`cqw`）長。320–430 寬數字與原本相同，桌機不變。
- **對比**：
  - 環境頁還沒到的餐點原本整列淡化，12px 小字只剩 2.97:1；改成只淡化手寫大標（仍有 4.9:1）。
  - 關於頁「拉拉看」紙條白字壓橘底 2.89:1，改用 `--ink`（5.22:1），同 10-01 書籤的做法。
- **點擊範圍**：`/news`、`/news/<id>` 麵包屑「首頁」從 28×44 補到 44×44（同 10-01 `.breadcrumb` 的做法）。
- **入學頁**：320 寬「每天穿什麼」的印章 64px 擠進 56px 欄、壓進鄰欄；360 以下印章最寬等於欄寬。
- 新增 `web/tests/mobile-ux-20261002.spec.ts`（6 項）。改前快照 `versions/before-mobile-ux-20261002-082818/`。

**沒改、待決定或之後處理**：見 DESIGN.md 同日段落最後的清單。包括：
- 國際校書籤與桌面同色（1.00:1）。
- 拍立得時間戳在亮照片上的對比。
- 內頁主執行緒長任務（環境頁 4.7 秒、首頁／教學／入學約 3.2–3.4 秒，CPU 4 倍降速）。
- 內頁字型分片 330–470 KB。

**驗證**（Node 22）：
- `npm --prefix web run typecheck` 通過；`npm run test:website` 71 檔 699 項通過；fixture 模式 `nuxt build` 通過。
- 在 production build 上：
  - 10 頁 × 320／360／390／844×390／1440 全部捲完，沒有水平溢出、沒有 page error。
  - 關於頁三個舞台在 320–1024 共 8 種寬度實測，卡紙都不再超出舞台。
  - 入學頁 320／360／390 印章都在欄內。
- 未驗證：iPhone Safari／Android 實機。

## 2026-10-02 分校分頁線稿不再露出方塊底（`feature/mobile-ux-20261002`，已部署 `f520031`）

使用者反映首頁「分校資訊」五校按鈕有方塊底圖。線稿原圖是米白紙底（約 250,248,242），靠 CSS `grayscale(1) brightness(.72) contrast(3.2)`＋`mix-blend-mode:multiply` 融掉。iPhone（WebKit）只要把圖或它的祖先移到獨立合成層，multiply 就碰不到底色，整塊紙底露出來。09-24 `0620470` 修過轉場那一段，但之後加的換校描線遮罩、環境頁選中時轉動的分頁，仍會觸發同樣狀況。改 SVG `filter:url()` 也不行：Safari 在合成層上不套參照濾鏡。

- **墨線版素材**：`scripts/optimize-site-images.py` 從五校線稿另產 `campus-line-art-<校>-ink`，黑線、透明底，濃淡放在 alpha。
  - 曲線同 CSS：v＝clamp(2.304Y − 1.1)，alpha＝1 − v。疊在任何底色上的結果都是底色 × v，和 multiply 相同，但不用混合模式。
  - 每個尺寸縮圖後才套曲線（160／240／360／480／720w）。alpha 用有損 q70：和無損最多差 5/255，240w 約 5.5 KB，和原線稿相當。
- **用到的地方**：首頁分校分頁、常春藤環境頁五校分頁、預約結果都改用墨線版，拿掉 filter＋multiply。
  - 共用 `media-image.ts` 的 `lineArtInkImage()`。
  - 後台換過線稿（`lineArtMedia`）時沒有墨線版，照舊用原圖並掛 `is-blend`。
  - 淡彩速寫改從 manifest 取原線稿，不再讀分頁鈕的 srcset。
  - 淡彩層（只在 hover 裝置）仍是 multiply。
  - 桌機 hover 未選中分頁時，線條不再額外加深一級（brightness .72→.68），只保留不透明度變 1。
- 新增 `web/tests/campus-line-ink.spec.ts`（4 項）。改前快照 `versions/before-campus-tab-ink-20261002-072912/`。

驗證（Node 22）：
- `npm --prefix web run typecheck` 通過；`npm run test:website` 70 檔 693 項通過；fixture 模式 `nuxt build` 通過。
- Chromium 逐像素比對新舊做法（五校 × 48–220px × DPR 1–3 × 不透明度 .55–1）：平均差 1.9/255。較大的差異只出現在 DPR3 的 170／220px：原線稿 800×533 與 3:2 有些微比例差，造成 2px 垂直位移，肉眼看不出。
- dev server 實頁前後截圖：首頁 390／320、環境頁 390，平均差 0.4–0.6/255。
- 手機 390 實測：分頁載 240w 墨線版；淡彩速寫照舊載原線稿 480w；四張預覽卡畫成線稿；手動換校接手上色；無 console 錯誤。
- 未驗證：iPhone Safari 實機（本機只有 Chromium）。

## 2026-10-02 SEO／GEO 結構化資料補強（`feature/seo-geo-structured-data`，未部署）

- **web**（`web/app/utils/seo.ts`，只用已發布內容，不杜撰）：
  - 分校 `Preschool` 地址拆出 `addressRegion`（高雄市）與 `addressLocality`（行政區），地址與區名對不上就不拆；後台有填 Google 地圖網址時輸出 `hasMap`。
  - 分校 `sameAs` 只列該校自己的社群（目前只有義華）；沿用機構粉專的四校不列，不拿義華代填。
  - 首頁 `EducationalOrganization` 補 `logo`、`alternateName`（英文名）、`foundingDate`（1997，同關於頁）、全站 `socialLinks` 當 `sameAs`。
  - `NewsArticle` 補 `author`，`publisher` 帶 logo。
  - `llms.txt` 逐條列出各校常見問答（與分校頁 FAQPage 同一份）。
- **刻意不做**：經緯度、營業時間、評分（沒有已發布資料）；sitemap `lastmod`（維持既有「不虛構 lastmod」規則）；AI 爬蟲個別放行（`User-agent: *` 已放行）。
- **前提**：正式站 `NUXT_PUBLIC_INDEXING_ENABLED=false`，開放索引前以上都不會被搜尋引擎看到。
- **驗證**（Node 22.22.0）：web typecheck 0 錯誤；`npm --prefix web run test:unit` 69 檔 692 項通過（新增 3 項）。

## 2026-10-01 品質檢查與招生分析報告的後續修正（`fix/report-followups-20261001`，已部署 `6b76f11`）

- **文件**：
  - `docs/analysis/2026-09-30-award-quality-report.md`：官網品質自我檢查，依線上 `b216133` 更新。截圖與數據在 `docs/analysis/assets/2026-09-30-award-quality/`。
  - `docs/analysis/2026-09-30-enrollment-analytics-report.md`：招生分析只留階段 1、3，原階段 2 改由入學規格處理。交接檔是 `docs/handoff/2026-09-30-claude-enrollment-analytics.md`。
  - 唯讀檢查腳本 `scripts/audit-public-site.mjs`：擋下所有非 GET 請求。
  - 入學規格 `docs/specs/2026-09-30-website-admissions-design.md` 沒有一起提交，由 `feature/admissions-20261001` 提交；在那之前，報告裡指向它的連結會是斷的。
- **web**（品質報告 E1、E3）：
  - 關於頁五校書籤的字色改成 `--ink`，仁武從 3.96:1 提高到 5.22:1。
  - 關於頁行內校區連結、麵包屑「首頁」用透明偽元素把點擊範圍補到 44px，外觀不變。
- **admin**（招生報告 2.3 節）：
  - 流量面板說明改成「2026/09/30 起也計入內頁」，並提醒跨過這天的期間不能直接比較。
  - 成效漏斗的期間碰到 2026/10/01 以後，就不計官網確認率：自選場次送出即確認，這個比率必為 100%。
- **規則**：寫在 DESIGN.md 同日段落。
- **驗證**（Node 22.23.2）：

  | 項目 | 結果 |
  |---|---|
  | web typecheck | 0 錯誤 |
  | `npm run test:website` | 69 檔 689 項通過 |
  | admin typecheck | 0 錯誤 |
  | admin vitest | 54 檔 700 項通過（新增 1 項 10/01 確認率測試，另外 2 項改用 9 月區間） |
  | admin build | 成功 |

  本機 fixture 用 Playwright 在 390 與 1440 寬量測，修改前後對照：

  | 項目 | 修改前 | 修改後 |
  |---|---|---|
  | 仁武書籤對比 | 3.96:1 | 5.22:1 |
  | 校區連結可點範圍 | 70×32 | 70×44 |
  | 麵包屑「首頁」可點範圍 | 24×44 | 44×44 |

  分校頁「五所校園」的點擊不受影響。

## 2026-10-01 已完成改動併入 main（`merge/all-20261001`）

使用者要求把所有已完成的改動併入 main；家長自選場次一起上線，並裁定正式庫現有的預約資料都是測試資料、不必先備份。

- 基底：本機 `main` `2b05446`，已含全人教育 A2（`f718281`，web 已先單獨部署）與分校首次線稿（`099f03a`）。`03fc267`（09-24 舊的影片畫質提交）由那次合併以 ours 保留歷史，樹不變。
- 併入 `merge/branches-20260930b` 還沒上 main 的兩個提交：`8187ccf`（CI 後端 job 逾時放寬到 30 分）、`bad55bb`（09-30 下午部署紀錄）。
- 併入 `feature/parent-self-booking-20260930`（`0be93ea`，35 個提交，A–D 四階段）。
- 衝突只有 README／deploy/README 的日期段落，兩邊都保留。兩邊都改到的程式檔只有 `web/tests/fixtures/overlay-baseline-20260925.json`（首屏標點／預約 FAQ 文案）與 `web/tests/ux-critique-20260929.spec.ts`（首屏／預約結果圖示），區塊不重疊。
- 契約重產無差異；alembic 單一 head `c7d2e9f4a1b8`。這個 migration 會改寫資料：已有每週規則的 inquiry 校切成 slots，其餘切成 paused（各校到後台「參觀場次」設好後再開放）。
- 沒併：30 週年比稿（PR #12 draft，待業主拍板）、Renovate（PR #1）、`feature/admin-seo-analytics-retention-20260925`（WIP）、Desktop 工作目錄的未提交修改（LINE／Google 登入的舊稿，正式版已在 main；分析報告與招生入學規格草稿）。

驗證（Node 22.23.2）：backend pytest 1090 項（獨立測試庫；第一次在高負載下跑到 99% 後卡住、被 40 分鐘上限中止，重跑 13 分鐘全過）、schema guard、`deploy/tests` 20 項、`contract:check`；web typecheck（0 警告）、vitest 69 檔 689 項；admin typecheck、vitest 54 檔 699 項；production build 的 stack e2e 60 項（2.6 分）。

## 2026-10-01 分校資訊首次從線稿進場（未部署）

`CampusBoard.vue` 的預設中央校與左右預覽一起預畫線稿，首次露出後接續水彩上色、暈開成照片，移除「彩色 → 線稿 → 彩色」的順序。SSR 即標記首張等待狀態，素材載入與動畫期間暫停輪播計時；素材失敗、減少動態、強制色彩及無 JavaScript 保留照片 fallback。手動切換、自動輪播節奏沿用既有設定。

修正位於獨立 worktree `/private/tmp/ivy-campus-first-sketch-20261001`，基底為 `origin/main` 的 `392a41c`；原 Desktop 工作目錄的未提交修改保持不動。

驗證：Node 22，`npm --prefix web run typecheck` 通過；`npm run test:website` 65 檔 668 項通過；Playwright Chrome 桌機 1440×900、手機 390×844、線稿延遲下載、減少動態、強制色彩、無 JavaScript、線稿下載失敗共 7 種情境通過。桌機／手機逐幀確認首次上色前沒有彩色照片閃現，回捲不重播、手動切換正常，無水平溢出或 runtime error。截圖與狀態紀錄在 `output/playwright/campus-first-sketch/`；未測 Safari／iOS 實機，未 push 或部署。

合併驗證：修正提交 `099f03a`，整合本機 `main` 的全人教育 A2 後，typecheck 與 65 檔 665 項測試通過（A2 已移除原轉盤的 3 項測試）。

## 2026-10-01 全人教育右側採用 A2（`feature/whole-person-a2-20261001`，已部署 web）

依使用者指定，只替換 `/about#whole-child` 右側紙轉盤；左頁內容、DOM、列表、來源、連結、尺寸與元素位置保持。新增 `AboutWholePerson.vue`，六個透明圓聚合成全人，8.6 秒播放一次，依最新要求移除下方操作鈕，保留離開視窗暫停；減少動態、強制色彩和無 JS 顯示完成圖。移除原轉盤的樣式、事件、角度工具與 3 項專屬測試。

- 基底：最新取得的 `origin/main` `392a41c`；隔離工作目錄 `/private/tmp/ivy-website-whole-person-a2-20261001`。本機 fixture 預覽 `http://127.0.0.1:3931/about#whole-child`，未連正式 API、未修改 CMS。
- 驗證：Node 22.23.2 typecheck 成功；`npm run test:website` 65 檔 665 項全過（修改前 668 項，差額是已移除的轉盤測試）。Playwright 1440／1024／768／390／320px 左頁 DOM、所有元素尺寸與相對位置一致，無橫向溢出；移除按鈕後已重新驗證桌機與手機自動播放、離屏暫停與續播、減少動態、無 JS，無 page error。未驗 Safari／iOS 實機。
- 本機修改前快照 `versions/before-whole-person-a2-20261001/`（不納入提交）；截圖、左頁基準、檢查腳本與結果 `output/playwright/whole-person-a2/`。已依最新要求只部署 web（`f24d6e9b-cf09-4e5c-9fd6-7e4ecd88fe69`，SUCCESS），線上 release 與桌機手機驗證完成；本次提交保存已上線的六檔差異與紀錄，未 push。API／DB 部署不變，詳細紀錄見 `deploy/README.md`。

## 2026-09-30 下午已完成分支併入 main（`merge/branches-20260930b`，2026-09-30 經 main CI 部署）

併入三個已提交、worktree 乾淨的分支，各自說明見下方同日段落：`feature/tassels-five-20260930`（開場布幕流蘇固定五顆）、`feature/height-ruler-20260930`（首頁拿掉桌機章節指示）、`feature/mobile-perf-20260930`（手機效能第三輪）。合併基底是 main `7189998`（首屏筆刷的部署紀錄）。

- 衝突只有 README／DESIGN 頂部的日期段落，兩邊都保留。跨分支改到同一個程式檔的只有 `HeroVideo.vue`（首屏筆刷改文字、mobile-perf 在 `startVideo` 加頻寬判斷），區塊不重疊，自動合併結果逐行看過。
- 沒有新 migration，alembic 仍是單一 head `e9c3a7d5f214`；mobile-perf 只放寬 `TelemetryIn` 的頁面值（欄位本來就是 `String(16)`、無 CHECK），OpenAPI 契約與型別同步。
- 沒併：`feature/parent-self-booking-20260930`（規格待審、worktree 有未提交修改）、30 週年比稿（待業主拍板）、`feature/admin-seo-analytics-retention-20260925`（WIP 草稿；robots 跟著收錄開關 main 已有）、Renovate；`fix/visit-consent-blur-20260930`、`feature/social-films-20260925` 已用不同提交上線。

驗證（Node 22.23.2）：web typecheck（0 警告）、`npm run test:website` 65 檔 668 項；admin typecheck、vitest 49 檔 679 項（整套跑時另有三個 session 在忙、load 23，16 項 5 秒逾時，那 7 檔單獨重跑 133 項全過）；backend pytest 1037 項（獨立測試庫、先 `alembic upgrade head`）；`npm run contract:check`；production build 的完整 stack e2e 61 項全過（真 API＋拋棄式 PostgreSQL）。未驗：Safari／iOS 實機、正式站。

## 2026-09-30 首屏文字：「新發現」金色乾刷色塊、拿掉小標與找校區（`feature/hero-brush-20260930`，2026-09-30 經 main CI 部署）

依 `design/hero-brush-mockup-20260930/watercolor.html` 的定案（筆刷／金／原位／滿版裁切／關鍵字 -2°）改 `web/`：

- `HeroVideo.vue`：拿掉小標與「找校區」；「新發現」的黃色底線換成金色乾刷 SVG 色塊（字與色塊一起 -2°、.75 透明、進場由左刷到右）；標點有值才畫。
- `studio.css`／`typography.css`：刪掉底線與首屏小標樣式，加 `.hero-key`／`.hero-swatch`。
- `site-fixture.json`（與測試基準 `overlay-baseline-20260925.json`）：主標兩個標點改空字串。後端只匯入小標／說明／按鈕文字，不受影響。
- 後台首屏表單：說明改成「旁的標語」，小標欄位加「首頁不顯示」提示。
- 測試：`ux-critique-20260929.spec.ts` 的「找校區」改成鎖住拿掉；新增 `hero-brush-20260930.spec.ts`。
- 驗證：`npm --prefix web run typecheck`（0 警告）、`npm run test:website`（65 檔 668 項）、`npm --prefix admin run typecheck`、`npm --prefix admin run test:unit`（49 檔 679 項）；dev server 上 1440／1280／390 的 12 幀對比與九種寬度，數字見 DESIGN.md 同日章節。改版前快照 `versions/before-hero-brush-20260930-145859/`。
## 2026-09-30 首頁拿掉桌機章節指示（`feature/height-ruler-20260930`，2026-09-30 經 main CI 部署）

使用者要把首頁右側的章節指示改成像身高尺。試了三個方向（`?ruler=a` 刻度＋滑動頭頂板、`b` 從上方填色、`c` 由下往上長高），看完決定整個不要：首頁不放章節／進度指示。

- 刪 `components/HomeChapters.vue`，`pages/index.vue` 不再掛它；`utils/homeChapters.ts` 只剩 `chapterForHref`（`chapterAt`、`ancestorIds`、`READ_LINE` 與三項測試一起刪）。
- `useChapterAnchors` 保留：頁尾「孩子的一天」照樣捲到關於簾幕擦完的位置。`index.vue` 的 chapters 只留 `id`／`after`。
- DESIGN.md「首頁四項效果」那條改成已拿掉、勿再提。修改前快照 `versions/before-remove-chapter-nav-20260930-143455/`。

驗證：Node 22 `nuxt typecheck` 結束碼 0；`npm run test:website` 64 檔 660 項通過。dev server（fixture）Playwright 1440×900、390×844：首頁沒有章節指示，點頁尾「孩子的一天」網址變 `#life`、讀線元素在 `#life` 內，沒有 console／page error。
## 2026-09-30 手機效能第三輪：環境頁載入中卡操作、首屏影片拉長 LCP、three 首屏預取、內頁沒有 CWV（`feature/mobile-perf-20260930`，2026-09-30 經 main CI 部署）

處理 `output/playwright/mobile-perf-deep-20260930/report.md`。報告量的是 main `0a00625`，這裡也從同一個 main 開 worktree 修（`/private/tmp/ivy-website-mobile-perf-20260930`）。規則見 DESIGN.md 最上方「手機效能第三輪」。改版前快照：`versions/before-mobile-perf-20260930-131548/`。

量測條件同報告：Nuxt production build＋fixture、Chrome 154、390×844 DPR 3 觸控、正常快取但每輪新 context；「慢速」＝1.6 Mbps／RTT 150 ms／CPU 4×。基準是同一個 main 未修改的 build，兩版並排跑。

- **P1 環境頁初始化卡住操作（已修）**：`rough-sketch.ts` 改成一批三段（prepare → 只讀的 measure → 只寫的 paint），藏線的路徑長度也集中量；fonts.ready 後只重畫幾何變了的宿主（原本整批再畫一次）；首屏以外的章節每 8 個宿主一批、每批之間等下一幀。載入中（5.9–6.2 秒間四個時間點）點手機選單：INP 基準 2,640／3,232 ms → 修正後 112–160 ms（選單都有開）；強制樣式與版面 2.6–3.0 s → 約 0.1 s；手繪層最長任務 1,583／1,897 ms → 每批 ≤67 ms（剩下超過 100 ms 的長任務是約 3.7 s 的 hydration，基準版也有）。減少動態：INP 3,504 → 176 ms、手繪層最長任務 2,173 ms → 每批腳本 ≤50 ms。
- **手繪結果**：reduced motion 下 106 張 svg 與基準逐一比對，只有曬衣繩那條繩子不同——基準版第二次重畫時 `scrollWidth` 把繩子自己的 svg 出血算進去，繩子多畫 30px（之後每次改寬還會再長），改用軌道寬度。正常動態下曬衣繩五張照片框與基準版不同：基準版是在 `is-windy` 傾斜轉場中途重畫、量到半途的角度；修改版只在轉場前畫一次，與減少動態時完全相同（18/18）。
- **P1 首屏影片拉長慢速手機 LCP（已修）**：影片第一幀比封面大 1px 列、一畫出來就成為新的 LCP。首屏影片在 `downlink` 低於 5 Mbps 時比照 3G 留靜態封面（其他影片不變）。慢速首頁 LCP 4.48 s → 1.42 s、16 秒下載量 2.95 MB → 0.75 MB；3 Mbps 2.81 → 0.93 s、5 Mbps（回報 4.3）2.54 → 0.84 s；8 Mbps 以上照常播放（LCP 1.94 s）。門檻依實測：LCP 約在 5 Mbps 越過 2.5 s。Safari／Firefox 沒有 downlink，行為不變。原本想用 Resource Timing 自己量這次載入的頻寬，實測小檔都被延遲主導（20 Mbps 只量到 3.5），不採用。
- **P2 three 無條件進首屏預取（已修）**：three 本身的 manifest 也關 prefetch；布幕由新的 `plugins/entrance-engine.client.ts` 在 plugin 階段就 import 引擎，日常紙張由 `utils/paper-warm.ts` 在載完 3 秒後的閒置時段或卡片接近時暖載（多等 3 秒是讓開首屏影片：同時下載時 20 Mbps 的 LCP 晚 0.1–0.2 s；延後後四輪中位數基準 1.44 s、修改版 1.42 s）。減少動態的首頁不再下載 three（747 → 602 KB），LCP 不變；已看過布幕的首頁 three 改在載完後才抓。首訪布幕 A/B：9 Mbps 開演 1.63／1.54 → 1.61／1.63 s、5 Mbps 3.13／2.88 → 3.20／2.98 s，都照常播（plugin 比照 EntranceCurtain，hydration 晚過 1.8 s 就不抓引擎）；3 Mbps 以下兩版都超過 2.8 s 上限而略過。
- **P2 新內頁沒進 CWV 回報（已修）**：`/about` `/curriculum` `/environment` `/admission` `/news`（含內文頁，一律記成 `news`）也回報瀏覽與 LCP／INP／CLS。改了 web `shared/telemetry.ts`、後端 `TelemetryIn`（page 欄位本來就是 String(16)、無 CHECK，不用 migration）、OpenAPI 契約、後台頁面名稱（沒改會被標成「預約參觀（選校）」）。**上線後注意**：後台總瀏覽量、手機比例從這天起多了內頁，與之前不連續；「網頁速度」p75 仍是全站一個數字（現在含內頁，環境頁會拉低 INP）。線上 telemetry 開關、配額是否夠用沒查。
- **P2 內頁首屏字型與圖片（只量測、沒改）**：內頁 LCP 圖都在 0.3 s 左右就以 high priority 開始下載，慢的是 1.6 Mbps 下跟字型分片搶頻寬——例如 /about 首圖 142 KB 從 0.38 s 下到 3.94 s，同時段 LINE Seed 700 的 001–004 分片（約 160 KB，inline `font-subsets.css` 宣告，頁面下方標題就會觸發）與 3.35 s 起 extended 樣式表的 ExtraBold 分片一起下載。要改得重切分片（首屏 critical 涵蓋各頁第一屏、其餘延後），屬於字型管線與品牌字呈現的取捨，留待決定。

驗證：web `nuxt typecheck`、`npm run test:website` 64 檔 666 項；admin `vue-tsc`、vitest 679 項；backend 全套 pytest 1037 項（獨立測試庫、先 `alembic upgrade head`）；`npm run contract:check`；production build 的完整 stack e2e 61 項全過（含 hydration／a11y／keyboard 走到環境頁）。量測腳本與原始數據：`output/playwright/mobile-perf-deep-20260930/fix-20260930/`（`probe.cjs` 載入／點擊、`compare-svg.cjs` 手繪 svg 逐一比對、`cross.cjs` 跨模式比對照片框；已 gitignore）。未驗：iPhone Safari 與 Android 實機、線上 CMS 內容、真實網路下 downlink 的分布（門檻只在 DevTools 限速下定）。

## 2026-09-30 家長自選場次預約（`feature/parent-self-booking-20260930`，尚未 push、未部署）

業主裁定官網預約只剩「家長自選場次、送出即預約成功」。規格 `docs/specs/2026-09-30-parent-self-booking-design.md`，計畫 `docs/superpowers/plans/2026-09-30-parent-self-booking*.md`，規則見 DESIGN.md「家長自選場次預約」。

- **後端（階段 A）**：Email 必填、送單即成立並回修改連結（HMAC 重算，不存原始 token）；家長可直接改場次、改資料、取消；確認信、變更信、取消信走 outbox；後台列表分組與 `group-counts`；migration 把有規則的 inquiry 校切 slots、其餘切 paused。
- **官網（階段 B）**：表單只剩自選場次與 Email 必填、422 對到欄位；結果頁寫預約成功、修改連結與複製鈕；管理頁直接改場次、修改資料、取消。
- **後台（階段 C）**：列表改預約正常／時間已過／已取消；明細拿掉聯絡中、可重寄確認信；補登必選場次；預約方式拿掉填表與人工確認；「時段與容量」與「接待月曆」併成「參觀場次」頁（固定場次卡＋月曆＋當天清單）。
- **端到端（階段 D）**：`tests/stack` 改寫成真 API＋真官網＋真後台，確認信寫進本機 sink 資料夾核對；順手修未讀圓點缺 `role` 的 a11y 問題。

驗證：backend／web／admin 單元測試與 `tests/stack` 60 項在隔離測試庫全過（指令與輸出見交審回報）；視覺基準 `visit-detail`、`booking-settings` 因後台改版重拍。

**未驗證**：Safari／iOS 實機；真實 SMTP 投遞（本機只寫 sink，`parent_email_enabled` 以有無 `WEBSITE_SMTP_HOST` 判斷）；真後端上的後台畫面逐頁人工檢查只用 mock 與 stack 截圖。上線前人工步驟在 `deploy/README.md` 草稿。

## 2026-09-30 參觀報名第二輪 E2E：多分頁錯筆、同 key 重送誤報額滿、截止後操作列消失（`fix/visit-e2e-20260930`，2026-09-30 經 main CI 部署）

處理 `output/playwright/visit-e2e-20260930-round2/REPORT.md`。報告同樣在落後 main 的 `5e34c5d` 上測，四項都對 main 重新查證：三項仍在、一項 main 已修。

- **P1 多分頁取消／改期錯筆（已修）**：同一個瀏覽器的分頁共用 `ivy_parent_session`，後開的連結蓋掉前一筆；回舊分頁按取消，後端照 cookie 取消了另一筆。官網的取消與改期改成帶 `visit_request_id`（畫面上的案件），和 session 的案件對不上回 `409 PARENT_SESSION_CHANGED`、兩筆都不動（沒帶照舊依 session 處理：CD 先部署 API 再部署 web，部署前開著的舊版家長頁取消不帶 body，發布版本需前後相容）；家長頁顯示「其他分頁開啟了另一筆預約的管理連結，這一頁的預約沒有任何變更」，請家長重開這筆的連結，不自動換成另一筆。契約（`openapi.json`、型別）與規格第 318 行同步。
- **P2 同一案件併發改期兩筆 pending（main 已修）**：`95440a0` 起 `create_reschedule_request` 先鎖案件列再查 pending。補一項固定交錯的回歸測試，確認只留一筆、另一個回 `RESCHEDULE_PENDING`。
- **P2 同 key 併發重送最後名額誤報額滿（已修）**：重播查詢在拿校區設定列鎖之前，慢的請求等到鎖後直接判定額滿（201＋409 `SLOT_FULL`）。`submit_visit_request` 拿到鎖後先再查一次同 key 案件（原本只在手機上限那條路補查，這次合併成一處）；路由的鎖外預檢判定失敗時也先補查，已建立就回原收據 200。同 key 不同內容仍回 `IDEMPOTENCY_CONFLICT`。
- **P3 改期送出時跨過截止，操作列消失（已修）**：`manage.vue` 的操作列只看 `showReschedule`，改期表單還多看 `can_reschedule`，截止後兩邊都不顯示。改成 `cancelOpen`／`rescheduleOpen` 一組條件，面板收起操作列就回來。
- 沒動的兩個觀察（報告也沒列為缺陷，待業主決定政策）：改期目標場次選好後被訂滿，仍可送出待審申請（核准時才擋）；取消成功但回應遺失時，重試只看到「連結失效」、拿不回取消回執。

回歸測試：後端 `test_parent_access.py` 多分頁一項、`test_booking_concurrency.py` 三項（同 key 重送在鎖上等待／在預檢時對方已提交、同案件併發改期），用 `asyncio.Barrier` 包住 `find_replay`／`precheck_submission`／`create_reschedule_request` 排出固定交錯，連跑 5 次穩定；stack e2e `booking-flow.spec.ts`「家長管理頁的邊界情況」兩項（兩個分頁取消、改期途中過截止）。除了已修好的併發改期，其餘在修正前的程式上都失敗。既有測試的取消／改期呼叫補上 `visit_request_id`，另加一項舊版官網（取消不帶 body、改期不帶 id）照常可用。

驗證：backend 全套 pytest（獨立測試庫、先 `alembic upgrade head`）1034 項全過；web `nuxt typecheck`（無警告）、`npm run test:website` 64 檔 663 項；admin typecheck、vitest 49 檔 679 項；`npm run contract:check`；production build 的完整 stack e2e 61 項全過。未驗：Safari／iOS 實機、多分頁情境下的實際 LINE／Email 通知。

## 2026-09-30 參觀表單：欄位填錯後第一次點擊落空（`fix/visit-consent-blur-20260930`，2026-09-30 經 main CI 部署）

處理 `output/playwright/visit-e2e-20260930/REPORT.md` 的兩個 P3。該報告是在落後 main 364 個提交的 `feature/website-admin` 上測的，這裡都對 main 重新查證。

- **問題 1（已修）**：電話填錯直接點同意框要點兩次。滑鼠或觸控按下的當下電話欄就 blur，錯誤訊息插入把下方推下 31.5px，`mouseup`／`click` 落在 `FIELDSET`。main 上一樣重現，而且「Email 填錯直接按送出」第一次也按不到送出鈕。只在剛填的欄位還在畫面上時發生：目標在畫面外時瀏覽器先捲動，Chrome 的 scroll anchoring 剛好把位移補掉。`VisitForm.vue` 五個欄位的 blur 驗證改走 `checkFieldOnBlur`，按住主鍵期間只記下欄位，放開、click 跑完才顯示錯誤；鍵盤 Tab 照舊立即顯示，版面不變。規則見 DESIGN.md「預約校園參觀 A」。
- **問題 2（main 已修，不用動）**：已關閉場次顯示「名額剛好滿了」。main 在 `1f32f7d` 改成回 `409 SLOT_CLOSED`，前端顯示「這個時段剛被園所關閉了，請選擇其他時段。」，後端（`test_request_id_and_error_codes.py`）與前端（`visit-form.spec.ts`）都有測試。
- 回歸測試：`tests/stack/booking-flow.spec.ts`「填寫中的即時驗證」三項（桌機滑鼠、手機觸控點同意框；Email 填錯直接送出），`openAs` 多一個選填的 `device` 參數（手機視口與觸控）。三項在修正前的 main 上都失敗。

驗證：web `nuxt typecheck`（無警告）、`npm run test:website` 64 檔 663 項；新回歸測試在 nuxt dev 上連跑 3 次共 9 項全過；production build 的完整 stack e2e（真 API＋拋棄式 PostgreSQL）59 項 58 過，唯一失敗是已知的 `media.spec.ts` 整套跑順序問題（`home_about` 最新版沒有 `photo`），同一份 build 單獨跑會過。另外手動確認：鍵盤 Tab 離開電話欄仍然立即顯示錯誤；點別處後 `0912-345-678` 照常正規化成 `0912345678`。未驗：Safari／iOS 實機（iOS 點 checkbox 時 blur 的時間點可能不同）、正式站。

## 2026-09-30 義華外觀照換成完整、較高解析的 v2（`feature/yihua-photo-20260930`，2026-09-30 經 main CI 部署）

使用者反映首頁五校卡的義華校圖片下半部被裁掉，舊官網有完整的圖，要換成完整的並提高畫質。原因是版面：五校卡桌機 2.13:1、舊圖 1.52:1，塔尖和地面放不進同一張卡，舊設定 `center 12%` 只保塔尖。規則見 DESIGN.md 最上方「義華外觀照改用 v2」，來源與處理步驟見 `design/yihua-photo-v2-20260930/README.md`。改版前快照：`versions/before-yihua-photo-v2-20260930-092510/`。

- **新母檔** `web/public/assets/yihua-exterior-v2.webp`（2820×1684）：舊站 Wix 原始上傳（1560×1123）左右延伸背景（LaMa）後以 Real-ESRGAN 放大，招牌字形換回原圖的保守放大。響應式多 1600／2000／2400 三級（`scripts/optimize-site-images.py` 的 `OVERRIDES`），分享圖 `og/yihua-exterior-v2.jpg`。
- **資料**：`web/server/data/site-fixture.json` 義華 `image` → `yihua-exterior-v2`、`panoramaPos` `center 12%` → `center 36%`、`heroPhotoPos` `85% 8%` → `85% 16%`；後台「五校介紹」內建封面（`CampusProfileView.vue`）同步；`media-slots.spec.ts` 的比對基準照慣例更新這三欄。`content/site-fixture.json` 的圖與焦點後端不讀，沒改。
- **淡彩速寫**：`campusSketch.ts` 義華對位換算成 v2（照片對照片的相位相關再套舊表），疊圖與動畫截圖確認塔尖、窗框對齊。

驗證（Node 22.23.2，rebase 到 main `2dfd269` 後重跑，fixture 模式 dev server）：web `nuxt typecheck` 通過（0 警告）、vitest 64 檔 663 項；admin `vue-tsc -b --noEmit` 通過、vitest 49 檔 679 項。Playwright（Chrome）1920／1440／1280／1000／390 寬截首頁義華卡與 `/campuses/yihua` 封面，零 page error，各寬度選到預期的衍生檔；首頁淡彩速寫三階段、義華當鄰卡的靜態線稿與換回時從線稿接手上色；預約頁縮圖。未驗：stack e2e、正式站、Safari／Firefox 與手機實機。
## 2026-09-30 開場布幕流蘇固定五顆

使用者要求開場動畫的金色流蘇由四顆改成五顆。原本帷幔垂花數依畫面比例 `max(2, floor(aspect×2.4+0.5))`，流蘇掛在內側綁點，所以 1440×900 是三顆、較寬螢幕四顆、手機一顆。`web/app/utils/entranceCurtain.ts` 改成固定六段垂花（`VALANCE_SWAGS`），任何比例都是五顆；手機也跟著變五顆，垂花較窄、流蘇間距約一顆流蘇寬。五張首屏海報（`web/public/assets/entrance-poster-*.webp`）用 `render-posters.cjs` 重產並更新 `ENTRANCE_POSTERS` 版號，比例分檔不變；預覽 `velvet.js` 重新產生（main 上原本就落後，一併追上）。

驗證：Node 22 `nuxt typecheck` 0 個 `error TS`；`npm run test:website` 64 檔 663 項通過（rebase 到 `7861fc6` 後重跑）。dev server（fixture）用 Playwright（Metal）實跑開場：1512×790、1440×900、390×844 倒數期間都是五顆，拉幕後帷幔連同流蘇飛出，無 console／shader error。Safari／iOS 實機未驗證。2026-09-30 經 main CI 部署。

## 2026-09-30 已完成分支併入 main（`merge/branches-20260930`）

併入三個已提交、沒有在途修改的分支：`feature/sketch-preview-20260929`（首頁五校左右預覽改線稿）、`claude/backend-ui-ux-optimization-y5ndf4` 在 PR #17 之後的 16 個提交（2026-09-29 業主裁定：同事顯示名稱、操作紀錄的操作者、側欄只留參觀案件數字、隱藏官網不顯示的欄位、「個資與搜尋設定」改名）、`feature/ux-admin-20260929`（後台第六輪 UX，取捨見下方該段）。

- migration `e9c3a7d5f214`（`users.display_name`，只加可為 NULL 的欄位、不回填）改接 main 當下的 head `e4c1a7f3b862`，維持單一 head；不改寫既有資料，依 `deploy/CICD.md` 不需先備份正式 DB。
- 沒併：30 週年比稿（PR #12 草稿，待業主拍板）、Renovate、已用 cherry-pick 上線或被後續定案取代的舊分支。
- 後台截圖基準（`tests/stack/visual.spec.ts-snapshots/`）停在 09-27，PR #15 之後本來就對不上，這次依合併後畫面重拍；頁首未讀連結在截圖時隱藏（出不出現要看其他測試），家長姓名改 h2 後 e2e 改用 h2 找。

驗證：admin typecheck、vitest 49 檔 679 項；web typecheck、`npm run test:website` 64 檔 663 項；backend pytest 1029 項（獨立測試庫、先 `alembic upgrade head`）＋ schema guard；`npm run contract:check`；admin／web production build；本機 stack e2e 56 項（真 API＋拋棄式 PostgreSQL＋production build）。

## 2026-09-29 首頁五校：左右預覽改成線稿（`feature/sketch-preview-20260929`，尚未部署）

使用者回報首頁五校左右滑時，鄰卡是彩色照片、滑到中央後才被淡彩速寫蓋成黑白線稿再上色（彩色→黑白→彩色）。改成不在中央的卡一律顯示靜態線稿，換到中央才上色：手動換校從線稿直接上水彩再暈開回照片，自動輪播只暈開；離開中央的那張邊滑邊淡回線稿。第一次捲到的淡彩速寫、減少動態／強制色彩（維持照片）不變。規則見 DESIGN.md「首頁水彩」的「左右預覽是線稿」。改版前快照 `versions/before-sketch-preview-20260929-191717/`。

- `web/app/utils/campusSketch.ts`：抽出共用的線稿底圖（`sketchSurface`／`paintPaper`／`paintGrain`），新增 `paintSketchStill`；`developSketch` 加 `from: 'sketch'`（同步接手、跳過描線）與 `wash: false`（只暈開）。
- `web/app/components/CampusBoard.vue`：`lineArt`（校名 key）→ 卡片 `data-art="line"`；換校時舊卡 `showLineArt`、新卡依有無線稿走 `runDevelop(…, 'sketch', !automatic)`；卡片尺寸變了才重畫線稿；暈開期間也暫停輪播計時。

驗證：web `nuxt typecheck` 通過；vitest 63 檔 658 項通過（含 `home-watercolor.spec.ts` 新增的 5 項）。dev server（fixture）Playwright：1440×900 初始四張鄰卡 `data-art=line`、照片 opacity 0；點右鄰卡 → 線稿抵達、上水彩、照片暈開，舊卡淡回線稿；自動輪播換校只暈開；390×844 觸控拖曳拖進來的是線稿；減少動態與強制色彩五張都是照片；1440→1000 縮放後 canvas 依新卡片尺寸（0.85 倍）重畫；無 pageerror。未驗：Safari／iOS 實機、正式站。

## 2026-09-29 白箱資安稽核修正（`fix/security-audit-20260929`，2026-09-29 經 main CI 部署）

依白箱資安稽核的發現分六個工作包修正（auth、booking、media、platform、ops、web），部署前後的人工步驟與新環境變數見 `deploy/README.md`「2026-09-29 資安稽核修正」。分支已合併 main（`576672c`，PR #13–#17）：PR #14「系統設計審查第一批修正」已先上線其中幾項（限流獨立連線池、`statement_timeout`、圖片 EXIF 無損清理、uvicorn 存取紀錄去查詢字串、production 關閉 API 文件、同源代理擋 `..`、SSR 逾時與退回上一份內容），合併時同一機制只留一份、以 PR #14 的實作為底，本分支較嚴的行為補在上面；下列各項已照合併後的狀態改寫。業主裁定：密碼登入 5 分鐘錯 10 次鎖該帳號密碼登入 15 分鐘（Google／LINE 不受影響）；公開預約內建 Cloudflare Turnstile（兩把 key 都設才啟用）＋每來源／每校上限＋IPv6 /64 聚合；`analytics_events` 不清除，改用全站每分鐘與每日上限。

- **公開預約**（booking）：Cloudflare Turnstile 伺服器端驗證（`app/booking/turnstile.py`；官網 `VisitForm` 有 `turnstile_site_key` 才載入元件，送單失敗一律重設元件，`BOT_CHECK_FAILED`／`BOOKING_LIMIT` 顯示伺服器訊息）；每來源 24 小時占位上限與每校每小時送單上限（429 `BOOKING_LIMIT`）；`/public/slots` 改一次 GROUP BY 並加每來源限流；送單在上列鎖之前做完限流與預檢，鎖內不再向限流器要連線；payload hash 改 HMAC，匿名化時一併換掉 hash 與 Idempotency-Key；保留前綴的 Idempotency-Key 回 422；自由文字拒收控制字元；後台 CSV 匯出改成下載（`Content-Disposition: attachment`＋`no-store`）。
- **後台登入**（auth）：帳號鎖在 bcrypt 之前檢查；bcrypt 改在 worker thread 並限制並行；登入成功／失敗／鎖定／登出與 LINE 登入寫稽核；session 改閒置逾時（預設 120 分鐘，12 小時絕對上限）與瀏覽器 session cookie；綁定／解除 LINE、解除 Google 超過 10 分鐘要重新輸入密碼（後台跳出輸入框）；總管理者可替別人「解除綁定並登出」，停權一併解除綁定；LINE callback 限流並讓 state 只能用一次；密碼欄位最多 128 字、新密碼最多 72 bytes。後台使用中收到 401 會導回登入頁（沿用 PR #15 的 `reason=expired` 與「登入已逾時，請重新登入；登入後會回到剛才的頁面。」提示，有未儲存修改時留在原頁）；本人改密碼套用 72 bytes 上限與帳號鎖提示（「我的帳號」的更改密碼 PR #15 也加了，合併後只留一個）。
- **素材**（media）：Pillow 10.4 → 12.3；圖片原檔去中繼資料沿用 PR #14 的無損做法（`app/media/metadata.py`，只留拍攝方向、像素不動），再收緊成白名單：JPEG 的其他 APPn（MPF、C2PA…）、多次掃描之間的區段與 EOI 之後的附加資料（多圖、動態照片），PNG／WebP 不認得的 chunk（含 iDOT）一併拿掉；影片以 ffmpeg 不轉碼重新封裝、去除地點與建立時間；清理寫到暫存複本，不再就地改寫來源檔（匯入官網內建素材時來源是 repo 裡的檔案），素材寬高以實際留下的方向為準；Pillow／ffmpeg 只解讀白名單格式；處理並行數 2；送檔前先釋放 DB 連線。既有素材要在部署後跑 `python -m app.cli strip-media-metadata`（先 dry-run，備份後再 `--apply`），PR #14 以前的圖片與所有影片都還沒清。
- **平台**（platform）：限流獨立小連線池沿用 PR #14 的 `create_rate_limit_engine`（3＋2 條、等 5 秒），補上拿不到連線時放行判斷一律當超限；主池大小改由 `WEBSITE_DB_*` 設定（預設同 PR #14 的 10＋10、等 10 秒）；連線在 PR #14 的 `statement_timeout` 30 秒之外再帶 `lock_timeout`／`idle_in_transaction_session_timeout`（定期工作持鎖的交易另外關掉 idle 逾時）；DB 例外不再把綁定參數寫進 log；存取紀錄沿用 PR #14 的 uvicorn access log 去查詢字串（本分支原本的 `--no-access-log`＋`app.access` 在合併時移除），INFO 改走 stdout、WARNING 以上走 stderr；production 關閉 `/docs`／`/openapi.json`（PR #14 已上線）；後台與登入回應 `no-store`、production 啟動硬性檢查 `WEBSITE_ADMIN_ORIGIN`／`WEBSITE_SESSION_SECRET`、可拆 migration 專用 DB 連線、Dockerfile 與 CI postgres 以 digest 釘版、CI 加執行期 Python 相依套件的 `pip-audit`。
- **營運**（ops）：telemetry 與點擊加全站每分鐘／每日上限（安靜丟棄）；LINE webhook 非 ASCII 簽章回 401；LINE 群組要在群組裡貼後台產生的一次性驗證碼才能被選為新的推播目標（migration `e4c1a7f3b862`，只新增欄位與表；後台「LINE 通知」頁有「產生驗證碼」與已驗證／未驗證標示）；發布舊版本一律用目前的欄位規則重驗。
- **官網**（web）：`web/server/middleware/0.security-headers.ts` 改為 `web/server/plugins/security-headers.ts`（nitro request hook，涵蓋靜態資源與後台入口 `/admin/`），後台頁面加上嚴格 CSP（`script-src 'self'`）；下方「2026-09-24 官網體檢第一批」描述的是舊檔，屬歷史紀錄、不改。API 代理在 PR #14 的 `..`／`%2e%2e` 檢查之外再拒絕前綴內的 `..`、編碼斜線、反斜線與控制字元（合併成一支 `escapesApiPrefix`，一律 404）、素材改有背壓的串流並在斷線時中止上游、`/public/telemetry` 只接受經 `/api/telemetry` 轉送、代理帶給 API 的 IPv6 訪客 IP 聚合成 /64、`/assets/**/*.mp4` 串流並支援 Range、公開站資料 3 秒快取（ETag 重新驗證，疊在 PR #14 的 8 秒逾時與退回上一份成功內容之上）；happy-dom 升到 20。
- **後台依賴**：admin 的 vitest 2 → 4.1.11（`npm audit` 0 筆）；`vitest.config.ts` 只對測試放行讀 `backend/app` 原始碼（Vite 6 起 `?raw` 受 `server.fs` 限制），CI 與 `admin/README.md` 拿掉 vitest 4 不認得的 `--minWorkers`。
- **審查後修正**（同日第二輪）：密碼驗證改成「進 bcrypt 名額後重查帳號鎖並原子扣帳號額度、成功前再查一次鎖」，同時灌進來的一批請求最多驗 10 次、排隊中開始鎖定的正確密碼也擋；驗密碼排隊上限 16，查完帳號就歸還主連線池的連線；429 分成 `LOGIN_LOCKED`／`LOGIN_RATE_LIMITED` 並帶 Retry-After，後台三處文案共用 `loginLimitedMessage`；session 延長拿不到連線時不延長、不回 500；後台依鍵盤／滑鼠輸入每 10 分鐘最多打一次 `/auth/me` 延長閒置期限，有未儲存修改的頁面收到 401 不導頁、改請本人在新分頁重新登入後回原頁繼續儲存。公開預約加「同一來源對同一校每小時 5 筆」（inquiry 模式單一來源用不光每校上限）、手機每 10 分鐘 5 筆改在校區設定列鎖內核對已建立筆數（併發不會越過，同 key 併發重送仍回同一張收據）；Turnstile 只在連線錯誤／逾時／5xx／`internal-error` 放行，secret 設錯放行但記 error，其他 4xx 與非 JSON 回應一律 400。telemetry／點擊加每來源每日上限、每日上限改固定 UTC 日窗口、開始丟棄時每窗口記一筆 warning。素材配額鎖的等候上限沿用 PR #14 的 300 秒（改由 `lock_timeout` 控制），等不到回 409 `MEDIA_BUSY`；同一個交易的 `statement_timeout` 放寬到 330 秒，等鎖逾時一定先到。一次性標記移到 `RateLimiter.consume_marker`／`marker_active`，bcrypt 與素材處理共用 `app/common/concurrency.py`，素材格式對照集中在 `processing.CONTENT_TYPE_BY_FORMAT`；移除沒有呼叫端的 `verify_password`／`record_login_attempt` 與後台使用者頁的死分支。e2e 的發布新鮮度改成在 3 秒快取 TTL 內重新載入輪詢（驗收 A23 同步註明）。仍未關閉：`admin-same-origin-as-public-site`、通用代理的 `/public/site` 沒有快取（見 `deploy/README.md`）。

驗證（reconcile 階段，Node 22、測試庫 `ivy_website_secfix_platform_test` 已 `alembic upgrade head`）：backend `test_secfix_auth.py`、`test_maintenance.py`、`test_secfix_platform.py`、`test_line_oauth.py` 140 passed，`test_secfix_booking.py`、`test_audit_coverage.py` 40 passed（新增的定期工作持鎖與 bootstrap-admin 慢輸入兩項，拿掉修正後實測會失敗）；`export_openapi.py --check` 與 `check-contract-types.mjs` 一致；admin `vue-tsc` 通過、vitest 37 檔 355 項通過、`vite build` 通過、npm 10 `npm ci` 可用新 lockfile；web `nuxt typecheck` 通過、vitest 61 檔 607 項通過；`deploy/tests` 20 項通過；執行期相依套件 `pip-audit` 無已知漏洞（開發用的 pytest 8.4.2 有一筆，未升級）。整合驗證（六個工作包與後台 UI 合併後，測試庫 `ivy_website_secfix_base_test`）：`alembic heads` 只有 `e4c1a7f3b862`，upgrade／downgrade -1／upgrade 來回通過，`alembic check` 無差異；backend 全套 968 passed（修正前基準 822）；`deploy/check_schema.py` 通過；`contract:check` 一致；web `nuxt typecheck` 無 Duplicated imports、vitest 61 檔 607 項；admin vitest 39 檔 368 項、`vite build` 通過；production `Settings`＋`create_app` 成功且沒有 `/docs`／`/openapi.json`，`.env.example` 的範例 secret 或缺 `WEBSITE_ADMIN_ORIGIN` 會被拒。未驗：瀏覽器實測（後台 CSP、Turnstile 元件、重新驗證對話框、LINE 驗證碼流程）、正式站。已 commit 於本機分支、未部署。

審查後修正的驗證（Node 22.23.2、測試庫 `ivy_website_secfix_base_test` 已 `alembic upgrade head`＝`e4c1a7f3b862`）：backend 全套 987 passed；`contract:check` 一致（只有公開送單端點的說明文字變動，已 `contract:generate`）；web `nuxt typecheck` 通過、vitest 61 檔 607 項；admin vitest 39 檔 373 項、`vue-tsc -b && vite build` 通過。未驗：stack e2e 與 `release-freshness.spec.ts`（只改了等待方式，沒有實際跑）、瀏覽器實測（後台閒置延長與「登入已逾時」對話框）、正式站。已 commit 於本機分支、未部署。

合併 main（`576672c`）後的 backend 去重與驗證（worktree `/private/tmp/ivy-website-security-fix-20260929`，測試庫 `ivy_website_secfix_platform_test` 重建並 `alembic upgrade head`，`alembic heads` 只有 `e4c1a7f3b862`）：`app/db.py` 兩份 `create_rate_limit_engine` 合成一份；`app/common/request_id.py` 的 `app.access` 存取紀錄、`main._configure_logging` 與 `deploy/api-start.py` 的 `--no-access-log` 移除，改由 `app/logging_config.py` 一份負責（stdout／stderr 分流移植過去）；`app/media/metadata.py` 兩套圖片清理合成 PR #14 的無損版加白名單；API 文件的重複測試併進 `test_logging_config.py`。`test_media_metadata.py`、`test_secfix_media.py` 28 passed；`test_secfix_platform.py`、`test_logging_config.py` 34 passed；`test_rate_limits.py`、`test_booking_concurrency.py`、`test_maintenance.py` 31 passed；`test_secfix_auth.py`、`test_secfix_booking.py`、`test_secfix_ops.py` 103 passed；`test_request_id_and_error_codes.py`、`test_health.py`、`test_config_isolation.py`、`test_media*.py`、`test_security_hardening.py` 122 passed；`deploy/tests` 20 項通過；全部改完後再跑一輪 14 檔（上述 media、platform、logging、限流、預約併發、定期工作，加上 `test_audit_actions.py`、`test_bugfix_regressions.py`、`test_traffic.py` 等會上傳素材或數限流的測試）209 passed；`export_openapi.py --check` 與契約一致。admin／web 的合併另行驗證。已 commit 於本機分支、未部署。

合併 main 後的整合驗證（Node 22.23.2、測試庫 `ivy_website_secfix_base_test` 重建並 `alembic upgrade head`）：沒有殘留衝突標記；`alembic heads` 只有 `e4c1a7f3b862`；backend 全套 1001 passed（合併前本分支 987）；`deploy/check_schema.py` 通過；`deploy/tests` 20 項通過；`contract:check` 一致；web `nuxt typecheck` 通過且沒有 Duplicated imports、vitest 62 檔 630 項；admin vitest 46 檔 628 項、`vue-tsc -b && vite build` 通過；production `Settings`＋`create_app` 成功、沒有 `/docs`／`/openapi.json`，主池 10＋10、限流池 3＋2。web 的 `proxy-guard.spec.ts` 已併入 `request-guard.spec.ts`。未驗：stack e2e、瀏覽器實測、正式站。已 commit 於本機分支、未部署。

## 2026-09-29 關於常春藤頁改成立體書（`feature/about-popup-20260929`）

使用者看完五批 /about 比稿後選 J 立體書（`design/about-style-directions-20260929/j-popup.*`），要求不特別強調 2005 → 2020 相隔十五年。規則見 DESIGN.md「關於常春藤頁改成『立體書』」。改版前快照：`versions/before-about-popup-20260929-*/`（在 Desktop 工作目錄）。

- **版面**：整頁是攤在淡綠桌面上的立體繪本，每段一個跨頁（左頁文字、右頁照片卡紙）；桌機捲到時右頁從闔上翻開、卡紙站起來。首屏不翻。
- **01 一路走來**：右頁拉紙條，五站等距，拉過哪一站那一校站起來；翻開時紙條自己示範拉到底。鍵盤可操作（slider）。
- **02 全人教育**：紙轉盤，拖著轉或按「轉一格」，窗口顯示一個領域。**03 我們的期許**：折起來的紙房子。結尾五校書籤。
- **技術**：新增依賴 `motion`（motion.dev；production build 的動態 chunk 約 45 KB gz），只在這頁動態載入；動態在 `web/app/utils/about-popup.ts`；`about.css` 改寫為 `abk-*`，不再掛 `admission.css`；首屏照片改 `ABOUT_HERO_SIZES`（頁面與預載共用）。頁面內容不放預約參觀（頁首預約鈕照舊）。

驗證（Node 22）：`npm --prefix web run typecheck` 通過；`npm run test:website` 57 檔通過（`about.spec.ts` 新增紙條、轉盤、無 JS 狀態、無預約連結等測試；`page-hero.spec.ts` 改驗 `ABOUT_HERO_SIZES`）。fixture 模式 dev server 以 Playwright 實測 1440、1024、768、390、360、320：無水平溢出、無 console 錯誤；翻頁、卡紙彈起、紙條示範、紙條鍵盤（Home＋→×2 = 2005 崇德校）、轉盤（轉兩格 = 語文）、系統減少動態都正常；標題各寬度都是兩行。fixture 模式 `nuxt build` 通過（三個 postcss 警告都是既有的首頁 hero calc）。未驗證：Safari／iOS 實機（3D 翻頁、`container` 單位、`mask` 兩層）、低階手機、stack e2e（交給 CI）。

## 2026-09-29 常春藤環境頁「五所校園」拿掉照片上的標註箭頭（`feature/env-no-spots-20260929`）

使用者要求拿掉 `/environment` 第四章照片上的標籤與紅筆箭頭（截圖是國際校美語商店街的「餐廳」）。確認範圍後改成整章都不畫（原本 42 個）：刪掉模板的 `.renv-spot`、`utils/rough-sketch.ts` 的 `layoutSpotBoxes`／`placeSpots`／`spot` 繪製、對應 CSS 與單元測試；章節說明「照片與標註」改成「照片」。01、02 章的便利貼＋箭頭與分校頁校園探索的熱點不動。規則見 DESIGN.md「常春藤環境頁手繪版」。

## 2026-09-29 手機版體驗優化（`claude/mobile-experience-optimization-60rfw2`，PR #13）

使用者要求「優化手機版的體驗」。先分八區在 390×844、360×780、320×568、844×390 以 Playwright 實測審查（77 項發現），每區再由懷疑者重測反駁、對照 DESIGN.md 定案，只做確認成立且不違反定案的項目；分七組、檔案不重疊實作，每組再由獨立審查者重測。只改 `web/`（外加 `scripts/optimize-site-images.py` 的線稿候選）。規則與待業主決定的清單見 DESIGN.md「手機版體驗優化第二輪（2026-09-29）」。改版前快照：`versions/before-mobile-ux-20260929-082521/`。

- **頁首與選單**：選單卡外加透明遮罩，點卡外不再點到底下的影片圓點或分校照片；焦點離開頁首就關選單；觸控點過的漢堡、預約、選單五校不再黏著 hover 底色；文字放大或視窗很窄時頁首換行，漢堡與預約不再被推出畫面；分校頁「預約參觀」直接帶到該校；首頁膠囊校徽點了回頂端；主要行動元素有按下回饋。
- **首頁**：收合「關於」介紹不再跳走；首屏副文案在標點處換行；「孩子的一天」圖說與暫停鈕在拍立得碰到時就讓位（含橫向），暫停鈕改 Phosphor 圖示，封面恢復延後載入；五校照片滑動跟手、觸控不留 hover、200% 文字不溢出、進度條改 CSS 動畫；活動影片被拒自動播放時按鈕顯示正確；活動對話框標題列 sticky、點背景關閉；消息縮圖 sizes 改 160px；橫拿手機不再下載桌機影片母帶；章節指示只在桌機綁捲動。
- **捲動位置**：新增 `web/app/router.options.ts`：各頁重新整理不再先還原又被拉回頁首；從消息單篇按上一頁回首頁停在消息列表，不再掉到頁尾；帶 hash 的網址重新整理停在原位。
- **最新消息**：`/news` 示意活動不顯示具體日期；標題不再留孤字；內文圖片與文字欄同寬、內文連結觸控範圍 44px；頁尾五校電話在 200% 文字時換行不溢出。
- **分校頁**：展開檢視關閉後照片回到 1 倍；照片上可以兩指縮放頁面；展開檢視的「返回頁面」留在頂端；下緣標註點標籤朝上；「交通與聯絡」加地圖連結（義華另有 LINE）。
- **預約流程**：送出後結果不被膠囊蓋住；選校後停在所選校區；手機鍵盤「前往」跳下一欄不直接送出；錯誤訊息看得到；失敗時送出鈕旁提示可以重送；320 寬場次時間不斷行；個資說明的「關閉」不會捲走；手機與橫拿手機不下載迎賓照片。
- **內容分頁**：常春藤環境頁網址列伸縮與換校不再整頁重畫手繪層（390 寬只改高度原本卡 1.5 秒），換校後照片框與便條位置正確；關於頁手機照片帶跟視窗高度縮，小手機首屏看得到標題；特色教學暈開遮罩分次產生、hero sizes 修正、橫拿手機 hero 雙欄、200% 文字不裁切。
- **撤回與未改**：分校 hero 小標光暈（天空出現暗斑）已撤回；與定案衝突或需要實機的項目列在 DESIGN.md，這輪沒改。合併 main 的入學護照後，只給舊入學頁用的規則已移除。

驗證（Node 22）：`npm --prefix web run typecheck` 通過；`npm run test:website` 56 檔 538 項通過（新增 `router-options.spec.ts`；`media-policy`、`news-page`、`page-hero` 補測）；fixture 模式 `nuxt build` 通過（唯一的 postcss 警告是既有的首屏 calc）。上線前以 production build（fixture）對 main 做最終驗證：桌機 1440／1024 十五個路由逐段像素比對，差異全部屬於上列刻意改動或既有雜訊（特色教學水彩每次隨機）；手機 320／360／390／844×390 全路由 24 項回歸檢查全數通過（無水平溢出、無新的 console 錯誤、上述修正逐項重測）；對全部改動做對抗式程式碼審查，確認的問題（桌機矮視窗被套到橫拿手機規則、鍵盤回頂後焦點）已修。未驗證：iPhone Safari／Android 實機（`overflow:clip`、tap highlight 形狀、iOS 自動播放）、stack e2e 未在本機跑（交給 CI）。

## 2026-09-29 首頁水彩：五校淡彩速寫＋孩子的一天→五校水彩滲接（`feature/home-watercolor-20260929`）

使用者最喜歡 /curriculum 的水彩畫面、效果與換頁接續，要在首頁呈現、但不要跟 curriculum 一樣。三個方向（A 五校淡彩速寫、B 孩子的一天→五校水彩滲接、C 最新消息水彩紙）中 A、B 在首頁做比稿（`?wc=a|b`，定案後已移除），使用者看過後兩個都上。取代 DESIGN.md「水彩層只在 /curriculum」；規則見 DESIGN.md「首頁水彩」。

- **A**：五校大照片第一次露出與手動換校時，先畫成鉛筆線稿、水彩從建築中央滲開上色、再從中央暈開回照片；自動輪播不播。線稿對照片的對位表在 `utils/campusSketch.ts`（後台換了照片／線稿就不畫）。
- **B**：孩子的一天→五校的簾幕擦除邊改成水彩濕邊往上滲（兩張遮罩帶聯集、閒置時分塊產生），濕邊以下另用 clip-path 裁掉，露出來的五校才點得到。
- 新增 `utils/campusSketch.ts`、`composables/useWatercolorSeep.ts`、`tests/home-watercolor.spec.ts`；改 `utils/watercolor.ts`（`seepEdgeCanvas`／`seepEdgeJob`）、`useCurtain.ts`（`edge` 參數）、`CampusBoard.vue`、`DayExperience.vue`、`studio.css`。改前快照 `versions/before-home-watercolor-20260929-112031/`。

驗證（Node 22、worktree `/private/tmp/ivy-website-home-watercolor-20260929`、fixture 模式）：`npm --prefix web run typecheck` 通過；`npm run test:website` 56 檔 542 項通過（新增 14 項：對位與素材、後台換圖不畫、cover 換算、srcset 挑圖、濕邊位置、只寫 panel、值沒變不重寫、停用再啟用、中途減少動態、clip-path、`@property` 命名）；`npm --prefix web run build` 通過（postcss 對 hero `--motion-vh` 的 Lexical 警告是 main 既有的）。Playwright 在 dev 與 production server、Chrome 與 WebKit、1440 與 390 實測：A 依序線稿→上色→照片暈開、國際校換校對位對得上、素材載好才淡出照片、照片中央露出才開始畫；B 濕邊隨捲動上滲，進度 40% 起已露出的五校分頁點得到；減少動態兩者都不播（簾幕回正常排列）；無 console 錯誤。效能（headless Chrome）：390 寬 4 倍 CPU 降速捲過簾幕 p50 16.7ms、p95 19–20ms（原版 p95 24–30ms），1440 寬 p95 約 18ms。未驗：iOS／Android 實機、Firefox、螢幕報讀器、stack e2e。未 commit、未部署。

## 2026-09-28／29 官網後台全面盤點與修正（`claude/backend-ui-ux-optimization-y5ndf4`）

使用者問後台 UI/UX 可以怎麼優化，之後要求處理完併入 `main`。先全面盤點再修：程式碼分 9 區逐檔讀，加上在拋棄式測試庫（`ivy_website_uxaudit_test`，5 種角色、15 筆各狀態案件、時段、草稿／送審／排程內容與素材）實際拍桌機 1440 與手機 390 共 97 張截圖；每條發現都經另一輪讀碼、實測反駁，程式碼 148 條、畫面 58 條通過（合併重複後約 110 個問題）。報告與未處理清單在 `docs/analysis/2026-09-28-admin-uiux-audit.md`，定下的規則寫進 DESIGN.md「官網後台全面盤點與修正（2026-09-28）」。改動在 `admin/`，外加一個後端併發修正與三支 `tests/stack` 的預期；沒有動 API、契約或 migration。修改前快照：`versions/before-admin-uiux-audit-20260928-214000/`。

- **會誤導的錯**：正式站頁首「查看官網」原本 `href=""` 開回後台，改開官網首頁；內容狀態點不論狀態都是黃色，改依狀態上色；校園探索後台畫布 4:3 裁切、官網 8:5 整張，熱點會偏，改成和官網相同；案件表格在 1280／1440 寬切掉送出時間，改成放得下；手機每週規則跑版；側欄讀屏文字把短頁撐高 400px；網址打錯整頁空白（新增找不到頁面）；確認率可超過 100%。
- **資料與不可逆動作**：開啟個資自動清理、縮短天數先確認並寫筆數；案件明細未送出的聯絡紀錄離頁先問；補登對話框誤關先問、送出列固定；每週規則未儲存攔截；關閉時段改三選一、取消休假要確認；「還原修改」改「放棄修改」並確認；自訂開關關掉會記住原值；使用中的素材不送封存刪除；上傳中不能關；「停用分校」移到表單下方並寫清下架後果。
- **發布判斷**：發布與核准確認框改和官網目前版本逐欄比對（先存草稿再發布、核准送審也看得到），標題寫出內容與校區；分校內容的校區寫進網址；動作列主色給真正的下一步；不再疊兩則矛盾 toast；排程列不寫版本號與 email。
- **櫃台動線**：「下一筆」先待園方確認再待處理；列表篩選與頁數寫進網址、返回鍵回列表；切回分頁時靜默更新列表與總覽；手機明細頂部撥電話鈕；家長申請改期時手動改期收合；新需求改叫「取消這筆需求」；「方便接電話時段」、名額「組」統一；月曆點日期捲到名單並加圖例；名額調整只更新那一列；站內通知可看全部校區；總覽主按鈕涵蓋待人工處理與到期追蹤。
- **找得到、看得懂**：側欄搜尋加同義詞；登入頁說明被導回的原因、書籤開登入頁直接恢復；我的帳號可改密碼；操作紀錄細節翻成中文並依日期分段；使用者頁新密碼可複製、升總管理者再確認；「替代文字」「Poster」、內建素材代碼、版本號等工程語改掉；成效統計速度表改白話、手機表格改小卡。
- **手機與效能**：內容頁狀態列與黏底動作列在手機變薄（111／184 → 69／121px）；觸控裝置輸入框一律 16px、電話網址叫出對應鍵盤；素材卡動作收進「更多」；編輯頁改載縮圖；路由改點進去才下載，單一 JS 1.6 MB（gzip 494 KB）拆成 65 個檔、主檔 923 KB（gzip 297 KB）。
- **合併時補的兩處**：外殼拿掉 `?denied=` 與分校內容頁寫 `?campus=` 會互相蓋掉，改成跟著網址變化再拿一次；「發布到官網」鈕的報讀名稱因 el-button 內層 flex 變成「發布 到官網」，改用 `aria-label` 寫死。狀態列連結在新底色上只有 4.2:1（axe 抓到），改用深一階操作色。
- **後端併發修正**：還沒有預約設定列的校區同時被讀第一次（時段頁現在同時讀預約方式與每週規則；官網同頁兩處也會）時，`get_or_create_config` 慢的那個撞主鍵回 500。改成 `INSERT … ON CONFLICT DO NOTHING` 再讀回；`test_booking_concurrency.py` 新增固定順序重現的測試（改前紅、改後綠）。端到端的 `media.spec.ts` 原本要搶在上傳成功自動關窗前按「關閉」，改成等對話框關掉。

驗證（Node 22）：`npm --prefix admin run typecheck` 通過；後台 vitest 44 檔 595 項通過（原 37 檔 340 項）；`vite build` 通過。拋棄式測試庫重拍 97 張截圖：0 個 JS 錯誤、兩種寬度都沒有水平溢出，短頁高度回到視窗高。發布與核准確認框在實際資料上列出和官網的逐欄差異。`tests/stack` 端到端在本機以預裝 Chromium（CI 用 Google Chrome）跑：56 項全過（修正前本機先抓到 5 項：兩頁 axe 對比、三支測試預期舊用語或收合前的面板，外加上述後端併發與上傳關窗的時序問題）。未驗證：Safari／iOS 實機、正式站、真實 LINE／Email 通知。

## 2026-09-29 系統設計審查後的第一批修正（`claude/system-design-review-rdqjzh`）

- **連線池自我死鎖**：限流原本向請求同一個連線池借第二條連線，約 15 個同時進來的公開點擊或送單就讓池子互等到逾時、全站 503。限流改用 `backend/app/db.py` 的獨立小池；主池明寫 10+10、等候 10 秒、`statement_timeout` 30 秒（素材配額鎖另放寬）。
- **LINE 失敗擋住 email**：LINE 推播例外改成先把信寄完再拋出重試，重試只補 LINE。
- **發布樂觀鎖**：`POST .../publish` 可帶 `expected_published_revision_id`，與官網現行版不符回 409；後台一律帶上。被退回的版本不能直接發布（`CONTENT_REVISION_REJECTED`）。
- **圖片原檔去中繼資料**：上傳時無損拿掉 EXIF（GPS、機型、時間）、XMP、IPTC、註解，只留拍攝方向（`backend/app/media/metadata.py`）。已上傳的舊素材尚未處理。
- **可觀測性**：`/health` 的 `background_jobs` 多 `last_clean_at`、`last_failed_steps`；API 啟動設定 logging（app.* INFO 不再被丟），uvicorn 存取紀錄拿掉查詢字串（後台搜尋的電話不進平台日誌）；通知寄送失敗記 WARNING。
- **官網韌性**：SSR 取內容加 8 秒逾時，API 暫時失敗時退回上一份成功內容；內容套用改成逐種類別隔離，一種格式不符只影響那一區。
- **代理與 API 文件**：同源代理擋下 `..`／`%2e%2e` 跳出 `/api/website/v1`；production 關閉 FastAPI `/docs`、`/redoc`、`/openapi.json`。

## 2026-09-29 官網 UX 評析後修正（`feature/ux-web-20260929`）

依 09-29 impeccable critique（官網 27／40）修「選校 → 比較 → 預約」主線。使用者同意翻兩條舊裁定：輪播滑鼠停在資訊欄時暫停、桌機首屏也放「找校區」。規則見 DESIGN.md「官網 UX 評析後修正」。

- **首頁五校輪播**（`CampusBoard.vue`）：滑鼠停在下方校名／地址／預約欄時暫停；照片區照舊自動播放。
- **首屏「找校區」**（`HeroVideo.vue`）：桌機、平板也顯示，仍是底線文字連結。
- **預約頁**（`VisitForm.vue`、`visit-booking.css`）：
  - 選校卡的區名改成短地址（去掉「高雄市」）。
  - 送出結果只有「預約成立」用打勾，待確認與已收到需求改用時鐘。
  - 送出失敗、送太多次時附上所選校區電話。
  - 第二步的主要按鈕從杏色 `--ivy-campus-gold` 改成 `--yellow`。
- **分校頁**（`CampusPageMain.vue`）：
  - 「交通與聯絡」右欄列出其他四校（校名連到分校頁、短地址、電話）。
  - 頁內「預約Ｘ校」改成金黃色，和 hero、頁首、橫幅一致。
  - 正式頁與草稿預覽都傳入 `campuses`。
- **最新消息頁**（`NewsIndexContent.vue`、`news-page.css`）：示意活動改顯示「示意／日期未定」，比照首頁。合併進 main 時，手機版體驗優化（PR #13）已做了同樣修正，以 main 的寫法（`eventMeta`）為準。
- **錯誤頁**：新增 `app/error.vue`，取代 Nuxt 預設英文頁。
  - 404 顯示「找不到這一頁」、五校電話與入口；其他錯誤顯示「網站暫時無法顯示」，只給回首頁與重新整理。
  - 頁面設 `noindex`；`nuxt.config.ts` 讓 error.vue 不在首頁 prefetch。
- **家長管理頁**（`useParentVisit.ts`、`visit/manage.vue`）：
  - 沒帶連結、第一次讀取就 401 時，改用中性說明告訴家長連結從哪來，不再紅字寫「已失效」。
  - 提示框的 3px 左側色條改成整圈細框。
- **放大字級**（`studio.css`）：手機頁首品牌字標用 `min(rem, px)` 封頂，比照 logo 不跟根字級放大；預設 16px 時數值不變。品牌可以縮，預約鈕與選單鈕不再被擠出畫面。
- **沒做**：
  - 市話可預約：要改 `normalize_phone`，資安 session 正在改同一段。
  - 受理編號：後台搜尋不比對案件 id，家長報了也查不到。
  - 「多久內來電」：需要園方給時限。
  - 個資告知內容：五校 `privacy_notice` 在正式站是空的，要園方在後台填。
  - 入學流程第 1 格文案：後台內容。

驗證（Node 22、worktree `/private/tmp/ivy-website-ux-web-20260929`）：
- `npx nuxt typecheck` 通過（exit 0）。
- `npm run test:unit` 55 檔 530 項通過；另新增 `tests/ux-critique-20260929.spec.ts` 12 項、`parent-visit.spec.ts` 2 項。
- fixture 模式 dev server 以 Playwright（Chrome）在 1440×900 與 390×844 實測：
  - 輪播：游標停在預約連結 12 秒都維持 `/visit/yihua`，移開 5 秒後換到明華。
  - 送出鈕底色 `oklch(.87 .13 88)`。
  - `/no-such-page-xyz` 回 404，標題為「找不到這一頁｜常春藤教育機構」。
  - 根字級 200% 時首頁、分校頁、入學頁的 `scrollWidth` 都是 390。
- 截圖在 session scratchpad `web-fix/`。
- 未驗證：Safari／iOS 實機、正式 build（只跑 dev）、真的送出後的結果頁（用程式確認）。
## 2026-09-29 官網後台第六輪 UX 修正（`feature/ux-admin-20260929`）

依後台 UX 評析修掉 25 項，使用者同日裁定兩條：後台不再顯示「第 N 版」（改日期時間＋編輯者）、側欄只留參觀案件的數字（未讀通知改放頁首連結與總覽待辦）。規則見 DESIGN.md「官網後台第六輪 UX」。

- **案件處理**：「下一筆」依來源列表或固定優先序（待確認→新需求）；新需求／聯絡中改叫「結案（不需參觀）」、待確認／已確認才叫「取消預約」，說明名額釋出與不會通知家長；聯絡紀錄草稿存 sessionStorage；手機加滿版「撥打」鈕、處理面板 DOM 排第一、只留一個 h1、觸控裝置不彈鍵盤與快捷鍵提示；名額單位統一「組」。
- **內容**：核准送審版顯示與官網目前版本的欄位差異，差異欄位名依內容種類對應表單（新增 `admin/src/api/contentFieldLabels.ts`）；「替代文字」改「圖片說明」；對話框否定鈕統一「先不要」。
- **時段**：儲存規則後直接產生時段；名額加減鈕連按只存最後的值並顯示儲存中；關閉有人預約的時段條列後果、主鈕 danger。
- **其他**：找不到頁面、沒權限導回時說明原因、列表載入中不閃「沒有案件」、手機搜尋框獨占一列、接待月曆待確認加文字標記。
- 審查後補：
  - 主動登出清掉所有案件草稿，逾時被導回登入則保留（`composables/visitNoteDraft.ts`，防共用電腦看到上一位的草稿）。
  - 列表第 2 頁以後點進案件，連每頁筆數一起帶，「下一筆」查的是同一段列表。
  - 名額按完馬上離開頁面時立刻送出，不丟掉。
  - 手機「撥打」改次要樣式，不和「確認」搶主按鈕。
- 沒做：
  - 接待「指派給我」：指派 API 要 `booking.manage`，要動後端。
  - 操作紀錄 key=value 白話化、產生密碼的複製鈕：資安 session 正在改同一段。

驗證：
- Node 22 `npm --prefix admin run typecheck` 通過；`npm --prefix admin run build` 通過（只有既有的 chunk 大小警告）。
- `vitest run` 38 檔 364 項通過。其中 `siteStructure`／`labelCoverage`／`publishingWorkflow` 要讀 web/ 與 backend/，sparse worktree 暫時 symlink 後才跑得到，跑完已移除。
Playwright 在桌機 1440×900 與手機 390×844 驗過下一筆、核准差異、結案對話框、草稿復原、找不到頁面、手機撥打鈕與 44px、確認後不聚焦、搜尋框整列、名額連按。

2026-09-30 合併進 main 時的取捨（這個分支與 PR #15「官網後台全面盤點」平行開發、改到同一批畫面）：
- **照 main（PR #15）已上線的做法、不採這個分支的版本**：找不到頁面與沒權限說明、核准前比對官網版（改用 main 的 `compareWithLive`）、下一筆的固定優先序與件數寫法、儲存每週規則後的補時段（main 是約一分鐘內自動補並刷新清單）、名額加減（main 逐列停用直到存完）、關閉有人預約的時段（main 的三選項對話框）、總覽待辦清單、接待月曆待確認（main 用色條＋圖例）、「取消這筆需求」的叫法、圖片說明與「影片封面」用語；表單對話框關閉鈕依 DESIGN「對話框按鈕的範圍」維持「取消」。
- **補進 main 版的部分**：下一筆跟著來源列表走（`?list=`）、聯絡紀錄草稿、取消確認鈕 danger 並寫明不通知家長、觸控裝置確認後不自動聚焦、案件明細家長名改 h2、頁首未讀連結（改期申請、內容通知）與總覽「有內容通知還沒看」、後台不顯示「第 N 版」、差異清單欄位名依內容種類（`contentFieldLabels.ts`）、角色名「內容編輯」。

## 2026-09-28 入學資訊頁改成「入學護照」（`feature/admission-passport-20260928`）

使用者從三個主題比稿（`design/admission-theme-directions-20260928/`：A 上學路線圖、B 入學護照、C 木頭積木）選 B。入學頁整頁改成一本打開的護照：六格簽證欄捲到就蓋章、輸入生日蓋下「115 學年度・中班」大章、勾必備品蓋「已備」、補助做成補助券；防偽細紋只當紙張質感。同日裁定延續：不放預約參觀、分班用成長軌道邏輯、叮嚀不用翻面。新增 `PassportStamp.vue`、`utils/guilloche.ts`、`utils/passport-stamp.ts`、`utils/admission-motion.ts`（GSAP 只在這頁動態載入）、`admission-passport.css`、`tokens.css` 第 14 節兩個色票；明體 `Ivy Passport Serif`（Noto Serif TC 自託管分片，`scripts/subset-admission-fonts.py`、`scripts/admission-font-chars.cjs`，`web/public/assets/fonts/admission/` 共 3.4MB，頁面只下載用到的片）。改前快照 `versions/before-admission-passport-20260928-234037/`；細節見 DESIGN.md。

驗證：Node 22 `npm --prefix web run typecheck` 通過；`npm run test:website` 55 檔 528 項通過（新增 `admission-passport.spec.ts`、`admission-fonts.spec.ts`，`page-hero.spec.ts` 改成入學頁用 `admissionHeroImage()`）。Playwright 在 dev server（接本機後端）1440／390 實測：hero 照片挑 800w（桌機顯示 483px、手機 304px）；六格簽證章捲到後都蓋上；2022/3/15 → 115 學年度中班、大章與「寶貝」小章在中班、寶貝那屆標出；2025/5/1 → 116 學年度幼幼班；勾兩項蓋兩枚「已備」；明體 600／900 都載入；`main` 內文字對比全數達標；無水平溢出、無 console 錯誤、無 hydration 警告。減少動態：六枚簽證章與歡迎章一載入就在紙上。關掉 JS：標題、6 步、5 條退費、3 張補助券、對照表都在。手機「寶貝」小章不壓到班名。`npm --prefix web run build` 通過：入學頁 chunk 10.6KB（gzip），gsap（27KB）是另一支 chunk，只在沒開減少動態時 `import()`。未驗：iOS／Android 實機、螢幕報讀器、Windows 明體、stack e2e。未 commit、未部署。
## 2026-09-28 常春藤環境頁加 GSAP 動態層：小腳印、曬衣繩起風、太陽慣性、換校發牌（`feature/environment-gsap-20260928`）

接在 `feature/environment-rough-20260928`（手繪版，尚未併入 main）之上。使用者看過 mock-up `design/environment-gsap-mockup-20260928/`（`feature/website-admin` 工作目錄、未追蹤）並要求把小腳印做得更好看，確認後同意上線。規則見 DESIGN.md「常春藤環境頁 GSAP 動態層」。

- **新增** `web/app/utils/environment-motion.ts`：純函式（`smoothPath`、`walkAnchors`、`walkedLength`、`footstepLengths`、`stepStop`）＋ `createEnvironmentMotion()`。`gsap` 3.15（標準授權、免費但不是 MIT）三支模組只在環境頁動態 import（dev 實測首頁、入學頁不會載入）。
- **`rough-sketch.ts`**：新增 `SketchMotion`／`SketchTools` 掛鉤（小路、太陽、便條進場可交給動態層）、`paperColor()`、`--renv-leaf-deep` token；不給動態層時行為不變。
- **`EnvironmentContent.vue`**：動態載入 GSAP（失敗就用原本的虛線小路）、換校時發牌、提示字改「跟著小腳印，走一圈看看」。
- **`environment.css`**：到站彈跳 `--renv-pop`、曬衣繩擺角 `--renv-swing`／`--renv-tilt`。
- **字型**：跑 `scripts/environment-font-chars.cjs`＋`subset-environment-fonts.py` 重切（手寫字 critical 多「腳印」、少「虛線」）。切字輸出每次都不一樣（很可能是字型 head 表的時間戳），所以連字沒變的圓體分片也都換了新雜湊，約 200 個檔（8.2 MB）整批替換。
- 改版前快照：`versions/before-environment-gsap-20260928-075018/`（EnvironmentContent.vue、environment.css、rough-sketch.ts）。

驗證（Node 22、worktree `/private/tmp/ivy-website-environment-gsap-20260928`）：`npm run typecheck` 通過；`npm run test:website` 51 檔 465 項通過（環境頁新增 12 項：只動態載入 GSAP、載入失敗退回虛線、提示字、`@property` 命名、路線經過每一點、捲動錨點五項、腳印左右與避站、腳印配色）。fixture 模式 dev server 以 Playwright（Chrome）實測：1440×900 與 390×844 捲過六站，腳印逐站增加（桌機 54、手機 59 個）、便條到站才出現、回捲時腳印收回而便條保留；曬衣繩捲動時擺 3.4°–4.5°、停下後歸零；太陽跳 300px 後 80ms 仍在半路、1.4 秒追上；滑鼠與方向鍵換校都會發牌、結束後無殘留 style；到入學頁再返回無錯誤；減少動態時 54 個腳印全顯示、不起風；擋掉 gsap 模組時退回虛線且無 page error（只在 dev 驗證；production 的 chunk 名是雜湊，攔截規則沒擋到）；提示字「跟著小腳印」以 Iansui critical 分片畫出。`npm run build` 通過，GSAP 為獨立 chunk（gzip：core 27 KB、ScrollTrigger 17 KB、MotionPath 8 KB，動態層 4 KB）；production server（fixture）以不過濾任何 console 訊息的嚴格版重跑上述流程，零錯誤零警告。未驗證：Safari、Firefox、iOS 實機（`color-mix()` 需 Safari 16.2+）、低階手機效能。

## 2026-09-28 常春藤環境頁改成 Rough.js 手繪版（`feature/environment-rough-20260928`）

使用者要求用 Rough.js 把 `/environment` 做成跟其他分頁不同、活潑一點的風格。比稿 `design/environment-rough-mockup-20260928/`（A 老師的聯絡簿、B 蠟筆佈告欄，在 `feature/website-admin` 的工作目錄、未追蹤）選了 A＋B 結合的 C，另外裁定：這頁不放預約參觀、多一點其他內容、字型改圓體。規則見 DESIGN.md「常春藤環境頁手繪版」。

- **版面**（`EnvironmentContent.vue`、`environment.css` 整支重寫，不再掛 `admission.css`）：點格紙、01 天藍與 03 黃的手剪色紙、照片貼在彩色底紙上＋紙膠帶、黃色便利貼＋紅筆箭頭、曬衣繩掛五張照顧照片、校園環境「跟著虛線走一圈」、餐點太陽弧線、看完打個勾。原文與照片沿用 09-25 版。
- **Rough.js**（`roughjs` 4.6.6，MIT）：`utils/rough-sketch.ts` 在瀏覽器畫所有線條，進場描線、捲動畫小路與太陽、滑過抖一下；減少動態時直接畫完。動態 import，只有這頁載入（gzip 約 23 KB）。沒有 JS 時版面與文字照常。
- **不放預約**：拿掉首屏預約鈕與結尾預約卡，結尾改成往孩子的一天、特色教學、入學資訊的貼紙連結。全站頁首預約鈕不動。
- **新內容**：第四章「五所校園」讀後台發布的各校校園探索（`campuses[].tourScenes`，目前 14 個場景），分頁切校，標註點畫成便利貼＋箭頭。
- **字型**：圓體 Chiron GoRound TC 固定字重 400／700／800＋手寫芫荽 Iansui（皆 OFL，自行託管）。`scripts/environment-font-chars.cjs` 在實際頁面量各字重用字，`scripts/subset-environment-fonts.py` 切 critical＋隱藏分頁 tour＋常用字分片（208 檔 8.2 MB）。首次載入本頁字型 4 片約 214 KB，切到其他校再 45 KB；首頁不載入。可變字型每字約 730 bytes，改做固定字重才壓到這個量。
- **頁首**：`/environment` 移出 `PILL_PAGES`（淺色首屏配實底頁首）。首屏照片改 3:2 相框，新增 `environmentHeroImage()`，`<img>` 與預載共用 sizes。
- 改版前快照：`versions/before-environment-rough-20260928-011322/`。

驗證（Node 22、worktree `/private/tmp/ivy-website-environment-rough-20260928`）：`npm run typecheck` 通過；`vitest` 51 檔 453 項通過（環境頁新增 8 項：不放預約、hero sizes、頁首、校園探索資料、便條排版不重疊、太陽弧與曬衣繩、字型分片、用字覆蓋）；`npm run build` 通過。production server（fixture）Playwright 1440／390：無水平溢出、無 console 錯誤、無 4xx；分頁點選與左右鍵／End 切換正確；四章打勾、太陽點亮、小路隨捲動畫出；`check-layout-stability.mjs` 對 /environment 四種視窗位移 0.00000–0.00006。Safari／iOS 實機未驗證；未 commit、未部署。

## 2026-09-28 進入特色教學頁：水彩從畫面中央暈開（`feature/curriculum-watercolor-20260928`）

使用者問全站換頁動畫可以做在哪，先看「進入特色教學頁」：mock `design/curriculum-enter-transition-20260928/`（`?vt=0|a|b|c`：現行、A 中央暈開、B 從點擊處、C 刷過去），使用者選 **A**。其他換頁維持 09-26 的裁定：不開全站換頁動畫。

- **做法**：`plugins/curriculum-enter.client.ts` 只在「從其他頁點連結進入 `/curriculum`」時用 View Transition：`beforeResolve` 先拍舊畫面、`page:finish` 後拍新畫面（同 Nuxt 內建做法），逾時 2.5 秒。舊頁是靜止截圖、新頁是 live，特色教學頁自己的顏料會在遮罩裡一起動。三張遮罩（`utils/watercolor.ts` 的 `revealMaskCanvas`）在閒置時間產生、toBlob 編碼；還沒好就直接換頁。頁首在過場期間有名字（`site-header`），原地淡換、不參與暈開。
- **頁首與頁尾是一般 `<a>`**（整頁載入、不經過路由）：連到 `/curriculum` 而且這次會暈開時才攔下來改走 `router.push`，其他連結照舊整頁載入。
- **不播**：首次進站、上一頁／下一頁（含 iPhone 左滑返回）、從特色教學離開、其他頁面之間、不支援 View Transitions、減少動態、強制色彩。規則在 `utils/curriculumEnter.ts`。
- 樣式在 `styles.css`「進入特色教學」，名字與遮罩只在 `html.curriculum-enter` 期間存在。

驗證：`nuxt typecheck` 結束碼 0；`npm run test:website` 53 檔 482 項通過（新增 `curriculum-enter.spec.ts` 11 項）。dev（:3217）Playwright 以 CDP 放慢 5 倍逐格：環境頁首、入學與首頁頁尾、手機膠囊選單卡點進特色教學都有暈開（包 `startViewTransition` 計數＝1），結束後 class 拿掉、選單捲動鎖定解除、無 console／page error；特色教學→環境、上一頁、環境→入學、減少動態皆為 0（減少動態也不產生遮罩）。mock 階段發現：更新 DOM 期間瀏覽器暫停畫面更新，`requestAnimationFrame` 不會觸發，不能拿它等新頁。Safari／iOS 實機未驗證；未 commit、未部署。

## 2026-09-28 特色教學頁改成水彩版、補兒童美術館與教學理念、拿掉預約參觀（`feature/curriculum-watercolor-20260928`）

使用者要一個跟其他分頁不一樣、藝術一點的 canvas 2D 風格。先在 `/environment` 比了三個方向（`design/environment-canvas-directions-20260927/`，A 藤蔭、B 一筆藤、C 水彩），使用者選 C 但要套在 `/curriculum`；mock 在 `design/curriculum-watercolor-mockup-20260928/`，依 mock 改正式頁。內頁共用版型（hero＋薄荷帶＋米底＋深綠舞台）這頁不再使用。

- **版面**：hero 從深色遮罩壓照片改成水彩紙＋右欄撕紙框照片，「動手做」底下刷一筆橙色顏料；章節索引改成四團顏料（與各段主色一致）。01 四個年段：四團顏料一歲比一歲大。02 課程方向：大小錯落，品德培養印在一片橙色顏料上，藝術共創放大收尾。04 五件事：紙上五幅畫各配一種顏料。手機的課程方向、美術館、五件事改一列橫滑，清單本身鋪一片淡顏料。
- **拿掉**（使用者要求）：結尾的預約參觀卡、hero 的「預約參觀」「先看孩子做什麼」兩顆按鈕。頁首預約鈕全站共用，沒動。
- **新增內容**（都是舊站原文、有標出處）：03 兒童美術館 8 件作品（機構站「常春藤兒童美術館」相簿原圖 4608×3456，依 EXIF 轉正後長邊 1600，`optimize-site-images.py --only` 只新增 8 項 manifest；字母珠球、有手寫字的膠帶畫不放）；01 補「螺旋式課程」一句（機構站關於頁）與連到 `/about#whole-child` 的連結；結尾改成教學理念（義華站關於頁，「二十七年口碑」「歐式城堡建築」不搬）。SEO 描述與 llms.txt 同步。
- **水彩層**：`utils/watercolor.ts`（純演算法：可重現亂數、多邊形反覆變形、疊層顏料、撕紙毛邊、紙紋）＋`composables/useWatercolor.ts`（掛到頁面）。顏料色進 `tokens.css` 第 13 節 `--ivy-paint-*-rgb`；`curriculum.css` 不寫色碼。canvas 只在瀏覽器端畫，SSR 輸出的是乾淨紙面與方形照片。減少動態一次畫完不暈開；強制色彩整層不畫。
- **hero sizes**：照片不再滿版，新增 `CURRICULUM_HERO_SIZES`（`(max-width: 900px) 187vw, 1500px`，依框高 × 寬高比），頁面與預載共用；其他內頁仍用 `pageHeroImage()`。

驗證：Node 22 web `nuxt typecheck` 結束碼 0；`npm run test:website` 52 檔 471 項通過（改寫 `curriculum.spec.ts`、`page-hero.spec.ts`，新增 `watercolor.spec.ts` 10 項）；`tests/e2e/old-site-content.spec.ts` 特色教學頁四個視口通過（對本機 dev :3217）。Playwright 1440／1024／390／320：無水平溢出、無 console／page error；21 張照片遮罩與 21 團顏料都畫出；換頁離開再回來無錯誤。axe（wcag2a／aa、21a／aa）1440 與 390 零違規（修掉手機橫滑清單不能用鍵盤捲的 `scrollable-region-focusable`）。文字對實際渲染背景量對比，全部 ≥ 4.5（課程方向副標原本 3.5–4.2，改內文色）。效能：390 寬、4 倍 CPU 節流，初版掛上時多一個約 840ms 長任務，改成接近視窗才產生、閒置時間 8ms 分塊、toBlob 非同步編碼後，最大長任務 ~200ms，與關掉水彩層的對照組同量級，捲動時無長任務。Safari／iOS 實機（mask-composite、canvas `rgb(r g b / a)` 語法）未驗證；stack e2e（a11y／keyboard／hydration 會掃 `/curriculum`）沒有在本機跑完整套；未 commit、未部署。

## 2026-09-27 官網後台換常春藤 logo、登入頁改版、狀態色對比修正（`feature/admin-ui-20260927`）

使用者要求後台所有 logo 換成常春藤 IVY KIDS 徽章，登入頁比照園務系統（ivy-frontend）的登入頁。徽章取自 `ivy-frontend/public/images/login-logo.png`（城堡版），裁掉透明邊後輸出。

- **logo**：`admin/src/assets/brand/ivy-crest.webp`（登入頁，714×760，131KB）、`ivy-crest-mark.webp`（側欄 44px 高，13KB）；favicon 改 `favicon-32.png`／`favicon-48.png`，新增 `apple-touch-icon.png`（米白底），刪除舊的葉子 `favicon.svg`。徽章自帶天空圓底，深色側欄上 44px 仍認得出，所以全站統一用城堡版。
- **登入頁**（`LoginView.vue`）：左徽章、右登入卡、底部「常春藤教育機構 ・ 官網後台」與版權；900px 以下改上下排。標題寫「官網後台登入」而不是參考圖的「管理員登入」：兩個系統長得一樣，要靠標題分辨。欄位改「帳號」「密碼」加圖示與必填星號，空白或格式錯誤的提示顯示在該欄下方（`aria-invalid`＋`aria-describedby`，焦點移到第一個錯的欄位）；帳密錯誤、限流、連線問題仍用上方警示。Google／LINE 入口移到登入鈕下方的「或」之後，沒啟用就不顯示。忘記密碼的說明改成「請聯絡總管理者重設」（總管理者可以在使用者頁重設密碼）。參考圖的光暈背景沒有照做：impeccable 判定為裝飾性 spotlight，改純色冷色底。
- **側欄**：徽章＋「常春藤官網／管理後台」整塊改成連回該角色起始頁的連結（總管理者是營運總覽，編輯者是第一個看得到的內容頁）；品牌列加底線，和右側頂欄的底線接成一條。hover 底色只在 `(hover: hover)` 裝置生效，手機點開抽屜時手指位置不再留一塊亮底。更改密碼、登出圖示從 14px 放大到 18px。
- **手機頂欄**：選單鈕從 Element Plus 的 `Menu`（四格方塊，像「應用程式」）改成三條線。
- **狀態色對比**：`--el-color-error`（`el-alert type="error"`、錯誤 toast）原本是預設 `#f56c6c`，後台只調了 danger；`--el-color-success`（48 處 `ElMessage.success`、「核准並發布」實心鈕、使用者頁綠字）與 `--el-color-info` 也是預設色，都不到 3:1。error 對齊 danger 深紅、success 對齊「已上線」深綠 `--status-live-ink`、info 用 `--ink-3`，warning toast 字改 `--el-color-warning-dark-2`；實算淺底上皆 ≥ 5:1。

驗證：Node 22 admin `vue-tsc` 通過、vitest 37 檔 340 項通過（新增登入欄位提示、側欄 logo 連結兩項）；`vite build` 通過，index 的 favicon 路徑帶 `/admin/`。stack e2e（`e2e:build` 後獨立庫 `ivy_website_adminui_e2e_test`）56 項中 55 過，5 張後台畫面基準已在 macOS 重拍；`media.spec.ts` 在整套跑時失敗（API 讀回的 `home_about` 最新版沒有 photo），單獨跑會過，失敗點在內容資料、不在這次改的畫面，未對照 origin/main 確認是否原本就會。Playwright 1440／1280／390／360 截圖：登入頁無水平溢出、錯誤提示與焦點正確；抽屜與側欄正常。Safari／iOS 實機未驗證；未 commit、未部署。

## 2026-09-27 首頁 UI/UX 評析後修正（預約鈕、頁尾聯絡、觸控範圍、示意活動日期）

首頁評析後使用者指定處理五項，只動 `web/`：

- 分校卡「預約參觀Ｘ校」：桌機也補上底部停留距離 `calc(60px + 25svh)`（`HomeNewsTransition.vue`，原本只有手機），1440×900 可點的捲動範圍從 260px 變成 700px；底色從低彩度杏色 `--ivy-campus-gold` 改成頁首預約鈕同一個 `--yellow`，字重 600（`CampusBoard.vue`）。
- 頁尾「我們的大家庭」改成一校一列：校名｜區域｜電話（`tel:` 連結），subgrid 對齊（`SiteFooter.vue`）。
- 觸控範圍：桌機膠囊三個控制用透明 `::before` 上下各補 2px 到 44px、外觀不變（`studio.css`）；桌機章節指示連結 36→44px（`HomeChapters.vue`）。
- 示意活動不露出具體日期：日期格改「示意／日期未定」，詳情改「日期未定」，排序仍依原日期（`NewsDialog.vue`）。
- 評析報的手機 `hn-more`、影片圓點、分校地址 40–41px 是紙頁轉場靜止時的 0.92／0.935 縮放造成的量測值，CSS 本身已是 44px，未改。

驗證：`nuxt typecheck` 通過；web vitest 51 檔 446 項通過。Playwright（fixture 模式 dev）1440／390：逐 20px 捲動以 `elementFromPoint` 量預約鈕可點範圍（桌機 700px、手機 620px）；膠囊上下緣外 1.5px 點得到；頁尾五校三欄對齊；示意活動日期格截圖確認。未部署。

品牌名統一（使用者裁定）：頁尾品牌改成跟頁首一樣的「常春藤教育機構／IVY EDUCATIONAL INSTITUTION」。`footer.brandName` 不走後台疊加，改兩份 fixture（`content/`、`web/server/data/`）即生效；`media-slots.spec.ts` 的基準檔 `overlay-baseline-20260925.json` 同步兩個欄位。LINE Seed 子集的 unicode-range 涵蓋「教育機構」；360px 手機英文一行不溢出。web vitest 51 檔 446 項通過。內文、SEO、預約表單裡的「常春藤幼兒園」（指幼兒園本身）不動。

## 2026-09-27 手機版 UI/UX 整理

使用者看完手機版評析（iPhone 13 尺寸量正式站）後說「全部都改」。只改 `web/`，桌機版面不變。

- 開場布幕手機短版：760px 以下（或高度 500px 以下）跳過 3-2-1 倒數，校徽 2.5→1.5 秒、拉幕 3.4→2.3 秒，總長 8.9→3.8 秒；從倒數片頭淡出 180ms 之後接回，不會閃出片頭。`entrance-timeline.ts` 加 `compactEntranceElapsed`，`EntranceCurtain.vue` 依 `COMPACT_ENTRANCE_MEDIA` 切換。桌機維持完整倒數。「略過動畫」手機 12→13px。
- 「孩子的一天」：拍立得蓋到大標以後（`data-covered`），左下圖說淡出、右下「暫停背景」收成 44px 圓鈕（文字留給螢幕閱讀器），不再壓住卡片上的時間與內文。
- 手機膠囊陰影收成貼身短陰影（桌機那層 40px 陰影會把下方內容壓暗一整條）。
- 分校頁：手機收掉照片探索底部與「交通與聯絡」兩顆重複的預約按鈕，只留 hero 與最後的預約橫幅（加上一直都在的頁首膠囊）；照片探索的縮放列手機只在「展開檢視」後出現。
- 預約頁：手機迎賓區收短、拿掉照片，選校卡 112→96px，第一屏就看得到選校。
- 首頁：活動影片圓點點擊範圍 36×44→48×48（區塊縮放進場，實測原本只有 33×40）；五校卡地址後的 ↗ 改成「地圖 ↗」。「孩子的一天」底部說明手機 12→13px。
- 未改：「示意內容」標章與設計示意說明（要等真實消息，屬內容決定）。

驗證：`nuxt typecheck` 通過；web vitest 51 檔 447 項通過（`entrance-timeline.spec.ts` 新增短版一項）。fixture 模式 dev（:3100）用 Playwright 量：手機布幕實播 3751ms、只經過 logo／opening，沒有 countdown；桌機 8952ms、3/2/1 都有。「孩子的一天」蓋上後暫停鍵 44×44、圖說 opacity 0；影片圓點 44×44；分校頁可見預約連結只剩 2 個、縮放列展開前 `display:none`、展開後 flex；預約頁第一屏看得到第一張選校卡。Safari／iOS 實機未驗證；未部署。

## 2026-09-26 最新消息開放獨立網址（/news、/news/<id>）

使用者從新分頁方向裡改做 C，並拍板開放獨立消息網址（原本「不在核可範圍」）。這輪只做 C1：網址與頁面，資料用後台現有的全站消息與各校消息；舊站 51 篇義華活動下一輪另做。

- 新增 `pages/news/index.vue`、`pages/news/[id].vue`、`components/NewsIndexContent.vue`、`NewsArticleContent.vue`、`assets/css/news-page.css`；`utils/news-content.ts` 加 `newsPath`、`findArticle`、`indexableArticles`、`articlesForCampus`；`seo.ts` 加 `newsListSeo`、`newsArticleSeo`（NewsArticle＋三層麵包屑），sitemap 列 `/news` 與真實消息、llms.txt 加最新消息。
- 示意消息（正式站目前全部是）：照常顯示並標「示意」，單篇 noindex、無 canonical、不進 sitemap。
- 首頁消息卡片與「所有最新消息」改為連結，對話框只剩活動；頁尾「最新消息」改指 `/news`（後台預設連結同步）。預約點擊統計新增入口 `news`（web、backend、admin 標籤、contracts）。

驗證：Node 22 web vitest 46 檔 413 項通過（新增 `tests/news-page.spec.ts` 7 項）、`nuxt typecheck` 0 錯誤（中途抓到一個批次替換打壞 `eventTimeDetail(view.item)`，已修）；`contract:check` 通過；admin 23 項、後端 `test_analytics_funnel.py` 9 項通過。fixture 模式 dev（:3240）開啟索引（`NUXT_PUBLIC_SITE_ORIGIN=https://ivy.example`）實測：`/news` index＋canonical、示意 `/news/garden` noindex 無 canonical、sitemap 不含示意消息、`/news/nope` 404。Playwright 1440／390：無水平溢出、無 page error；首頁卡片連到 `/news/<id>`、「所有最新消息」連到 `/news`、活動仍開對話框；鍵盤在列表 Enter 進單篇。截圖 `output/playwright/news-page-20260926/`。Safari／iOS 實機未驗證；未部署。

## 2026-09-26 新分頁「關於常春藤」（/about）

使用者要探索新分頁可以做什麼，比較五個方向（關於常春藤、常見問題總表、活動與消息、家長分享、五校比較）後選 A。內容全部取自機構站 `ivykidschool.com/about` 原文：沿革（民國 86 年義華路 → 90 明華 → 94 崇德 → 109 國際 → 110 仁武）、全人教育（課綱六大領域與六大核心素養）、首頁「Our Goals」期許。hero 用同一頁的原始照片裁成 2000×803（`about-hero`，`optimize-site-images.py --only about-hero` 只新增 manifest 一項）。舊站「三十多個春夏秋冬」改為「近三十年」；崇德同年的 ESL 美語部先不寫；不綁 30 週年。

- 新增 `web/app/pages/about.vue`、`components/AboutContent.vue`、`assets/css/about.css`；SEO（`aboutSeo`，AboutPage＋麵包屑）、sitemap、llms.txt、預載 hero、頁首膠囊都接上。
- 主選單第一項加「關於常春藤」，頁尾「關於常春藤」從 `/#about` 改指 `/about`；後台預設連結（`admin/src/composables/siteLinks.ts`）同步。**若正式站後台已經存過主選單或頁尾連結，官網會用後台那份，要到後台「網站設定」手動加上 `/about`。**
- 預約鈕點擊統計新增入口 `about`：`web/app/utils/cta-analytics.ts`、`backend/app/operations/models.py`、後台 `labels.ts`、`contracts/` 一起改（欄位是字串，不用 migration）。

驗證：Node 22 web vitest 45 檔 406 項通過（新增 `tests/about.spec.ts`；`media-slots` 比對基準只多選單與頁尾兩處）、`nuxt typecheck` 0 個 `error TS`；`contract:check` 通過；admin `labelCoverage`、`siteStructure` 23 項通過；後端 `test_analytics_funnel.py` 9 項通過（獨立測試庫 `ivy_website_about_test`）。標題用字對 LINE Seed TW 700／800 分片 unicode-range 無缺字。Playwright 對 fixture 模式 dev（:3240）截 1440／1024／390：無水平溢出、無 page error／console error；320 寬標題皆兩行、無標點落單。截圖在 `output/playwright/about-page-20260926/`。Safari／iOS 實機未驗證；未 commit、未部署。
## 2026-09-26 修正：手機五校「預約參觀Ｘ校」被消息紙頁蓋住、頁尾「孩子的一天」停在簾幕前

- **手機預約鈕**：五校區塊在手機比一屏高，黏住時最底下的預約鈕剛好在視窗底，消息紙頁一開始爬就蓋住它。390×844 每 150px 捲一次，正式站只有一個位置點得到。`HomeNewsTransition.vue` 在 760px 以下、有紙頁轉場時，五校區塊底部加 `32svh` 停留距離：黏住後預約鈕停在畫面中段，紙要先爬過這段才蓋到它。修後 y≈5400–5900（約 600px）都點得到，實際觸控點擊可進預約頁。桌機本來就有 150–300px 可點，不動。
- **頁尾 `/#life`**：原生錨點落在「關於」簾幕擦除之前，畫面還是關於。新增 `composables/useChapterAnchors.ts`：首頁上連到設了 `after` 的章節（目前只有 `#life`）的同源連結，先照錨點捲、再補到簾幕擦完；帶 `#life` 從其他頁進站也在掛載後補一次。章節指示改走同一條，不再自己處理點擊。`#about`、`#campuses` 等其他錨點不經過這裡。

驗證：`nuxt typecheck` 結束碼 0；`npm run test:website` 46 檔 406 項通過（`home-chapters.spec.ts` 加 `chapterForHref`）。Playwright：1440×900、390×844 在首頁點頁尾「孩子的一天」、再點一次、從 /admission 點進來都停在孩子的一天（讀線元素在 `#life` 內），上一頁正常；手機 `/#about`、`/#campuses` 行為不變；console 無錯誤。

## 2026-09-26 首頁四項效果：孩子的一天時段光、五校線稿畫出、選校→預約照片接續、桌機章節指示（`feature/home-effects-20260926`）

- **時段光**：捲到哪張拍立得，背景影片就疊上那個時段的光（08–10 點暖黃、10–13 點提亮、13–16 點琥珀、16 點後較濃琥珀），1.6 秒淡換。`utils/dayLight.ts` 只看時間戳、不看卡片 tint；三層色只動 opacity、`mix-blend-mode: soft-light` 疊在影片與壓暗漸層之間，色票 `--ivy-day-light-*`。同一格畫面實測平均色偏移約 10–15/255（早上 R+12、中午整體 +11、傍晚 R+15 B−12）。
- **五校線稿畫出**：換校時被選中的分頁線稿由左往右畫出（遮罩羽化 30%），畫完再染淡彩；第一次捲到五校也畫一次預設校。選中分頁在滑鼠裝置上改為常駐淡彩（原本只有 hover）。遮罩位置走註冊過的 `--tab-draw`，理由同既有的線稿 multiply 註解（不升合成層）。
- **選校→預約**：五校卡「預約參觀Ｘ校」用 View Transition 把目前那張照片縮放到預約頁側欄的校區照片（手機是 96px 縮圖）。沒開 Nuxt 全站 `experimental.viewTransition`，只有這顆按鈕走 `utils/campusPhotoMorph.ts`；`view-transition-name` 只在 `html.campus-morph` 期間存在。不支援、減少動態、強制色彩、按修飾鍵時照常換頁。
- **章節指示**：1101px 以上右側一條細線（關於常春藤、孩子的一天、五所校園、最新消息），過首屏才出現；換章時名稱亮 2 秒，滑鼠移上或 Tab 進來才展開全部。判斷用視窗 45% 讀線上實際看得到的元素屬於哪一章（`utils/homeChapters.ts`）——簾幕讓下一段先疊在底下，量 rect 會提早跳章。點「孩子的一天」會捲到關於簾幕擦完的位置（原生 `#life` 錨點停在擦除前，畫面還是關於）。

驗證：Node 22 `nuxt typecheck` 結束碼 0；`npm run test:website` 46 檔 404 項通過（新增 `day-light.spec.ts`、`home-chapters.spec.ts`）。dev server（fixture）Playwright：1440×900 六張拍立得依序 morning→morning→noon→noon→afternoon→dusk、章節四個錨點跳轉與判斷正確、線稿 120／400／700／1500ms 截圖、照片接續錄影逐幀無白閃；390×844 章節指示隱藏、無水平捲動、照片接續到縮圖；減少動態直接換頁；console 無錯誤。截圖在 `output/playwright/home-effects-20260926/`。快照 `versions/before-home-effects-20260926-223845/`。Safari／iOS 實機未驗證（Safari 18 起才支援同文件 View Transition，舊版照常換頁）。
## 2026-09-26 預約成立後「加入行事曆」與「導航」（`feature/visit-calendar-20260926`）

- 預約完成畫面（送出後 API 回 `confirmed`）與家長管理頁 `/visit/manage`（狀態 `confirmed` 且有時段）多一塊「記下參觀時間」：加入 Google 日曆、下載 `.ics`（iPhone、Outlook）、Google 地圖導航。**只在預約成立時出現**；已收到需求、待園方確認都不出現（規格 197）。
- `utils/visit-calendar.ts`：時段以台北時間換 UTC；`.ics` 依 RFC 5545 跳脫、CRLF、75 位元組折行，前一天提醒（`TRIGGER:-P1D`），UID 用 `receipt_id`／管理頁用 `visit.id`（改期後同 UID 會更新同一筆）。行程只寫分校、地址、電話，不放孩子與家長資料。導航目的地用地址（分校自訂地圖連結可能是地標頁）；管理頁的地址取公開分校資料，停用的分校沒有地址就只給行事曆。
- 元件 `VisitCalendarActions.vue`，圖示沿用 sprite 的 `i-calendar-check`、`i-navigation-arrow`。

驗證：`nuxt typecheck` 結束碼 0；`npm run test:website` 45 檔 408 項通過（新增 `visit-calendar.spec.ts`，含「兩處都以 confirmed 為條件」的原始碼檢查）。Playwright 以攔截 API 模擬：1440×900、390×844 的預約完成畫面與管理頁，`confirmed` 都出現、`pending_confirmation` 都不出現；下載的 `.ics` 以 Python `icalendar` 解析，時間 2026-10-07 09:30+08:00、地點、電話、前一天提醒正確；console 無錯誤。截圖在 `output/playwright/visit-calendar-20260926/`。iPhone Safari 下載 `.ics` 後叫出「加入行事曆」未實機驗證；未接真後端跑 `tests/stack`。

未 commit、未部署。

## 2026-09-25／26 官網後台缺口補齊：權限、案件處理、內容審核與排程、素材庫、統計、字型、E2E（`feature/admin-gaps-20260925`，B01–B15，尚未併回 `main`）

以 `origin/main`（`912da33`）與已上線的 `ops-hardening`（`d4a8c0b`，定期工作、限流存 PostgreSQL、LINE 群組通知、capability 表、S3）為基準，逐項盤點官網後台的規格缺口與文件落後後分批修補，共 14 個實作批次＋本篇文件同步批次。到 `84e9c41`（B10）已合併進 `main` 並部署；之後的批次尚在此分支，未合併、未部署。細節、API 變動、測試證據見各批 commit 訊息與 `docs/website-admin/acceptance.md` 底部「2026-09-25／26 小結」，逐項驗收表見同檔上方表格。

- **權限**：新增 `booking.handle`（接待人員可處理案件：聯絡紀錄、確認排入時段、補登、取消、未到場、完成、後台改期、核准／退回家長改期、家長連結、通知已讀），`booking.manage` 收斂為設定面；個資匯出、全站共用內容改為總管理者逐人授權；後台按鈕一律依 `effective_capabilities` 顯示。
- **案件處理**：後台改期、名額保留（`completed`／`no_show` 不能再排入）、家長管理連結產生／撤銷、案件歷程時間軸、家長線上申請改期、待人工處理清單、CSV 匯出依篩選、送出日期篩選、各校可設家長異動期限、每週規則自動延展。
- **預約規則**：同意版本追蹤、隱私說明可編輯、預約模式啟用條件與影響範圍確認、參觀人數必填（1–10）、問題上限 500 字。
- **通知**：寄送失敗可人工重試、新增「即將參觀」「逾期未處理」提醒（寄送當下重新判斷是否仍成立）。
- **內容管理**：排程發布不蓋回新版本、送審／核准／退回、全站發布紀錄與一鍵還原、總覽待發布與缺素材提示、版本紀錄顯示差異摘要。
- **消息與 FAQ**：消息與活動結構化內文、適用範圍與首頁推薦排序、各校可編輯自己的消息、全站共用常見問題（可逐校逐題覆寫或不顯示）。
- **官網內容**：停用分校官網整校下架、首頁五校順序與主選單／頁尾連結可編輯、分校地圖連結、標題缺字提示擴及所有欄位、校園探索可排序、孩子的一天新卡與刪卡生效。
- **素材庫**：引用記錄版本與欄位路徑、批次替換、封存與待清理（延後刪檔）、批次上傳、影片 metadata、縮圖／大圖／poster 衍生檔、版位裁切焦點、既有素材 dry-run importer、多個素材版位（首屏影片、關於照片、孩子的一天、分校封面線稿、手機活動影片）進 CMS。
- **統計與 SEO**：後台收錄開關真的接上 `robots.txt`／`sitemap.xml`／`llms.txt`；成效漏斗加取消原因、日期區間與來源分組；公開點擊事件改用 `event_id` 去重。
- **稽核與資料治理**：稽核範圍擴大到約 30 種動作並有靜態測試把關；個資保存政策改後台可設定天數並持久化；樂觀鎖涵蓋時段／案件／每週規則／全站設定／素材；統一 `X-Request-ID` 與更細錯誤碼；`/public/site` 加 ETag。
- **登入**：後台新增 Google 登入（可自行解除綁定）。
- **字型**：`web/` 標題字型由 737 字子集換成完整 LINE Seed TW（Bold／ExtraBold 各 13,915 字），首屏預載量減半；根目錄凍結原型不受影響。
- **測試基礎設施**：新增 `tests/stack/` 真後端端到端測試（預約全流程、內容送審發布、素材選圖、每週規則、角色限制）、axe 無障礙檢查、鍵盤操作檢查、像素回歸，CI 新增 `e2e` job（不擋部署）；過程中修掉 `#shared` 別名的 production build 失敗與新庫一次套 migration 時的 enum 值問題。
- **文件同步**（本篇，B15）：`docs/website-admin/acceptance.md`／`operations.md`／`README.md`、`deploy/README.md`、`web/public/assets/fonts/README.md`、`CLAUDE.md` 與部分程式內過時註解，依上述實作結果重寫；已核對 HEAD 現況，避免把已修好的缺口寫成待辦。

驗證：本篇（B15）為文件批次，未重跑全套測試；各實作批次結束前皆跑過 `backend uv run pytest -q`、`admin`／`web` 的 `typecheck`＋`test:unit`、`contract:check`，部分批次跑過 `tests/stack`（詳見各 commit）。

仍待使用者或業主處理：簡訊驗證（付費）、正式庫與媒體備份／PITR、斷開 Railway 原生部署、正式站 `initialize-content`、SMTP／Google／LINE／S3 正式環境變數、四校正式內容、錯誤格式 envelope 是否要做破壞性變更；其餘細項見 `docs/website-admin/acceptance.md` 小結的「仍未做／需要使用者或業主處理」。

未 commit 前不影響任何正式站；未 push、未合併進 `main`、未部署。

## 2026-09-26 開場布幕視覺精修（舞台光、褶子、帷幔接點）

依使用者「布幕可以怎麼優化」的評析全部修改，只動 `web/app/utils/entranceCurtain.ts` 的著色器與幾何。規則寫在 DESIGN.md 同日段落。
- 帷幔綁點原本有一條硬的直線接縫，改成平滑收褶。
- 舞台光往兩翼暗下、腳燈更寬更亮；絨布正面壓暗、斜面受光。
- 褶子間距與深淺加入低頻變化；片頭片框邊緣收窄，拿掉大片光暈。
- 30th 緞帶改用長焦投影，並減弱褶子造成的明暗，上下緣與文字不再隨褶子起伏；人物校徽不動。
- 首屏海報五張重產（`entrance-policy.ts` 的 `?v=` 已更新），和新版第一幀的像素差為 1～9/255。

驗證：Node 22 `nuxt typecheck` 結束碼 0；`npm run test:website` 36 檔 304 項通過。dev server 用 Playwright（Metal）在 1440×900、390×844、1466×690 截校徽、倒數「1」、拉幕 30% 三格，改版前後對照，console 無 shader 錯誤。快照 `versions/before-curtain-polish-20260926-071538/`。Safari／iOS 實機未驗證。部署紀錄見 `deploy/README.md`。

## 2026-09-26 內頁 hero 手機版 sizes 照實寫（入學資訊、常春藤環境、特色教學）

三頁手機版 hero 是固定 500px 高的照片帶（`admission.css` 760px 以下的 `.adm-hero-photo`），用 `object-fit: cover`。橫幅照片實際顯示寬度是 500 × 寬高比：入學 675px、環境 1049px、特色教學 1245px。原本 `sizes` 一律寫 `100vw`，390 寬手機只選到 800w，有效解析度 0.32–0.68，看起來糊。
- 改法：`utils/responsive-image.ts` 新增 `pageHeroImage()`／`PAGE_HERO_MOBILE_HEIGHT`，`sizes` 改為 `(max-width: 760px) <500×寬高比>px, 100vw`。三頁的 `<img>` 與 `usePageSeo` 的首屏預載都改用它，兩邊 sizes 一致。761px 以上維持 100vw：實測本來就選到最大候選，這次不變。
- 實測（390 寬，DPR 1.75／2）：有效解析度入學 0.68／0.59 → 0.91／0.80、環境 0.44／0.38 → 1.07／0.93、特色教學 0.37／0.32 → 0.92／0.80。DPR 3 受原圖尺寸限制（入學 1080、環境 1960、特色教學 2000 寬），只到 0.53–0.62。
- 代價：手機首屏圖變大，入學 34 → 61 KB、環境 32 → 119 KB、特色教學 28 → 92 KB。每次載入只下載一張首屏圖（預載與 `<img>` 選到同一個候選，已逐一確認）。
- 測試：新增 `tests/page-hero.spec.ts` 6 項，檢查 sizes 算法、常數與 CSS 高度一致、`<img>` 與預載都用 `pageHeroImage`，以及找不到素材時不丟例外。
- 驗證：web vitest 39 檔 351 項通過、`nuxt typecheck` 結束碼 0。e2e `old-site-content` 在 390 手機 6 項通過。前後對照截圖在 `output/playwright/page-hero-sizes-20260926/compare.png`。
- 未量正式站 LCP：以 Lighthouse 慢速 4G 約 1.6 Mbps 粗估，環境頁多出約 87 KB，首屏圖下載時間約多 0.4 秒。部署後應該用線上 Lighthouse 確認。

未 commit、未部署。

## 2026-09-26 特色教學頁 /curriculum、四校校園探索換真實場景、義華家長分享

接續舊官網盤點（ivykidschool.com、ivykids.tw），把可以直接搬的內容做完。
- **特色教學頁 `/curriculum`**：`pages/curriculum.vue`＋`components/CurriculumContent.vue`＋`assets/css/curriculum.css`，版型照 `/environment`（共用 `admission.css`），內容寫在元件裡，不進後台。
  - 01 四個年段：機構站「四年八階段」幼幼班到大班的 slogan。年齡寫法同入學資訊頁，有測試比對 `CLASS_BY_OFFSET`。
  - 02 七個課程方向：機構站課程支柱。品德培養沒有照片，做成橫跨兩格的深綠引言卡。
  - 03 五件事：義華 ivykids.tw「課程特色」（靜心、教具操作、美術創作、閱讀素養、大肌肉時間），照片與介紹標明取自義華校。
  - 文案是舊站原文，只修錯字與標點；「做準備準備」改為「做準備」。「《常春藤幼兒園》高雄獨家課程」「大推」拿掉（無法佐證，待園方確認）。
  - 大標只用 LINE Seed 子集有的字。課程名稱有缺字（統、元文、品培、術、美術、肌肉、六八），卡片標題整組改用內文字型。
  - 照片 14 張 `cur-*`：首屏是義華首頁輪播原圖（孩子合十），課程照是機構站圓形照片裁內接 4:3。
  - 選單改為「特色教學、常春藤環境、入學資訊」，頁尾加特色教學，後台 `siteLinks.ts` 預設同步。另接好 SEO、sitemap、llms.txt、頁首膠囊。
- **四校校園探索**：明華、崇德、國際、仁武的 `tourScenes` 從通用模板換成機構站各校介紹頁的實景，共 11 個場景（`tour-*`，8:5，因為畫面用 `object-fit: fill`）。熱點只寫照片裡看得到的東西。
  - 校別證據：明華的戶外廣場檔名是「07_明華戶外廣場」；國際校大門鑄著校名；仁武的照片來自「仁武校校園環境」相簿。
  - 國際校美語商店街的場景說明，引用機構站 About 頁原句。
  - 義華的校園探索存在後台，要補的花花世界、藝術走廊寫成操作說明 `docs/website-admin/handoff-yihua-tour-20260926.md`。
- **義華家長分享**：新元件 `CampusTestimonials.vue`，分校頁校園探索後面放 4 支家長分享影片（ivykids.tw 共 16 支）。
  - 引言是影片標題裡家長說的話。
  - 海報用影片畫面，裁掉名字字卡與職稱字卡。
  - 點了才插 `youtube-nocookie`；只在 fixture 有 `testimonials` 的學校出現（目前只有義華）。
- **修午夜不穩定的測試**：`backend/tests/test_visit_details.py` 的「明天」改成執行當下才計算（09-25 CI run 36157022816 在台北午夜失敗過）。
- main 的 `media-slots.spec.ts` 比對基準更新。逐欄比對過，差異只有：義華 `testimonials`、四校 `tourScenes`、選單與頁尾多了特色教學。

驗證：
- web：`nuxt typecheck` 結束碼 0，vitest 38 檔 345 項通過。新增 `curriculum.spec.ts`（SEO／sitemap／llms、年段對入學資訊、圖片）、`campus-old-site-content.spec.ts`（五校無模板、場景 8:5、熱點範圍、家長分享只有義華、海報檔在）。
- admin：`vue-tsc` 結束碼 0，vitest 33 檔 264 項通過。
- backend：`test_visit_details`、`test_content_initialize` 共 24 項通過。
- `contract:check` 一致。
- e2e：新增 `tests/e2e/old-site-content.spec.ts`，連同活動影片、五校卡社群在 1440／390 共 15 項通過、1 項桌機跳過。
- Playwright 對 3218 dev（fixture 模式）：
  - `/curriculum` 1440／1024／390 無 console 錯誤、無破圖、無橫向捲動。
  - 選單三項在 901／950／1000／1024／1101／1180／1245／1280／1440 都排一行，預約鈕貼齊右緣。
  - 11 個校園探索場景比例 1.6、熱點位置逐張看過，已調 2 個。
  - 家長分享 4 張海報載入，點了插 iframe。
  - 4 支家長分享影片從正式網域嵌入能載入播放器。
- 截圖在 `output/playwright/curriculum-20260926/`。

未 commit、未部署。

## 2026-09-25 各校 IG／YouTube 改由後台管理，首頁五校卡顯示

接續同日上一段。後台「五校介紹」新增 Instagram、YouTube 兩欄，首頁五校卡跟著顯示。
- **後端**：`CampusProfilePayload` 加 `instagram`、`youtube`，預設 `""`，所以舊版本照樣通過驗證，也不需要 migration。兩欄跟 FB、LINE 一起走 `_require_safe_url` 允許清單。`initialize.py` 把 null 轉成空字串；種子 `content/site-fixture.json` 補上這兩欄（義華有值，其他四校 null）。
- **後台**：`CampusProfileView.vue` 在 LINE 下方加兩個欄位；`types.ts`、`labels.ts`（版本比對的欄位名）同步更新。
- **官網**：`content-overlay.ts` 有這一欄就以後台為準，空字串轉成 null；舊版本沒有這一欄才沿用 fixture。`CampusBoard.vue` 社群列在 Facebook 後面加 Instagram、YouTube，有值才出現。
- API 契約沒有變動：分校資料在 API 上是泛用的 payload，`contract:check` 一致。

**部署後要做**：到後台「五校介紹 → 義華校」填 IG `https://www.instagram.com/ivy.kids.school.ig/`、YouTube `https://www.youtube.com/@IvyKidsVideos`，然後發布。沒做的話，下一次有人存義華的資料，這兩個連結就會消失（原因見 DESIGN.md 同日段落）。

驗證：
- backend：全套 500 項通過（獨立測試庫 `ivy_website_social_test` 從零 migrate 到 `9b2b0ebc14ae`）。新增三組測試：IG／YouTube 發布往返（舊版本沒帶也能存）、6 組不安全網址回 422（驗證器拿掉這兩欄時 6 組全部轉紅）、初始化帶入義華的值。
- web：`nuxt typecheck` 結束碼 0，vitest 31 檔 247 項通過（`content.spec.ts` 新增「以後台為準／舊版本沿用 fixture」兩項，修改前前者是紅的）。
- admin：`vue-tsc` 結束碼 0，vitest 23 檔 128 項通過（新增 `campusProfileSocials.test.ts`：舊版本載入時補空白，填了會跟著存草稿送出）。
- 新增 e2e `tests/e2e/campus-board-socials.spec.ts`：義華有 IG／YouTube 連結、明華沒有。1440 和 390 都通過，連同 `home-films.spec.ts` 一起跑 3 項通過、1 項桌機跳過。
- Playwright 對 3217 dev（fixture 模式）：1440／1024／390 都無橫向溢出、無 console 錯誤，義華四個連結、明華兩個。截圖在 `output/playwright/campus-board-socials-20260925/`。

未 commit、未部署。

## 2026-09-25 義華 IG／YouTube 連結、手機活動影片換成義華 YouTube

盤點兩個舊官網後先做風險最低的兩項。
1. **義華 IG／YouTube**：`web/server/data/site-fixture.json` 義華的 `instagram`、`youtube` 從 null 填入 `instagram.com/ivy.kids.school.ig`、`youtube.com/@IvyKidsVideos`，兩者都取自 ivykids.tw 頁尾，也已確認帳號存在。正式站以 fixture 為底、再疊後台 `campus_profile`；疊的時候不會覆蓋這兩欄，所以改 fixture 就會上線。後台目前沒有這兩個欄位。其他四校維持「待提供」。
2. **手機「活動影片」**：`web/app/utils/campusFilms.ts` 保留第一支 `run`，讓它繼續靜音預覽。從 `day-film-mobile` 剪的三段舞台片（孩子的一天的背景片已經在播）換成義華頻道的四支 YouTube：迎財神、果嶺公園放風箏、大班英語演講、IVY 盃校際足球聯賽。四支都是 ivykids.tw 活動頁內嵌的影片，oEmbed 公開可嵌入。頻道封面是綠框大字，不合站上風格，所以 `youtube()` 加了第三個參數 `poster`，海報改用影片畫面（`i.ytimg.com/vi/<id>/maxres3.jpg`，1280×720）縮成 720×405 WebP：`campus-film-{new-year,kite,speech,football}.webp`。舊的 `campus-film-{stage,dance,family}.webp` 已刪。
3. **修 YouTube 播放鍵**：`HomeFilms.vue` 的 `onViewportClick` 原本用 `event.target.closest()` 判斷點到的是不是當前這張。點播放鍵時，按鈕在冒泡到 viewport 之前就被 Vue 換成 iframe，target 已經脫離 DOM，於是被當成點兩側、翻到下一張，iframe 也跟著被拔掉。改用 `event.composedPath()`。之前清單裡沒有 YouTube 影片，所以這條路徑從沒被觸發過。

注意：「迎財神」（`T3AZm_UiDhY`）從 `http://127.0.0.1` 嵌入會顯示「無法播放這部影片」。同一支從正式站網域、example.com、ivykids.tw 嵌入都正常，另外三支從哪裡嵌入都正常。本機看到這個錯誤不是 bug。

驗證：Node 22 `nuxt typecheck` 結束碼 0；web vitest 31 檔 245 項通過（`film-carousel.spec.ts` 新增兩項：`poster` 參數、站內海報檔都存在且 id 不重複）。新增 e2e `tests/e2e/home-films.spec.ts`：YouTube 請求攔成空頁，點播放後 iframe 留在原位、圓點不跳走；修正前 mobile-390 連兩次失敗在 iframe 斷言，修正後 mobile-390／375 各兩次通過，桌機按設計跳過。Playwright 對 3217 dev（fixture 模式）：
- 手機 390：5 個圓點，4 張海報都載入；點右側、左側可以翻頁；無橫向溢出、無 console 錯誤。
- 手機選單：義華的 IG／FB／YouTube／LINE 四個都是連結。
- 桌機 1440：`.hn-films` 為 `display:none`，不下載任何 `campus-film`／`ytimg`；膠囊選單中，義華四個都是連結，換到明華回到「待提供」。

截圖在 `output/playwright/social-films-20260925/`。未在實機上點播 YouTube。未 commit、未部署。

## 2026-09-25 常春藤環境頁 /environment，頁首只留分頁

把舊官網「一日常春藤 Environment」（幼兒保育、校園環境、幼兒餐點；一日流程不搬）搬成新頁 `/environment`，版型照入學資訊頁：`pages/environment.vue`＋`components/EnvironmentContent.vue`（共用 `admission.css`，另加 `assets/css/environment.css`）。照片從舊站原圖產生 15 張 `env-*` 母檔，經 `scripts/optimize-site-images.py --only` 產生響應式檔。菜單不抄進網站：營養餐點書按鈕依台北日期開到當月那一頁（`utils/meal-book.ts`）。頁首選單依使用者裁定只留真正的分頁「常春藤環境、入學資訊」（`site-fixture.json`），頁尾加常春藤環境；`/environment` 加進膠囊頁首頁面、選單目前頁標 `aria-current`。SEO、sitemap、llms.txt 加入新頁。設計紀錄與未選方案見 DESIGN.md 同日一節，mock 在 `design/environment-mockup-20260925/`。改前快照 `versions/before-environment-page-20260925-212623/`。

未處理：標題有 21 字不在現行子集，等字型分支 `feature/admin-gaps-fonts-20260925` 合併後補齊；未 commit、未部署。

驗證：Node 22 web vitest 31 檔 244 項通過（新增 `tests/environment.spec.ts` 22 項：餐點書月份與頁碼、台北時區換月、選單只剩兩項、SEO／sitemap／llms.txt、15 張圖都有響應式檔）；`nuxt typecheck` 通過。Playwright 對 3777 dev（fixture 模式）：`/environment` 1440／1024／390 無 console 錯誤與 hydration 警告、無破圖、無橫向捲動，餐點書連結 `#p=19`、按鈕「看 9 月菜單」；首頁、入學資訊、義華分校頁選單都只剩兩項，入學資訊頁標目前頁；桌機捲過後頁首收成膠囊；901–1440px 預約鈕都沒被擠出。
## 2026-09-25 手機捲動順暢度：拿掉每幀整頁樣式重算與 WebGL 紙的通用法線重算

使用者反映手機版滑動不順。對線上站用 Chrome 手機模擬（390×844、3×、CDP 觸控捲動手勢、CPU 4 倍降速）錄 trace、invalidation tracking 與 CPU profile，找到三個每幀成本來源。只改 `web/`，畫面與行為不變：

- 「關於」簾幕擦除時，`useRelayProgress`（`useCurtain.ts`）每幀把四個變數寫在 `<html>`；自訂屬性會繼承，整頁五百多個元素每幀重算樣式。改成只把 `--relay-day` 寫在唯一讀它的「的一天」（`.t-day`）上，值不變就不寫。`--seam-inset`／`--relay`／`--relay-glow` 只給原型的 relay-glint 研究面板用，Nuxt 沒開這個 class，不再寫。
- 手機 WebGL 拍立得掛上後，捲動起風每幀要重算整張紙兩面的頂點法線，three 的 `computeVertexNormals()` 佔這段 JS 的四分之一以上。新增 `web/app/utils/gridNormals.ts`，用 typed array 跑同一套運算，結果與 three 逐位元相同。`cornerCurl.ts` 的 `setCurl` 基準轉角改成只算一次（原本七個波紋層級各算一遍），積分表逐值相同。
- 順風微擺 `--sway` 原本寫在 `li.day-print`，整張卡的子樹每幀跟著重算。改寫在唯一讀它的 `.print-card`，並用 `@property` 註冊成不繼承。

驗證（本機 fixture production build，原版 `origin/main` 對修改版，Chrome 手機模擬）：
- 「關於」接縫來回滑（4× 降速，3 輪）：樣式重算元素 8.5k–11.7k → 21–66，樣式時間 548–1179 → 25–133 ms，慢幀（>20 ms）16–23 → 2–15。
- 拍立得區 CSS 版（4×，3 輪）：重算元素 15.7k–19.2k → 5.5k–6.0k，幀距 p50 16.8–33 → 16.7 ms，慢幀 74–89 → 27–46。
- 拍立得區 WebGL 已掛上（2×，2 輪）：慢幀 12、62 → 3、5，p95 33 → 16.8 ms。1× 兩版都是 60 fps，4× 兩版都飽和。CPU profile：法線 1211 → 292 ms，主執行緒閒置 689 → 1465 ms。
- 等價：Node 22 web vitest 32 檔 233 項通過（新增 `grid-normals.spec.ts` 5 項逐位元比對 three；`corner-curl.spec.ts` 3 項比對舊積分表；`relay-progress.spec.ts` 3 項），`nuxt typecheck` 0 個 `error TS`。法線測試用 float32 捨入突變確認會轉紅。接縫 321 個捲動位置「的一天」opacity 兩版相同（含中間值）。Chrome 與 WebKit 捲動中 `.print-card` rotate 兩版相同，停下後歸位。WebGL 版靜止截圖兩版逐像素相同。CSS 版截圖曾有差異，隔離後確認是照片點陣化時機的雜訊：同一版重跑也會不同，原版注入同一條 `@property` 仍與原版相同。無 page error。

未處理（另案）：觸控裝置停下 200 ms 後掛上 WebGL 紙時，該幀仍有 100–250 ms 的長任務（2× 降速，兩版相同），剛好接著滑會卡一下。iPhone Safari 實機與 GPU 端（3× DPR WebGL 繪製、畫布複製）都還沒量。腳本與結果在 `output/playwright/mobile-scroll-perf-20260925/`，快照在 `versions/before-mobile-scroll-perf-20260925-070912/`。凍結的 vanilla 原型未改。

## 2026-09-24 後台 LINE 登入（登入後自行綁定）

登入頁加入 LINE 登入，與 Google、帳密並存。LINE 的 ID token 沒有 `email_verified`，所以不拿 email 比對、不自動綁定：管理員先用帳密或 Google 登入，點側欄底部自己的 email 進入新的「我的帳號」（`/account`）按「綁定 LINE」，之後就能用 LINE 登入，也可以自行解除。後端新增 `app/auth/line.py`：只要 `openid`，帶 state／nonce／PKCE，用自己的簽章握手 cookie（不和 Google 的 `SessionMiddleware` 共用 `scope["session"]`），ID token 依演算法分別用 Channel secret（HS256）或 LINE JWKS（ES256）驗；綁定時確認是同一位仍啟用的管理員 session，綁定與解除寫入操作紀錄。migration `d41e6c2a9f58` 接在 `b6d1f8e3a524` 後，只新增 `users.line_sub`，部署時由 API 啟動自動套用。`/auth/providers` 移到 `routes.py` 並回傳 `{google, line}`，`UserOut` 加 `line_linked`；Google 與 LINE 共用的 `safe_admin_path` 等抽成 `app/auth/oauth_common.py`（Google 的 `aud` 檢查不變）。LINE Developers 設定、環境變數與驗收清單見 [LINE 登入設定說明](deploy/line-oauth.md)。三個 `WEBSITE_LINE_*` 未設定前入口不會出現。

驗證（在 main `912da33` 上完成；之後 rebase 到 `7dd7207`，新增的兩個提交只動 `web/`）：backend 438 項通過（獨立測試庫從零 migrate 到 `d41e6c2a9f58`、單一 head，`check_schema.py` 通過；LINE 54 項，另以突變確認 nonce／aud／session／sub 檢查拿掉會轉紅）；admin 21 檔 121 項、`vue-tsc`、Node 22 build、`contract:check`、deploy 工具 13 項、web `oauth-proxy.spec` 通過。瀏覽器以真的 API 經 Vite 代理、只攔 `access.line.me`：1440／390／320 登入頁兩顆按鈕等寬、高 44px、無水平溢出；登入取消、無握手重放、綁定取消、竄改 state、解除綁定、手機抽屜導覽正常，無 page error。尚未建立真實 LINE channel，換 token 的真實往返未驗。
## 2026-09-24 拍立得翻面提示改 F「第一張翻開進場」，取代首張偷看

使用者問怎麼提示「可以翻面」、要自然。現行暗示都在捲動中或剛進場發生，而且輕掀 31°、偷看 12° 都看不到背面。比稿 `design/flip-hint-natural-20260924/` 兩批六版後選 F，已接進 Nuxt `web/`：每次工作階段第一次來，第一張（01 早安入園）背面朝上貼著，讀者看到它（可見 ≥60%）停留 0.8 秒後自己翻成照片、照片接著顯影；讀者先點也算示範完成，翻開途中被點則讓它翻完、不翻回背面。SSR／無 JS 維持正面，載入當下已在畫面內（錨點、回上一頁）不做；減少動態停在背面等讀者點。首張偷看（元件、WebGL `peek()`、CSS keyframes）移除。新增 `web/app/utils/printOpener.ts` 與 9 項單元測試。規則見 DESIGN.md「F『第一張翻開進場』定案」。

驗證：Node 22 web vitest 26 檔 195 項通過；`nuxt typecheck` 0 個 `error TS`（以故意錯誤檔確認有抓錯）。Playwright 對 3161 dev：桌機 WebGL（Metal、假時鐘）載入後第一張背面朝上、第二張不受影響、只露出約 20% 不翻、置中 700ms 仍是背面、之後翻開並顯影、`ivy-day-peek` 寫入、同工作階段重新整理直接正面；強制關 WebGL 的 CSS 版置中約 0.92 秒翻開；手機 390 背面→照片、WebGL 接手、無橫向溢出；減少動態停在背面、點擊切換、重新整理正面；讀者先點不會被再翻一次、翻開途中點擊會翻完停在照片（WebGL 與 CSS 版）；`#day-hello` 直達維持正面。console 只有別處 `visit-looks.css` 的 404（與拍立得無關）。逐格 `output/playwright/flip-opener-20260924/sheet-desktop-open.png`，快照 `versions/before-flip-opener-20260924-204501/`。已經 main CI 部署（`7dd7207`，見 `deploy/README.md`）；Safari／iOS 實機未驗證；vanilla 原型未動（`node --check app.js` 通過，未重打包）。

## 2026-09-24 首屏調亮：遮罩只墊在文字後面

使用者要求首屏調亮一點。暗感來自 `web/app/assets/css/studio.css` 的 `.studio-hero::before`：左側滿高直欄在 0–34% 壓到 76%，文字上下與左下角沒有字的照片也一起變暗。改為三層：頂部導覽帶 .64→.60 並從 96/190px 收短到 76/140px（手機同步）；左側直欄降為原本三成（.23 起）；文字塊後方加橢圓光暈 `radial-gradient(40% 42% at 24% 49%, .68 → .60 55% → 0)`。遮罩色由字面值改為 `--hero-scrim` 變數（色值不變）；頁首收合的 `background-size` 補第三層 `auto`，否則光暈會一起被收掉。影片、文案、版面不動。

驗證：以 ffmpeg 抽桌機／手機影片各 12 幀＋封面，離線依 CSS 遮罩合成（與瀏覽器實際截圖平均差約 1/255），取每行文字範圍內最亮背景像素算白字對比。調整後最差值：1440 內文 5.55／導覽 5.61、1280 內文 4.85／小標 4.79、1024 內文 5.68、手機導覽 4.66，大標 3.49→5.76；整體亮度（封面 L* 平均）桌機 36.3→40.8、手機 45.9→47.7，左下角 26.5→約 42。Playwright 對新開的 :3171 dev 截 1440／1280／1024／390 前後對照，文字位置不變、頁首收合只收頂部帶、原生揭幕照常、無 page error。截圖與模型在 `output/hero-brighten-20260924/`，快照 `versions/before-hero-brighten-20260924-194536/`。凍結 vanilla 原型未改；Safari／iOS 實機未驗證。以單一 commit cherry-pick 上 main，部署紀錄見 `deploy/README.md`。

## 2026-09-24 頁尾回到 A 深森林綠，文字全部純白

使用者看過上線的 R「燕麥＋深綠底列」後要求再看顏色：先在 `design/footer-colour-directions-20260924/` 加第三批 R 的變化（U–Z），使用者決定「走 A」；再比文字顏色 `design/footer-text-colour-a-20260924/`（10 案，含指定保留的全白版），選 1 全白。`web/app/assets/css/tokens.css` 的 `--ivy-footer-*` 改為底色 `#24483F`、文字 `--ivy-white-pure`、分隔線 `#526D61`（R 的其他頁尾變數刪除），共用 `SiteFooter.vue` 改讀這三個，拿掉 R 的 `.footer-bar` 滿版底列、恢復 1px 分隔線 `#526D61`，鍵盤焦點外框改白。文案、欄位、斷點不變。規則寫在 DESIGN.md 最上方。

驗證：Node 22 `nuxt typecheck` 通過、web vitest 25 檔 186 項通過。Playwright 對 3161 dev 跑首頁、義華分校頁、預約頁 × 1440／390px：底色 `rgb(36,72,63)`、頁尾所有文字計算色只有 `rgb(255,255,255)`（對比 10.13）、無 `.footer-bar`、分隔線 1px `#526D61`、無橫向溢出、連結高度 ≥44px；鍵盤焦點外框白色 3px；強制色彩底為 Canvas、分隔線保留。截圖與 `results.json` 在 `output/playwright/footer-text-white-20260924/`。Safari／iOS 實機未驗證；未 commit、未部署。

## 2026-09-24 合併 main（PR #9）：重疊功能以 main 為準

main 的 PR #9 與本分支同時做了補登案件、承辦人、接待月曆、完成參觀、版本還原。合併時重疊的部分一律採 main 的 API 與畫面，本分支只保留 main 沒有的：

- 後端：補登、指派、承辦人清單、接待月曆、完成參觀、版本還原（`POST …/revisions/{id}/restore`，可選同時發布）用 main 的；本分支的同名端點移除。`source`／`created_by` 欄位由 main 的 migration `d3a8f1c5b742` 新增，本分支的 `c4e8a1d3f210` 改接在它後面、只補 `related_request_id`（重新預約關聯舊案），全部仍是單一 head。
- 還原並發布沿用本分支的發布規則：內容編輯不能直接發布（403，畫面上也不顯示「還原並發布」），發布前檢查（例如校園探索熱點待複核）照樣生效。
- 補登對話框用 main 的，加上「方便聯絡時段」改下拉（固定代碼）與重新預約帶入舊案；案件明細用 main 的，加上「聯絡中」「退回聯絡中」「重新預約」與年齡／時段中文顯示。版本紀錄用 main 的抽屜，本分支的抽屜移除。

驗證：後端 pytest 374 passed、1 skipped（含 main 的新測試）；後台 vitest 102 passed、`vue-tsc` 通過。

## 2026-09-24 孩子年齡、聯絡時段改固定選項；全站共用內容授權

- **固定選項（規格 190）**：參觀案件的 `age`／`preferred_time` 只收固定代碼（`unknown|under_2|2-3|3-4|4-5|5-6`、`flexible|weekday_morning|weekday_afternoon|other`）。官網表單改送代碼、顯示中文；API 仍接受舊頁面送的中文標籤並換成代碼，認不得的值回 422。migration `a9c4e2f7d316` 把既有案件的中文標籤轉成代碼（認不得的保留原字）。冪等 hash 用中文標籤算，更新前後的重送會認得是同一筆。後台清單、明細改顯示中文，人工補登改成下拉選單。
- **全站共用內容授權（規格 7）**：新增 `users.capabilities`（migration `b6d1f8e3a524`），總管理者可在「使用者 → 角色與校區」或新增帳號時，勾選「也可以編輯全站共用內容」給分校管理者或內容編輯。有授權的內容編輯能改首頁、頁尾、網站設定並上傳共用素材，但只能送審；有授權的分校管理者可以直接發布與審核共用內容。側欄與路由依授權顯示；改成櫃台／唯讀／總管理者時授權自動清掉。素材庫的上傳校區改為只列自己負責的校區（沒有授權時不能選「不指定」）。

驗證：後端新增 `test_visit_option_codes.py`、`test_shared_content_grant.py`，調整 `test_visit_details.py` 的舊 hash 算法；後台 vitest 84 passed、`vue-tsc` 通過；官網 vitest 210 passed、`nuxt typecheck` 通過。

## 2026-09-24 後台補齊：案件流程、接待日曆、時段規則、版本紀錄、送審與排程、角色與帳號

盤點規格後把後台還沒做的功能一次補上。四個新 migration（`c4e8a1d3f210`→`d1f5b2c8e437`→`e7a3c9d4b128`→`f2b8d6a1c953`），部署後要跑 `alembic upgrade head`；OpenAPI 契約已重新產生。

- **參觀案件**：新增「聯絡中」狀態；已確認可標「已完成」（原本後端有函式但沒有 API）；待確認可退回聯絡中並釋出名額。承辦人指派與「只看我負責的」篩選。電話／LINE／現場／外部預約網站的**人工補登**，記建立人與來源；結案後可「重新預約」另建新案並關聯舊案（跨校限總管理者）。清單加來源與送出日期篩選，CSV 多一欄來源。
- **接待日曆**：新頁面，依時段日期排開已排定的參觀（待確認、已確認、已完成、未到場），與案件清單讀同一張表。
- **時段規則**：每週開放規則（週幾、時間、每場分鐘、每場組數）、休假日／臨時封鎖（關閉當天時段，已排入的案件不自動取消，回報件數）、「依規則產生時段」（可重複按，不重複建、不重開已關閉的）。最短提前時數與最遠開放天數改成各校設定（預設仍是 24 小時／60 天）。
- **內容版本**：「版本紀錄」抽屜列出每一版、標出線上版與曾上線版，可和目前比較、放回草稿或直接發布舊版。草稿預覽擴及分校頁（`/preview?page=campus&campus=<key>`，分校頁主體抽成 `CampusPageMain.vue` 兩邊共用）。發布確認框不再說「要重新輸入舊內容」。
- **送審與排程**：內容編輯只能存草稿與送審，校區管理者／總管理者核准（＝發布）或退回（必填原因）；總覽多「內容等你審核」。排程發布綁定特定版本，到期由 `process-notifications` 執行，執行前重新檢查排程人權限、分校是否啟用、素材是否就緒，失敗原因顯示在編輯頁。
- **校園探索**：換場景照片後伺服器把該場景熱點標成待複核，按「熱點位置都確認過了」並存檔才能發布。
- **全站設定**：社群分享圖（素材庫）、入學資訊頁搜尋標題與描述、「允許搜尋引擎收錄」開關（只能收緊）。品牌名稱與 Logo 因字型子集維持鎖定，頁面上說明原因。
- **分校停用**：總管理者可在「各校預約方式」停用／啟用分校；停用後官網預約顯示暫停、送單回 `BOOKING_UNAVAILABLE`、該校內容不能發布，歷史資料全部保留。
- **素材庫**：標籤（篩選、點標籤過濾）、圖說、授權註記；API 支援 `?tag=`、`?q=`。
- **帳號**：五種角色都能建立（總管理者以外必須指定校區），可改角色與校區；總管理者可重設別人密碼（對方所有裝置登出）；每個人可在側欄改自己的密碼（其他裝置登出）。側欄依角色顯示，編輯與唯讀登入後落在「五校介紹」。
- **寄信**：新增 SMTP adapter（`WEBSITE_SMTP_*`，production 不允許明文），沒設定時照舊用本機 sink 或回報未配置。

驗證：
- 後端 `pytest` 294 passed、1 skipped（新增 9 個測試檔），真 PostgreSQL；四個 migration 降版再升版通過，`deploy/check_schema.py` 通過；`npm run contract:check` 通過
- 後台 `vitest` 81 passed、`vue-tsc` 無錯誤、`vite build` 通過
- 官網 `vitest` 209 passed、`nuxt typecheck` 無錯誤、`nuxt build` 通過

未驗證：瀏覽器實際點過新畫面（只有元件測試）、真實 SMTP 伺服器寄信、正式站部署。這兩項原本未處理的（`age`／`contact_time` 固定選項、全站內容編輯授權）已在上一段補上。

## 2026-09-24 後台營運補強：版本還原、補登案件、承辦人、接待月曆、消息上下架

- **版本紀錄與還原**：所有內容編輯頁多一個「版本紀錄」抽屜，列出最近 50 次儲存、選一版可看還原後會變的欄位，可「還原成草稿」或「還原並發布」。還原是另存新的一版，不改歷史，也不會把其他人的草稿帶上官網。
- **人工補登案件**：參觀案件頁「補登案件」，登錄電話／LINE／親自到園／外部網站來的需求；可當場排入時段（走同一套容量檢查）。暫停線上收件時也能用。新增 migration `d3a8f1c5b742`（`visit_requests.source`、`created_by`、承辦人索引）。
- **指派承辦人**：明細頁選承辦人，列表新增承辦人欄、「我承辦的／尚未指派」與來源篩選。只能指派給有該校權限的啟用人員；確認預約不再覆蓋已指派的承辦人。
- **接待月曆**：側欄「接待月曆」，按月看每個時段排了誰、剩幾位；點日期列出當天名單。另補上「完成參觀」（狀態機原本就有，只缺路由）。
- **消息上下架日期**：最新消息與活動每一則可設上架、下架日期（台北時間，含當天），官網讀取時自動過濾，不用再發布一次。

驗證：backend pytest 314 passed／1 skipped（新增 `test_content_revisions.py`、`test_visit_manual_and_assign.py`、`test_home_news.py` 排程案例），alembic upgrade／downgrade／check 通過；admin vue-tsc、vitest 85 項（新增 `receptionAndHistory.test.ts`）、vite build 通過；`npm run contract:check` 通過。本機 PostgreSQL＋API＋admin dev 用 Chromium 1440×900 與 390×844 實跑：補登→進入明細（顯示來源、登錄者、承辦人）、改標題存草稿→版本紀錄還原回原標題、月曆與列表、消息頁，皆無水平捲動、無 JS 錯誤（只有消息頁向未啟動的官網 3000 埠抓示意照片失敗）。

未驗證：Safari、正式站 migration、草稿預覽 `/preview` 對上下架日期的呈現（預覽顯示全部消息）。

## 2026-09-24 後台 UI/UX：案件、時段、總覽

本機起 PostgreSQL＋API、灌入示範案件與時段後逐頁截圖，挑出每天最常用的三頁改：

- 總覽主按鈕：原本顯示「新需求＋待確認」加總，卻只帶去其中一批（兩批都有時帶去新需求，和註解說的「占位先處理」相反）。改成按鈕文字與數字就是點進去的那一批：有待確認先「確認時段預約 N」，否則「聯絡新需求 N」，都沒有是「查看參觀案件」。
- 參觀案件：狀態下拉改成一排頁籤（全部／待處理／待園方確認／…），待處理兩種狀態帶側欄同源的數字，縮小到單一校區、搜尋或到期時不顯示總數以免對不上。手機把校區、排序、到期收進「更多篩選」（有套用時顯示件數），第一筆案件從約 540px 提到約 450px。「待處理」狀態標籤改操作色，和「待園方確認」的暖黃分開，對齊總覽待辦的底色。
- 時段與容量：同一天的場次合併日期（桌機表格合併儲存格、手機依日期分組、今天加標記），手機每場從一張高卡片改成一行，12 場的頁長 3892px → 約 2100px。已經結束的場次標「已結束」、不能再調名額或關閉，也不算進「仍有名額」。

驗證：admin vitest 18 檔 82 項通過（新增 `listUx.test.ts`，更新總覽主按鈕、狀態頁籤、標籤色的既有測試）、`npm run build`（含 vue-tsc）通過；本機真實 API＋Chromium 1440／390 截圖檢查總覽、案件列表（含展開更多篩選）、時段頁。

未驗證：Safari、螢幕報讀器、校區管理者帳號的畫面、正式站。

## 2026-09-24 入學資訊頁改首頁版型

依同日 mock 改寫 `web/app/components/AdmissionContent.vue` 與 `admission.css`，內容仍由後台 `admission_content` 管理、不需要 migration。首頁的透明頁首＋膠囊、滿版 hero、薄荷色帶、五校分頁卡、拍立得、升起的消息紙逐段套用；分班對照提到第二段；拿掉麵包屑、分頁列與提醒條（提醒移到 hero）。頁首：studio.css 首頁透明頁首選擇器加 `.photo-hero`，SiteHeader 的膠囊頁面加 `/admission`。細節見 DESIGN.md。

驗證：web `nuxt typecheck` 無錯誤、vitest 27 檔 205 項通過、`nuxt build` 通過；fixture 模式本機 Chromium 1440／1024／390 截圖，無水平捲動、無主控台錯誤，生日查詢會同步切換班別分頁、拍立得翻面後焦點移到「翻回正面」；首頁、分校頁、預約頁的頁首狀態與改版前相同；hero 遮罩對比用照片像素量過。

未驗證：Safari、螢幕報讀器、草稿預覽 `/preview?page=admission`（需要後台登入）、正式站。

## 2026-09-24 入學資訊頁「靠近首頁」mock

使用者想讓 `/admission` 更接近首頁的版型與風格，先出 mock、不動正式頁。`design/admission-homestyle-mockup-20260924/`：單檔 `admission-homestyle-mockup.html`、原始檔與打包腳本、1440／390 截圖。首頁的透明頁首＋膠囊、滿版 hero＋金色底線、薄荷色帶＋巨大淡字、五校的分頁與大圓角卡、孩子的一天的拍立得、最新消息的升起紙張，逐段對應到入學流程、分班對照、新生準備、收退費；分班提到第二段。待決定事項（大標改回 LINE Seed、桌機內頁收膠囊、拿掉分頁列等）見該資料夾 README。

驗證：Chromium 1440×900、390×844 截圖，無水平捲動、無主控台錯誤；打包時檢查標題 LINE Seed 無缺字。

## 2026-09-24 後台 Google OAuth 整合

後台新增 Google 登入，僅接受已建立且啟用的管理員，首次驗證 Gmail／Google Workspace 信箱後綁定穩定 `sub`，沿用既有角色、分校權限、session 與 CSRF；帳密登入保留。OAuth 設定完全留空時隱藏入口。整合保留 main 的登入 Email 檢查、API 本文大小限制、可信代理 IP 判定與素材串流轉送。

新增 `users.google_sub` migration，並以 `c6e4a2b9d810` 合併 Google 身分與流量統計 migration 歷史。正式 migration 必須在經核准的備份後、API 切換前執行；Google Client、回呼網址、管理員資格及上線順序見 [Google OAuth 設定說明](deploy/google-oauth.md)。

驗證：backend 291、admin 78、web 207、deploy 12 項測試通過，Node 22 typecheck／build、API contract、原型語法與打包通過。隔離 PostgreSQL 從空庫及 main revision 升級皆通過，既有帳號／權限／流量資料保留。Chromium 正式 build 的 1440／390／320px 登入頁（模擬 API）無水平溢出或 runtime error，取消提示、帳密備援、Email 驗證及 Enter 單次提交通過。另補上明確的 ID token audience 驗證與回歸案例。真人 Google 往返及 Safari／iOS 實機尚未驗證。

## 2026-09-24 入學資訊頁上線版：內容進後台、選單入口、補字

接續同日的 mock-up，使用者確認後改為正式頁面：內容由後台管理，頁面接上選單並開放索引，頁面上方保留「金額以各校公告為準」提醒，等園方確認金額後在後台清空。

- 後端：新增共用內容 `admission_content`（只有 super_admin 能編）：頁面提醒、介紹、入學步驟（1–10）、新生入園階段（必備品、提醒）、每週穿著、接送與註冊須知、補助、育兒津貼、退費規定（每種情況 1–6 組條文）。所有巢狀字串都擋 `javascript:` 等 scheme，清單裡的空白項目直接略過。`initialize-content` 從 fixture 帶入，初始化筆數 19→20。不需要 migration，OpenAPI 契約不變。
- 官網：`/admission` 改讀發布內容（沒發布過就用 fixture 同一份）；草稿預覽支援 `admission_content`。拿掉 noindex，加 canonical、WebPage＋麵包屑結構化資料，sitemap 與 llms.txt 列入。分班計算移到 `web/app/utils/admission-classes.ts`，用台北日期算學年度。主選單、手機選單、頁尾加「入學資訊」。
- 後台：「全站與素材 → 入學資訊頁」編輯頁；清單類文字一行一項，步驟與退費情況可上下移，步驟／階段標題有缺字提示，發布後「查看官網」開 `/admission`。
- 字型：LINE Seed Bold 補 12 字重切（見 `web/public/assets/fonts/README.md`），hero 大標另切 8 字明體子集。
- 選單變五項後 901–915px 預約鈕被擠出 11px，901–1000px 選單間距改 14px。

驗證：
- 後端 pytest 全部通過（新增 `test_admission_content.py`），`npm run contract:check` 通過
- web vitest 26 檔通過（新增 `admission.spec.ts`），`nuxt typecheck` 無錯誤，`nuxt build` 通過
- admin vitest 16 檔通過（新增 `admissionContent.test.ts`），`vue-tsc` 無錯誤，`vite build` 通過
- 本機 PostgreSQL＋API＋live 模式官網＋後台實跑：`initialize-content` 建 20 筆；Chromium 登入後台改訂位金、加必備品、清空提醒並發布，官網 `/admission` 立即反映；步驟標題清空時後台顯示「步驟標題不可空白」；缺字提示正確（本機後台與官網不同源，用瀏覽器攔截補 CORS 測，正式站同源不受影響）
- 901–1100px 首頁、分校頁、預約頁、入學資訊頁皆無水平捲動；390px 手機選單第 05 項為入學資訊

未驗證：正式站（需部署後跑 `initialize-content`，見 `deploy/README.md`）、Safari、真實搜尋引擎收錄。

## 2026-09-24 入學資訊頁 mock-up（/admission）

把舊官網「常春藤入學」四個子頁（寶貝入學流程、新生入園須知、收退費辦法、分班表）的內容搬到新官網，套用分校頁的版面。新增 `web/app/pages/admission.vue` 與 `web/app/assets/css/admission.css`，路徑 `/admission`，`noindex`、未加進主選單，內容先寫死在頁面。

- 四段：六步入學流程、新生入學二部曲（必備品可勾選、每週服裝、接送、註冊須知）、補助與退費規定、分班對照（輸入生日列出每年班級，出生區間表依今天日期推算學年度）。
- 舊站圖片與彈出視窗裡的文字已逐一取出，盤點、要園方確認的金額與已知待辦見 `design/admission-mockup-20260924/README.md`。
- 標題字型子集缺 14 字，目前退回系統字，定案後再補字。

驗證：`nuxt typecheck` 無錯誤；fixture 模式本機 Chromium 1440／390 截圖，分班計算用舊海報對照核對。

## 2026-09-24 安全掃描報告修補

依安全掃描報告（30 項）修補官網後台；逐項對照見 PR 說明。重點：

- 預約：容量計算排除已到期的待確認占位，`process-notifications` 沒設定寄信也會釋放占位；家長取消與園方結案、並行改期申請、交換與撤銷家長連結都改成鎖列序列化；家長 session 每案件最多 10 個、過期即刪。
- 權限：`booking.read` 依規格權限表只給總管理、分校管理、接待（內容編輯與唯讀不讀家長個資）；漏斗改用新的 `analytics.read`；共用通知標已讀改要 `booking.manage`；儀表板失敗通知數依校區；並行停權不會停掉所有總管理者。
- 媒體：匿名公開讀取只限目前 release 有引用的素材（後台 session 可預覽草稿）；改用串流送檔；解碼／縮圖／ffmpeg 丟到 thread；處理失敗刪原檔；每校素材累計配額（預設 5 GiB）。
- 請求：web 代理與 api 在解析前限制本文大小，素材上傳串流轉送；訪客 IP 改從 X-Forwarded-For 右邊取；程序內限流表加閒置淘汰與容量上限；telemetry 只計有效事件。
- 其他：CSV 匯出處理前導空白／控制字元；CMS 文字欄位上限 2000 字、圖片代號只收英數與連字號；匿名化同時清聯絡紀錄；登出要過 CSRF，失敗時後台不假裝已登出；`/api/site-fixture` 在正式內容模式需後台 session；備份與通知 sink 檔案改為 0700／0600。
- 未處理：未驗證手機號碼仍可占用時段（要簡訊驗證或其他產品決策）。

## 2026-09-24 品牌規範與色票收整

- 新增 `docs/brand/brand-guidelines.md`：品牌個性、Logo 與字標規格、色彩（含 HEX 近似值）、字型與字級、圖示、用語、影像、後台色票、可及性底線，全部取自既有定案。
- 官網新增 `web/app/assets/css/tokens.css` 作為唯一色票來源，拿掉 `styles.css`／`studio.css` 兩份互相覆蓋的 `:root` 顏色；`studio.css`、`styles.css`、`visit-booking.css` 與 `CampusBoard`、`SiteFooter`、`HomeFilms`、`HomeNewsTransition`、`EntranceCurtain`、`preview` 裡寫死的色碼都改引用色票。樣式裡已沒有寫死的顏色，只剩 TypeScript 的四個例外（見規範 3.3）。
- 後台 `admin/src/style.css` 補 `--on-photo*`、`--photo-caption-*`，收掉校園探索與素材庫 8 處色碼。
- 驗證：本機正式建置＋同一份 API 資料，改前改後逐元素比對計算後顏色 34,988 筆全同、截圖 32 張逐像素 0 差異（細節見 DESIGN.md）。web `vitest` 191 passed、`nuxt typecheck` 無錯誤、`nuxt build` 通過；後台 `vitest` 65 passed、build 通過。未部署。

## 2026-09-24 官網瀏覽量與網頁速度存進資料庫，後台「數據」頁可看

體檢報告「數據分析」一項：原本瀏覽量與 LCP／INP／CLS 只印在 web 的日誌，沒有存下來。

- 後端：migration `b7d2e4f1a903` 新增兩張表。
  - `page_view_daily`：依台北日期、頁面、校區、裝置累計成一列。
  - `web_vital_samples`：每個指標一筆樣本，以瀏覽器端的隨機 id upsert，保留 90 天，每個程序每天清一次。
  - 不存 IP、cookie、完整網址或任何訪客識別。
- 新公開端點 `POST /public/telemetry`：驗證規則跟 `web/shared/telemetry.ts` 同一套，多的欄位一律拒收；每個來源每分鐘最多 120 筆，超過回 429。`visit_click` 只留在日誌裡，不存。
- 新後台端點 `GET /admin/analytics/traffic?days=7–90`：回傳瀏覽總數、每日數字、各頁、裝置，以及各指標依裝置分開的 p75 與 Google 門檻評等。登入的帳號都能看。
- web：`/api/telemetry` 原本的來源檢查、限流、日誌都保留，驗證通過後轉存到 API，並附上訪客 IP 給 API 限流用（IP 不入庫）。API 不通時照樣回 204。
- 後台：「數據」頁最上方新增「官網瀏覽與速度」，可選近 7／28／90 天，內容有瀏覽次數、今天、手機比例、各頁瀏覽長條，以及速度表（主畫面出現／點擊反應／版面跳動，附評等與樣本數）。原本的預約漏斗移到下方「各校預約」。
- 契約用 `npm run contract:generate` 重新產生。

驗證：
- 後端 pytest：209 passed、1 skipped，新增 `test_traffic.py` 15 項
- `deploy/check_schema.py`：`Database schema ready: b7d2e4f1a903`
- `npm run contract:check` 通過
- web vitest 191 passed，`nuxt typecheck` 無錯誤
- admin vitest 65 passed，`vue-tsc` 無錯誤
- 本機實跑 API＋live web（開 telemetry）＋後台：Chromium 以手機、電腦各逛首頁、義華、仁武、預約頁，資料庫得到 8 列瀏覽、LCP／INP／CLS 樣本，後台「數據」頁顯示正確

正式站還沒跑 migration，所以正式站目前不會存資料（見 `deploy/README.md`）。

## 2026-09-24 最新消息與活動搬進後台（home_news）

體檢報告優先第 1 件的後半：首頁「最新消息」「近期活動」原本寫死在 fixture，後台改不到。

- 後端：新增共用內容種類 `home_news`（只有 super_admin 能編），內容有示意說明 `sample_note`、消息 `articles`（最多 30 則）、活動 `events`（最多 12 筆）。日期必須是存在的 `YYYY-MM-DD`；消息照片可以用素材庫 UUID（會建立引用保護，也不能引用分校自有素材），或沿用舊的內建素材代號；兩個清單都可以是 0 筆。`initialize-content` 會把原型的示意消息原樣帶進來，包含示意說明。不需要 migration，OpenAPI 契約不變。
- 官網：`content-overlay.ts` 用後台發布的消息整組取代 fixture，英文月份由日期推出。首頁消息改成依日期新到舊排列；活動只列台北時間今天以後的，近到遠排列，過期的自動下架。清單是空的時候顯示「目前沒有新的消息／近期活動」。「示意內容」標籤、區塊底部說明，以及對話框裡「示意活動／閱讀互動示範」的字句，都只在示意說明有值時出現。草稿預覽也會讀 `home_news`。
- 後台：「首頁 → 最新消息與活動」新頁面，功能包括：清空示意說明的快捷按鈕；新增的消息、活動放在最上面；日期選擇器；校區下拉選單（全校＋五校，也可以自己輸入）；從素材庫選照片，已填的替代文字會自動帶入；已過期的活動標「已過，官網不顯示」。
- 標題缺字提示（規格 3.1.1）：後台讀官網公開的 `/assets/fonts/chars-bd.txt`，消息標題或活動名稱用到官網標題字型沒有的字時，當場列出是哪幾個字。實測發現現行標題「小小園丁」的「丁」本來就不在字型裡。

驗證：
- 後端 pytest：194 passed、1 skipped，新增 `test_home_news.py`，初始化筆數改為 19
- web vitest：191 passed，`nuxt typecheck` 無錯誤
- admin vitest：63 passed，`npm run build` 通過
- `npm run contract:check` 通過
- 本機實跑 PostgreSQL＋API＋live 模式 web＋後台，用 Chromium 操作過一輪：登入、清空示意說明、改標題（缺字提示正確）、刪掉示意活動、新增 12/06 的活動、儲存並發布。首頁沒有「示意內容」標籤，新標題與 DEC 06 活動都有出現，舊的示意活動消失。

素材庫選照片這條路徑由後端測試涵蓋，沒有在瀏覽器裡實際點選。正式站與 Safari 都沒有驗證。

## 2026-09-24 官網體檢第一批：資安標頭、FAQPage／llms.txt、示意消息標註、選單用語

依「常春藤官網體檢」報告的「我可以直接做」欄，先做不需要園方或帳號的幾項。

- 資安標頭：新增 `web/server/middleware/0.security-headers.ts`，前台、`/admin`、同源 `/api` 代理一律送 `X-Frame-Options: SAMEORIGIN`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`（關相機、麥克風、定位、付款、USB、browsing-topics；不關 YouTube 嵌入要用的 fullscreen／autoplay）、CSP 先只收 `frame-ancestors 'self'; base-uri 'self'; object-src 'none'`；正式環境另送 HSTS（一年、不含子網域）。檔名 `0.` 讓它先於 `preview-headers.ts`，`/visit/manage` 的 `no-referrer` 照舊覆寫。完整 script-src CSP 要先盤點 inline 腳本並實機驗證，這輪不做。
- SEO／GEO：分校頁 JSON-LD 加 `FAQPage`，問答與頁面上的參觀須知同一份；新增 `/llms.txt`，只列已發布校區的名稱、地址、電話與網址，跟 sitemap 同一道閘（未開索引回 404）。
- 首頁「近期活動」「最新消息」標題上方加「示意內容」膠囊（`news.sampleNote` 有值才顯示）。消息與活動仍寫在 fixture、後台改不到，原本只有區塊底部一行小字說明。消息搬進後台前先這樣標；要整塊藏起來請再說。
- 用語統一成主選單的叫法：頁尾連結「認識常春藤／五校介紹／校園生活」改為「關於常春藤／五所校園／孩子的一天」，分校頁麵包屑「五校介紹」改為「五所校園」。後台 CMS 頁名「五校介紹」不動。
- Dependabot 沒加：repo 已有 Renovate 的 onboarding PR（#1，base 是 `feature/website-admin`），兩個一起開會重複發更新 PR，請擇一。

驗證：web vitest 187 passed、`nuxt typecheck` 無錯誤、fixture 模式 `nuxt build` 後本機 :3161／:3162 實測：各路徑回應標頭、`/visit/manage` 仍為 `no-referrer`、未開索引 `/llms.txt` 404、開索引後 200 且內容正確、`/campuses/renwu` 輸出 FAQPage；Chromium 1440／390 截圖確認示意膠囊。線上站與 Safari 未驗證。

## 2026-09-24 頁尾拿掉「參觀時間與入學資訊，請向各校確認。」

使用者要求拿掉這句開發輔助字。它不在 CMS 裡：線上發布的 `site_footer.bottom_note` 仍是原型字「官網設計提案 · 預約為操作示範，不會送出資料」，由 `web/app/utils/public-copy.ts` 換成這句。改為換成空字串，`SiteFooter.vue` 底列只剩版權；CMS 之後另填的備註照常顯示。`web/tests/public-copy.spec.ts` 補兩條斷言。

驗證：Node 22 web vitest 25 檔 186 項通過、`nuxt typecheck` 無錯誤；:3161 的 `/`、`/visit`、`/campuses/yihua` SSR 輸出都不再含這句，底列只剩「© 2026 常春藤教育機構」。以單一 commit cherry-pick 上 main，部署紀錄見 `deploy/README.md`。

## 2026-09-24 後台第六輪 UX：側欄待處理數字、明細確認期限

- 側欄「參觀案件」旁顯示新需求＋待園方確認的總數（暖黃小膠囊，0 件不顯示，超過 99 顯示 99+；報讀器讀「N 件待處理」，滑過顯示兩種各幾件）。數字來自同一個 `/admin/dashboard`，由新的 `stores/openRequests.ts` 保存：換頁時更新、30 秒內不重抓；總覽載入時直接沿用、不多打一次；案件確認或取消後強制重抓。讀不到時保留上一次的數字。
- 案件明細（待園方確認）：原本一行灰字「請於 … 前確認」改成有底色的提示，加上「還剩 N 小時」與「逾期名額會自動釋出」，剩不到 6 小時改用暖色。
- 新增全域 `.visually-hidden`。`visitDetails.test.ts` 掛載時補上 pinia（明細現在會用到 store）。
- 登入頁：帳號欄只打「admin」這類非 Email 時，原本送出後顯示「登入失敗（422）」；改為送出前就提示「請輸入完整的 Email，例如 name@example.com」，後端仍回 422 時也用同一句（新增 `loginUx.test.ts` 2 項，前端合計 60 passed）。
- 測試：前端 58 passed（新增 5 項：側欄數字、store 快取與失敗保留、總覽不重複讀取、明細倒數與暖色、確認後重抓）；`npm run build` 通過。本機 Chromium 1440px 明細、390px 抽屜截圖，並實際按「確認已選場次」看到側欄 11 → 10（只寫本機測試資料庫）。未部署。

## 2026-09-24 後台第五輪 UX：總覽看得到還沒處理的參觀案件

實際用本機 PostgreSQL＋後端＋11 筆種子案件跑後台，發現總覽在 4 筆新需求、7 筆「待園方確認」時仍寫「目前沒有待處理事項」，四格數字都是 0。待園方確認的名額 24 小時內沒確認會被自動釋出，是後台最急的事，卻沒有任何地方提醒。

- 後端 `dashboard_service`：新增 `new_requests`、`awaiting_confirmation`、`next_hold_expires_at`（最早到期的占位），依登入者校區範圍統計，定義與案件列表的 `status` 篩選相同。回應本來就是 dict，OpenAPI 契約不變。
- 總覽：四格改為「新需求待聯絡／待園方確認／今日參觀／到期待追蹤」，待確認那格寫「最早一筆還剩 N 小時」；待辦清單最上面是「時段預約等園方確認」（附最早期限）與「新的參觀需求還沒聯絡」；主按鈕帶總數，只有待確認時直接帶去待確認。草稿與通知失敗只在待辦清單出現（原本就有）。
- 案件列表：接受 `?order=oldest`（總覽的入口都帶這個條件）；待園方確認的案件在參觀時間下顯示「確認期限還剩 N 小時」，剩不到 6 小時改用暖色；手機卡片沒填方便時段就不顯示「方便時段：未填寫」。
- 測試：後端新增 1 項（計數、期限、校區範圍、與列表篩選一致）；前端新增 `openRequestsUx.test.ts` 5 項。後端 180 passed／1 skipped、前端 53 passed、`npm run build`、`contract:check` 通過。本機 Chromium 1440／390px 截圖檢查過總覽與待確認列表。未部署。

## 2026-09-24 接力改回原樣：拿掉停拍與「關於」落下

使用者看過上線版（15e3c9d）後，要求改回沒有接力動畫的樣子。回到 09-18 seam=2 原本的接力：擦除線掃過浮水印「常春藤」時變成白色大標，「的一天」整組淡入。拿掉的有停拍、「關於」掉進句首再沉下去、「的一天」逐字。簾幕距離回到桌機 .85 屏、手機 .55 屏。

`studio.css`、`DayExperience.vue`、`useCurtain.ts`、`pages/index.vue` 還原成改之前（cfce2c8）的內容，刪除 `useRelayDrop.ts`；這些檔在 ba6a03e 之後沒有別的 commit 動過。DESIGN.md 最上方改寫為「維持原樣」並列出改回的方向。比稿對照頁與 versions 快照保留作紀錄。

## 2026-09-24 分校資訊線稿按鈕的白框（iPhone 輪播切換時閃現）

使用者在手機上看到分校資訊的線稿按鈕有白框。線稿是白底圖，靠 `mix-blend-mode:multiply` 融進米白底；`.campus-tab-art` 直接對 `opacity`／`filter` 做 0.2 秒 transition，WebKit（iPhone Safari／Chrome、桌機 Safari）在轉場期間把圖移到獨立合成層，multiply 碰不到底色，露出白底長方形。自動輪播每 4 秒切換，被取消與新選取的兩張就各閃一次；點按觸發的 hover 濾鏡轉場也會閃。桌機 hover 的淡彩層（`.campus-tab-colour`，multiply＋0.35 秒 opacity）同理，淡出時整張線稿被白框蓋住。Chrome 合成方式不同，看不到。

- `CampusBoard.vue`：三個值改用 `@property` 註冊的數值變數（`--tab-art-opacity`、`--tab-art-brightness`、`--tab-colour-opacity`），transition 轉場變數、由它帶 opacity／brightness；主執行緒逐幀更新，不升合成層。靜止值與淡入時間不變；未支援 `@property` 的瀏覽器以 `var()` 後備值退回瞬間切換。
- 順帶修明華淡彩層（只影響桌機 hover）：校名招牌的近白色補丁原是柔邊橢圓，溢到兩側磚柱與花台成一圈白霧。`make_colour_wash.py` 新增 `RECT_PATCHES` 貼齊線稿招牌外框（768 座標 x 358–490、y 360–393）；重產 `campus-line-art-minghua-colour.webp`、`preview-minghua.webp`，`optimize-site-images.py --only` 產出新雜湊 `56f214277928` 小圖，`image-manifest.json` 只改兩行。舊雜湊照慣例保留。

驗證（scratchpad 獨立樹：HEAD＋本次檔案，Node 22 `nuxt build`；編譯後三個 `@property` 保留）：
- WebKit 402×874 錄影逐幀量線稿框內外亮度：自動輪播＋點按，同一建置套回舊寫法 15 幀白框 → 新 0；線上原版 20 幀。桌機 WebKit hover 淡入淡出：舊 59 幀 → 新 0。
- 逐幀讀 computed opacity：線稿 0.75→1 約 0.2 秒、淡彩 0→1 約 0.35 秒，WebKit 與 Chrome 曲線同原版；靜止時各頁籤 computed opacity／filter 新舊相同，版面尺寸相同。
- 副作用：iPhone 上未選取的線稿改走完整解析度繪製，線條比原本略深、略銳利（線稿區平均墨量 15.8 → 17.2，Chrome 為 14.8）。
- 明華素材：原腳本重跑與線上逐位元組相同；新舊差異只在招牌區，區外僅 WebP 壓縮雜訊。

iPhone 實機未驗證。以單一 commit cherry-pick 上 main，部署紀錄見 `deploy/README.md`。另外發現（未改）：鍵盤方向鍵切換頁籤時，綠色焦點框上下兩邊被裁掉，只剩左右兩條直線。

## 2026-09-24 頁尾改用 R「燕麥＋深綠底列」

比稿 `design/footer-colour-directions-20260924/` 使用者選 R。共用 `web/app/components/SiteFooter.vue` 主體改淺燕麥 `#EFE8DA`、深綠字，版權列改成滿版深森林綠 `#24483F`（多包一層 `.footer-bar`，拿掉原本的分隔線）。文案、欄位、斷點不變；首頁消息區照舊漸退成暖白再接頁尾。規則寫在 DESIGN.md 最上方。

驗證：Node 22 `nuxt typecheck` 無輸出（通過）。Playwright 對 3161 dev 跑首頁、義華分校頁、預約頁 × 1440／390px：底色與底列色正確、底列滿版、無橫向溢出、連結高度 ≥44px、最低對比主體 5.11／底列 7.63，另測強制色彩會補回分隔線；截圖與 `results.json` 在 `output/playwright/footer-colour-r-20260924/`。3161 既有的 Vite 遮罩（找不到已刪的 `visit-looks.css`）與本次無關，截圖前移除。Safari／iOS 實機未驗證；未 commit、未部署。

## 2026-09-24 接力定案：「關於」掉進句首再沉下去

比稿 `design/relay-drop-mockup-20260924/` 使用者選「沉下去」，現在已是首頁預設；`?drop=` 參數與另外四種消失方式都已移除。

效果：停拍時「關於」從浮水印那行往下掉，穿過擦除線（上半淡綠、下半白字），落進「常春藤的一天」句首，接著「的一天」逐字接上。之後「關於」沉進字行（裁掉，不淡出），大標回到置中。手機放不下八個字，整行暫時縮到約 .76。簾幕距離桌機 1.25 屏、手機 0.8 屏。規則寫在 DESIGN.md 最上方。

改動檔案：
- `composables/useRelayDrop.ts`：只留沉下去。
- `useCurtain.ts`：停拍 32%。
- `pages/index.vue`：只把 `lead` 傳給日常區，其餘與 HEAD 相同。
- `DayExperience.vue`：`aria-hidden` 的 `.day-lead`。
- `studio.css`：`.day-lead`、`.wm-a` 的 transform-origin、簾幕距離。

驗證：獨立樹 Node 22 `nuxt typecheck` 0 錯誤；`vitest run` 24 檔 185 項通過；`nuxt build` 成功。Playwright 1440×900／390×844：
- 不帶參數的逐格與比稿時的 `?drop=sink` 相同，差異只來自背景影片。
- 落地時大標讓位 171px（手機縮 .76）。
- 「的一天」在落地後才逐字浮出。
- 減少動態時 `.day-lead` 為 `display:none`，大標沒有 transform。
- 無 page error。

Safari／iOS 實機未驗證。快照 `versions/before-relay-drop-20260924-083057/`。未提交、未部署。

## 2026-09-24 比稿：「關於」掉進「常春藤的一天」再直接消失（?drop=，同日定案 sink，參數已移除）

使用者想看「關於」掉到「常春藤的一天」、再隨捲動直接消失（不是變透明）。在 `web/` 加了預覽參數 `?drop=wipe|sink|out|push|cut`，不帶參數的畫面與 DOM 都不變。

效果：停拍時「關於」從浮水印那行掉下來，穿過擦除線（上半淡綠、下半白字），落在「常」前面湊成「關於常春藤的一天」，接著「的一天」逐字接上。停拍後「關於」消失、大標回到置中，五個方向只差在消失方式：擦掉、沉下去、掉出去、擠出去、瞬間消失。桌機大標往右讓出一個字；手機整行縮到約 75%。停拍加長到 32% 捲動，簾幕桌機 1.25 屏、手機 0.8 屏（只在帶參數時）。

對照頁 `design/relay-drop-mockup-20260924/index.html`，每個方向都有桌機與手機的等速捲動影片和膠卷條。

改動檔案：
- 新增 `composables/useRelayDrop.ts`：兩份「關於」逐幀寫同一個視窗座標。
- `useCurtain.ts`：只在 drop 時改停拍比例並呼叫它。
- `pages/index.vue`：`data-drop`，並把 `lead` 傳給日常區。
- `DayExperience.vue`：`aria-hidden` 的 `.day-lead`。
- `studio.css`：`.day-lead`。

驗證：在獨立樹用 Node 22 跑，`nuxt typecheck` 0 錯誤；`vitest run` 24 檔 185 項通過；`nuxt build` 成功。Playwright 1440×900／390×844 截五種方式的逐格與影片，無 page error。預設模式的逐字進度與前一版相同，也沒有 `.day-lead`。減少動態時沒有落下效果。Safari／iOS 實機未驗證。快照 `versions/before-relay-drop-20260924-083057/`。未提交。

## 2026-09-24 常春藤的一天：修復背景影片畫質

背景影片原本被額外縮成桌機 1280×720、手機 480×270，並以 CRF 27 再壓縮；手機 `cover` 鋪滿直式螢幕後細節明顯模糊。`scripts/optimize-site-videos.py` 改為桌機直接保留現有 1440×810 母檔（9,333,850 bytes，位元相同），手機由同一母檔以 CRF 25 輸出 1440×810（7,488,249 bytes），更新 `video-manifest.json` 的兩個雜湊網址。原剪輯、構圖、25 秒／24fps／600 幀、無音軌、faststart、遮罩與播放控制不變，Hero 映射不變，舊影片資產保留。原始 4K 影片不在記錄路徑，這次以現有素材恢復畫質，沒有放大解析度。

驗證：
- 兩支新影片全段解碼、格式、幀數、faststart 均通過；手機按 390×844 中央裁切，每 12 幀抽一幀、共 50 幀，相對 1440×810 素材的 VMAF 由 45.30 提升到 92.95。這是離線畫質對照，非實機效能指標。
- Node 22 獨立 fixture 快照 `nuxt build` 成功；`vitest run tests/media-policy.spec.ts --maxWorkers=1 --minWorkers=1` 共 3 項通過。
- 本機 Chrome：1440×900／390×844／320×568／760×393 實際載入正確的 1440×810 新檔；首屏不下載、捲入載入、暫停／恢復、循環、離開區塊暫停通過，無 page error／水平溢出。減少動態、省流量、3g 不下載影片，無 JS 保留靜態封面。
- 另行量測載入 3 秒後的連續播放：桌機約 8.19 秒／197 幀、手機模擬約 8.04 秒／194 幀，期間皆 0 掉幀；首次載入與捲入時的手機檢查仍曾記錄 1–2 幀丟失，不將此結果解讀成整程零掉幀。
- `node --check app.js`、`python3 package_preview.py` 通過；凍結原型未修改，重打包與既有 `preview.html` 位元相同。

證據與獨立預覽：`output/day-video-quality-20260924/`。Safari／iPhone 實機未驗證。尚未部署。

## 2026-09-24 接力拿掉過字放慢，只留停拍逐字

使用者要拿掉「放慢」。擦除線過「常春藤」恢復原本速度；過完字後在兩行中間停一拍（22% 捲動）、逐字接上「的一天」仍保留。`useCurtain.ts` 的查表只剩停拍，手機簾幕距離 .8→.7 屏（桌機 1.1 不變），停拍以外的擦除速度與原本相同。DESIGN.md 最上方同步改寫。

驗證：在 scratchpad 獨立樹用 Node 22 跑，`nuxt typecheck` 0 錯誤；`vitest run` 24 檔 185 項通過；`nuxt build` 成功。Playwright 在 1440×900 和 390×844 下：
- 過字時擦除線每捲 1px 走約 1.17px（桌機）和 1.83px（手機），與原本 .85／.55 屏時一致。
- 停拍期間「的」「一」「天」依序浮出。
- 減少動態時三個字透明度都是 1。
- 無 page error。

Safari／iOS 實機未驗證。快照 `versions/before-relay-noslow-20260924-082326/`（有放慢的版本）。未提交、未部署。

## 2026-09-24 頁尾拿掉校徽

使用者要求拿掉頁尾品牌名稱左側的畢業版雙童校徽（09-23 `7def645` 加入）。`SiteFooter.vue` 移除校徽圖片、`.footer-crest` 與圖文並排的 flex 規則，品牌區回到只有中英文品牌名稱；1000px／760px 的欄位跨整列排版與英文名 `lang="en"` 保留。素材 `web/public/assets/ivy-graduation-crest.png` 先留在 repo（頁尾校徽旅程比稿待拍板），目前沒有頁面引用。DESIGN.md 同節已改為撤下紀錄。

## 2026-09-23 孩子的一天：iPhone 捲動時按鈕與背景抖動（根因修正）

使用者回報 iPhone 17 下滑時「暫停背景」按鈕會抖、圖片也怪怪的，電腦 Chrome 開發者工具看不到。根因是 `.section.day-experience` 的 `overflow-x:clip`：WebKit 會替裡面的 sticky 圖層（背景影片 `.day-film`、按鈕層 `.day-film-ui`、大標 `.day-intro`）掛一層由主執行緒定位的祖先裁切層，捲動執行緒推得動 sticky，推不動這層，所以每幀晚一步再被拉回。iPhone 上的 Safari 和 Chrome 都是 WebKit；Chrome 的合成器沒有這個行為。同日下午（`bfcfef8`）加在 `.day-film-ui` 的 `translateZ(0)` 沒有效果（實測 89 幀仍偏移），這次一併移除。

- `styles.css`：區塊拿掉 `overflow-x:clip`；溢出的 WebGL 紙畫布（手機上超出視窗約 58px）改由 `.day-prints` 裁切。`.day-prints` 從「縮窄寬度＋置中」改成「滿版＋左右內距」，裁切邊界仍在視窗邊緣，內容寬度不變（桌機 `max(48px,(100% - 1280px)/2)`、≤1100 32px、≤760 20px）。

驗證：WebKit 2359 用真的滾輪事件（走捲動執行緒，mobile 模式不支援滾輪，改關 isMobile 並補觸控規則）錄影，逐幀比對按鈕位置。在 scratchpad 獨立樹（HEAD＋本檔）建置後：
- 按鈕偏移幀數：舊 87/153 → 新 0/153。
- 暫停影片後追蹤背景：舊 81/153 有 ±1–3px → 新 0。
- Chrome／WebKit 11 種寬度（1920～390，含 1101／1100、761／760 斷點兩側）：每張卡片位置、內容寬、區塊與整頁高度新舊一致，水平溢出 0。
- 手機 WebGL 紙掛上後截圖新舊逐像素最大差 3/255，左右邊緣無差異。

iPhone 實機未驗證。線上是 main，含 `paper-budget.ts` 等 feature 分支沒有的改動，但 `styles.css` 這幾條兩邊相同；以單一 commit cherry-pick 上 main，部署紀錄見 `deploy/README.md`。拍立得「停下才由 CSS 換成 WebGL」與快滑時角落被風掀起屬於原設計，這次沒有改。

## 2026-09-23 接力定案：過「常春藤」放慢＋「的一天」逐字接上

使用者想讓訪客發現「關於常春藤」的「常春藤」接成「常春藤的一天」，但不要太明顯。比稿時 `?relay=` 有 slow／type／dock／deepen 四個方向，對照頁在 `design/relay-discovery-mockup-20260923/`。看完後選 **slow＋type**，現在已是首頁預設；`?relay=` 參數與 dock、deepen 的程式碼都已移除。
- 擦除線過「常春藤」時放慢，字框固定分到停拍前 45% 的捲動（桌機約 300px、手機約 170px，原本約 130px／32px）。
- 過完字後在兩行中間停一拍，占 22% 的捲動，這段用來讓「的一天」一個字一個字接上。
- seam=2 的簾幕距離拉長補回：桌機 .85→1.1 屏、手機 .55→.8 屏。

改動檔案：
- `useCurtain.ts`：onProgress 可帶 `remap`，捲動進度經查表變成擦除進度，只有 belief 簾幕會帶；`--relay-day` 改成逐字進度。
- `DayExperience.vue`：「的一天」拆成逐字 span。
- `studio.css`：`.t-day-ch` 逐字規則，以及簾幕距離。

`index.vue` 與 HEAD 相同。規則與落選方向寫在 DESIGN.md 最上方。

驗證：在 scratchpad 獨立樹（HEAD＋本次 3 檔）用 Node 22 跑，`nuxt typecheck` 0 錯誤（比稿階段改寫前抓到 13 個，確認它有在檢查）；`vitest run` 24 檔 185 項通過；`nuxt build` 成功。Playwright 在 1440×900 和 390×844 下：
- 不帶參數的擦除曲線與比稿時的 `slow,type` 逐格相同。
- 停拍期間「的」「一」「天」依序浮出。
- 減少動態時沒有簾幕，三個字透明度都是 1。
- 無 page error。

另外，比稿階段已確認拆字前後每個字的排版框完全一致。Safari／iOS 實機未驗證。快照 `versions/before-relay-type-20260923-231256/`（本次 4 檔的 HEAD 版）。未提交、未部署。

## 2026-09-23 首頁手機版：活動影片取代近期活動、最新消息上下排列

依 `design/news-carousel-mobile-20260923/` 的 D 接進 `web/`，只改 640px 以下：近期活動換成 `HomeFilms.vue` 活動影片輪播（鼠尾草綠色帶、中央聚焦、左右露出、白色圓點、無限循環、只有當前那支靜音播放、支援 YouTube 連結點了才載入），最新消息改成縮圖列表；桌機不變。影片第一版用官網既有素材剪段（首屏影片＋舞台表演原檔），要換正式影片或 YouTube 改 `web/app/utils/campusFilms.ts`。

驗證：Node 22 `nuxt typecheck` 無錯誤；`vitest run` 25 檔 186 項通過（新增 `tests/film-carousel.spec.ts`）。本機 dev（:3161）Playwright 390×844：近期活動隱藏、綠色帶、消息三列、無水平溢出；只有當前影片下載並播放，點右側露出的影片換到第 2 支並開始播、第 1 支暫停；圓點、最後一支往後滑回第 1 支、暫停鍵、減少動態不播都通過；1440 桌機近期活動與三欄卡不變、不下載海報與影片。Safari／iOS 實機未驗證。快照 `versions/before-home-films-20260923-220111/`；證據 `output/playwright/home-films-20260923/`。

## 2026-09-23 五校線稿 hover 變彩色

使用者要首頁五校線稿在 hover 時變成彩色。原線稿是 image_gen 產的純線條、沒有彩色版，所以用各校實景修復照（`*-enhanced-v1`）的顏色做一層淡彩：手動取 11–14 個對位點，以 TPS 變形把照片對到線稿，中值濾波＋模糊做出水彩感。只在線稿有筆觸的地方上色，天空只留很淡一層；照片裡的校名、招牌字、紅綠燈、路牌補成周圍顏色，柏油地面逐列取中位數抹掉行人。產生腳本與五校對照圖在 `design/campus-tab-colour-20260923/`。

淡彩層只有顏色、不含線條（`web/public/assets/campus-line-art-<校區>-colour.webp`，各約 16KB），在 `CampusBoard.vue` 以 multiply 疊在原線稿上，hover 時 0.35 秒淡入，所以線條濃淡和原本的 hover 一樣。只在 `@media(hover:hover)` 顯示；觸控裝置為 `display:none`，搭配 `loading="lazy"` 不會下載。線稿尺寸規則從 `img` 移到外層 `.campus-tab-figure`，靜止、選中、強制色彩模式的樣子都不變。響應式圖用 `optimize-site-images.py --only` 產生，manifest 只新增 5 筆。

驗證：Playwright 對 `:3161` 桌機 1440（DPR 2）hover 明華、崇德、義華、仁武，只有被 hover 的那一校淡彩 opacity 為 1，線稿濾鏡與框線大小（160×106.7）不變，無 page error。手機 390／320 淡彩層是 `display:none`，沒有發出淡彩圖請求，框線大小與原本一致。截圖在 `output/playwright/campus-tab-colour/`。`:3161` 的 `visit-looks.css` Vite 遮罩仍在，與本次無關。Nuxt typecheck 與正式建置沒有實跑。未 commit。

## 2026-09-23 預約頁選校：其他校不再變暗

使用者不要選一間學校後其他學校變暗。拿掉 `web/app/assets/css/visit-booking.css` 對未選卡片照片的 `filter:saturate(.55) brightness(.96)`，連帶移除 `img` 上只為它存在的 `filter` 過場。選中的卡仍是雙層外環＋右上打勾，五張照片一律原色。DESIGN.md「預約頁首頁風格」同步改寫。

驗證：Playwright 對 `:3161/visit` 桌機 1440、手機 390 各點選崇德，五張照片的 computed `filter` 皆為 `none`、只有崇德 `checked`、無 page error。截圖在 scratchpad，未存進 `output/`。`:3161` 仍有別的 session 殘留的 `visit-looks.css` Vite 錯誤遮罩，與本次無關，驗證時先移除遮罩再點。

## 2026-09-23 開場布幕：校徽停留時間拉長

使用者要進站布幕的 logo 出現久一點。`web/app/utils/entrance-timeline.ts` 的 `LOGO_DURATION` 從 1500 改成 2500ms，校徽全亮的時間從約 0.7 秒變成約 1.7 秒。光圈開合速度、3-2-1 倒數與拉幕都沒動，整段開場從 7.9 秒變成 8.9 秒。`entrance-timeline.spec.ts` 新增一項，確認 480～2100ms 之間校徽都是全亮。設計預覽的 `velvet.js` 已用 `build-preview.mjs` 重產；首屏海報是第 0 幀，不受影響。

驗證：用 Node 22 跑 vitest 的 `entrance-timeline`、`entrance-policy` 兩檔，共 34 項通過（新測試改常數前先確認會失敗）。在設計預覽定格截圖：1.3、2.0 秒校徽全亮，2.4 秒光圈收合，2.7 秒接上倒數「3」，總長顯示 8.9 秒。截圖在 `output/entrance-logo-hold-20260923/`。Nuxt 正式建置沒有實跑。未部署。

## 2026-09-23 拍立得翻面暗示改 A「角落捲起」：拿掉折角、風把右下角掀起來

使用者要翻面提示有風吹的感覺，比稿 `design/flip-wind-20260923/`（無折角三版）與 `design/flip-corner-turn-20260923/`（依 A 做的翻面三版）後裁定：**A 角落捲起，點下去也從右下角先捲，翻面效果維持不變**。已接進 Nuxt `web/`：

- 拿掉右下折角（`.print-ear`、`--ear`、貼圖挖角、進場掀角），平常是完整平貼的相紙。
- 捲動時觀者看到的右下角被風掀起（捲得越快越大，強風翻過 90° 露出背面橫線紙，停下落回牆面輕彈一下，整張微擺 ≤0.4°）；只回應捲動，減少動態不做。
- 點下去 0.1 秒內角先捲起、0.45 秒內收掉，之後照原本的翻面（時長、曲線、懸臂彎、抬升都沒動）；顯影完成後角落輕掀一次取代舊掀角，首張偷看維持。
- 新增 `web/app/utils/cornerWind.ts`（風、起手、輕掀，取代 `earGust.ts`）與 `cornerCurl.ts`（紙張彎曲數學）；`paperPrints.ts` 網格 28×28→44×56 改彎角落、移除貼圖挖角；CSS 版（手機捲動中、無 WebGL）用兩片 3D 三角紙近似，只在起風／起手時才切開紙角。

驗證：Node 22 vitest 24 檔 180 項通過（新增 `corner-wind`、`corner-curl` 兩支，移除 `ear-gust`）；`nuxt typecheck` 0 個 `error TS`（以故意錯誤檔確認有抓錯）。Chrome（M2 Metal）桌機 WebGL：靜止無折角、捲動時右下角捲起、點擊後 120ms 角先捲再照原樣翻過去與翻回；強制關 WebGL 的 CSS 版起風三角紙掀到 52°、起手在約 100ms 到 43° 並於 430ms 收平（真實時間逐幀取樣）；手機 390 捲動當下走 CSS 版、停下後接 WebGL、無水平溢出；減少動態不掀、不載 WebGL；幀時間 p50／p95 16.7／16.8ms 與沒有拍立得的區段相同。證據 `output/playwright/flip-wind-corner-20260923/`，快照 `versions/before-flip-wind-corner-20260923-210501/`。驗證用的是另一個 session 開著的 dev server（3161），當時頁面有別處改到一半的 `visit-looks.css` 404／Vite 錯誤遮罩，與拍立得無關。未提交、未部署；Safari／iOS 實機未驗證。

## 2026-09-23 手機體驗：內頁頁首收成膠囊、選單鎖捲動、小字放大

接續手機盤點的第 3–6 項（預約表單「下一步」與表單提示字級、新聞卡點擊區，因另有 session 正在改版預約頁與新聞輪播，本次未動）。

- 分校頁、預約頁在 900px 以下也跟首頁一樣，捲過 40px 收成深綠膠囊、選單改用同一張選單卡（五校、電話、社群）；原本整條 78px 頁首一直黏在上方。`SiteHeader.vue`：`usePanel = 首頁 || 900px 以下`，頁首加 `.is-pill-nav`；`studio.css` 膠囊區段 139 個 `body:has(.studio-hero)` 改成 `body:has(:is(.studio-hero,.is-pill-nav))`（單一 class，特異度不變），內頁收合時拿掉底線。桌機內頁不變。
- 手機（≤900px）選單開著時 `html.menu-locked` 鎖背景捲動；桌機選單卡不鎖。
- 預約頁（`/visit`、`/visit/<校>`）手機不顯示頁首與膠囊的「預約參觀」；`/visit/manage` 保留。
- 拍立得背面的回答（`.print-answer`）與校區照片探索提示（`.tour-image-help`）手機由 12px 改 14px。
- `app.vue` 加 `theme-color` `#fdfcf6`（`--paper`）。

驗證：兩棵 `git archive` 隔離樹（r1＝前一段改動、r2＝再加本段）各自 build（fixture）。首頁 390／1440 的頂端、頂端選單、收合、膠囊選單 7 個狀態 r1／r2 逐像素相同；分校頁與預約頁 1440／1024 頂端與捲動後逐像素相同。390／320 實測：內頁收合後頁首透明、膠囊鈕 44×44、選單卡開啟時 `menu-locked`，在卡內觸控滑動背景不動、點卡外關閉並解鎖、Esc 焦點回到選單鈕；預約頁膠囊只剩校徽與選單，`/visit/manage` 仍有預約鈕；無水平溢出。拍立得背面六張在 390／360 高度不變、320 高 18px（370→388），皆無溢出。隔離樹 `nuxt typecheck` 0 個 `error TS`、vitest 21 檔 165 項通過。截圖在 `output/mobile-ux-20260923/shots/`。未提交、未部署。

## 2026-09-23 手機首訪：開場布幕在 4G 播得出來、首屏影片瘦身

手機版體驗盤點（正式站 390×844 模擬）發現：一般 4G（9 Mbps）首訪時，開場布幕只顯示約 3 秒靜態紅幕就切掉，從沒播過；同時已下載 6.2 MB。時間軸顯示兩個原因：首屏手機影片 3.9 MB 從 1.5 秒開始在布幕底下下載、搶頻寬；1.4 MB 的投影貼圖 PNG 要等 three.js 載完才開始抓（2.9 秒），5.5 秒才到，超過 2.8 秒載入上限。

- `web/public/assets/ivy-30th-anniversary-projection.webp`：原 PNG 把「去背後必為全透明」的白紙像素壓成純白再轉無損 WebP，1,408 KB → 462 KB。有損 WebP（q90 97 KB）會在白紙區冒出約 1 萬個去背斑點，不能用。重產：`python3 scripts/optimize-entrance-projection.py --write`。
- `web/app/utils/entrance-policy.ts`：新增 `ENTRANCE_PROJECTION`／`ENTRANCE_DIGIT_FONT`（引擎預設值改用同一組常數）；bootstrap 在 `DOMContentLoaded` 以 `crossOrigin=anonymous` 預載兩者（對齊 three `ImageLoader` 與 `FontFace` 的 CORS 模式，否則會重複下載）。DCL 晚於 1.5 秒就跳過——布幕元件晚於 1.8 秒掛載本來就放棄，慢速網路不再白載 462 KB。
- `web/app/components/HeroVideo.vue`：`data-ivy-entrance="pending"` 時先不載首屏影片，布幕開演（playing）或放棄（屬性移除）才放行，5.5 秒保底（與 CSS 首屏遮罩撤除同時）。改在 `startVideo` 內，main 的手機 load＋idle 延後版本可直接套用。
- 手機首屏影片改用 CRF 26：`design/hero-video-smooth-20260923/hero-smooth-mobile-crf26.mp4`（CRF 21 保留作對照），`scripts/optimize-site-videos.py` 改指向它，`hero-mobile-ba791e4aa97c.mp4` 3,886 KB → 2,203 KB。VMAF 手機模型 99.88、一般模型 93.15。

驗證：從 `git archive HEAD` 匯出兩棵隔離樹（HEAD／HEAD＋本次改動）各自 `nuxt build`（fixture），3171／3172 交替量測。一般 4G、不節流 CPU 各 3 次：投影貼圖 2.4–2.6 秒才開始、5.0 秒到 → 0.7–0.9 秒開始、1.9–2.1 秒到；布幕 0/3 → 3/3 開演（2.33–2.50 秒就緒）；首屏影片 0.9 秒開始載 → 布幕開演後 2.4 秒。慢速 4G 兩版都沒下載貼圖、遮罩撤除時間相同。設計預覽 `?p=0.12`／`0.17` 以 route 把 PNG 換成 WebP，真實引擎輸出逐像素相同（差異 0）。隔離樹 `nuxt typecheck` 0 個 `error TS`（放刻意錯誤確認有效）、vitest 21 檔 165 項通過。本機 JS 未壓縮（three 720 KB，正式站 147 KB），實際開演應更早；量測期間機器 load 10–28，CPU 節流的端到端數字不採用。紀錄在 `output/mobile-perf-20260923/`。未提交、未部署；Safari／iOS 實機未驗證。

## 2026-09-23 最新消息改成 C「原地換片」自動輪播

使用者從桌機輪播三版選 C，接進 `web/`：`NewsDialog.vue` 的三張消息卡改由 `composables/useNewsRotation.ts` 輪播（每 6 秒三格由左到右依序由上往下刷出下一組照片、文字上浮替換；fixture 6 則兩組交替），標題列加被動倒數「01 / 02」。分組邏輯 `utils/newsRotation.ts`（超過三則才輪播、最後一組從頭補滿），計時沿用分校的 `createCarouselClock`。滑鼠停在卡上、鍵盤焦點、對話框開著、離屏、分頁在背景都暫停；減少動態與 640px 以下（原生橫向捲動）不輪播。卡片圖改包 `.hn-media`（桌機 1.55、手機 3:2 比例不變）。取代 09-16「不使用自動輪播」，已記入 DESIGN.md。修改前快照 `versions/before-news-carousel-c-20260923-205644/`。

驗證：Node 22 `vitest run` 23 檔 169 項通過（新增 `tests/news-rotation.spec.ts` 3 項）、`nuxt typecheck` 0 個 `error TS`；`node --check app.js` → `python3 package_preview.py`，`preview.html` 無差異。本機 :3161 Playwright：1440／1024 從第一組換到第二組、倒數 01→02；滑鼠停 8 秒不換、對話框開著暫停；滑鼠關對話框後換組焦點交給新標題（不掉到 body），Esc 關閉的鍵盤焦點維持暫停；390px 與減少動態 8.5 秒不換、倒數不顯示；無水平溢出、無 hydration 警告。console 唯一錯誤是另一項未提交工作的 `visit-looks.css` 404，與本項無關。截圖 `output/news-carousel-c-site/`。未決：WCAG 2.2.2 常駐暫停方式（使用者要求不要按鈕）。Safari／iOS 未驗證。已提交 `8c834ee`，以 `c461429` 上 main 經 CI 部署，正式站驗證通過（見 deploy/README.md）。

## 2026-09-23 最新消息桌機輪播比稿（`design/news-carousel-20260923/`，已選 C）

使用者附首頁「近期活動／最新消息」截圖，要最新消息有輪播效果、不要按鈕，先看三版電腦版 mock（`web/` 未改）。6 則消息輪流出現，近期活動 3 則不動：A 緩慢漂移（整排約 32px／秒往左流，軌道延伸到視窗右緣露出下一張，可拖曳／觸控板左右滑）、B 逐張推進（每 4.5 秒推一張，最左那張淡出，標題旁「02 / 06」倒數細線，可拖曳）、C 原地換片（位置不動，每 6 秒三格由左到右依序由上往下刷出下一組照片、文字上浮替換）。三版都在滑鼠停留、鍵盤聚焦、離屏、分頁在背景時暫停，減少動態不播。**不要按鈕＝自動播放，三版都牴觸 09-16「消息不使用自動輪播」的裁定，選定要重新拍板；WCAG 2.2.2 的暫停機制也要一起決定。**

驗證：`node design/news-carousel-20260923/shot.cjs`（Playwright＋Chrome）1440／1024 × 三版：有移動、hover 後停住、倒數凍結、換到下一則／下一組、無水平溢出、無 console error；B、C 轉場逐格見 `shots/b-strip.jpg`、`c-strip.jpg`。滑鼠拖曳：A 拖 250px 放手連慣性移 462px、B 換到下一張，放手不誤觸點擊、之後單點仍點得到。Safari、觸控板實際手感未驗證。未提交。

## 2026-09-23 最新消息手機輪播比稿（`design/news-carousel-mobile-20260923/`，待拍板）

**同晚第二輪 D（比稿頁預設）：**使用者指定近期活動改成「學校活動影片」區塊，用參考圖的白色圓點＋B 中央聚焦；最新消息改上下排列。影片區鼠尾草綠底 `#acbe9b`、當前影片置中自動靜音循環、兩側露出海報、點圓點或兩側影片可換、無限循環、有暫停鍵，只有當前那支載入；影片暫用 `hero-campus.mp4`＋`day-film-mobile.mp4` 舞台表演剪段，標題為範例（已確認在 LINE Seed 子集內）。消息預設縮圖列表，可切大圖直排；影片比例可切 16:9／4:3／4:5。Playwright 390×844 功能與四種組合無溢出、無 console error 通過；Safari／iOS 實機未驗證。未改 `web/`、未提交。

**21:45 修訂：**圓點下方的類別與標題拿掉；影片格改成可混放「檔案」（靜音自動預覽）與「YouTube 連結」（縮圖＋播放鍵，點了才就地載入 `youtube-nocookie` 播放器有聲播放，滑走即卸掉），比稿頁可貼連結實測；比例預設改 16:9。Playwright 390×844 YouTube 載入／卸除、圓點、循環、減少動態通過，無 console error。

使用者要首頁「近期活動／最新消息」在手機版改成輪播，先看三種 mock（桌機不動、`web/` 未改）：A 單張翻頁（滿版一次一則，分校輪播同款膠囊圓點＋暫停鍵，5 秒自動換，兩個輪播錯開 2.5 秒）、B 中央聚焦（當前置中、左右露出前後一則只留色塊或照片，無限循環，標題列 ← 1/3 →）、C 疊卡（底下兩張露色條，甩開最上面那張塞回最底下）。**A 牴觸 09-16「消息不使用自動輪播」的裁定，選 A 要重新拍板。**三版區塊都比現況高 130–180px。內容取自 fixture。驗證：Playwright 1480 比較頁與 390×844 實寬無 console error、無水平溢出；A 自動換頁／暫停、減少動態不播，B 循環與上一則，C 下一張／← 退回、拖曳後不誤開對話框都通過。Safari／iOS 實機未驗證。未提交。

## 2026-09-23 頁尾加入畢業版校徽

使用者確認畢業版雙童 Logo，放到 `SiteFooter.vue` 中英文品牌名稱左側，排列比照頁首。新增透明素材 `web/public/assets/ivy-graduation-crest.png`（384×384，約 217 KB），由內建 imagegen 去背後等比例縮小；保留原文案、字型與深森林綠配色。桌機校徽 72px、手機 60px，平板與手機讓品牌區跨整列，避免文字受擠壓。素材母檔與製作紀錄保留於 `output/imagegen/footer-graduation-20260923/`。

驗證：Node 22 `npm --prefix web run typecheck` 通過、無 `error TS`；`node --check app.js` → `python3 package_preview.py` 通過，凍結原型 `preview.html` 無差異。本機 :3161 Chrome 1440／820／390／320px 校徽載入正常、圖文左右排列、無水平溢出，桌機與 390px 已目視確認。Safari／iOS 實機未驗證。未提交、未部署。

## 2026-09-23 預約頁改成首頁風格（定案：C 的第一步＋A 的第二步）

使用者想把 `/visit` 改成首頁風格。先做三案以 `?visit=` 比稿（A 分校線稿、B 拍立得、C 首頁節奏），使用者選 **C 的第一步＋A 的第二步**，已取代 09-22 的墨綠迎賓區＋框內表單並移除比稿參數與 B。第一步沿用「關於常春藤」：薄荷色帶、「預約／參觀」巨大淡字、左文右圖（`about-curious`），選校改成五張圓角照片卡（手機為一列一張的橫條）。第二步與送出後沿用「分校資訊」：左側跟隨捲動的圓角實景＋明體校名與地址電話，右側不包框的開放式表單（短線小標分段、圓角欄位、膠囊得知管道）、金色膠囊送出鈕；送出結果頂端放該校線稿。兩步用 `data-step` 切換色票。改的是 `web/app/components/VisitForm.vue`（新增 `isPicking`，移除舊迎賓側欄與列表選校）與整份重寫的 `web/app/assets/css/visit-booking.css`；欄位、驗證、idempotency、三種成功語意、booking-config 分支不動。styles.css 仍有舊的全域 `.visit-intro`（sticky），所以迎賓區命名為 `.visit-welcome`。改版前快照 `versions/before-visit-looks-20260923-200708/`。

驗證：scratchpad 獨立 Nuxt build（fixture，:3176，不動共用 `.nuxt`）＋ Playwright 以 `page.route` 攔截預約 API，1440／390 走完選校→填資料→送出，無 console error、無水平溢出；Tab＋方向鍵可選校、焦點框 3px；仁武 inquiry 模式與 `/visit/minghua` 直接進第二步正常。`vue-tsc` 0 錯、預約相關 vitest 4 檔 42 項通過。截圖 `output/visit-redesign/final/`，三案比稿圖 `output/visit-redesign/looks/`。未驗證：Safari／iOS 實機、200% 放大；`/visit/manage` 尚未跟著改。另：同 checkout 的 :3161 dev server 因模組快取仍會引用已刪的 `visit-looks.css`（404），重啟即可。

## 2026-09-23 開場布幕：首屏遮罩換成新版布幕海報

使用者反映線上首頁開場「好像先留著舊設計的布幕，才出現新的」。查證（Playwright 開正式站逐格截圖）：從首屏到 WebGL 就緒約 0.4～3.0 秒，畫面是 `entrance-policy.ts` 的首屏遮罩與 `EntranceCurtain.vue` 等待期底色，兩者都還是第一版（`a74c1a6`）的扁平紫紅條紋；A/19 改成深紅光澤＋帷幔後沒跟著改，WebGL 就緒後才硬切成新版布幕。

改法：用實際引擎渲染 progress 0 的第一幀，存成五張 WebP 海報（`web/public/assets/entrance-poster-{phone,portrait,landscape,desktop,wide}.webp`，21～45 KB）。依視窗比例分五檔，對應引擎帷幔垂花數 `max(2, floor(aspect×2.4+0.5))`；褶子與綁點都是視窗比例的分數，所以海報以 100%×100% 拉伸在同一檔內帷幔、流蘇、下襬都對得上。`ENTRANCE_POSTERS` 是單一來源：同時產生 CSS media 規則（最後符合者勝，所以反序輸出）與 bootstrap 的 `<link rel=preload fetchpriority=high>`（只在要播開場時才下載，只抓一張）。對話框等待期用同一張海報；WebGL 就緒後畫布 320ms 淡入蓋過海報，海報留到布幕開始拉開（`.is-opening`）才撤。海報下載前的後備條紋改用絨布實際取樣色。重產工具 `design/entrance-curtain-a-velvet-20260922/render-posters.cjs`（Metal 渲染、印出 `?v=` 雜湊）；測試會比對 `?v=` 與檔案內容雜湊，重產後忘了改版號會失敗。

驗證：Node 22 `vitest run` 22 檔 163 項通過（新增 aspect 選圖、CSS 與 JS 順序一致、內容雜湊版號）；`nuxt typecheck` 0 個 `error TS`；scratchpad 獨立 Nuxt build（fixture）用 Playwright（Metal）逐格看 1440×900、1366×768、1024×768、820×1180、390×844：封面即新版布幕，與實際第一幀的帷幔帶／兩側平均像素差 1～9／255，淡入後無跳動，拉幕時首頁正常露出。另發現既有問題（未改）：開場有 2.8 秒載入上限，正式站桌機寬頻實測約 2.7 秒才就緒，節流到 16 Mbps 時兩個版本都會放棄動畫只留封面。快照 `versions/before-entrance-poster-20260923-163548/`。Safari／iOS 實機未驗證。未部署、未提交。

## 2026-09-23 拍立得：滑鼠點完不再留綠色焦點框

使用者截圖問「翻頁效果好像沒在線上」與「綠框能不能移除」。查證：翻面改自然（`5a6128e`）自 09-23 12:05 的 main 部署起就在線上，捲動飄角（`acde729`）隨 16:21 部署（`3b496ff`）上線；Playwright（Metal）開正式站確認 WebGL 紙為右緣掀起往左翻。綠框是 `.print-turn:focus-visible`：滑鼠點卡片後焦點留在透明按鈕上，之後按方向鍵／空白鍵捲頁，Chrome 就把它判成 `:focus-visible`，畫出不跟紙傾斜、也不切折角的平面矩形；空白鍵還會把卡片再翻一次、頁面不捲動（正式站實測）。`web/app/components/DayMomentCard.vue` 的 `toggleFlip` 在 `event.detail > 0`（滑鼠／觸控）時 `blur()`，鍵盤 Enter／Space（detail 0）保留焦點框。本機 :3161 驗證：點擊後 ArrowDown 不再出框、Space 正常捲頁不翻面、鍵盤聚焦＋Enter 仍有框並翻面；Node 22 `nuxt typecheck` 無錯誤輸出，`vitest run` 22 檔 153 項通過。證據 `output/playwright/flip-live-20260923/`。單獨 cherry-pick 上 main 部署。

## 2026-09-23 桌機關於：大字要完整露在段落下方

使用者截圖：桌機「關於常春藤」黏住、準備接孩子的一天時，段落最後幾行壓在浮水印「關於」上。原因不是上午的手機修正（c7b9c47 只動 ≤900px），而是下午改成單張 3:2 照片（a50a569）：舊的雙照片疊放比內文高，段落剛好停在大字上方；換成較矮的單張照片後，內文變成最低的元素，layout 的滿屏置中又在段落下多墊約 98px，段落停的位置就往下掉。對照 09:34 舊 build（:3125）與現行 dev（:3161），1440×900 段落末行 y 183→263，「關於」上緣都是 190。

`web/app/assets/css/studio.css`：動態版尾留白（半屏＋1.52 倍大字，對齊「關於」上緣）從 ≤900px 擴大到所有寬度，桌機另拿掉 `.belief-layout` 的滿屏 min-height，最後一行到大字的間隔固定為 layout 下內距。1280×720／1440×900／1512×982／1920×1080／1024×768 段落與照片最低點都在「關於」上緣之上 55–76px；390px 手機數值不變（96px）；接力時「常春藤」與日常大標仍對齊（1440：207,365），無 page error。減少動態／無 JS 維持原本較短的尾留白。證據 `output/playwright/about-desktop-tail-20260923/`，快照 `versions/before-about-desktop-tail-20260923-163406/`。未部署、未提交。

## 2026-09-23 「略過動畫」提早退場

使用者說略過鈕太晚消失。`web/app/components/EntranceCurtain.vue`：原本整段 7.9 秒都在，拉幕後疊在頁首「預約參觀」上；改為布幕開始拉開（`opening > 0`，與片頭燈熄同時）就淡出 240ms，之後不可點、不可聚焦，Escape 仍可略過。實際首頁（:3161）1440／390px：倒數中可見可點、點了會略過；拉幕後 hidden 且點不到；Esc 25–34ms 內關閉並還原捲動；完整開場、清理、不重播無錯誤；Node 22 `nuxt typecheck` 0 錯誤。快照 `versions/before-skip-early-20260923-155515/`。未部署、未提交。

## 2026-09-23 開場布幕流蘇改金色絲線（A/20）

使用者嫌帷幔流蘇像「金屬吊飾」。`web/app/utils/entranceCurtain.ts` 的流蘇由「有凹槽的實心錐＋金屬度」改為絲線：金屬度 0＋sheen、每根線各自深淺與長短、下緣參差透出絨布、頭部圓球水平繞線；尺寸 1.35→1.1 倍。帷幔飛出距離 0.4→0.5（`VALANCE_FLY`，三處共用），減速尾巴移到畫面外，流蘇不再拖過頁首文字。預覽 `velvet.js` 已用 `build-preview.mjs` 重新產生。Node 22 `nuxt typecheck` 0 錯誤；實際首頁（:3161）1440／390px 完整開場、清理、不重播，無 shader error。細節見 `design/entrance-curtain-a-velvet-20260922/README.md` A/20。未部署、未提交。

## 2026-09-23 五校線稿 hover 輪廓微加深

`web/app/components/CampusBoard.vue` 的 hover 線稿亮度由 `.72` 微調為 `.68`，增加 `.2s` 濾鏡過渡；一般與僅選中狀態沿用原色調。Chrome 1440px 前後對照、移出還原、390／320px 五校排列與無水平溢出均確認，無 page error；證據 `output/playwright/campus-hover-20260923/`。`node --check app.js`、`python3 package_preview.py` 通過，原型 `preview.html` 無差異。未部署；Safari／iOS 實機未驗證。

## 2026-09-23 首屏文字往上拉＋標語比稿 `?copy=a|b|c|d`

依使用者要求把桌機首屏文字往上拉：拿掉下午的 `margin-top:92px`，改為 `.studio-hero-copy{margin-bottom:48px}`（≥1001px），讓文字塊中心落在視窗中心上方約 10px。1440×900 眉標 y 356→286（比有按鈕時的 264 低 22px）、文字塊中心 440（視窗中心 450）；1280×800 眉標 306→236、1920×1080 446→376，三個尺寸都是中心高於視窗中心 10px。≤1000px 文字在照片下方，不變。

同時在 `HeroVideo.vue` 加 `?copy=` 預覽參數比較首屏標語與副文案（CMS 內容不動，不帶參數維持現行「在常春藤，每一天都有新發現。」）：a「每一個為什麼，都值得好好回答。」好奇心；b「在常春藤，每天都想來上學。」喜歡上學；c「第一次離開家，有我們好好陪著。」安心交託；d「世界那麼大，先從這裡玩起。」探索世界。標語用字已對 `lineseed-bd` 子集 cmap，全數在內；副文案只取自關於常春藤既有敘述。本機 Nuxt dev（:3161）1440／1280／1920／390px 截圖，SSR 也輸出對應文案。快照 `versions/before-hero-copy-up-20260923-153500/`；證據 `output/hero-copy-20260923/`。定案後移除 `copyDrafts`。未部署、未提交。

小標後半段比稿（`?eyebrow=a|b|c|d|e`：1997 年創立於高雄／陪高雄孩子近三十年／三民、左營、鳥松、仁武／五所校園，同一份用心／專業保育，溫暖陪伴）後使用者選 **b**：小標改為「常春藤幼兒園 · 陪高雄孩子近三十年」，`web/server/data/site-fixture.json` 與後端初始化用的 `content/site-fixture.json` 同步，比稿碼已移除。1440／390／320px 都是一行、無水平溢出；對照圖 `output/hero-copy-20260923/eyebrow-sheet-*.png`。**正式站小標由後台 CMS 決定，要到後台「首頁主視覺」改成同一句再發布才會生效。**

## 2026-09-23 開場布幕：深紅光澤、白光片頭定案（A/19）

使用者選定深紅光澤與白色片頭燈都採用，改為預設：絨布與帷幔的光澤改為深紅（sheen `#a83a48`、rim `#cf4a58`），倒數片框的燈色改為接近白的鎢絲燈（`#fff3e4`）。`?sheen=`／`?lamp=` 比稿參數與引擎選項 `sheenTone`／`leaderLamp` 已移除；校徽投影與金色緞帶仍用暖金燈色。 [預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.28)；本機 Nuxt <http://127.0.0.1:3141/>。Node 22 `nuxt typecheck` 無錯誤輸出；`vitest run` 21 檔 152 項通過；獨立 Nuxt build 通過。實際首頁 1440／390px 完整開場、字型載入、清理、不重播，無 runtime／shader error。`preview.html` 雜湊不變。 快照 `versions/before-crimson-white-20260923-152826/`。未部署、未提交。

## 2026-09-23 開場布幕：拉幕時下襬不再上揚（A/18）

拿掉拉幕時把下襬前緣往上提的變形項（`pull*u*pow(1−v,2)*0.12`，最多約 6% 畫面高度，屬於提拉式布幕的動作）。改為軌道式對開：兩片布只左右平移，下襬一直貼著底邊，不會再露出底下的首頁。先前加的下襬擺盪只影響水平方向，保留。 [預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.75)；本機 Nuxt <http://127.0.0.1:3141/>。獨立 Nuxt build 與實際首頁 1440／390px 開場驗證通過。對照圖 `output/playwright/level-hem-20260923/hem-cmp.png`；快照 `versions/before-level-hem-20260923-152142/`。未部署、未提交。

## 2026-09-23 開場布幕：倒數圓圈改正圓（A/17）

依使用者要求把倒數的圓修得更正。片頭改由「長焦距放映機」投射：只有倒數的投影距離拉長為原本的 3.75 倍（`12/(12−z)`），圓圈在褶子上幾乎是正圓，錯位從最多約 4px 降到約 1px；褶子的明暗與受光照舊，所以仍讀得出是投在絨布上。校徽投影不變。 [預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.28)；本機 Nuxt <http://127.0.0.1:3141/>。獨立 Nuxt build 與實際首頁 1440／390px 開場驗證通過，無 shader error。對照圖 `output/playwright/round-leader-20260923/round-cmp.png`；快照 `versions/before-round-leader-20260923-151732/`。未部署、未提交。

## 2026-09-23 關於常春藤照片對齊標題、兩欄收成一塊

使用者先要求照片往下對齊文字（先對內文第一行，照片反而比內文長出一截、標題右側空一塊），再請我直接調到最協調：桌機（≥901px）照片頂緣改對**標題字面頂**，SINCE 小標獨立在上當引子。左欄以 CSS subgrid 拆成 SINCE／標題／內文三列，照片跨標題＋內文兩列靠上，再下移標題半行距；標題字級抽成 `--belief-title-size`（`typography.css`）供兩邊共用，數值不變（`studio.css`）。

實測（照片／內文末行／圖說底）：1512×982 照片 334–760、末行底 782、圖說底 795；1440×900 照片 302–706、末行底 739、圖說底 742；1920×1080 照片 377–814、末行底 832。照片頂與標題字面頂放大檢查同高。1280、1024 內文較長，照片靠上、文字續排；390px 單欄不變。本機 Nuxt dev（:3161）截圖、無水平溢出、無 page error。快照 `versions/before-about-photo-align-20260923-152027/`（最初）與 `versions/before-about-photo-balance-20260923-152642/`（對內文版）；證據 `output/playwright/about-photo-align-20260923/`（`balance-*`）。未部署、未提交。

## 2026-09-23 首屏拿掉「看看孩子的一天」按鈕

依使用者要求，`web/app/components/HeroVideo.vue` 首屏拿掉白框按鈕，桌機文字整段往下移 92px（按鈕原本佔的高度），文字底緣落在原按鈕底緣：1440×900 眉標由 y 264→356、底緣維持 664。窄螢幕（≤1000px）文字在照片下方不下移；手機只剩「找校區 →」連結，改靠左。刪除 hero 按鈕的死碼樣式（`studio.css`、`typography.css`）與已無引用的 `--hero-veil`。本機 Nuxt dev（:3161）1440／1280／1024／390px 截圖、無水平溢出、無 page error；桌機捲動揭幕仍為 native 並正常淡出。CMS 首屏「按鈕文字」欄位目前在前台不再顯示（資料流未動）。快照 `versions/before-hero-no-cta-20260923-151530/`；證據 `output/playwright/hero-no-cta-20260923/`。未部署、未提交。

## 2026-09-23 開場布幕：質感精修與兩組比稿（A/16）

評析 A/15 後八項全做。修了三個遠看就看得到的瑕疵：帷幔下方的「管風琴」陰影、編繩上的暗紅小點、片頭圓圈上下的接縫斷口。絨布加上細纖維與壓絨色斑，下襬金邊改成麻花。帷幔加深垂花皺褶並掛上金色流蘇。開幕時下襬會擺盪，收攏時褶子加深。片頭加上柔邊片框、暗角、較明顯的顆粒與閃爍、毛髮與刮痕。

口味題做成比稿參數，預設不變：`?sheen=crimson`（深紅光澤）、`?lamp=white`（片頭白燈）。[預設](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.28)、[深紅光澤](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.28&sheen=crimson)、[白色燈光](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.28&lamp=white)、[兩者](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.28&sheen=crimson&lamp=white)。Node 22 `nuxt typecheck` 無錯誤輸出；`vitest run` 21 檔 152 項通過；獨立 Nuxt build 通過。實際首頁 1440×900（2×）與 390×844（3×）：倒數字型 `loaded`，校徽→321→開幕、清理、無水平溢出、重新整理不重播，均無 runtime／shader error。預覽 1440／390／320px 與四種比稿組合無錯誤。`node --check app.js`、`package_preview.py` 通過，`preview.html` 雜湊不變。Safari／iOS 實機未驗證。 快照 `versions/before-velvet-polish-20260923-150632/`；證據 `output/playwright/velvet-polish-20260923/`。未部署、未提交。

## 2026-09-23 分校資訊標題改上下排列

`web/app/components/CampusBoard.vue` 標題由「分校資訊　Campuses」左右並排，改為英文斜體 Campuses 在上、中文「分校資訊」在下，置中。DOM 順序同步改成英文在前（與原型 `app.js` 的 eyebrow 在 h2 之前一致）。

使用者再要求往下靠、拉大中英比例：中文 48→56px（桌機 `clamp(40px,3.9vw,56px)`、手機 32→40px），英文 28→24px（桌機 `clamp(fs-lg,1.7vw,fs-2xl)`、手機 20→18px），比例約 1.7→2.3；標題加 `margin-top`（桌機 24px／手機 14px）並把標題到分校插圖的間距收小（28→16px／23→12px），整塊往下、貼近插圖。移除 ≤360px 為並排留下的縮字與 `gap:12px`。本機 Nuxt dev（:3161）1440／390／320px 截圖確認、無水平溢出。

已部署：只把這個 commit cherry-pick 到 `main`（`1f805e2`，不含 feature 上尚未上 main 的拍立得飄角、關於照片），CI run 35831335751 四個 job 全綠，線上 `/release.json` base_commit `1f805e2`、snapshot `e969e461…`；正式站 1440／390／320px 量到的字級與位置和本機相同、無水平溢出。

## 2026-09-23 官網報名修復已部署

報名設定失敗重試、全形連字號手機，以及家長管理頁已部署至[正式官網](https://web-production-04caa.up.railway.app/)。API 與 web 均 SUCCESS；版本 `20800ce32b86`。以最新正式 `f023bd0` 為基底，只套入本次修復，保留已部署設計與錯誤頁修正。

隔離快照 180 backend／140 web／48 admin 測試、型別、契約與正式建置通過；線上 36 項公開檢查與 Chrome 15 項 1440／390／320px 操作檢查通過，無 runtime／hydration error 或水平溢出。未建立正式測試報名、未 migration／CMS 發布／commit／push。詳見 `deploy/README.md` 與 `output/railway-visit-repair-20260923-145157/`。

## 2026-09-23 拍立得翻面暗示：B「捲動飄角」

使用者從 `design/flip-hint-subtle-20260923/` 三版（A 對光透字／B 捲動飄角／C 包邊貼紙）選 B，已接進 Nuxt `web/`。紙膠帶只黏上緣，捲動時右下折角隨速度掀起（32→最多 52px）、整張微擺 ≤0.7°，停下回彈一次收回；只回應使用者的捲動，不自動播放，減少動態不做。新增 `web/app/utils/earGust.ts`（共用一個 scroll 監聽與 rAF 時鐘）與 11 項單元測試；`DayMomentCard.vue` 折角改為「基準＋捲動疊加」單一出口，`.print-card` 傾角改走 `--card-tilt`。

驗證：web 21 檔 152 項單元測試、Node 22 `nuxt typecheck` 0 錯誤（以故意錯誤檔確認有抓錯）；Chrome（M2 Metal）桌機 WebGL 折角掀到 47.6px、停下回 32px／擺動歸零，畫面外卡片不動，p95 幀時間 16.8ms 與無拍立得區段相同；手機 390px 掀到 55px 後收回、無水平溢出；減少動態不動；無 console 錯誤。證據 `output/playwright/ear-gust-20260923/`，快照 `versions/before-ear-gust-20260923-143901/`（本機）。未部署；Safari／iOS 實機未驗證。

## 2026-09-23 官網報名手測修復與家長管理頁

修正預約設定 API 失敗被顯示為「暫停預約」：改為錯誤提示、重新載入與聯絡園所入口；手機正規化支援全形／Unicode 連字號。新增 `/visit/manage`，提供遮罩手機與狀態查詢、改期申請、二次確認取消、失效連結處理。改期待核准時原時段保留，重新整理仍顯示待確認；同頁切換連結會清掉舊畫面與請求，失效連結不沿用上一筆 session。

管理頁使用 fragment 交換 HttpOnly cookie，移除網址 token，不把個案資料放進 SSR payload；補上 no-store／noindex／no-referrer、正式環境 Secure cookie、來源檢查與限流。預設參觀前 24 小時截止由 API 執行，並回傳可操作狀態；OpenAPI／前端型別同步，無 migration。

驗證：backend 真 PostgreSQL 180 項、web 141 項單元測試、Node 22 型別與契約檢查通過；Chrome 實際表單送出／管理連結／改期／取消／錯誤重試／截止時間與 1440／390／320px 驗證通過，無 page error 或水平溢出。證據 `output/playwright/visit-repair-20260923/REPORT.md`；臨時 API 與專用手測 DB 已清理，未發通知。`node --check app.js`、原型重新打包通過，`preview.html` 無差異。未部署、未提交；Safari／iOS 實機未驗證。

## 2026-09-23 開場布幕：經典片頭倒數、帷幔定案（A/15）

使用者確認帷幔與金底深字都採用，並要求倒數改成經典電影片頭。倒數現在是投影在絨布上的 Academy 式片頭：圓形片框照亮布面，雙圈、十字線、順時針掃過的明暗和 Oswald 粗黑體數字都是擋光的底片，加上片門晃動、閃爍、灰塵與刮痕。片框會在校徽光圈收起的地方重新打開。帷幔改為預設出現，移除 `?valance=1`。

[查看 A/15](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1&v=15)；本機 Nuxt <http://127.0.0.1:3141/>。Node 22 型別檢查無錯、131 項單元測試與獨立 Nuxt build 通過；實際首頁 1440／390px 完整開場、字型載入、清理、無溢出、不重播，無 runtime／shader error；`preview.html` 雜湊不變。新增字型 `web/public/assets/fonts/oswald-700-leader.woff2`（OFL）。快照 `versions/before-film-leader-20260923-140842/`；證據 `output/playwright/film-leader-20260923/`。Safari／iOS 實機未驗證。未部署、未提交。

## 2026-09-23 彩色校徽置中與布幕倒數正式部署

已將本對話定案的 A/13 部署至[正式官網](https://web-production-04caa.up.railway.app/)：彩色人物校徽置中、暖金 30th Anniversary 緞帶、圓框 321 投影與紅絨布幕開啟。另修正首次載入時先編譯空白幀、太晚下載 Logo 的順序；畫面與倒數時序保持原樣。

最終 web deployment `367a3133-0ab1-43fa-9c2a-dfaee064d8a5`，snapshot `f17220a71ac74d29c60c62de39a3e00e161b84c867a0484d4d1f92b2dd0b6bbe`。隔離建置、120 web／42 admin tests、本機 9 組瀏覽器流程、正式 Chrome 1440／390px 完整播放與 51 項公開唯讀檢查通過。動畫同一工作階段播放一次，可用全新無痕視窗重看；Safari／iOS 實機未驗證。

本次由即時正式基底建立限定快照，保留其他已上線內容，未納入工作區並行的新布幕設計／後台 UX／字型變更。API／資料庫部署維持不變，未 commit 或 push。詳細紀錄見 `deploy/README.md`，證據 `output/railway-entrance-load-20260923-135034/`。

## 2026-09-23 官網後台第四輪 UX：追蹤到期有入口、案件一筆接一筆、發布前看差異

對 `admin/` 做 impeccable critique（LLM 審查＋自動偵測，25/40，不是 AI slop），依業主選「預約流程優先、全部處理、回上一版先做前端差異預覽」實作：

- **到期待追蹤**：總覽數字原本連到未篩選列表，且沒有任何地方能設定「預定聯絡時間」。後端 `GET /admin/visit-requests` 新增 `follow_up_due=true`（與總覽同定義）與 `order=newest|oldest`；案件詳情的聯絡紀錄旁加「下次聯絡」日期一起送出；列表加「只看到期待追蹤」與排序，頁首與列表用金色標出已到期。
- **櫃台動線**：詳情頁加「下一筆待處理（還有 N 件）」；確認預約後把「已致電家長，告知參觀時間 …」預填進紀錄框並聚焦；桌機列表電話改可撥；孩子姓名併入家長欄減成 7 欄；「取消預約」移到面板底部分隔。
- **發布安全網**：發布確認框列出「欄位：之前 → 之後」（`ContentEditor` 用 `useContentItem` 的 `changes`），成功 toast 附「查看官網」連結（依 kind／校區導到對應頁）；底部動作列不再複述狀態。回到上一版仍需後端保留已發布版本內容，未做。
- **文案**：「時段預約（尚未開放）」改「家長自選場次」（09-22 已改為校方可設定）；「首頁首屏文字」改「首頁大圖標語」並提示字型子集；「替代文字」統一為「圖片說明」；取消鈕統一「先不要」；「原填年齡」「小標（eyebrow）」「標題樣板」「目前為第 N 版」清掉；改期核准／退回加確認框；新增使用者加「產生密碼」；登入頁忘記密碼說法對齊實際流程。

驗證：`admin` typecheck 無錯、vitest 48 項（新增 `followUpUx.test.ts` 6 項）；backend pytest 172 項（新增到期篩選與排序測試）；契約 `contracts/` 已重生。真後端（8010）＋Vite（5175）以臨時帳號與示範案件跑 Playwright 1440／390px，截圖 `output/playwright/admin-ux-round4/`，無 console error、無溢出，示範資料已清。快照 `versions/before-admin-ux-round4-20260923-134519/`。未部署、未提交。

## 2026-09-23 開場布幕：絨布打光、光圈校徽、對焦倒數（A/14）

依評析把布幕質感、倒數、Logo 一起改。絨布改為「正面暗、摺肩亮」的打光：上方隱入暗處、下緣暖色腳燈，褶子是圓鼓布面加窄深褶溝，下襬金邊加寬成斜紋編繩。Logo 改成追蹤光圈投影，墨線擋光、彩色保留，緞帶為金底深字。倒數桌機、手機統一單圈，字型換成 LINE Seed TW，拿掉掃針與光暈，每個數字落下時短暫對焦。帷幔另做比稿參數 `?valance=1`，首頁預設不開。

順帶修正一個既有陰影 bug：VSM 把沒有變形深度材質的下襬金邊畫成 z=0 的隱形平面，造成褶溝假陰影與上緣鋸齒尖刺。

[查看 A/14](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1&v=14)；[加帷幔](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1&v=14&valance=1)；本機 Nuxt <http://127.0.0.1:3141/>。Node 22 型別檢查無錯、120 項單元測試與獨立 Nuxt build 通過；實際首頁 1440／390px 完整開場、字型載入、清理、無溢出、不重播，無 runtime／shader error；`preview.html` 雜湊不變。快照 `versions/before-velvet-light-20260923-132931/`；證據 `output/playwright/velvet-light-20260923/`。Safari／iOS 實機未驗證。未部署、未提交。

## 2026-09-23 關於常春藤改為單張圓角照片

依使用者截圖，Nuxt 首頁「關於常春藤」原本的主照＋小照疊放改為單張照片，框型比照參考圖：3:2、16px 圓角、無米白框也無陰影（與 `.studio-intro-photo` 同規格）。圖說移到照片下方靠右。`sizes` 改為 `(max-width: 900px) 90vw, 42vw`。凍結原型 `app.js` 未動。

同日依使用者提供的新照片（2000×803 寬幅，長輩被孩子們圍住大笑）換掉 `about-curious`：從 x=30 裁成 3:2 母檔 `web/public/assets/about-together.webp`（1204×803，WebP q90），左側大笑的男孩完整入鏡，長輩視線朝向右側孩子；以 `scripts/optimize-site-images.py --only about-together` 產生 160／480／800／1200 衍生檔與 manifest。fixture 只留這一張（後台不編輯照片；`about-curious`、`learning` 素材保留，`learning` 仍用於消息卡）。alt 只描述畫面，不寫人物身分。

1440／1024／390 截圖與量測：照片 1 張、圓角 16px、無邊框與陰影、1440 與 390 載入 800w、無水平溢出、無 runtime error；手機照片先離開，才接「關於／常春藤」大字。`vitest run` 18 檔 120 項通過，`nuxt typecheck`（Node 22）無錯誤。快照 `versions/before-about-single-photo-20260923-135156/`，證據 `output/playwright/about-single-photo-20260923/`。部署紀錄見 `deploy/README.md`。

## 2026-09-23 iPhone 背景播放鈕捲動相容性

使用者回報 iPhone Chrome 上下捲動時只有「暫停背景」按鈕跳動。本輪只在觸控裝置替 `.day-film-ui` 加上 `translateZ(0)`，讓 sticky 控制層獨立合成；外觀、位置、影片與拍立得功能保持原樣。這是針對繪製不同步的相容性措施：本機原先沒有重現實機抖動，仍須以使用者的 iPhone Chrome 確認是否改善。已部署正式 web，deployment `6ca094b6-1fdf-40a4-a9de-c7cad13c62f7`，release `cd2d806f…`；34 項公開 GET 與五組 Chrome／WebKit 線上檢查通過。未提交。

本機 Chrome 320／390px 觸控及 1440px 桌機、WebKit 390px 一般／減少動態模式均通過版位前後比較、上下捲動、播放／暫停、區塊交界點擊及無溢出檢查，無 runtime error；Chrome 觸控模式確認控制層使用 `StickyPosition` 合成。`node --check app.js`、`python3 package_preview.py` 通過，凍結的 `preview.html` 無差異。證據與驗證腳本位於 `output/playwright/day-scroll-jitter-20260923/`。

## 2026-09-23 人物校徽置中基準修正

使用者回報 Logo 仍未置中。本輪改以截圖中的「皇冠／人物／月桂／IVY KIDS」可見範圍置中，下方 30th Anniversary 緞帶接在校徽下方；先前是包含緞帶的整組外框置中，人物區域因此偏上。倒數圓框仍以畫面中心呈現，人物彩色、金色緞帶、大小及時序不變。

[查看 A/13 新版](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1&v=13)；[本機首頁](http://127.0.0.1:3136/)。原圖上方校徽範圍 y=114–876、中心 y=495；投影依此修正取樣中心。快照 `versions/before-crest-centering-20260923-122208/`；證據 `output/playwright/crest-centering-20260923/`。本機預覽，未部署、未提交。

Node 22 typecheck 與獨立 Nuxt build 通過。Chrome 桌機 1440px／2× 與手機 390px／3× 實際首頁完整播放、清理、無溢出及重新整理不重播均通過，無 runtime／shader error。1440／390／320px 的人物校徽外框中心偏差至多 3px；此輪量測以皇冠到 IVY KIDS 為範圍，週年緞帶不納入。原圖與凍結 preview.html 雜湊不變，原型語法／重打包及 diff 檢查通過。保留既有 CSS calc/clamp 與 chunk 大小建置警告；Safari／iOS 實機未驗證。

## 2026-09-23 人物投影細修與置中

依使用者截圖，人物校徽改為縮圖前清除米白紙底，避免淡色殘邊混入輪廓；保留原始人物與品牌色，下方週年緞帶維持既定暖金。投影依布褶深淺調整焦外柔光與明暗，讓布料質感透出。校徽與 321 共同改為畫面正中央，比例與時序保留。

高密度顯示最高 2×，並限制繪圖像素總量為 450 萬；原圖不改寫、不另外下載素材。快照 `versions/before-refined-projection-20260923-120523/`；證據 `output/playwright/refined-projection-20260923/`。[細修預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1)；[本機首頁](http://127.0.0.1:3136/)。未部署、未提交。

Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。Chrome 實際首頁 1440／901px（2× DPR）及 390px（3× DPR）完整開場、無溢出、工作階段一次與倒數中略過／WebGL context loss／減少動態均通過，無 runtime／shader error。另確認 1440／390／320px 高密度預覽與繪圖像素上限；校徽及圓框的可見外框中心與畫面中心偏差至多 2px。原始 PNG 與凍結 preview.html 雜湊不變，原型語法／重打包／diff 檢查通過。建置仍有既有 CSS calc/clamp 與 chunk 大小警告；Safari／iOS 實機未驗證。

## 2026-09-23 週年緞帶恢復金色投影

依使用者要求，只有下方「30th Anniversary」緞帶恢復上一版的暖金投影，沿用該版遮光密度、柔光與亮度參數。人物、月桂、皇冠及 IVY KIDS 保留原彩色；兩區分界位於原圖緞帶間的留白，原始 PNG、位置、倒數與拉幕時序均不變。

[查看／重播](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1)；[本機首頁](http://127.0.0.1:3136/)。證據 `output/playwright/gold-anniversary-20260923/`；快照 `versions/before-gold-anniversary-20260923-115542/`。本機修改，未部署、未提交。

Node 22 typecheck 與獨立 Nuxt build 通過。Chrome 1440／390px 實際首頁完整播放、清理、無溢出與重新整理不重播均通過，無 runtime／shader error；上方彩色區域與前版像素一致，下方緞帶內部與先前金色版一致。321／拉幕八張比較中只有兩張各一像素差 1/255。原始 PNG、凍結 preview.html 雜湊不變，原型語法／重打包及 diff 檢查通過。保留既有 CSS calc/clamp 與 chunk 建置警告；Safari／iOS 實機未驗證。

## 2026-09-23 選單五校 hover 切換

五校校名滑鼠移入或鍵盤聚焦時，選單下方的參觀專線、電話連結與分校社群同步切換；移開後保留目前校區及底色。校名點擊與手機觸控仍進入原分校頁，缺少聯絡資料維持待提供。只更新 Nuxt 選單互動，沿用乳白毛玻璃外觀。已部署正式 web，deployment `e5ea1c35-ce8f-4b2b-9705-317294f76830`，release `01bdec18…`；API／資料庫版本維持。

驗證：Node 22 Nuxt typecheck、119 項既有單元測試、Chromium 桌機五校 hover／鍵盤與 390px 觸控導頁通過，無 runtime error。證據在 `output/playwright/menu-hover-20260923/`；[本機預覽](http://127.0.0.1:3162/)。原型語法與重打包通過，凍結 `preview.html` 無差異；Safari／iOS 實機未驗證。

部署以正式照片畫質版為基底，僅套入 `SiteHeader.vue` 與 `studio.css` 的 hover 差異。隔離建置的 102 web／42 admin tests、型別與 build、39 項正式公開檢查及線上桌機／手機互動均通過；證據 `output/railway-menu-hover-20260923-115855/`。未納入並行開場設計，未 commit／push。

## 2026-09-23 彩色校徽與圓框電影投影

依使用者最新要求，人物校徽恢復原圖彩色：藍衣、粉紅裙、綠色月桂與金色緞帶保留；shader 只去除接近米白的紙底，清理邊緣並讓色光隨布褶明暗變化，原始 PNG 不變。電腦 3、2、1 加回單一暖金細圓框，搭配低對比旋轉掃針、細顆粒與柔和光暈；圈內仍看得到酒紅絨布。

校徽與倒數共用位置和高度，維持 1.5 秒校徽、3 秒倒數、3.4 秒拉幕。手機校徽同步彩色，倒數維持既有圓環樣式。[重播預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)；[本機首頁](http://127.0.0.1:3136/)。證據 `output/playwright/cinema-projection-20260923/`；快照 `versions/before-cinema-projection-20260923-114356/`、`versions/before-colour-logo-20260923-114736/`。本機修改，未部署、未提交。

Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。Chrome 實際首頁 1440／901／390px 的彩色校徽→321→拉幕、清理、無溢出、同工作階段不重播，以及倒數中略過／WebGL context loss／減少動態均通過，無 runtime／shader error。手機倒數與拉幕四格比對，只有一格的一個像素差 1/255，維持原視覺；校徽依要求同步彩色。原始 PNG 與 preview.html 雜湊不變，原型語法／重打包／diff 檢查通過。建置保留既有 CSS calc/clamp 與共用 chunk 大小警告；Safari／iOS 實機未驗證。

## 2026-09-23 字體審查 B 批：明體統一、標點、字級尺度

使用者看過對照頁 `design/typography-b-20260923/index.html` 後決定四項都做（細項照對照頁建議）。只改 `web/`，凍結原型不回寫；規則寫進 DESIGN.md「字體審查 B 批」。

- **B-1 預約頁大標**：改用自託管思源宋體，新增 9 字子集 `noto-serif-tc-500-visit.woff`（3.9 KB）。`Ivy Campus Serif` 的 `@font-face` 從 `CampusBoard.vue` 移到 `typography.css` 全站宣告，Windows 不再落到新細明體。
- **B-2 分校頁校名**：由 LINE Seed 800 改為明體 500，和首頁分校資訊共用 `--fs-campus-name`（63.36／54／50px），刪掉 `styles.css` 裡已失效的 `.hero h1`／`.campus-hero h1` 字級規則；分校頁校名不再用到 ExtraBold。
- **B-3 標點與斷行**：標題 `text-spacing-trim:trim-start` 收行首開括號（逗號句號維持全形），WebGL 拍立得照字型 halt 數值同步；分校頁區塊標題只在標點後換行；拍立得背面 canvas 換行補上禁則，修掉「。」「？」單獨一行。
- **B-4 字級 token**：`typography.css` 定義 `--fs-xs`～`--fs-8xl` 12 階，約 320 處字面值改用 token；頁首／選單／品牌（園方規格）、活動日期、校名、流體字級、英文裝飾小字保留原值。表單「必填／選填」、預約頁地區／地址等 10–11px 中文一併拉到 12px。

快照 `versions/before-typography-b-20260923-122514/`，證據 `output/playwright/typography-b-20260923/`。未部署。

驗證（Nuxt dev fixture 模式，另以 Playwright 攔截預約設定 API 顯示表單）：首頁、消息列表對話框、分校頁、預約頁暫停／選校／表單六種狀態 × 1440／1024／768／390／320px，改前改後逐元素比對，沒有新的溢出或橫向捲動；多換一行的 14 處都是段落自然重排。拍立得四種寬度翻面，背面文字都在紙面內；WebGL 與 DOM 的行首括號像素位置一致。CDP 確認三處明體實際使用自託管字型。Node 22 `vitest` 119 項通過、`nuxt typecheck` 無錯誤。Safari／iOS／Windows 實機未驗證。

## 2026-09-23 字體審查 A 批：字型變數與 12px 小字底線

依字體審查結果，修正不改設計決策的部分（只動 `web/`，凍結原型不回寫）：

- `studio.css` 引用了沒定義的 `var(--font-en)`，選單／膠囊的英文、編號和電話都退回 PingFang；開場「略過動畫」引用的 `var(--font-body)` 也不存在，退回通用 sans-serif。已在 `typography.css` 的 `:root` 補上兩個 token，前者指向 Source Sans 3，後者指向系統黑體。
- 低於 12px 的中文字一律提高到 12px（DESIGN.md 2026-09-10 可讀性底線）：拍立得「01 / 早安入園」（桌機原 10px）、理念照片說明（桌機 11px／手機 10px）、影片說明與「播放背景」、手機日常提案註記、分校頁「到園時，還可以聊聊」「這張照片裡」、預約頁照片說明。9px 的英文裝飾標語不變。
- 消息卡標題改為 `balance`＋`keep-all`，只在「，」後換行（原本會剩下「形狀。」「空間。」兩字一行），太長時由 `overflow-wrap:anywhere` 兜底。
- 「近期活動」原本比「最新消息」高 9px，兩欄標題現在都貼齊標題區底部。

快照 `versions/before-typography-a-20260923-114102/`，證據 `output/playwright/typography-a-20260923/`。未部署。

驗證在這個 worktree 起 Nuxt dev（fixture 模式）：首頁、義華分校頁、預約頁在 1440／390px 下都沒有小於 12px 的中文字。CDP 查到選單英文、編號與電話實際使用 Source Sans 3；兩欄標題 1440／1024px 的 top 值相同；拍立得 WebGL 紙面桌機與手機截圖正常。`tests/print-flip.spec.ts` 10 項通過。Safari／iOS／Windows 實機未驗證。

## 2026-09-23 純數字倒數預覽

依使用者要求查看簡化畫面，電腦版移除膠卷底、圓圈、十字線、掃針與齒孔，只保留紅布幕中央的暖金 3、2、1。延續數字比例與光學置中，改由 Three.js 布幕材質投射，讓數字光影隨布褶起伏。校徽先行與 7.9 秒完整流程不變，手機維持既有圓環投影。

[查看純數字預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)；[本機首頁](http://127.0.0.1:3136/)。舊膠卷版留於 `versions/before-number-only-20260923-112736/`，本輪證據 `output/playwright/number-only-20260923/`。先供本機視覺比較，未部署、未提交。

Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。Chrome 實際首頁 1440／390px 的校徽→321→拉幕、清理、無溢出及重新整理不重播通過，無 runtime／shader error。手機五個影格比對差異最多為每格單一像素、單色階 1/255，維持原視覺。原型語法、重打包及 diff 檢查通過，preview.html 雜湊不變；保留既有 CSS calc/clamp 與 chunk 大小建置警告，Safari／iOS 實機未驗證。

## 2026-09-23 膠卷縮成中央橫框，321 光學置中

依要求取消電腦版滿版膠卷，改為中央 16:9 橫框，四周露出紅布幕，最大寬度 880px 且依容器尺寸縮放。校徽與倒數圓圈仍共用中心與高度。框內移除向上偏移；3、2、1 的橫向依實際墨色重心校正、垂直依可見字形置中，修正「1」直筆偏右的視覺感。手機版與完整 7.9 秒流程維持原樣。

[重播預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)；[本機首頁](http://127.0.0.1:3136/)。快照 `versions/before-film-panel-20260923-111907/`，證據 `output/playwright/film-panel-20260923/`。未部署、未提交。

Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。Chrome 1440／901／390px 完整開場、工作階段一次、略過與備援均通過，無 runtime／shader error；桌機兩尺寸確認四邊均露出紅布幕。1328×600 預覽的 3／2／1 水平墨色重心及垂直字形中心距框中心均小於 1px；390px 五個關鍵影格與前版 RGB 像素完全一致。原型語法／重打包／diff 檢查通過，preview.html 雜湊不變。建置保留既有 CSS calc/clamp 與 chunk 大小警告；Safari／iOS 實機未驗證。

## 2026-09-23 首屏按鈕 ?cta= 比稿（否決，已移除）

「看看孩子的一天」白框幽靈鈕試了三個 `?cta=` 方向：a 霧面深綠膠囊、b 米白實心＋黃色圓形箭頭、c 圓形箭頭加底線文字。使用者看過後決定都不用，維持現行白框按鈕；`web/app/components/HeroVideo.vue` 已還原為提交版本（`git diff` 無差異），否決紀錄寫進 DESIGN.md。截圖保留在 `output/hero-cta-20260923/` 供追溯。

## 2026-09-23 電腦版改為參考圖的復古膠卷

電腦版（>900px）倒數依使用者截圖改成米褐色底、深褐大數字與單圈粗圓框，加上兩側齒孔、十字線、旋轉掃針與細緻底片磨損。先校徽、再完整 321、最後紅布幕拉開的 7.9 秒流程不變；900px 以下保留上一版的暖金布面投影。

[可重播預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)；[實際 Nuxt 首頁](http://127.0.0.1:3136/)。新膠卷用 Three.js 平面呈現並隨開幕退場；修正獨立預覽打包器只替換第一個 Three.js import 的問題。快照 `versions/before-desktop-film-20260923-094848/`，證據 `output/playwright/desktop-film-20260923/`。本機修改，未部署、未提交。

## 2026-09-23 Hero 活動鏡頭卡頓修正

[修正版獨立預覽](http://127.0.0.1:3147/)：Chrome 1440／390／320px 各連播 14 秒，皆為 0 掉幀、無超過 90ms 的影格呈現間隔，循環與暫停／恢復正常，無 runtime error。這是本機 Chrome 與手機模擬量測；Safari／iOS 實機未驗證。

第 5 鏡戶外遊戲與第 7 鏡跳躍原本用重複影格維持半速，封裝雖為 30fps，動作實際只有 15fps。這兩段改回原片自然速度、真實 30fps，其餘五段維持既有平順半速；七段鏡頭與 1080×800 畫質保留，總長由 11.7 秒縮短至 9.833333 秒。從園方原片重新產製，各自由無損中間檔壓縮一次，桌機 CRF 18／5.67 MB、手機 CRF 21／3.98 MB。

逐鏡相鄰影格檢查中，第 5／7 鏡的 36／22 組近重複影格皆消除；兩份新影片七鏡均為零近重複影格（108×80 灰階 MAE ≤0.35 門檻）。Typecheck、119 項單元測試、原型語法／重打包通過，`preview.html` hash 不變。產製方式見 `design/hero-video-smooth-20260923/README.md`，量測證據在 `output/hero-smooth-20260923/`；修改前快照 `versions/before-hero-smooth-20260923-094446/`。本機修改，未部署、未提交。

## 2026-09-23 Hero 小標拿掉「高雄五校」，修正首頁按鈕與頁尾連結無效

Nuxt 首頁 hero 小標改為「常春藤幼兒園」，`web/server/data/site-fixture.json` 與後端初始化用的 `content/site-fixture.json` 同步修改；vanilla 原型已凍結，未更動。正式站小標由後台 CMS 決定，需要到後台「首頁主視覺」修改後再發布。

另修正沿用原型 hash 路由的連結：「看看孩子的一天」原本是 `#/home/life`，頁尾五個連結也是 `#/home/*`、`#/visit`。`legacy-hash` 外掛只在載入時轉址，點擊後網址會改變但頁面不捲動；從分校頁點擊也不會回到首頁。現在改為 `/#life`、`/#about`、`/#campuses`、`/#latest-news`、`/visit`。這些連結不經 CMS，部署後正式站就會生效。

Chrome 1440×900 與 390×844 實測：hero 按鈕會落在「孩子的一天」區塊；從 `/campuses/yihua` 點頁尾四個連結都能到達目標區塊或頁面。Node 22 下 content／public-copy／legacy-hash／seo 四檔共 30 項測試通過。本機修改，未部署、未提交。

Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。實際首頁 1440／901／390px 的校徽→321→拉幕、工作階段一次、無水平溢出與倒數中略過／WebGL context loss／減少動態驗證通過，無 runtime／shader error。320／390／900px 各五個關鍵影格與前版像素完全一致；1440→390→1440 切換正確，尾段透明及資源釋放正常。原型語法、重打包與 diff 檢查通過，preview.html 雜湊不變。建置保留既有 CSS calc/clamp 與 chunk 大小警告；Safari／iOS 實機未驗證。

## 2026-09-23 校徽先行，接同位置的復古電影倒數

依最新要求，先投影校徽 1.5 秒，再由相同中心與高度的電影倒數圓盤接替，3、2、1 各一秒，最後 3.4 秒拉幕。倒數採暖金雙圓環、順時針掃針、深酒紅大數字與細緻底片顆粒；原始校徽、酒紅絨布及布面投影保留。總長 7.9 秒，取代先前校徽與小倒數同時出現的版本。

[可重播預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)；[本輪實際 Nuxt 首頁](http://127.0.0.1:3136/)。獨立建置位於 `output/film-build/`，避免覆蓋其他 session 的 `.output` 服務。修改前快照 `versions/before-film-countdown-20260923-094014/`，瀏覽器證據 `output/playwright/film-countdown-20260923/`。本機修改，未部署、未提交。

Node 22 型別檢查、119 項單元測試及獨立 Nuxt build 通過。Chrome／Apple M2 的 1440×900、768×1024、390×844、320×568 共 30 組播放／備援檢查通過，無 runtime／hydration／shader error；包含校徽先行、逐秒倒數、完整拉幕、各階段略過、同工作階段不重播，以及載入失敗放行。實際布面投影外框高度差低於 1%，圓盤與校徽共用投影中心（不同輪廓受布褶扭曲後，像素外框中心差 0.5–4.5px）。原始 PNG 雜湊相同，原型語法／重打包／diff 檢查通過，preview.html 雜湊不變。建置仍有既有 CSS calc/clamp 解析及 chunk 大小警告；Safari／iOS 實機未驗證。

## 2026-09-23 常春藤的一天照片畫質提升

Nuxt 五張影片截圖重新取自園方原始影片的同一秒數，從 810×600 回復為原生 1080×800，保留相同鏡頭、裁切與色彩；WebP 母圖 quality 94、響應式衍生圖 quality 92。完整尺寸也使用內容雜湊網址，避免回訪者沿用舊照片快取。五張完整圖片合計約 453 KiB（原本 161 KiB），沿用 lazy loading。`sizes` 納入橫圖裁成方形時的像素需求；WebGL 紙面、顯示 Canvas 與共用 renderer 支援至 3× DPR，照片縮圖在支援的瀏覽器使用高品質平滑取樣。

第六張教室照片保留既有 960×600；來源網站回傳 HTTP 500，尚無可確認的更大原圖。原片本身的失焦與運動模糊仍受來源限制，未重繪人物或場景。

重製：`python3 scripts/restore-day-photos.py '/path/to/常春藤廣告+配音.mp4'`，接著 `python3 scripts/optimize-site-images.py --only day-hello day-discover day-lunch day-outside day-home`。腳本核對來源 SHA-256，僅更新 Nuxt 素材。前後瀏覽器證據：`output/playwright/day-photo-quality-20260923/`；快照：`versions/before-day-photo-quality-20260923-093544/`。本次僅本機修改，未部署、未提交。

Node 22 typecheck、18 檔共 119 項單元測試通過。Chrome 桌機 1440px／2× 與手機 390px／3× 的 12 組 WebGL 照片載入、像素密度、翻面往返通過；320px 無 WebGL 與 390px 減少動態的 12 組 CSS 備援通過，無水平溢出或 runtime error。五張新圖均更接近原始影格（PSNR 43.2–44.4 dB，舊圖放大後為 38.0–39.8 dB；僅為來源保存比較）。原型語法、重打包與 diff 檢查通過，`preview.html` 無差異；Safari／iOS 實機尚未驗證。

已依使用者要求送出正式 web 部署，但截至 2026-09-23 10:11（台灣），Railway `28ce210a-4ad8-4be1-92ea-689da4348224` 仍停在 `INITIALIZING` 超過 15 分鐘；**照片清晰版尚未上線**。最終快照 `6b82fc18…` 的 102 項 web／42 項 admin 測試、前後台建置及本機 24 組瀏覽器檢查通過。正式站仍提供原版本，API／Postgres 正常；詳見[部署等待紀錄](deploy/README.md)。

## 2026-09-23 Hero 播放畫質提升

Nuxt 首頁桌機改用現有 1080×800、CRF 18 修復母帶（4.17 → 5.95 MB）；手機從 720×534、CRF 22 提升為 1080×800、CRF 21（2.05 → 4.17 MB），改善高密度螢幕裁切放大後的細節。素材直接複製、更新雜湊網址，避免再次轉碼；鏡頭、色調、速度、封面與版面維持原樣，減少動態／省流量／慢速連線仍不下載影片。原片失焦與運動模糊仍受來源限制。

修復前後的瀏覽器證據放在 `output/hero-quality-20260923/`。本次僅本機修改，未部署、未提交。

Node 22 typecheck 與 117 項單元測試通過；Chrome 1440／390／320px 確認實際載入新影片、暫停／恢復與完整循環正常，無水平溢出或 runtime error。減少動態／省流量／3G 三種情境皆不請求 Hero MP4。兩份輸出與來源逐位元相同，1080×800、351 幀、11.7 秒、faststart 與完整解碼通過。`node --check app.js`、原型重打包及 diff 檢查通過，`preview.html` hash 不變；Safari／iOS 實機未驗證。

## 2026-09-23 開場動態與陰影渲染優化

沿用酒紅與柔金的既有構圖，拉幕改成起步與收尾更平滑的五次緩動，下襬稍後跟上、布料擺動放慢。完整 3 秒倒數後，最後的「1」用 180ms 退光，接續校徽退光與 3.4 秒對開。預覽重播立即回首格，開幕完成就隱藏略過鈕。另修正尾段殘留約 18% 陰影造成的亮度跳動，讓陰影在移除動畫前就完全退去；預覽背景更新為本輪實際首頁截圖。

倒數期間重用靜止布面的 VSM 陰影；拉幕、拖曳與尺寸改變時重新計算。同一閉幕拖曳操作的繪圖呼叫數從 24 降至 10（兩次渲染合計，約減少 58%），拖回閉幕並恢復視窗尺寸後的 canvas 截圖完全一致；此為繪製呼叫數量測，不代表等幅 FPS／電量改善。

證據在 `output/playwright/entrance-motion-20260923/`，修改前快照 `versions/before-entrance-motion-20260923-092615/`。原校徽、倒數總時長與本機首頁版面保留；未部署、未提交。

## 2026-09-23 手機關於背景與轉場修正

加長 Nuxt 首頁手機介紹照片後方的綠色背景，讓「關於／常春藤」大字完整露出後再接到日常影片；390×844 下增加約 246px，轉場前照片與大字保留約 40px 空間。沿用原先較短的擦除距離與雙照片構圖，修正 320px 大字裁切、水平對位及副標斷行；手機浮水印恢復既定 .28 透明度。減少動態／無 JS 不增加轉場留白。

前後截圖與驗證記錄：`output/playwright/about-mobile-20260923/`；快照：`versions/before-about-mobile-20260923-092601/`。本次只修改 Nuxt CSS 與紀錄，未提交。

已部署至[正式官網](https://web-production-04caa.up.railway.app/)：web deployment `2bb67300-f755-4ef7-8787-ac02a14ef4a4` SUCCESS，release `8a3dd98d…`。以最新正式 `9813f34`／`14952c0e…` 為基底，只套入本輪 CSS；API／Postgres 部署維持原版。隔離建置通過 typecheck、92 web／42 admin tests 及前後台 build；正式站 42 項公開檢查、八尺寸 24 組版面／互動檢查通過，13 段內嵌 CSS 與建置 hash 相符。證據：`output/railway-about-mobile-20260923-093354/`，詳見[部署紀錄](deploy/README.md)。

Node 22 `npm run typecheck`、116 項單元測試、原型語法／重打包及 diff 檢查通過；`preview.html` SHA-256 不變。Chrome 八尺寸、24 組檢查涵蓋介紹展開收合、轉場正反向捲動、200% 文字放大、手機橫直旋轉、網址列高度變動、減少動態與無 JS；無水平溢出，動態頁面無 runtime error。900px 以下單欄照片與大字至少保留約 40px 間距，1440px 幾何與修改前相同。Safari／iOS 實機尚未驗證。

## 2026-09-23 孩子的一天拍立得翻面改得更自然

依使用者要求讓翻面更自然（僅 Nuxt `web/`，凍結原型不動）。翻面改為永遠右緣掀起往左翻，與右下折角、首張偷看同方向，翻到一半再點原路翻回；節奏改為 0.95 秒、點下即起步的曲線；紙改成單側懸臂微彎、停下輕輕回彈，抬升時下緣先起、影子變淡變散；紙膠帶畫進紙面跟著翻，不再停在原地。同時修掉兩個舊 bug：WebGL 紙量到旋轉後外框而大約 5% 且偏右下、翻到一半穿過接影子地板而出現假摺痕。鍵盤焦點框翻面途中先淡掉。規則見 DESIGN.md「翻面手感改得更自然」。

以 `origin/main`（9813f34）三方合併，保留 main 的顯影分格快取、觸控掛載名額與 shader 暖身。Node 22 typecheck 0 錯誤、單元測試 102 項通過（新增 `web/tests/print-flip.spec.ts`）、`nuxt build` 完成；以該 build 在 Chrome＋SwiftShader 假時鐘逐格驗證桌機／390px 手機 WebGL 版與停用 WebGL 的 CSS 版：翻過去、翻回、途中反轉皆無 console error。證據在 `output/playwright/flip-natural-20260923/`（本機，未進版控）。實機 GPU、Safari／iOS 未驗證。

Node 22 typecheck 0 錯誤、單元測試 115 項通過（新增 `web/tests/print-flip.spec.ts`）；Chrome＋SwiftShader 以假時鐘逐格驗證桌機／390px 手機的 WebGL 版與停用 WebGL 的 CSS 版：翻過去、翻回、途中反轉、偷看中點擊、鍵盤焦點框、懸停，靜止後 WebGL 紙與 DOM 差異只剩 1px 邊緣。前後對照在 `output/playwright/flip-natural-20260923/`。未跑 `nuxt build`（另一個 session 的 server 正在使用 `web/.output`）；實機 GPU、Safari／iOS 未驗證。

Node 22 typecheck、117 項單元測試與最終 Nuxt build 通過。29 組進站／備援檢查通過；尾段陰影修正後，另以 1440×900、390×844、320×568 實際首頁逐秒倒數、完整開幕、重新整理不重播，以及預覽尾段透明度／重播重新確認，均無 runtime／hydration／shader error。中央 canvas alpha 實測由原先固定 46/255，改為 23→1→0；原型語法與重打包通過，preview.html hash 不變。既有拍立得變更及執行中並行修改的 studio.css 保留。Safari／iOS 實機未驗證。

## 2026-09-23 布幕協調性精修

依使用者要求繼續檢視協調性，A 版改為較沉穩的酒紅、寬厚布褶與柔和暖金光。校徽桌機約縮小 9%、手機約 16%，與倒數組成光學置中的一組；倒數改圓潤粗體並拉近校徽，金邊與略過按鈕降低視覺重量。投影改平滑淡入、提早退光，完整 3 秒倒數及 3.4 秒左右開幕保留。

新增[精修前後比較](design/entrance-curtain-a-velvet-20260922/harmony/index.html)，使用前後兩版實際 Nuxt 首頁的桌機／手機截圖；[動畫預覽](design/entrance-curtain-a-velvet-20260922/README.md)和首頁共用引擎。備份在 `versions/before-entrance-harmony-20260923-081253/`，本輪證據在 `output/playwright/entrance-harmony-20260923/`。未部署或提交。

Node 22 typecheck、105 項單元測試、Nuxt build 通過；Chrome／Apple M2 在 1440×900、768×1024、390×844、320×568 的逐秒倒數／開幕及各項備援共 29 組檢查通過，無 runtime／hydration／shader error。原型語法及重打包通過，preview.html hash 不變；五個其他未提交產品檔案 hash 保持一致。Safari／iOS 實機尚未驗證。

## 2026-09-23 A 布幕加入 30 週年校徽投影與 3、2、1 倒數

依使用者提供的週年圖，將校徽轉為暖金投影，直接照在變形後的紅絨布面；保留原圖人物、皇冠、緞帶與字樣，光線隨凹凸產生明暗。圖檔原樣複製，無白底矩形。數字同樣以光投射，完整倒數三秒後再接 3.4 秒左右開幕，總計 6.4 秒；開幕時投影退光，載入時間不壓縮倒數。手機依畫面比例縮放，保留全部校徽和數字。

已整合本機 Nuxt 首頁及[可重播預覽](design/entrance-curtain-a-velvet-20260922/README.md)。Node 22 typecheck、105 項單元測試及 Nuxt build 通過；Chrome／Apple M2 在 1440／390／320px 的逐秒倒數、開幕、略過、無溢出、同工作階段不重播、減少動態與圖檔／模組失敗等 27 組檢查通過，無 runtime／hydration／shader error。證據：`output/playwright/entrance-projection-20260923/`。備份：`versions/before-entrance-projection-20260923-080318/`。

原型語法／重打包通過，`preview.html` hash 不變；五個其他未提交產品檔案 hash 保持一致。此輪未部署、未提交；Safari／iOS 實機尚未驗證。

## 2026-09-22 首次進站採 A 並升級紅絨布質感

依使用者「走 A、質感更高更逼真」，Nuxt 首頁加入一次性的左右開幕。布料使用不規則立體垂褶、纖維 bump、MeshPhysicalMaterial 絨面反光、VSM 自身陰影與下襬滯後，預設 3.4 秒。略過／Escape、減少動態、資料節省、慢網路、首次載入逾時及 WebGL 失敗都能直接回到內容；完成即移除 dialog 並釋放圖形資源。

可重播並對照原版的[材質預覽](design/entrance-curtain-a-velvet-20260922/README.md)與實際首頁共用引擎。Node 22 typecheck、102 項單元測試與 Nuxt build 通過；瀏覽器證據在 `output/playwright/entrance-curtain-a-20260922/`。沿用使用者未提交的首頁設計；凍結原型重打包內容不變。未部署或提交，Safari／iOS 實機未驗證。

Chrome 使用 Apple M2／ANGLE Metal，20 組實際首頁／備援檢查通過，無 runtime／hydration error；1440／390／320px 最終材質、拖曳、重播與無溢出另行通過。手機摺痕密度與深度隨視窗比例降低，保留寬厚的布褶。Nuxt `build:manifest` 關閉入口引擎本體的 SSR prefetch，已看過與減少動態時不下載該模組；其他區塊原有 Three.js 載入策略保留。

## 2026-09-22 首次進站紅布幕 Three.js 三案 mock-up

新增獨立比較頁 [`design/entrance-curtain-three-20260922/`](design/entrance-curtain-three-20260922/README.md)：A 經典左右對開（3.2 秒）、B 波浪劇院升幕（3.0 秒）、C 柔弧向兩角攬幕（3.6 秒）。使用現有 Three.js 做立體布面形變、摺痕光線與金邊，提供重播、暫停、進度拖曳、略過及滿版預覽。背景沿用今日 Nuxt 首頁桌機／手機靜態截圖；此輪為比稿，未整合正式頁面、未部署或提交。

Chrome / SwiftShader 驗證桌機 1440px、手機 390／320px、三案操作、減少動態及 WebGL 備援，證據在 `output/playwright/entrance-curtain-20260922/`。mock-up JS 語法、根目錄 app.js 語法與原型重打包通過，`preview.html` SHA-256 前後一致；Safari／iOS 實機及實際 GPU 效能未驗證。

## 2026-09-22 修復正式站拍立得照片裁切回歸

後續已依使用者要求同步本機與遠端 `main`：commit `89235d2796c017f619d4146ee7fdbbfcfb101e20`。五個已部署產品差異一併帶入，避免 CI 回退手機構圖；重建 436 檔快照與既有正式 hash `a2a32307…` 完全一致。[CI 35740635299](https://github.com/wu0010802-stack/ivy-website-admin/actions/runs/35740635299) 的前台、後台、PostgreSQL／契約及正式部署全部成功，線上 release 已對應同一 commit。兩個原工作區的未提交內容保留；同步 main 時逐檔確認其 9 個使用者檔案 hash 不變。

已部署至[正式官網](https://web-production-04caa.up.railway.app/)：web deployment `3a94c291-e100-435b-ad34-8531a5370b9b` SUCCESS，release `a2a32307…`。以目前正式 `050b9d12…` 快照為基底，只移除 `DayMomentCard.vue` 被效能分支合併帶回的 figcaption，修正照片框多出 29px、WebGL 裁切與 DOM 不一致；保留既有手機構圖與效能版本。

Node 22 web typecheck、92 項 web／42 項 admin tests 與前後台 build 通過；46 項公開 GET 檢查、Chrome 桌機／手機 WebGL、320px 減少動態及 CSS 備援的六張照片比例與翻面均通過。初次線上 WebGL 等待曾逾時，獨立診斷正常後完整重驗四組通過，紀錄保留。Safari／iOS 實機未驗證。證據在 `output/railway-day-photo-fix-20260922-204153/`，詳見[部署紀錄](deploy/README.md)；API／Postgres 未變，未 commit／push。

## 2026-09-22 手機版保留桌機構圖

依使用者確認，Nuxt 首頁手機消息恢復大圖＋下方標題，消息與近期活動以原生橫向捲動呈現並露出下一張；700px 以下分校照片改為 3:2，拍立得縮至容器 84% 並保留左右錯位。正背面共同撐高，避免縮窄或放大文字時裁掉故事；首頁影片、介紹雙照片與桌機排版沿用既有定案。

Node 22 typecheck、91 項 web 單元測試、JS 語法、原型重打包與 diff 檢查通過。Chrome 320／390／430／640／768／1024／1440px、觸控橫滑、鍵盤及對話框焦點返回、六張 WebGL 翻面、CSS 備援、減少動態、橫直轉向，以及拍立得／消息 200% 文字放大通過；整頁無水平溢出，1440px 主要區塊及手機 Hero 尺寸與修改前一致。實作驗證在 `output/playwright/mobile-composition-20260922/`；Safari／iOS 實機未驗證，未提交。

已部署至[正式官網](https://web-production-04caa.up.railway.app/)：web deployment `81f2ce4e-0722-4fbe-bc5d-125196351034` SUCCESS，release `050b9d12…`。以最新校區線稿版 `4045a4b4…` 為基底，只套入這次四檔手機差異，保留正式字型、Hero 與延後載圖。固定快照通過 92 項 web／42 項 admin tests、typecheck 與前後台 build；45 項公開檢查、Chrome 七尺寸及手機互動驗證通過。部署證據在 `output/railway-mobile-composition-20260922-175717/`，詳見[部署紀錄](deploy/README.md)；API／Postgres 部署未變，未 commit／push。

## 2026-09-22 首頁五校線稿切換列放大

依使用者截圖調整 `web/app/components/CampusBoard.vue`：桌機線稿寬度 120→160px、校名 15→17px，選校列上限 820→1040px，並同步圖片 `sizes`。窄桌機插畫依可用寬度等比例縮放；手機沿用既有一列五校尺寸與短底線樣式。

Node 22 typecheck、JS 語法與原型打包通過；Chrome 在 1440／768／701／700／390／320px 的五校排列、無水平溢出、點選與方向鍵循環切換通過。截圖在 `output/playwright/campus-size-*.png`；原型打包無差異。

已部署至[正式官網](https://web-production-04caa.up.railway.app/#campuses)：web deployment `47f3ca84-a257-441a-8723-54ebff31bff3` SUCCESS，release `4045a4b4…`。以線上 CI commit `4466afa` 重建的精確快照疊加本輪四處尺寸差異，保留已部署的卡片延後載圖；未帶入其他手機版調整。固定快照通過前台 92／後台 42 tests 與前後台 build；43 項公開檢查、Chrome 1440／768／390／320px 五校點選／鍵盤／無溢出檢查通過。證據在 `output/railway-campus-size-20260922-174531/`，詳見 [部署紀錄](deploy/README.md)。未 commit／push。

## 2026-09-22 main 對齊已部署照片修補與手機構圖

將正式快照 `a2a3230720fa0c4ed3e8d21719b649176d819fc04f7c8c358fb8672837188107` 的五個產品差異同步到 main：移除合併時帶回的拍立得 figcaption，修正照片框多出 29px 的裁切問題；保留已上線的手機消息／活動橫滑與大圖、84% 拍立得與正背面共用高度、五校線稿放大及手機分校照片 3:2。其他效能、字型、延後載圖、API、後台與內容來源維持正式版本。

main 的 CI 會重新部署完整快照，因此這五檔必須一起對齊，避免只提交照片一行修補時回退另外四檔已上線設計。同步時逐一核對 436 個部署來源檔，與上述正式快照完全一致。該快照通過 Node 22 web typecheck、92 項 web／42 項 admin tests、前後台 build、46 項公開檢查，以及 Chrome 桌機／手機 WebGL、320px 減少動態、CSS 備援的六張照片比例與翻面驗證；Safari／iOS 實機未驗證。


## 2026-09-22 線上 v2 合併版的三項效能回歸修正

線上部署「v2 ＋ 載入效能第一批」合併版後 mobile simulate 從早上的 89–90 掉到 76–80、FCP 1.6 → 3.3 s，本機重現後修三件事：

1. **字型重複載入**：`styles.css` 的整包 `lineseed-bd.woff2?v=`（154 KB）與 `font-subsets.css` 的 critical＋remaining（7＋150 KB）同時被抓（本機 Lighthouse 也重現，字型 7 支）。移除 `styles.css` 的 LINE Seed 700 宣告，LINE Seed Bold 只剩 `font-subsets.css` 這一份；critical 字集改由 `scripts/first-screen-chars.cjs` 對實際 SSR 首頁、五個分校頁與 /visit 在 320–1440 六種視窗量到的首屏 LINE Seed Bold 用字推導（`web/app/generated/first-screen-chars.json`，53 字，含分校頁 h1 標語與桌機首屏露出的下一段標題；原本 24 字只涵蓋 hero 標語＋校名，分校頁首屏要等 150 KB remaining 才換字），`scripts/subset-critical-fonts.py` 取聯集重切（13,788 B／146,676 B，cmap 聯集＝原 725 字、字形輪廓與字寬逐字比對相同），`nuxt.config.ts` preload critical（URL 取自 `font-manifest.json`）。截圖比對抓到拆分後所有標題往上跑 2–4px：CSS 行框高度取家族裡 `unicode-range` 涵蓋 U+20 的第一個 face 的度量，兩段都不含 U+20 時退到 PingFang（1.40em vs 1.61em），腳本改為 critical 一律補 `U+20`，h1 幾何與線上版逐 px 相同。**合併規則寫進 `web/public/assets/fonts/README.md`：`font-subsets.css` 與整包宣告只能擇一。**
2. **錯誤頁 CSS 載進首頁**：純 v2 build 重現，是 `features.inlineStyles:false` 讓 Nuxt 對 error-404／error-500 的 CSS 發 `<link rel=prefetch as=style>`；加 `build:manifest` hook 對這兩個 chunk 關 prefetch（改回 inline 後 CSS 本就不會出現，hook 保險）。
3. **`inlineStyles` 取捨**：同機同碼 A/B（字型修好後，各 3 次 median）——false：devtools 98／LCP 2021 ms、simulate 82／LCP 4054、desktop 99／765；true：devtools 97／LCP 2279、simulate 83／LCP 4054、desktop 99／783。分數打平；true 少兩支阻塞渲染的 CSS（Lighthouse 對 false 估 0.7–1.05 s 可省、對 true 估 0–0.15 s），代價是每頁多 28 KB（brotli）inline CSS。線上是高延遲手機網路、往返比位元組貴，且早上 89–90 分的版本就是預設值，改回 `true`。

修正後本機（fixture、同機同條件）：mobile devtools ×3 median Perf 97、FCP 1712 ms、LCP 2279、TBT 82、CLS 0、556 KB（修正前 4466afa：97／1783／2293／81／0／708 KB）；mobile simulate ×3 median 82–83、FCP 2852、LCP 4127、1167 KB（修正前 73／3755／4956／1319 KB）；desktop 99／LCP 822。字型請求 6 支、無重複；`npm run build`／`typecheck`／`test:unit`（15 檔 92 項）通過；截圖比對（基準＝未修改的 `4466afa`，390／1440 各 33 張）全部 0.00%、整頁高度一致。未 commit。

## 2026-09-22 部署分支改為 main

Railway 正式部署的觸發分支由 `production` 改為 `main`：`.github/workflows/website.yml` 的 deploy job 條件與 concurrency 取消規則、以及 `deploy/railway_ci.py` 內建的分支自檢都改為 `refs/heads/main`（三道守門要一起改，只改 workflow 會在 deploy job 被腳本擋下），`deploy/CICD.md` 的分支表、首次啟用步驟與日常操作同步更新。GitHub environment `production` 已建立並將 Deployment branches 限制為 `main`。

GitHub default branch 同日一併改為 `main`（PR 預設開向 `main`，`feature/website-admin` 保留未刪除）。啟用後每次成功推上 `main` 都會在 CI 全綠後部署正式站，沒有額外閘門；不想立即上線的工作留在 `feature/**`。尚未設定 `RAILWAY_TOKEN`（production environment secret），在設定前 deploy job 會失敗、不會實際部署。線上目前包含未提交快照，首次真正部署前需先核對 `main` 與線上的差異。

## 2026-09-22 首頁 Lighthouse 效能／SEO 修復（移植到 21d99e3）

把 `perf/lighthouse-mobile-fixes` 上驗證過的效能修改移植到含分校控制器水滴進場的正式原始碼（先在 `9a0150e` 完成並驗證，同日以 3-way 合併把 base 移到 `21d99e3`：`studio.css` 上游新增的活動卡片蜜糖日光 hover 與本輪的 hero 底線改動位於不同區塊、自動合併無衝突；README／DESIGN 兩邊新增段落並列；其餘 54 個上游檔案（backend／admin／contracts／docs／`server/routes/api/website/v1/[...].ts`）直接取上游版本），還原版元件一律不保留、只以正式元件為準重新套用同樣的意圖。內容：取消 157 KB LINE Seed Bold 的 preload、品牌字 `@font-face` 併進 `styles.css` 不再載阻塞的 `brand-fonts.css`（只預載 h1 的 EB 與兩個品牌字子集）；SSR HTML 由 `server/plugins/compress-html.ts` 送 brotli、靜態檔 `nitro.compressPublicAssets` 預產 br／gz、`features.inlineStyles:false` 去掉 scoped 樣式 inline 又 link 的重複（首頁 HTML 99.8 KB → 79.2 KB，brotli 後 19.7 KB）；三道簾幕在 hydration 前於 `performance.css` 預留幾何；hero 影片重壓（手機 1.17 → 0.57 MB、桌機 2.32 → 1.18 MB）、手機延到 `load` 後 idle 才啟動、拿掉重複下載的 `poster`；`day-poster`／`classroom`／`learning` 提高壓縮率、hero 補 640w、母檔另產原尺寸重編碼候選、logo 改無損 WebP、below-fold 圖 `fetchpriority=low`、分校導覽圖改響應式；`/assets/**` 與字型補 Cache-Control、`/visit` 改 `no-cache` 讓 bfcache 可用；hero 底線改雙層 transform 擦出；五校→消息換頁（`HomeNewsTransition.vue`）與頁尾進場（`pages/index.vue`）的 view-timeline 動畫改直接掛在 underlay／sheet／`::before`／`::after` 上，wrapper 只留 `timeline-scope`，`--news-paper-progress`／`--home-footer-progress` 只給 JS 備援；五校卡片只有當前與左右鄰卡綁 `src`；拍立得 WebGL（`paperPrints.ts`）：觸控 DPR 上限 1.5、shadow map 512、顯影改六格預繪交叉淡化、建場景分段讓出主執行緒＋`compileAsync`、WebGL 探測整頁一次、暖身場景保住 shader program、觸控同時最多 2 張（`paper-budget.ts`）。SEO：首頁 JSON-LD 列五校 `Preschool`、`og:image` 改 1200×630 JPG（`web/public/assets/og/`）、品牌連結可及名稱與可見文字一致。水滴進場、輪播時鐘與 `motionViewport`／`scrollIdle` 等正式元件功能未動。

驗證（本機 fixture build、同機同條件，基準為未修改的 `9a0150e`）：mobile devtools 節流 ×3 median Perf 66 → 98、FCP 3.78 → 1.70 s、LCP 3.78 → 2.00 s、TBT 110 → 73 ms、CLS 0.255 → 0.002、傳輸 1036 → 579 KB；mobile simulate ×3 median 57 → 83（LCP 6.0 → 4.06 s、TBT 14 → 0 ms、2243 → 1169 KB）；desktop 97 → 99（LCP 1.13 → 0.81 s）。layout-shift 診斷（412×823、4x CPU、慢網路）：基準 0.2657（`.day-reveal` 量測後上移），移植版 0.0019（僅字型換入的 4px 文字位移）。拍立得 4x CPU 節流逐張停留（SwiftShader）：第 2–6 張單次最大 LoAF 111–275 ms（基準 119–505 ms）、總阻塞 1433 ms（基準 2762 ms）、同時掛載的 canvas 最多 3（基準累積到 6）；第 1 張含 three 載入與首次 shader 編譯仍約 1.0 s（基準 1.09 s）。`npm run build`／`typecheck`／`test:unit`（12 檔 73 項，含 scroll-idle／motion-viewport／carousel-clock）通過。基準 vs 移植截圖比對（`scratchpad/port-verify/capture-local.cjs`，輪播先按暫停，390／1440 各 33 張）：整頁高度一致，66 張裡 64 張 0.00%，桌機 3.4 視窗位置 0.01%（第二張拍立得 WebGL 紙緣一線），桌機 campuses+0.3 的 3.94% 是兩邊剛好差 2px 捲動位置的時序假差異，固定同一 scrollY 重比為 0.000%。未 commit。

base 移到 `21d99e3` 後重驗（基準＝未修改的 `21d99e3`）：`build`／`typecheck`／`test:unit`（73）通過；mobile devtools ×3 median Perf 68 → 98、FCP 3811 → 1702 ms、LCP 3811 → 2147 ms、TBT 109 → 73 ms、CLS 0.228 → 0.002、1037 → 579 KB（simulate 57 → 83、desktop 97 → 99 同前）；截圖比對 390／1440 各 33 張：桌機 33 張皆 ≤0.02%（3.4／4.8 位置的 0.02%／0.01% 是拍立得 WebGL 紙緣一線），手機第一輪 1.8／2.3／4 三格 3–6% 為視窗下緣那張拍立得顯影時序（一邊已顯影一邊未），settle 拉到 3 秒重跑 33 張全部 0.00%，整頁高度兩邊一致。

審查後補修（同日）：字型檔名沒有雜湊但 `/assets/fonts/**` 快取 30 天，`styles.css` 的 `@font-face` 與 `nuxt.config.ts` 的 preload URL 一律加 `?v=<sha256 前 8 碼>`（重切子集時兩邊同步改；build 後 5 個字型 200、瀏覽器只各請求一次、無重複下載）；`paperPrints.ts` 的場景 `dispose()` 補 `key.shadow.dispose()`（暖身場景亦同），觸控名額反覆卸掛不再累積 512² shadow map；`buildScene` 的顯示畫布尺寸改到最後一個 await 之後才設、並同步畫第一幀（Playwright 逐幀取樣：桌機 1440→1100→1440 與手機 390×844↔844×390 轉向，畫布尺寸切換 9 次、空白幀 0；修正前手機轉向有 5 格空白幀）。

未處理：Lighthouse SEO 66 是本機沒設 `NUXT_PUBLIC_SITE_ORIGIN`／indexing 關閉造成（noindex、無 canonical、無 og:image），與程式無關；`og:image` 由 `scripts/optimize-site-images.py` 依固定圖名（`OG_IMAGES`）預產、檔名不帶雜湊，CMS 一旦開放分校封面改成媒體庫 UUID 圖片，`ogImagePath()` 會指向不存在的 `/assets/og/<uuid>.jpg`，換圖後社群平台的分享快取也不會更新，屆時要改成由後端產圖並帶版本；perf-fixer 在還原版 `CampusBoard.vue` 上依線上 CSS 重寫的分校樣式（Noto Serif 校名、底線式 tabs、`noto-serif-tc-500-campus.woff`）**沒有**移植，因為正式原始碼的分校樣式與線上 build 不同，是否要對齊線上待設計側裁定；hero h1 實際字重 700 蓋過 800 的問題同前未改；Safari／iOS 實機未驗證。

## 2026-09-22 後台深色側欄與青藍風格已部署

[正式後台](https://web-production-04caa.up.railway.app/admin/) 已套用參考 `ivy-frontend` 的深藍灰側欄、青藍操作色與淺灰工作區。以目前線上快照為基底，只替換 9 個後台樣式檔，保留官網、API、資料庫與既有操作流程。

web deployment `ac70c670-ff0f-45b7-8764-81cb67e1e34b` 為 SUCCESS，release `fc5638c3…` 及後台 JS／CSS 逐檔雜湊已在線上核對。固定快照通過 web 88／admin 30 tests、typecheck 與前後台正式建置；39 項公開 GET 與 Chrome 1440／390／320px 共 14 組檢查通過。登入頁為實際匿名流程，內頁使用正式程式搭配合成 API，未登入真實帳號或讀寫私人案件。證據在 `output/railway-admin-style-20260922/`；Safari／iOS 實機未驗證。未 commit／push。

## 2026-09-22 官網後台套用園務後台風格

依使用者指定參考 `ivy-frontend`，`admin/` 改為深藍灰側欄、青藍操作色、淺灰工作區與白底面板。統一總覽、列表、表單、素材選取及登入畫面；保留兩層分組、權限、搜尋、手機抽屜與未儲存保護。

Node 22 typecheck、42 項後台單元測試與 production build 通過；Chrome 8 頁 × 5 尺寸（320–1440px）、導覽／按鈕對比及主要互動共 76 筆檢查通過，另 11 筆按鈕 hover、焦點、高對比與減少動態檢查通過。實際畫面使用合成 API 資料，未寫入正式資料；JS 語法與原型重打包通過，`preview.html` 無差異。建置保留既有大型 bundle 警告。證據在 `output/playwright/admin-reference-20260922/`，Safari／iOS 實機未驗證。僅本機整合，尚未部署或提交。

## 2026-09-22 預約 A 與孩子／聯絡資料已部署

[正式預約入口](https://web-production-04caa.up.railway.app/visit) 已更新為 A 兩步驟選校與參觀資料，支援日期／場次、孩子姓名／生日、Email 與得知管道；後台同步詳情、搜尋、CSV 及人工確認。分校直達頁的場次載入已修正 SSR hydration 不一致。五校預約模式維持 `paused`，園方開啟適當模式並設定場次後才接受表單。

依使用者確認，先備份官網獨立正式 PostgreSQL，再更新至 `8cf3e2b5a641`；沒有修改或停權帳號。API `69880c2d-77d0-457d-a051-90f80464b7c4` 與 web `c801bed3-689e-416d-b057-6ad75d8ed891` 均 SUCCESS，release `da604b8c…` 已線上核對，保留既有 Hero、照片、字體、活動卡、頁尾與效能更新。

固定快照 web 88／admin 30／真 PostgreSQL API 171 tests、前後台 build 通過；線上 39 項公開 GET、97 個 API 檔案 hash、migration／volume／非 root 程序及三尺寸 6 組 Chrome 驗證通過，無 runtime／hydration error。沒有登入正式後台、建立正式預約、啟用寄信／索引或 commit／push。[部署紀錄](deploy/README.md) 與 `output/railway-visit-20260922-151800/` 保留完整證據。

## 2026-09-22 官網 CI/CD 設定（待發布啟用）

新增 GitHub Actions：PR／開發分支執行前後台、真 PostgreSQL 與 API 契約檢查；`production` 通過後依序部署 Railway API／web，核對 deployment ID 與公開 release。API 啟動先以唯讀交易核對 schema，migration 維持另行核准。啟用需發布 workflow、設定 production 的 Railway secret，以及整理已核准的正式版 commit；現有線上快照含未提交設計，不能直接用舊 HEAD 覆蓋。詳見 [CI/CD 說明](deploy/CICD.md)。

## 2026-09-22 前台載入效能第一批已部署

校園探索圖片按需載入／responsive 縮圖、首頁 hydration 幾何預留、日常封面延後載入及首屏字型分包已部署至 Railway web。以最新正式快照疊加 17 個效能檔案差異，保留既有設計、原圖放大、CMS 媒體來源與字形；API、DB 與其他工作區功能不在本輪部署範圍。

固定快照 typecheck、前台 77 tests／後台 27 tests 與 production build 通過；線上 51 項公開 GET、18 組 Chrome 情境通過，五尺寸 hydration 幾何穩定，無 runtime error 或 hydration warning。無 JS、減少動態、縮放／場景／熱點／dialog 與暖快取皆已補驗。web deployment `d07e2cc6-4805-44d5-94b7-26efe45b3bde`，release `794731a2…`。本機受控比較與正式站限速抽測見 [量測與部署紀錄](docs/analysis/2026-09-22-frontend-performance-batch1.md)；這些數字不等同真實訪客 p75。

## 2026-09-22 分校社群移除外連箭頭

依使用者指定，移除選單分校社群列 FB／LINE 名稱旁的箭頭，保留原圖示、名稱、連結與讀屏的新視窗提示；Nuxt 和 B 互動稿同步。電話、主導覽與機構社群不在本次修改範圍。JS 語法與原型打包通過，尚未部署。

## 2026-09-22 選單改為一般淺色毛玻璃

依使用者修正，移除墨綠染色，改用中性乳白半透明底、深灰文字、24px 背景模糊及淡亮邊框；標題、五校與聯絡區同樣使用中性色。保留 B 排版、上一輪字級、分校及機構社群順序。[最新 B 預覽](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)，[實站截圖](output/playwright/menu-neutral-glass-20260922/menu-desktop.png)。

Chromium 六尺寸、操作尺寸、鍵盤、既有連結、200% 文字放大與三種透明度／色彩備援通過，無 runtime error；深色文字以純黑最暗背景合成驗證，正常與 hover 對比皆超過 4.5:1。JS 語法、原型打包與 diff 檢查通過，`preview.html` 無差異。證據在 `output/playwright/menu-neutral-glass-20260922/`。已套用本機官網與互動稿，尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 頁尾 A「深森林綠」已部署

[查看正式官網頁尾](https://web-production-04caa.up.railway.app/#footer-campuses)。共用頁尾採深森林綠、米白文字與暖金點綴，呈現已確認的精簡底列；首頁消息區維持暖白銜接。web deployment `2b928a25-1865-47ee-90a1-dfbee3b9dc53` 為 SUCCESS，線上 release hash `87efef1ebe8118ace30cc39a54fac7907b65a815bfee91f3af357106129d7c3f` 已核對。

以當時線上的活動卡／Hero 快照為基底，產品檔案只更新 `SiteFooter.vue`，保留其他已上線內容。Node 22 typecheck、web 72／admin 27 項測試與正式建置通過；正式站 39 項公開 HTTP 檢查及 9 組 320–1920px 瀏覽器檢查通過，CSS hash／色碼、暖白轉場、焦點與高對比備援正常，零 runtime／console error。證據在 `output/railway-footer-a-20260922-150539/`；Safari／iOS 實機未驗證。

自動核准審查拒絕正式帳密使用與私有管理資料讀取，因此本次採公開 GET-only smoke，未執行後台登入／私有資料驗證。API／Postgres 未部署，未執行 migration、CMS 發布、素材或帳號異動、commit／push。

## 2026-09-22 選單 B 改為墨綠毛玻璃

依使用者要求，B 選單整體改為墨綠毛玻璃：80% 透底色、24px 背景模糊、淡亮邊框、米白／淡綠文字與淡金電話圖示。五校底列與分校聯絡區同步透光，保留上一輪排版、字級與社群資訊順序。[B 互動預覽](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)，[實站選單截圖](output/playwright/menu-glass-20260922/menu-desktop.png)。

Chromium 六尺寸、點擊尺寸、鍵盤操作、連結目的地與 200% 選單文字放大通過；以純白作最亮底色合成驗證文字及 hover 對比皆超過 4.5:1。減少透明度、模擬不支援 blur、強制色彩備援均通過，無 runtime error。JS 語法、原型重打包及 diff 檢查通過，`preview.html` 無差異。證據在 `output/playwright/menu-glass-20260922/`；僅本機整合，尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 預約 A 補齊參觀／孩子／聯絡資料

依使用者提供的表單截圖，A 版第二步新增：可預約日期與場次、孩子姓名與出生年月日、Email、得知管道多選（Facebook／Google 評論／媽媽社團／親友介紹／其他）。保留家長稱呼、手機、同意事項與選填提問；孩子姓名／生日必填，Email／得知管道選填。桌機長表單使用可跟隨捲動的迎賓照片區，手機按資料分組順讀。[本機完整表單預覽](http://127.0.0.1:3021/visit/yihua)使用合成場次與送出回應，不建立真實案件。

新增資料以獨立欄位儲存，後台明細、孩子姓名／Email 搜尋與 CSV 同步；生日按台北日期檢查、Email 格式檢核、得知來源使用穩定值。舊客戶端可省略新增欄位，保留舊請求冪等重播；匿名化清除新個資，公開家長回應及通知 payload 不增加兒童資料。

日期與場次使用既有 VisitSlot，僅在園方將該校設為 slots 並建立開放時段時呈現，inquiry 仍由園所安排。後台可選 slots 並設定人工／自動確認，預設人工確認；新增待確認標籤、篩選與確認已選場次的操作。修正最後一組 pending 確認時重算自身占位的問題，過期占位不得確認復活。未自動更改任何校區的實際設定。

驗證：web 86 tests、admin 42 tests（含修正選擇器後的指定重跑）、backend 指定預約／通知／保存政策 89 tests 通過；web／admin typecheck、OpenAPI／TypeScript 契約檢查通過。新 migration `8cf3e2b5a641` 已在專用 PostgreSQL `ivy_website_visit_details_test` upgrade，`alembic check` 無 drift；未動開發或正式 DB。五尺寸完整表單、選校／場次、額滿重選、日期／Email 驗證、空場次／讀取失敗重試與 200% 文字放大驗證在 `output/playwright/visit-details-20260922/`；快照 `versions/before-visit-details-20260922-143833/`。正式啟用需部署配套 API／前後台、套用 migration 並由園方設定場次；本輪未部署、未發送真實通知。Safari／iOS 實機未驗證。

## 2026-09-22 常春藤的一天移除照片補充字已部署

六張拍立得照片左上角的補充字及底標已移除，DOM、WebGL 貼圖及專用 CSS 同步清除。照片、時間戳、下方標題、背面故事、翻面與區塊來源說明保留。[查看正式官網](https://web-production-04caa.up.railway.app/#life)。僅部署三個檔案差異，保留線上既有頁尾、Hero、校園圖片與後台；未更動 CMS 資料及凍結原型。

web deployment `7817ce31-4423-43df-9163-d6aca236645f` 為 SUCCESS，線上快照 `52c0092371b0902c9838a4859fa5d48f8ef9f518814ef0f378efee97a12dd5e8` 已核對。隔離版本 typecheck、web 72／admin 27 項測試及正式建置通過；正式站 41 項公開 HTTP 檢查、桌機／390／320px 照片與翻面檢查完成。證據在 `output/railway-day-caption-20260922-151539/`，API／Postgres 沿用原部署；未 commit／push。

Node 22 typecheck、JS 語法與原型重打包通過；Chrome 1440／390px WebGL、320px 減少動態確認六張皆無圖說，時間戳／標題／故事保留、鍵盤翻面正常，無 runtime error。證據在 `output/playwright/day-captions-removed-20260922/`；Safari／iOS 實機未驗證。

## 2026-09-22 選單 B 色彩與文字比例精修

依使用者截圖優化選單：暖白底與墨綠導覽、深綠標題帶；分校聯絡區改為內縮淺鼠尾草綠與淡金電話圖示。主導覽桌機 20px／手機 18px、電話 22px、校名 14px、輔助字 12px；五校整併單列淡色底，社群移除厚框與重複的「前往」。分校在上、機構在下，以及 IG／YouTube「待提供」的資訊規則保留。

[本機 B 預覽](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)與 Nuxt 官網同步。[實際選單截圖](output/playwright/menu-polish-20260922/menu-desktop.png)。Node 22 typecheck、JS 語法、原型重新打包及 diff 檢查通過，`preview.html` 無差異。Chromium 實站六尺寸／互動稿五尺寸、有效連結至少 44×44px、鍵盤與外連目的地檢查通過，無 runtime error；文字對比最低 5.55:1，390px 的選單文字放大 200% 無水平溢出。證據在 `output/playwright/menu-polish-20260922/`；尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 頁尾 A「深森林綠」已整合

依使用者「走 A」定案，Nuxt 共用頁尾改為深森林綠底、米白文字及暖金點綴，沿用現有排版、文案與五校導覽。首頁消息區維持暖白漸退，再接深綠頁尾；色票限定在 `SiteFooter.vue`，不更動全域品牌色與凍結原型。三案比較留存於 `design/footer-colour-directions-20260922/`，已於同日部署，詳見本頁部署紀錄。

[本機預覽](http://127.0.0.1:3016/#footer-campuses)。Node 22 typecheck、JS 語法檢查與原型重打包通過，`preview.html` 無 Git 差異；首頁／分校／預約頁三路由 HTTP 200 並載入已編譯的 scoped 色票。Chromium 九組路由／尺寸檢查（320–1920px）確認 A 色碼、全域暖白不變、頁尾無橫向溢出、10 個連結保留 44px 高度；暖金鍵盤焦點、hover 底線、強制色彩與減少動態檢查通過，無 runtime error 或 console warning。證據在 `output/playwright/footer-colour-directions-20260922/integration-results.json`；Safari／iOS 實機未驗證。

## 2026-09-22 選單分校資訊移到機構社群上方

依使用者修正，B 選單先顯示分校電話與 IG／FB／YouTube／LINE，最下方才是機構社群。分校社群依頁首電話對應的已發布校區取得；目前義華 Facebook、LINE 可開啟，IG 與 YouTube 顯示「待提供」且不產生連結。未能對應校區時不猜填；舊資料借用的機構帳號不重列成分校帳號。

[更新 B 預覽](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)，[本機官網](http://127.0.0.1:3016/)。3 項社群歸屬 Vitest、Node 22 typecheck、Chrome 六尺寸（含順序、四平台圖示、電話至社群的鍵盤順序、分校與機構連結目的地）通過，無水平溢出或 runtime error。外站回應由本機替代，未撥號或傳訊；JS 語法與原型重打包通過，`preview.html` 無差異。證據在 `output/playwright/menu-campus-socials-20260922/`。尚未部署；Safari／iOS 實機未驗證。

## 2026-09-22 Hero 清晰修復影片已部署

首頁已採用 11.7 秒 Hero 修復片段與新版封面，桌機／手機分別載入確認的最佳化影片；保留自然膚色、慢速循環與播放控制，改善細節及快速動作重影。[查看正式官網](https://web-production-04caa.up.railway.app/)。Hero deployment `1812fc8a-c8f4-4a3e-aed6-15ecfa08f14c` 為 SUCCESS；後續活動卡 deployment 已逐檔確認保留全部 Hero 更新。

以最新線上字體版本加入 10 個 Hero 檔案差異，固定快照 SHA-256 `f3a85bc5e8f7324835f08544bde09bb421d1f2d291cd7c78c00b31bd1e19f542`。Node 22 typecheck、web 72／admin 27 項測試與正式建置通過；線上 56 項 HTTP 檢查及 15 組桌機／手機播放、控制與封面備援驗證通過，0 runtime error。證據在 `output/railway-hero-restored-20260922-142744/`，部署細節見 `deploy/README.md`。本輪未 commit／push、migration 或 CMS 發布；Safari／iOS 實機未驗證。

## 2026-09-22 活動卡片 A「蜜糖日光」已部署

commit `8adf2a1` 的三色向下填入動畫已上線：[正式官網近期活動](https://web-production-04caa.up.railway.app/#latest-news)。以最新 Hero 修復影片快照為基底，只加入活動卡片 CSS，保留已上線的字體、校園照片與後台。web deployment `cd51dbeb-4f59-4e76-91bc-5d5a392fb7c9` 為 SUCCESS，線上 `/release.json` 對上 `0d8237902391866c562747b53bda8e6833cc73e816d54959f4f871a1d826f162`。

Node 22 型別檢查、web 72 項／admin 27 項測試及前後台正式建置通過；正式站 48 項 HTTP 與 8 組桌機／手機互動檢查通過，逐卡截圖像素確認 A 色碼及向下填色，0 runtime error。證據在 `output/railway-event-hover-a-20260922-143225/`，部署細節見 `deploy/README.md`。API／Postgres 維持原部署，未執行 migration、CMS 發布或 Git push；Safari／iOS 實機未驗證。

## 2026-09-22 預約參觀 A 已整合並優化

依使用者「走 A」定案，正式 Nuxt `VisitForm.vue` 採墨綠迎賓／校園影像與兩步流程：五校照片選擇 → 聯絡與安排。通用入口不預選；分校入口直接帶入第二步。手機第二步收短介紹，選填資料預設收合；返回換校保留所有填寫資料，欄位錯誤就地顯示並移動焦點，支援手機號碼貼上空格／連字號。送出中鎖定輸入與切校，成功後以 server 狀態呈現「已收到需求／待園方確認／預約成立」，補充或更正改引導直接聯絡原校。

[本機 A 版預覽](http://127.0.0.1:3021/visit)；[桌機選校截圖](output/playwright/visit-a-20260922/desktop-select.png)、[手機表單截圖](output/playwright/visit-a-20260922/mobile-form.png)。新增樣式限於 VisitForm scoped，沿用各校即時預約設定、API 與 idempotency；LINE／電話僅使用該校既有資料，slots 模式沿用尚未開放政策。

驗證：web 單元測試 **80 passed**、隔離副本 Nuxt typecheck 通過；Chromium 1440／1024／768／390／320px、五校、鍵盤、手機觸控、200% 表單文字放大、保留輸入、錯誤重試、防重複送出、設定變更、各聯絡模式與三種成功狀態，共 19 組檢查通過。預約 POST 全部攔截為合成回應，未建立真實案件。原型 `node --check app.js`／重新打包通過，`preview.html` 無差異。快照在 `versions/before-visit-a-20260922-141058/`；驗證腳本、結果與截圖在 `output/playwright/visit-a-20260922/`。尚未部署或提交；Safari／iOS 實機未驗證。

## 2026-09-22 選單採用 B 米白目錄與機構社群

依使用者選定 B，Nuxt 選單改為米白直式目錄，頂部採深綠「探索常春藤＋細線」，底部保留明標義華校的參觀專線。「機構社群」先加入專案既有的 Facebook `facebook.com/ivykid`；其他平台待提供。分校捷徑保留行政區；矮螢幕可捲動選單。同步修正面板繼承 `pointer-events:none` 的點擊穿透，以及四項舊 hash 導覽，保留膠囊本體。

[本機首頁](http://127.0.0.1:3016/)捲動後展開右上選單；[B 互動稿](http://127.0.0.1:8786/design/menu-uiux-20260922/preview.html?v=b)。Chrome 六尺寸、手機首屏／收合選單、鍵盤焦點、四項錨點實際點擊與 Facebook 新分頁（外站回應由本機替代）通過，無水平溢出或 runtime error；Node 22 typecheck、JS 語法與原型重打包通過，`preview.html` 無差異。證據在 `output/playwright/menu-directory-b-20260922/`。尚未部署；Safari／iOS 實機未驗證。

## 2026-09-22 首頁字體分工已上線

確認的字體調整已部署至[正式官網](https://web-production-04caa.up.railway.app/#latest-news)。web deployment `8eb936b3-343a-4e0e-9d00-886ddd0fa607` 為 SUCCESS；以當時線上版本加入字體樣式與 CSS 註冊兩檔差異，快照 SHA-256 `ebad700792a6e5c5aac90ba3500d8b6a8ec923af8ee2b05fa9aa737b727868d9`。

Node 22 型別檢查、web 72／admin 27 項測試及正式建置通過。線上 47 項 HTTP 檢查（含 CSS 雜湊）與 Chrome 六尺寸／消息互動 10 組驗證通過，無水平溢出或 runtime error；Safari／iOS 實機未驗證。部署證據在 `output/railway-typography-20260922-141925/`，細節見 `deploy/README.md`。未 commit／push、migration 或 CMS 發布。

## 2026-09-22 首頁字體分工已整合

依已確認 mock-up，正式 Nuxt 首頁及消息／活動視窗採用字體分工：品牌主標與分校明體保留，理念標題收斂，資訊標題使用系統黑體600、正文400、操作500，日期與英文小標沿用 Source Sans 3 400。字體變更集中在 `web/app/assets/css/typography.css`，由 `web/nuxt.config.ts` 註冊；沿用原內容、照片與互動。

[本機預覽](http://127.0.0.1:3016/#latest-news)。Chromium 320／390／768／1024／1440／1920px 字級與版面檢查通過；桌機／手機消息清單、詳情、Escape、焦點返回與正常捲動模式通過。品牌／校名／孩子的一天字級對照一致。Nuxt typecheck、原型語法與重打包通過，根目錄 `preview.html` 無差異。截圖與計算字型紀錄在 `output/playwright/typography-roles/`，快照在 `versions/before-typography-roles-20260922-140604/`。尚未部署或提交。

文字放大200%：本次理念、消息與詳情無文字裁切，活動日期欄已修正重疊；320px時的既有頁首仍有水平溢出，停用本次樣式後同樣存在，未擴大修改頁首。Safari／iOS 實機未驗證。

## 2026-09-22 Hero 影片清晰修復片段（未替換）

從園方提供的廣告原檔重製既有七個 Hero 鏡頭，維持 11.7 秒、1080×800、半速無聲循環；輕度去噪／細節銳化並避免多次壓縮。揮手與跳躍兩鏡改保留原始影格，改善光流補幀重影。交付高畫質短片、桌機／手機網頁版及封面，素材與重製腳本在 `design/hero-video-restoration-20260922/`。

[新舊版預覽](http://127.0.0.1:8794/design/hero-video-restoration-20260922/)。三版完整解碼、351 幀／30fps／無音軌／faststart 檢查通過；Chrome 三尺寸預覽與三版完整循環共 6 組檢查通過，無溢出或 runtime error。原型語法／重打包通過，`preview.html` 無差異；尚未替換正式 Nuxt 或部署，Safari／iOS 實機未驗證。

## 2026-09-22 後台缺陷修復（backend／admin／web 契約）

針對後台（`backend/` + `admin/`）做了一輪多維度稽核，修掉 20 項實際重現過的缺陷。最嚴重的七項都有 repro 測試佐證：

- **帳號 email 大小寫**：建立時大小寫敏感、登入查詢不分大小寫，只要存在 `admin@` 與 `ADMIN@` 兩筆就整支登入端點拋 `MultipleResultsFound`（500），而且 API 沒有任何端點能救回來。改成 schema 統一正規化＋DB 端 `lower(email)` 唯一索引兜底，登入查詢改 `limit(1)` 不再炸。
- **共用素材跨校破壞**：`campus_key` 為 NULL 時權限檢查直接放行，任何分校管理者都能改寫、取代、刪除五校共用素材。manage 一律限總管理者。
- **已發布素材可被刪**：引用計數只看最新草稿，把圖從草稿移除後就能刪掉線上還在用的素材（官網當場破圖）。刪除前改成一併檢查目前生效 release 的 manifest。
- **家長管理連結可無限重放**：docstring 宣稱一次性但程式從未寫過 `revoked_at`，連結外流後 14 天內任何人都能看個資、取消預約。改成終態自動撤銷＋新增管理端撤銷端點；家長端回應同時改成遮罩手機的專用 schema（規格 6.4）。
- **公開送單零限流**：規格第 199 行要求 429，實際完全沒有。補上「校區＋手機」與來源兩層滑動窗口，冪等重播不計入。
- **家長改期申請不驗證**：亂填 slot UUID 撞 FK 變 500，別校時段會卡成永遠 pending。補上存在性、同校、可預約與重複申請檢查。
- **過去時段可被預約**：公開查詢與送單都不檢查日期，名額永久被佔住。依規格 225–226 補上最短提前 24 小時、最遠 60 天的時間窗，查詢與送單共用同一份判斷。

其餘：上傳大小限制改成串流中止（原本先把整個檔案讀進記憶體才比對）、Pillow 壓縮炸彈、URL scheme 驗證改允許清單（`java<TAB>script:` 原本可繞過並經 `CampusBoard.vue` 的 `:href` 變成公開站 stored XSS）、內容跨校讀取、素材引用驗證、內容樂觀鎖補列鎖、預約設定存檔補列鎖、CSV 匯出獨立權限＋稽核、帳號建立／授權補稽核、通知重試去重、worker 失敗補 rollback、儀表板改用台北時區、analytics 限流鍵改用訪客 IP、三支 migration 壞掉的 `downgrade()`。

**行為變更**：依規格第 197／221／222 行，`slots` 模式送出後預設是「待園方確認」（`pending_confirmation`，占名額、24 小時占位到期自動釋放），不再一律直接寫成 `confirmed`。園方要「送出即成立」需在預約設定打開 `slots_auto_confirm`。`web/` 的成功畫面改成依 server 回傳的實際狀態顯示文案，不再從 mode 推斷成「預約成立」。

**尚未處理（需另行決定）**：規格第 190 行的 `age`／`contact_time` 固定 enum 仍未強制——公開表單目前送的是 CMS 的中文標籤，收緊成 Literal 會讓現行表單全部送不出去，需要 `web/` 與 CMS 選項一起改。

同時補上 `web/server/routes/api/website/v1/[...].ts` 的訪客 IP header（並顯式覆寫，避免被偽造），公開端點限流才真的以訪客為單位——實測同一訪客連打 22 次 analytics 在第 21 次開始 429，另一個訪客仍是 204。

驗證：`backend` pytest 150 passed、`admin` vitest 39 passed、`web` vitest 72 passed、`admin` vue-tsc 乾淨、`alembic check` 無 drift、`export_openapi.py --check` 契約一致。新 migration head 為 `a1c4f7e92b30`。

## 2026-09-22 導覽選單三款 mock-up

新增獨立 `design/menu-uiux-20260922/`：A「墨綠精簡」整理雙欄導覽、分校捷徑與義華專線；B「米白目錄」以單欄順讀呈現；C「校園優先」提供五校照片、電話與參觀路徑同步切換。[三款互動比較](http://127.0.0.1:8786/design/menu-uiux-20260922/)可切換桌機／手機，保留原截圖與完整比較圖。推薦 A 延續現有選單風格；尚未定案、整合 Nuxt 或部署。

Chrome 三款 × 五尺寸共 15 組版面、C 五校資料／目的地、鍵盤與選單開關、比較頁裁切檢查通過，無水平溢出、缺圖或 runtime error；操作目標至少 44 × 44px。JS 語法、校名字型 cmap 與原型重打包通過，`preview.html` 無差異。驗證紀錄在 `output/playwright/menu-uiux-20260922/`；Safari／iOS 實機未驗證。

## 2026-09-22 預約校園參觀三案 mock-up

新增獨立 `design/visit-booking-mockups-20260922/`：[互動比較](http://127.0.0.1:8786/design/visit-booking-mockups-20260922/)與[三案並排](http://127.0.0.1:8786/design/visit-booking-mockups-20260922/compare.html)。A 為照片選校＋兩步短表單、B 為五校並列＋單頁表單、C 為校園大圖＋側邊／手機底部表單；參考 EtonHouse、MindChamps、BrightPath 的選校與參觀流程。保留校區帶入、切校後輸入、inquiry 語意及各校聯絡方式。

Chromium 三案 × 五尺寸（1440／1024／768／390／320px）互動驗證通過，無水平溢出、圖片失敗、runtime error 或網路 mutation；深連結、暫停情境、鍵盤、錯誤與返回修改通過。JS 語法與原型重打包通過，`preview.html` 無差異。本輪不傳送預約資料、不整合 Nuxt、不部署；Safari／iOS 實機未驗證。

## 2026-09-22 字體角色分工 mock-up

新增獨立 `design/typography-roles-20260922/`，以相同節錄內容、版型與照片比較目前字體與提案：品牌標語保留 LINE Seed、五校名稱保留明體，資訊標題改用系統黑體 600，內文 400，日期沿用較輕的 Source Sans 3。理念大標收斂，桌機正文與手機消息入口提高字級。[互動比較](http://127.0.0.1:8782/design/typography-roles-20260922/)與[並排截圖](http://127.0.0.1:8782/design/typography-roles-20260922/compare.html)均提供桌機／手機；尚未整合正式 Nuxt。

Chromium 六尺寸 × 兩版無水平溢出、缺圖；200% 文字縮放、比較切換、詳情與焦點返回通過。保留品牌／校名字型 cmap 覆蓋、JS 語法、原型重打包通過，`preview.html` 無差異。Safari／iOS 實機未驗證。

## 2026-09-22 五校校園修復圖已部署

已將確認的五校修復版圖片套用至[正式官網](https://web-production-04caa.up.railway.app/#campuses)的首頁輪播、分校封面與分享圖。web deployment `2f074707-e2a7-47c2-99fc-005d1bc47c52` 為 SUCCESS；以線上基底加入 23 檔圖片與設定差異，快照 SHA-256 為 `45467a20ebd86b008aebbd4cc2e2e36ac315795cedc1f678e64ffb0fc2e3095c`。

Node 22 型別、web 72 項／admin 27 項測試與正式建置通過。線上 HTTP 64 項（含 20 張圖片逐檔雜湊）及 Chrome 30 組桌機／手機圖片與版面檢查通過，無水平溢出或 runtime error。部署證據在 `output/railway-campus-photos-20260922-134539/`，細節見 `deploy/README.md`；API／資料庫沿用原部署，未 commit／push、migration 或 CMS 發布。Safari／iOS 實機未驗證。

## 2026-09-22 後台 UI／UX 已部署

後台手機清單、篩選／重試、未儲存保護、版本衝突保留輸入與觸控圖釘已上線：[正式後台](https://web-production-04caa.up.railway.app/admin/)。web deployment `1e3b1147-edc6-487c-a144-6b3a6bdb9515` 為 SUCCESS；採既有線上官網快照加 `admin/` 22 檔差異，官網及 API／資料庫沿用原版本。

快照 web 72 項／admin 27 項測試、型別與正式建置通過；線上 HTTP 39 項、Chrome 32 項檢查通過（1440／390／320px），JS／CSS 與本機正式建置雜湊一致。0 runtime error，未儲存測試未送出資料。部署證據在 `output/railway-admin-uiux-20260922-133447/`，細節見 `deploy/README.md`。未 commit／push、未執行 migration 或 CMS 發布；Safari／iOS 實機未驗證。

## 2026-09-22 首頁與分校內頁銜接 mock-up

新增獨立提案 `design/campus-continuity-mockup-20260922/`，延續首頁已定案的明體校名、暖白底、明亮圓角校園照片與香檳金入口；內容包含五校首屏、介紹、照片切換、FAQ 與聯絡區。提供[目前版／提案比較頁](http://127.0.0.1:8782/design/campus-continuity-mockup-20260922/)，可切換五校與桌機／手機，附完整截圖。僅為 mock-up，尚未整合 Nuxt 或部署。

本機 Chromium 六尺寸 × 五校 30 組版面無水平溢出、主圖與明體正確載入、無 runtime error；照片選擇、FAQ、手機選單及比較工具操作通過。標題字型 cmap、JS 語法與原型重打包通過，`preview.html` 無差異。Safari／iOS 實機未驗證。

## 2026-09-22 五校校園圖採用修復版

依使用者確認，Nuxt 首頁分校輪播、五校內頁封面及分享圖改用已選定的質感修復素材。義華為 1546×1017，其餘約 1737×906；使用新版檔名並產生 480／800／1200px 響應式 WebP，原圖、PNG 母檔與比較頁均保留。內頁圖說改為「校園圖像」。

[本機預覽](http://127.0.0.1:3010/#campuses)。Chrome 320／390／1440／1920px 首頁與桌機／手機五校內頁共 30 組檢查通過，確認新版圖片、響應式選圖、裁切、切校鍵盤操作與連結，無水平溢出或 runtime error。五張素材雜湊吻合確認版、20 個圖片尺寸檢查、Nuxt typecheck、原型語法／重打包與 diff 檢查通過；`preview.html` 無差異。證據在 `output/playwright/campus-photo-replacement-20260922/`。未部署；Safari／iOS 實機未驗證。

## 2026-09-22 後台手機清單與編輯保護

`admin/` 沿用淺色、深綠操作的既有風格，將時段、通知、使用者與操作紀錄改為桌機表格／手機直向清單。統一有標籤的篩選、筆數、載入與錯誤重試；新增使用者與操作紀錄搜尋。預約方式與全站設定加入未儲存離頁保護，版本衝突保留輸入；批次已讀、帳號操作與時段調整防止重複送出。校園探索支援觸控拖曳、44px 圖釘與鍵盤微調。

驗證：27 項 Vitest 全數通過；`npm --prefix admin run build`（含 TypeScript）通過，仍有既有主 bundle 大於 500KB 提示。Chrome 10 頁 × 1440／390／320px 共 30 組版面檢查，無水平溢出或 runtime error；另通過設定取消／放棄、7 頁錯誤重試、名額編輯、通知批次、使用者範圍與觸控／鍵盤操作。截圖及合成 API 測試腳本在 `output/playwright/admin-uiux-20260922/`。瀏覽器驗證不連真實後端，未寫入正式資料；未部署，Safari／iOS 實機未驗。

## 2026-09-22 分校線稿採用 A「留白短線」

依使用者選定 A，正式 Nuxt `CampusBoard.vue` 的五校選單加入各校建築線稿，校名下方以桌機 25px／手機 20px 短底線呈現選取。取消整列上下框線及矩形 hover 底色，保留明體標題與既有照片、聯絡資訊、輪播控制。沿用響應式線稿與 lazy loading，decorative 圖片不重複朗讀校名。

[本機預覽](http://127.0.0.1:3010/#campuses)。Chrome 六尺寸 × 五校及鍵盤／連結共 32 筆驗證、桌機／手機輪播 10 項互動檢查、Nuxt typecheck 通過；無水平溢出、缺圖或 runtime error。原型語法與重打包通過，`preview.html` 無差異。截圖與檢查在 `output/playwright/campus-lineart-a/`，改前快照在 `versions/before-campus-lineart-a-20260922/`。尚未部署；Safari／iOS 實機未驗證。

## 2026-09-22 分校按鈕三個新方向（mock-up）

使用者否決建築輪廓描邊後，新增 `design/campus-tab-framing-20260922/`：A 留白短線、B 校名膠囊、C 輕框卡片。三款皆沿用原有五校線稿，提供桌機／手機同頁對照與完整互動預覽，尚未選定或整合 Nuxt。

[三款比較頁](http://127.0.0.1:8772/design/campus-tab-framing-20260922/)。Chrome 三款 × 四尺寸 × 五校共 60 個版面與鍵盤檢查通過，無水平溢出、缺圖或 runtime error。原型語法與重打包通過，`preview.html` 無差異。

## 2026-09-22 五校校園圖質感修復提案（未整合）

新增五校 AI 修復圖片與[原圖／新版互動比較頁](http://127.0.0.1:8772/design/campus-photo-enhancement-20260922/)。義華由 590×388 提升為 1546×1017，其餘由 1000×522 提升為約 1737×906；保留 PNG 母檔、WebP 與完整提示詞。改善材質清晰度與色偏，但窗格、招牌、人物、植栽等有生成差異，因此仍為提案，未替換 Nuxt 的官方素材。

素材與使用界線見 `design/campus-photo-enhancement-20260922/README.md`。Chrome 三尺寸 × 五校 15 組顯示與互動檢查通過，無水平溢出或 runtime error；原型語法與重打包通過，`preview.html` 無差異。未部署。

## 2026-09-22 A 版線稿按鈕改為建築輪廓框（mock-up）

依使用者截圖，A 版五校按鈕的框線改沿各校建築外緣描繪，保留雙塔、尖屋頂與仁武圓頂的差異。移除矩形 hover 底色、橫跨選校列的直線及選取底線；移入時輪廓淡顯、選取時加深，校名維持下方。只修改獨立 mock-up，B 版與正式 Nuxt 未改。

[更新版 A](http://127.0.0.1:8772/design/campus-lineart-placement-20260922/preview.html?layout=a)。Chrome 四尺寸／五校版面及鍵盤檢查通過；另確認五種輪廓、透明 hover、手機截圖與強制色彩焦點。原型語法與重打包通過，`preview.html` 無差異；框線截圖在 `design/campus-lineart-placement-20260922/screenshots/a-building-outline.png`。

## 2026-09-22 分校建築線稿兩款位置 mock-up（未整合）

新增獨立比較頁 `design/campus-lineart-placement-20260922/`，沿用目前明體標題、細線選校列、圓角輪播及五校原有線稿。A 將小線稿放在各校名稱上方；B 在區塊右上角顯示目前校區建築，與照片同步切換，手機移至標題右側。預設明華校，提供桌機／手機截圖與五校互動預覽。

[本機比較頁](http://127.0.0.1:8772/design/campus-lineart-placement-20260922/)。Chrome 兩款 × 四尺寸 × 五校共 40 個狀態與鍵盤循環通過，無水平溢出或 runtime error；原型語法檢查與重打包通過，`preview.html` 無差異。正式 Nuxt 元件未改，未部署；原始線稿未修改。驗證紀錄在 `output/playwright/campus-lineart-placement/`。

## 2026-09-22 分校控制器延後至照片下方區塊首次進場

依使用者截圖調整 Nuxt `CampusBoard.vue`：膠囊與播放鍵在首次滑到照片下方控制區、該區塊至少 80% 可見時才播放水滴進場。改以控制區原始位置的定位元素觸發，避免 sticky 提前拉入畫面就播放；保留一次性進場、回捲時的吸附位置與播放操作。

本機預覽：[首頁](http://127.0.0.1:3010/)，重新整理後向下捲至分校照片下緣。Chrome 1440／390／320px 確認提前顯示問題修復，首次進場、回捲、暫停／繼續、切校、無溢出及減少動態／高對比／鍵盤共 6 組檢查通過，無 runtime error。Node 22 Nuxt typecheck、`node --check app.js`、`python3 package_preview.py` 通過，`preview.html` 無差異；紀錄在 `output/playwright/campus-control-trigger/`。已部署正式 web（`eec927c9-839d-48cd-b703-7151db30485f`，SUCCESS），線上版本、31 項服務檢查與 6 組瀏覽器功能驗證通過；部署證據見 `deploy/README.md`。Safari／iOS 實機未驗證。

## 2026-09-22 手機 Hero 影片放大

依使用者要求讓影片佔更多版面，Nuxt 1000px 以下影片由約 43% 視窗高度提高為 60%（320–620px），影片下方留白縮為 24px。390×844 手機的影片由約 363px 增至 506px，554×620 視窗由 280px 增至 372px。保留米白文字區、完整文案與無框漢堡。

手機 Hero 採自然捲動，文字與按鈕不在閱讀途中淡出；同步取消手機首次繪製的 sticky 空間預留。桌機仍維持原有揭幕轉場。[本機預覽](http://127.0.0.1:3010/)，截圖與驗證紀錄位於 `output/playwright/hero-video-larger-20260922/`；尚未部署。

Chrome 320–1440px、橫向、減少動態與無 JavaScript 共 10 組版面檢查通過，無水平溢出、內容裁切或 runtime error；選單、影片播放／暫停、孩子的一天入口通過。Node 22 Nuxt typecheck、原型語法／重打包及 diff 檢查通過，`preview.html` 無差異；Safari／iOS 實機未驗證。

## 2026-09-22 活動卡片採用 A「蜜糖日光」

依使用者選定 A，Nuxt 首頁三張活動卡 hover 色改為金黃 `#F6CD68`、蜂蜜 `#EABC74`、燕麥 `#F5DDA3`，保留 560ms 向下填色、移開還原與原有靜止底色。六組比較頁保留提案紀錄，正式配色規則同步至 DESIGN.md。

本機預覽：[近期活動](http://127.0.0.1:3010/#latest-news)。Chrome 桌機 1440px／手機 390、320px 共 8 組互動檢查通過，三張截圖像素均對上 A 色碼及由上往下填色，無 runtime error；鍵盤、減少動態、高對比及活動視窗維持正常。`node --check app.js`、`python3 package_preview.py` 通過，凍結原型 `preview.html` 無差異；紀錄在 `output/playwright/event-hover-a/`。尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 手機 Hero 米白底與無框漢堡選單

Nuxt 手機／平板 Hero 保留上方影片，下方深綠面板改為米白底、深色文字，移除文字陰影，並同步原生／fallback 捲動動畫的字色與深色按鈕框。首頁上方漢堡移除外框、兩條線雙向置中，保留 44×44px 點擊範圍與鍵盤焦點。

Chrome 320–1440px、減少動態與 fallback 共 12 組版面驗證通過，無水平溢出或 runtime error；手機文字對比 12.72:1，漢堡置中偏差 0px。選單點擊／Enter／Escape、收合膠囊與影片播放切換通過。Node 22 Nuxt typecheck、`node --check app.js`、`python3 package_preview.py` 及 `git diff --check` 通過，凍結原型 `preview.html` 無差異。證據在 `output/playwright/hero-mobile-20260922/`；[本機預覽](http://127.0.0.1:3010/)。未部署，Safari／iOS 實機未驗證。

## 2026-09-22 移除頁尾開發輔助連結

Nuxt 共用 `SiteFooter.vue` 移除「標題字型 LINE Seed TW」與「機構原官網」兩項連結及箭頭。版權與頁尾備註依內容顯示；兩者皆空時不保留空白底列，適用首頁、分校及預約頁。

Chrome 桌機 1440px／手機 390px × 三頁共 6 項檢查通過，無水平溢出或 runtime error，首頁頁尾漸退仍完整。Nuxt typecheck、`node --check app.js`、`python3 package_preview.py` 通過，`preview.html` 無差異。截圖與紀錄在 `output/playwright/footer-helper-removal/`；尚未部署。

## 2026-09-22 分校 B 標題與大校名明體整合

依使用者選定 B 並追加的截圖調整，Nuxt `CampusBoard.vue` 改為置中雙語標題與細線五校選單，無校區編號。「分校資訊」與校名採自託管 Noto Serif TC 500，校名放大為桌機 50–66px、手機 50px；資訊帶以細分隔線、垂直對齊的三欄整理校名／聯絡／預約，平板與手機分別重排。

字型涵蓋全部目前用字並附來源／授權；六尺寸 × 五校版面、鍵盤及連結共 32 筆檢查、10 項桌機／手機自動輪播檢查、Nuxt typecheck 通過，無 runtime error。原型語法與重打包通過，`preview.html` 無差異。畫面及驗證在 `output/playwright/campus-heading-b/`。已於同日部署正式 web，部署 ID `80d4dfd3-3944-434e-beda-c89cf65cd3ac`；線上 31 項 HTTP 與 32 筆瀏覽器檢查通過，紀錄見 `deploy/README.md`。Safari／iOS 實機未驗證。

## 2026-09-22 活動卡片六組暖色探索（未整合）

新增獨立比較頁 `design/event-warm-palettes-20260922/`：A 蜜糖日光、B 杏桃果茶、C 珊瑚花園、D 玫瑰奶茶、E 陶土午後、F 奶油烘焙，共 18 種暖色。與目前三色並排，保留霧藍背景及由上往下填色，支援個別 hover／手機點擊、全部換色、播放一輪與直接連結。預覽：[B 杏桃果茶](http://127.0.0.1:8769/design/event-warm-palettes-20260922/?palette=b)。尚未套用至 Nuxt 首頁。

Chrome 六款 × 1440／768／390／320px 共 24 個版面及 6 組互動檢查通過，無水平溢出或 runtime error；18 色對深綠文字最低對比為 5.48:1。JavaScript 語法檢查、`node --check app.js` 與 `python3 package_preview.py` 通過，`preview.html` 無差異。截圖與紀錄在 `output/playwright/event-warm-palettes/`；Safari／iOS 實機未驗證，未部署。

## 2026-09-22 活動卡片暖色向下填入

Nuxt 首頁三張活動卡新增 560ms hover 動畫：蜜桃橘 `#F2B592`、杏桃金 `#F0C56F`、玫瑰奶茶 `#E8B1A4` 從上往下覆蓋原色，滑鼠移開後收回。保留深綠文字與原有尺寸；鍵盤聚焦同步換色，減少動態直接呈現結果，手機不殘留 hover，高對比沿用系統色。

本機預覽：[近期活動](http://127.0.0.1:3010/#latest-news)。Chrome 桌機 1440px／手機 390、320px 共 8 組互動檢查通過，涵蓋三色方向、快速反向、活動視窗、Escape／焦點還原、鍵盤、減少動態及高對比，零 runtime error；逐卡截圖另確認上半已換色、下半仍為原色。Node 22 Nuxt typecheck、`node --check app.js`、`python3 package_preview.py` 通過，凍結原型 `preview.html` 無差異。證據在 `output/playwright/event-hover/`；未部署，Safari／iOS 實機未驗證。

## 2026-09-22 分校標題與選校列三款置中提案

新增獨立比較頁 `design/campus-heading-20260922/`：A 墨綠古銅、上下置中；B 石墨藍灰、雙語橫式標題與細線選單；C 深松綠香檳金、整合式標頭。三款沿用現行圓角輪播照片與資訊，提供五校互動和桌機／手機截圖，尚未整合至官網。

Chrome 三款 × 1440／768／390／320px 共 12 個版面、60 次切校、鍵盤循環通過；標題與選校列置中、按鈕至少 44px、無水平溢出與 runtime error。檢查與截圖在 `output/playwright/campus-heading-20260922/`，Safari／iOS 實機未驗證。原型語法與重打包通過，`preview.html` 無差異。

## 2026-09-22 分校控制器水滴進場

參考 [Apple iPhone 官網](https://www.apple.com/iphone/) 控制器的進場順序，Nuxt 分校輪播加入 1.2 秒水滴動畫：縱向小水滴上浮、輕壓回彈，延展成進度膠囊並分離出播放鍵，最後顯示圓點與圖示。首次控制列至少 80% 可見時播放一次，回捲不重播；保留現有配色、尺寸、sticky 位置與四秒自動輪播。形變只作用於控制器及裝飾底板，不推動照片或聯絡資訊。

減少動態與高對比模式直接顯示控制列；鍵盤聚焦或進場途中 resize 也立即顯示完成狀態。Chrome 1440／390／320px 的進場、重返、減少動態、高對比及鍵盤共 6 組檢查、原自動輪播 10 項互動檢查均通過，無 runtime error；Nuxt typecheck、4 項時鐘測試與原型語法／重打包通過，`preview.html` 無差異。逐格畫面及紀錄在 `output/playwright/campus-control-droplet/`，修改前快照在 `versions/before-campus-droplet-20260922-104942/`。未部署；Safari／iOS 實機未驗證。

## 2026-09-22 分校輪播自動播放不受滑鼠位置影響

Nuxt `CampusBoard.vue` 移除滑鼠停留造成的暫停：照片進入畫面後每 4 秒自動切校，滑鼠放在照片、校名或控制膠囊上都持續播放。保留播放／暫停按鈕、鍵盤焦點暫停、離屏／分頁隱藏暫停與減少動態設定。

Chrome 桌機 1440px／手機 390px 的 10 項互動檢查通過，無 runtime error；先重現修改前照片 hover 會停止，再確認修改後持續自動切校。Node 22 Nuxt typecheck、4 項輪播計時測試、`node --check app.js` 與 `python3 package_preview.py` 通過，`preview.html` 無差異。證據在 `output/playwright/campus-autoplay-pointer/`。尚未部署；Safari／iOS 實機未驗證。

## 2026-09-22 頁首膠囊內距調為 8px

依使用者截圖，Nuxt 首頁深綠膠囊四邊內距由 4px 改為 8px，保留校徽、選單與預約按鈕尺寸。Chrome 1440／900／390／320px 實測 padding 均為 8px，膠囊高度桌機 58px、手機 62px，無水平溢出或 runtime error。截圖與量測在 `output/playwright/header-padding/`；本機預覽 `http://127.0.0.1:3010/`，向下捲動即可看到。

原型 `node --check app.js` 與 `python3 package_preview.py` 通過，`preview.html` 無差異。已以 `bb20ce1` 的內距修改部署正式 web（`d899f96e-d7a3-49e6-ac57-77f32de61932`，SUCCESS）；線上 33 項檢查與四尺寸 8px／選單操作驗證通過，紀錄在 `output/railway-header-padding-20260922/`。

## 2026-09-22 第三次 Railway 部署：官網輪播與轉場上線

將目前確認的分校圓角輪播、四秒切校與社群 icon、手機閱讀高度／拍立得效能、A 無文字淡折角、E 消息紙頁覆疊、A 頁尾霧藍漸退及校徽 favicon 部署到 [正式官網](https://web-production-04caa.up.railway.app/)。web deployment `deb1076d-e531-45bc-924a-928601a815d8` 為 SUCCESS；`/release.json` 對上固定工作目錄快照 `1c000aaf0b655cc233100688f642312f1c44295537fe6af5dcabf0a5568ebaad`。

Node 22.23.2 下前台 typecheck／72 項單元測試／正式建置、後台 16 項單元測試／建置通過；保留既有 Hero calc／clamp 與大型 chunk 建置警告。線上 33 項檢查通過，包括版本、production/live API、CMS、五校 SSR、後台登入與素材上傳／讀取／刪除。Chrome 1440px 桌機、390px 手機模擬的輪播、正反向轉場、JS 備援、觸控、減少動態、拍立得、三個校徽圖檔與後台操作共 40 筆檢查通過，無水平溢出或 runtime error。紀錄：`output/railway-deploy-20260922/`、`output/playwright/railway-20260922/`；Safari／Firefox／iOS 實機未驗證。

本次僅更新 web 服務；API／Postgres 沿用原 deployment，未執行 migration、CMS 發布或初始化。首頁預約入口常駐，五校實際預約設定仍為 paused，搜尋索引與寄信未啟用。快照包含已驗證的未提交前台修改；未 commit、未 push，原型與其他使用者工作保留。

## 2026-09-22 頁尾採用 A「霧藍漸退」

依使用者選定 A，將消息到頁尾的轉場整合至 Nuxt 首頁：頁尾進入畫面時，消息霧藍漸退為頁尾的暖白，紙頁陰影同步消失；往上捲會還原。沿用原有內容排列，使用原生 view timeline 與 JS 備援，手機共用首頁閱讀高度；減少動態直接呈現暖白。

本機預覽：`http://127.0.0.1:3010/#latest-news`，往下捲至頁尾。Node 22 Nuxt typecheck、六項閱讀高度單元測試通過；Chrome 六尺寸 320–1920px、正反向捲動、JS 備援、手機觸控／高度變動、頁面往返與減少動態／強制色彩共 48 筆檢查通過，原有紙頁轉場另 47 筆回歸檢查通過，零 runtime error。證據在 `output/playwright/footer-fade-a/`。Safari／Firefox／iOS 實機尚未驗證，未部署。

改前快照：`versions/before-footer-fade-a-20260922-095616/`；獨立比較頁保留於 `design/footer-transition-20260922/`。原型語法檢查與重打包通過，`preview.html` 無差異；保留其他 session 的設計變更與凍結原型。

## 2026-09-22 官網分頁圖示改為常春藤校徽

Nuxt 官網以現有彩色校徽取代預設 Nuxt favicon，沿用 `SiteHeader.vue` 的 logo 裁切範圍與透明處理，原始 `assets/logo.png` 不變。提供 16／32／48px 多尺寸 `web/public/favicon.ico`、48px PNG 與 180px Apple touch icon；`web/nuxt.config.ts` 統一宣告版本化圖示網址，讓瀏覽器重新載入新圖示。設定依 [Nuxt head 文件](https://nuxt.com/docs/4.x/getting-started/seo-meta)。

驗證：Node 22 Nuxt typecheck、原型語法與重打包通過，`preview.html` 無差異。Chrome 確認首頁／義華分校頁 SSR 與 hydration 後均保留三個圖示宣告，各圖檔回傳 200、可解碼且與本機檔案一致，無 runtime error；圖檔匯出、驗證腳本與報告在 `output/playwright/favicon/`。尚未部署，Safari／iOS 實機未驗證。

## 2026-09-22 拍立得採用 A「無文字淡折角」

依使用者選定 A，移除六張拍立得的正反面翻面提示文字；折角改為常態 32px、淡橫線與輕陰影，首次輕掀 26→38→32。CSS 折角移入正反紙面，WebGL 折角畫入相同貼圖，翻轉途中不再有固定在右下的浮層。點擊會中止掀角／偷看，連點反向延續當下彎曲，CSS 改成 1.1 秒平順緩動；保留整卡觸控、鍵盤、accessible name 與減少動態。

本機預覽：`http://127.0.0.1:3010/#day-hello`；獨立 A 預覽同步更新於 `http://127.0.0.1:8768/design/flip-without-copy-20260922/?view=a`。Node 22 Nuxt typecheck、72 項單元測試、原型語法與重打包通過，`preview.html` 無差異。Chrome 桌機 WebGL、無 WebGL CSS 備援、390px 手機觸控、減少動態、鍵盤返回與快速反向皆通過；翻頁中原角落的 canvas alpha 為 0，沒有殘留。腳本與截圖在 `output/playwright/flip-a-subtle/`。Safari／iOS 實機未驗證，未部署。

改前快照：`versions/before-flip-a-subtle-20260922-0952/`。保留其他 session 的設計變更，vanilla 原型維持凍結。

## 2026-09-22 消息到頁尾三版轉場探索（未整合）

依使用者截圖，新增 `design/footer-transition-20260922/`：A 霧藍漸退（優先推薦）、B 頁尾揭幕、C 圓弧收邊，另附現況對照。沿用 Nuxt 實際渲染的消息、照片與頁尾內容，提供桌機／手機、播放、手動捲動、進度拉桿與全螢幕入口；只做獨立提案。B 參考 Olivier Larose 的 Sticky Footer／Framer 官方示範，C 參考形狀交接思路再延伸，來源與轉化界線記在該目錄 README；A 為現有配色延伸。預覽：`http://127.0.0.1:8765/design/footer-transition-20260922/`。

驗證：Chrome 五尺寸 320–2048px × 四版 × 四進度共 80 狀態，以及 JS 備援、減少動態、播放／手動中止、鍵盤進入頁尾、比較頁切換，共 103 筆檢查通過，無水平溢出、圖片失敗或 runtime error。證據在 `output/playwright/footer-transition/`；原型語法與重打包通過，`preview.html` 無差異。未整合 Nuxt、未改 CMS、未部署；Safari／Firefox／iOS 實機未驗證。

## 2026-09-22 首頁採用 E「紙頁覆疊」轉場

依使用者選定 E，新增 `HomeNewsTransition.vue`／`useNewsTransition.ts`，將現行圓角分校輪播與 News 組成連續轉場：消息紙頁從下方覆入、圓角逐漸展平，分校微微後退，暖白整面轉霧藍；往上捲反向還原。沿用正常文件流、原生 view timeline 與 JS 備援，移除舊 News 水平掃色的 composable／CSS／量測標記。保留活動、照片及 dialog，手機上方留白避開膠囊導覽，被完全蓋住的分校輪播會暫停。

預覽：`http://127.0.0.1:3010/#campuses`。Node 22 型別檢查、72 項單元測試與正式建置通過；建置仍提示既有 Hero CSS 的巢狀 calc／clamp 處理警告與大型 chunk。Chrome 六尺寸 320–1920px 共 36 個原生捲動狀態、六個備援狀態，以及觸控、手機高度變動、dialog／Escape／焦點還原、頁尾與頁面往返、減少動態／高對比、隱藏輪播暫停共 47 筆檢查通過，零 runtime error；證據在 `output/playwright/news-paper-e/`。Safari／Firefox／iOS 實機尚未驗證。

改前快照：`versions/before-news-paper-e-20260922-093121/`。本輪保留其他 session 的分校與手機動效變更，原型維持凍結；未 commit、push、部署或修改 CMS。

## 2026-09-22 分校資訊圓角輪播已整合首頁

依使用者確認的 `design/campus-rounded-20260922/`，更新 Nuxt `CampusBoard.vue`：中央大幅圓角照片與兩側預告、精簡五校選單、照片區內隨捲動停靠的進度膠囊與播放鍵，聯絡資訊排列在下方。中文採 PingFang TC 500，英文／電話採 Source Sans 3 400，搭配暖瓷白、墨綠與香檳金。移除照片解說、張數、前後圓鈕及獨立「認識○○校」；LINE／Facebook 加品牌圖示、移除外連箭頭，缺少 LINE 仍顯示待補。

每 4 秒自動切校，支援暫停、鍵盤、圓點與手機橫滑。首頁常駐「預約參觀○○校」，導向 `/visit/:key` 並預選校區；實際預約頁沿用 CMS 模式，**正式預約開放狀態未變更**。本機預覽：`http://127.0.0.1:3010/#campuses`。

驗證：Node 22 Nuxt typecheck、輪播／預約動作 15 項單元測試通過；Chrome 六尺寸 320–1920px × 五校共 30 個版面狀態無水平溢出，照片與預約頁連結、四秒首尾循環、閱讀／鍵盤／離屏暫停、減少動態、手機原生觸控、零／一／二校與恢復五校通過。照片控制列停靠／離開聯絡資訊／與同時更新的消息紙頁轉場銜接通過，0 個 JavaScript runtime error。截圖與紀錄在 `output/playwright/campus-rounded-site/`；Safari／iOS 實機尚未驗證。

修改前快照：`versions/before-campus-rounded-integration-20260922-092539/`。原型語法檢查與重打包通過，`preview.html` 無差異；未 commit、push 或部署。

## 2026-09-22 手機捲動抖動與拍立得效能修正

公開首頁 `web/` 的 Hero、關於及「常春藤的一天」統一閱讀高度，觸控裝置同寬高度變動不再切換動畫模式；保留向上揭幕與浮水印接力，減少捲動中的重複量測與透明度拖尾。手機先顯示可翻面的 CSS 拍立得，停止滑動後才逐張初始化可見卡片的 WebGL，保留紙張彎曲、折角及六張內容。同步快取紙底／文字，修正先翻背面再載入時的標籤鏡像與狀態接手。

驗證：高度 780↔720px 的卡片位移由原版約 396／422px 降為 0px；同機正式 build、手機模擬、CPU 4 倍降速的兩輪連續捲動，最長幀間隔由 150–233ms 降至 33–50ms。這是受控量測，初始化成本移到停止閱讀後，並非全面關閉 WebGL。72 項單元測試、typecheck、正式建置、五種瀏覽器模式與六張卡片翻面驗收通過；原型語法檢查與重打包通過，`preview.html` 無差異。

本機預覽：`http://127.0.0.1:3311`。詳見 [診斷與修正紀錄](docs/analysis/2026-09-22-mobile-motion-audit.md)，原始量測與截圖在 `output/playwright/mobile-motion-audit/`。尚未驗證 iPhone Safari 實機，未 commit、push 或部署；保留其他進行中的設計提案與部署文件修改。

## 2026-09-22 更多網站轉場探索（未整合）

新增獨立研究與互動頁 `design/news-transition-explore-20260922/`，整理 Motto、TrueKind、Guggenheim、Join Talent 的實站截圖與原作者資料，另附 Sweet Home Sweet、Moooi Paper Play 案例。延伸 D 留白展幅、E 紙頁覆疊、F 照片取色、G 照片接棒四款示意，可切桌機／手機、實際捲動或播放。原站觀察、歷史案例與本次轉化分別標示；沒有變更第一輪 A／B／C 或 Nuxt 主站。預覽：`http://127.0.0.1:8765/design/news-transition-explore-20260922/`。

驗證：獨立 headless Chrome 四尺寸 320–1440px × 四版 × 四進度共 64 狀態、JS 備援 12 狀態、比較頁 16 狀態與四版減少動態通過，無水平溢出／runtime error。D 的照片淡出後才顯示消息文字。證據位於 `output/playwright/news-transition-explore/`；尚未驗證 Safari／Firefox／iOS 實機。

## 2026-09-22 近期活動／消息交界三版轉場（未整合）

依截圖的深綠交界與 Wellington College 的捲動揭幕，新增獨立互動提案 `design/news-transition-20260922/`：A 直線揭幕／霧藍、B 圓弧展開／暖米、C 整面漸染／鼠尾草綠。比較頁提供桌機／手機、全螢幕、重播與進度拉桿；內容、照片沿用現行 News，深綠前段僅作截圖情境。未改 Nuxt、CMS 或五校版型。預覽：`http://127.0.0.1:8765/design/news-transition-20260922/`。

驗證：Chrome 五尺寸 320–2048px × 三版 × 四進度共 60 狀態通過，無水平溢出／runtime error；另確認 JS 備援九狀態、反向捲動、播放與手動中止、鍵盤拉桿、dialog／Esc／焦點還原、減少動態與高對比。比較頁四尺寸 × 三版 12 狀態通過。截圖與檢查摘要在 `output/playwright/news-transition/`。原型語法檢查與重打包通過，`preview.html` 無差異。未驗證 Safari／Firefox／iOS 實機，尚未整合主站捲動。

## 2026-09-22 分校資訊圓角影像輪播提案（未整合）

字體與捲動細修：中文標題／校名改為 PingFang TC 500，英文與電話沿用 Source Sans 3 400；暖瓷白、低飽和墨綠與香檳金取代較重的標題與鮮黃。照片區內的控制列改為原生 sticky 靠下，滑到聯絡資訊後隨照片離開。 捲動五種狀態與手機停靠通過；文字對比最低 5.89:1，證據在 `output/playwright/campus-rounded/scroll-style-checks.json`。

同日微調：移除「校園一隅」與照片張數、移除「認識○○校」及暫停預約訊息，改為常態顯示帶入所選校區的「預約參觀○○校」入口，輪播從 6 秒縮短為 4 秒。本輪僅更動獨立提案，正式 CMS 預約狀態未更動。 再依截圖移除左右切校圓鈕，LINE／Facebook 加入既有品牌圖示並移除社群外連箭頭。

依 Apple 產品重點輪播參考，製作獨立互動預覽 `design/campus-rounded-20260922/`：中央大幅圓角照片、兩側相鄰校園預告、上方精簡校名切換、置中膠囊進度與播放鍵，聯絡資訊移到照片下方。延續現有米白／深綠／暖黃與真實五校素材，手機採較直照片比例及左右滑動；尚未更動 Nuxt 的 `CampusBoard.vue`、CMS 或部署。預覽：`http://127.0.0.1:8765/design/campus-rounded-20260922/`，頁面提供現行版對照入口。

驗證：Chrome 六尺寸（320–1920px）× 五校共 30 個版面狀態無水平溢出；鍵盤／圓點／首尾循環、四秒播放與暫停、減少動態、手機原生觸控滑動通過；預約連結帶入所選校區、圖片說明移除後控制列仍置中，零 runtime error。截圖與結果在 `output/playwright/campus-rounded/`。原型語法檢查與重打包通過，`preview.html` 無差異。未驗證 Safari／iOS 實機及 Nuxt 首頁捲動整合。

## 2026-09-21 第二次 Railway 部署：後台改版與官網第二輪設計上線

把 `dc87b16` 的乾淨工作目錄快照部署到 Railway 專案 `ivy-website-admin`（api `f8b105cf`、web `02bd8339`，皆 SUCCESS）。相對於首次部署的基底 `5bc67b1`，本次補上後台導覽與操作體驗改版、UX 審查 P0～P3 缺口、預約與營運相關 backend 調整、手機版適配兩輪、分校資訊版面重構、拍立得折角提示第二輪及 SEO／效能整合。Migration head 仍為 `ce3082c9bf69`，未跑 alembic、未改 CMS 發布資料；五校預約維持 `paused`，搜尋索引與實際寄信未啟用。

驗證：Node 22.23.2 下 `web` typecheck／57 項單元測試／正式建置、`admin` 16 項單元測試／建置、`backend` 122 項測試通過。線上 33 項檢查全通過（`/release.json` 對上快照 `cd3630f6…`、production/live health、CMS release、五校 SSR、未知校區 404、索引關閉、五校 paused、後台直接路由與 assets、登入與 Secure HttpOnly cookie、素材上傳／讀取／刪除、登出失效），紀錄在 `output/railway-smoke.json`；桌機 1440 與手機 390px 瀏覽器檢查首頁 200、無水平溢出、後台登入與內容編輯頁正常、0 個 JavaScript runtime error，截圖在 `output/playwright/railway2-*.png`。未 commit、未 push，vanilla 原型與 `preview.html` 未動。

## 2026-09-21 拍立得翻面提示第二輪：折角做真＋首張偷看

依 `design/flip-cue-directions-20260921/` 五欄對照（現行／折角做真／文字圖示加重／合併／偷看）使用者選定第 3 欄：相紙右下角真的切掉並掀起一片背面橫線紙（CSS 版 `clip-path`、WebGL 版貼圖挖空＋`alphaTest`），顯影完成後折角自己掀一次；提示字 13px／500 加虛線底，圖示改為左右翻／U 型回頭；首張拍立得掀角後向左微翻 12° 回正一次（每次工作階段一次，減少動態不做）。相紙陰影改由 `.print::after` 承接。規則見 `DESIGN.md`「拍立得顯影」的翻面一節。

驗證：`nuxi typecheck` 通過；Playwright 在既有 dev（3013）桌機 1440 與手機 390 的 WebGL 版：提示文字／圖示隨翻面切換、`--ear` 30→44、翻面後折角換色、`sessionStorage` 旗標寫入、無 console 錯誤；關閉 WebGL 的 CSS 版 3.4 秒掀角、5 秒 `is-peeking`；`reducedMotion: reduce` 折角固定 44、無掀角無偷看。截圖與腳本在 `output/playwright/flip-cue-site/`。未驗證：Safari／iOS 實機、Firefox；手機右下「暫停背景」浮鈕與提示字距離很近是原有版面，未在本輪處理。快照 `versions/before-flip-cue-20260921-213531/`，vanilla 原型與 `preview.html` 未動，未 commit。

## 2026-09-21 分校資訊版面與閱讀優化

Nuxt 首頁沿用無線稿 B 的左右分景、五校橫列及六秒膠囊輪播。選取校區增加淡綠底與清楚底線；左側資訊欄上限 640px，校名收斂至最高 72px，地址、電話、社群及播放提示放大並提高對比。左側資訊與控制列改用正常 Grid 排列，控制列有獨立分隔與空間，內容較長時自然延伸；手動暫停的提示優先於滑鼠閱讀狀態。照片圖說改用局部深綠底、移除底部整片漸層。

900px 以下改成照片在上：761–900px 將校名與分校入口、聯絡方式分成雙欄；手機單欄，英文副標可自然換行，五校仍一列、互動高度至少 44px。保留各校圖片與裁切設定、地址地圖、電話、社群及共用 BookingCta 的預約狀態。

驗證：Nuxt typecheck、既有輪播與預約動作 15 項測試通過；Chrome 9 種視口 × 五校 45 個版面狀態、鍵盤、圓點、自動循環、暫停續播、離屏與減少動態通過。手機觸控與攔截回應的開放預約 CTA 通過，沒有真實送出。三尺寸 × 五校圖說背景像素抽樣最低對比 7.89:1，次要文字 4.84:1；這不是全站無障礙認證。證據在 `output/playwright/campus-refine/`，實際互動預覽為 `http://localhost:3013/#campuses`。原型語法檢查與重打包通過，`preview.html` 無差異；Safari／iOS 實機尚未驗證。修改前快照 `versions/before-campus-ux-refine-20260921-212956/`，未 commit、部署或修改 CMS。

## 2026-09-21 手機版第二輪：顯影提速、小字與殘留空白

以五校 fixture 在 390／320px 重拍後，補上第一輪手機動線之外的細節：拍立得手機顯影從 3 秒縮到 1 秒內（CSS 與 `paperPrints.ts` 的 WebGL 版同步，桌機不變）；拍立得 kicker、翻面提示提高到 12px、相片角落說明 11px；seam=2 手機浮水印壓淡、「閱讀完整介紹」按鈕帶底色避免被大字疊住；膠囊選單五校連結補到 44px；分校內頁「交通與聯絡」移除為不存在的線稿預留的 128px 空白。規則見 `DESIGN.md`「手機第二輪」。

驗證：`web` 型別檢查與 57 項 vitest 通過；Playwright 390／320px 首頁各區、選單、預約頁（未選校／明華暫停）、義華內頁各區共 24 張截圖，無 console 錯誤、無水平溢出、可見點擊目標無低於 40px 者；改前後對照與量測在 `output/playwright/mobile-ux2/`（`before-*`／`after-*`）。本輪與另一個 Codex session 同時改同一 checkout，動手前有先確認其寫入已停止；改前快照 `versions/before-mobile-ux-20260921-212330/`。未 commit、未動原型與 `preview.html`。

## 2026-09-21 分校 B 排版與膠囊輪播控制

依使用者參考圖，Nuxt 首頁分校輪播改為左欄底部的灰米色膠囊：目前校區展開成倒數長條，其餘為可點選圓點，旁邊獨立圓形播放／暫停鍵。上方保留水平五校名稱，移除原分段跑條；保留每校 6 秒、自動循環與減少動態設定。滑鼠／觸控切校後重新倒數，鍵盤聚焦暫停。左欄改用對齊的聯絡列與描邊分校入口，暫停預約訊息以較輕的文字樣式呈現；維持右側滿版照片、無線稿，手機與窄平板另調間距。

Chrome 五尺寸 × 五校 25 狀態、圓點／鍵盤／觸控切換、自動循環、暫停續播及開放預約狀態的排版通過；`web` typecheck 通過。截圖與檢查結果：`output/playwright/campus-capsule/`；五校互動預覽：`http://127.0.0.1:3012/#campuses`。只調整 `CampusBoard.vue` 與設計文件，沿用目前共用 BookingCta 狀態及響應式圖片，未更動 CMS 或部署。

## 2026-09-21 手機 UI/UX 第一輪

公開官網 `web/` 的預約頁改為常駐校區選擇，通用入口不再預選第一校；暫停、電話、LINE 或外部預約模式仍能更換校區，並顯示所選校區真實的聯絡方式。切校保留已填內容、清除過時錯誤與時段選取；送出與讀取中避免使用舊校設定。不可操作的預約提示改為一般狀態文字。

手機首屏新增「找校區」捷徑；關於介紹沿用 CMS 第一個完整句子作摘要，完整文字可展開，桌機仍完整顯示。缩短手機關於進場留白、接力簾幕距離、拍立得間距，保留六個片刻。沿用最新分校輪播，照片與大校名可進入對應校區，非當前照片設為 inert。

驗證：Node 22 的 Nuxt 型別檢查與 57 項單元測試通過；隔離五校預覽驗證五種預約模式、快速切校、輸入保留、送出失敗復原、摘要展開／收合、照片連結與減少動態。手機 320／375／390／430、平板 768 與桌機 1440px 檢查無水平溢出。表單送出使用瀏覽器攔截，不寫入真實資料。截圖、操作腳本與量測：`output/playwright/mobile-ux-implemented-20260921/`；Safari／iOS 實機與正式部署尚未驗證。原型語法檢查與重打包通過，`preview.html` 無差異。本輪未 commit、push、部署或修改 CMS 發布資料。

## 2026-09-21 拍立得改用折角翻面提示

Nuxt 官網移除「翻到背面」角落貼籤，改成相紙折角與無底框的「點照片，看看背面」提示；整張卡片可點，翻後提示可再點回照片。桌機 hover 微掀折角，手機常駐；原生按鈕提供 Enter／Space、整卡焦點框與正反面無障礙狀態。標題恢復完整寬度，提示另留底部空間。

驗證：`npm --prefix web run typecheck`、`node --check app.js` 通過，`python3 package_preview.py` 重打包無差異；Chrome 1440／390／320px 點擊或觸控、Enter／Space、正反面與減少動態 CSS 回退通過，無水平溢出與 pageerror。截圖與驗證腳本：`output/playwright/flip-corner/`。僅更新本機 Nuxt 版本，未部署。

## 2026-09-21 官網 SEO／GEO、載入效能與匿名量測

Nuxt 公開頁補齊分享圖片、Twitter card、機構／Preschool／麵包屑 JSON-LD；canonical origin 僅接受 HTTPS 部署設定。頁面與 sitemap 改走同一份已發布 release，保留無共享 HTML 快取及失敗 503；預約、後台與預覽維持 noindex。以精確原文比對修正舊提案的 description、FAQ、頁尾與錯誤的表單同意說明，保留 CMS 自訂內容及示意消息標示。正式網域與招生資料未確認，不開啟線上索引、不編造內容。

新增響應式 WebP／寬高、按頁首圖 preload、WOFF2 與手機影片；影片保持長度與母檔，hero 手機檔減少約 53%、day 桌機 50%、day 手機 65%。保留最新五校輪播修改，接入響應式圖片、校區連結與聯絡追蹤。WebGL 接近視窗才載入，慢速／省流量停用自動影片與 WebGL。另修正首屏動效初始化的版面位移，四視口本機檢查均低於 0.1；下方背景影片等進入主要閱讀區才載入。

新增 `web-vitals` 與同源匿名事件日誌、p75 彙整及唯讀 SEO 檢查指令；不新增 DB、migration、外部分析服務或持久訪客識別碼，既有後端需求／確認事件仍為招生計數權威。驗證、外部帳號待辦及五校待補清單：[維護與驗收文件](docs/website-admin/seo-performance.md)。本輪未 commit、push 或部署。

# 常春藤官網互動提案

2026-09-21：使用者選定無線稿 B 並要求自動播放，已整合至 Nuxt `web/app/components/CampusBoard.vue`：滿版左右圖文、上方水平五校與分段進度，每校 6 秒、最後一校回到第一校；保留圖示、地址地圖、各校 BookingCta 與既有分校內頁連結。可手動切校及暫停；滑鼠進入閱讀／校名區、鍵盤聚焦、分頁隱藏或區塊離開畫面時停止，返回後續播。減少動態預設不自動播放；只發布一校時不啟動輪播。新增 `carouselClock.ts` 與 4 項計時測試，連同預約動作共 15 項通過；Chrome 四尺寸 × 五校 20 狀態與實際自動循環／暫停／鍵盤／減少動態通過，`web` typecheck 通過。結果與截圖：`output/playwright/campus-live/`。完整五校 fixture 預覽在 `http://127.0.0.1:3012/#campuses`（獨立暫存副本）；原 3010 的 live release 目前只有明華校，未更動 CMS 發布資料。原型重打包無差異。

2026-09-21：UX 審查的 P3 收尾（`admin/` 與 `backend/`）。案件列表新增家長姓名／電話搜尋：後端 `GET /admin/visit-requests` 收 `q` 參數，姓名用 `ilike`、電話用 `like`，使用者輸入的 `%` 與 `_` 會跳脫成字面值（否則一個 `%` 就撈出整個校區），比對接在既有校區權限之後，不會變成跨校查人的後門；前端搜尋框放篩選列最前面，停止輸入 300ms 才送出，查無結果的文案帶上關鍵字，清除篩選會一起清掉。手機版案件卡補上「參觀時間」，先前只有桌機表格有這欄，已確認的案件在手機仍看不到約在哪天幾點。手機搜尋框改占整行，原本被壓到 130px 導致提示文字被截。儲存即生效的兩頁補上區分：全站設定的搜尋引擎開關從兩側都有文字的 `el-switch` 改成單一勾選「暫時不讓 Google 收錄（上線前）」，說明改排在下方與其他欄位一致，儲存鈕從「儲存」改成「儲存並套用到官網」；該頁與各校預約方式的儲存鈕旁都加上一行「沒有草稿階段，儲存後官網立即套用」，共用 `style.css` 的 `.save-row`／`.live-note`。

驗證：後端 122 項 pytest（新增搜尋命中、萬用字元當字面值、跨校不外洩三項）、前端 16 項 vitest（新增搜尋延遲送出與 `q` 參數一項）、型別檢查與 `npm run contract:check` 通過。另起 8001 後端與 5175 前端對 `ivy_website_dev` 實測四筆案件：全部 4 筆、搜姓名 1 筆、搜電話片段 1 筆、查無結果文案、兩頁的立即生效提示、手機卡片的參觀時間與整行搜尋框，無 console 錯誤、390px 無水平溢出，截圖在 `output/playwright/admin-p3/`。驗證用帳號、四筆案件、時段已刪除，義華預約模式還原為暫停。CSV 匯出沿用原本的校區篩選，未跟著帶入搜尋關鍵字；列表排序仍固定為送出時間新到舊。

2026-09-21：側欄改成兩層（`admin/`）。原本「官網內容」是一個 11 項的大組，其中「首頁五校區塊／五校介紹／校園探索」名字都帶校區，攤在一起難辨認。現在拆成首頁（4 項）、分校頁（3 項）、全站與素材（4 項）三個各自可收合的子組，共用一個「官網內容」區段標題並縮排，`NavGroup` 新增 `section` 欄位；頁首麵包屑改顯示區段名，內容頁仍標「官網內容」。收合狀態存進瀏覽器（`ivy-admin-nav-expanded`），下次進來沿用，讀寫都包 try／catch，私密視窗讀不到就回預設。搜尋改成功能名優先：搜「素材」只給素材庫，功能名都沒中時才用分組或區段名比對，讓搜「分校頁」仍能看到整組。

驗證：15 項 vitest（新增兩層結構與收合記憶、搜尋優先序兩項，並把既有兩項對齊新的分組 id）、`vue-tsc` 型別檢查通過。jsdom 這個設定下的 `localStorage` 只是空物件，測試檔自備最小 Storage 實作，`afterEach` 清掉避免互相影響。Chrome 實測 1440px 的收合、全展開、重新整理後維持展開、搜尋、從內頁自動展開對應子組與麵包屑，以及 390px 抽屜：收合後整個選單一屏放得下，原本 20 項要捲才看得到「操作紀錄」。無 console 錯誤，截圖在 `output/playwright/admin-nav2/`。驗證用帳號已刪除，未改動任何內容或預約資料。

2026-09-21：官網後台第三輪，補上 UX 審查找到的 P0／P1 缺口（`admin/` 與 `backend/`）。P0：已確認的案件先前只存 `slot_id`，明細與列表都看不到「約在哪一天幾點」，櫃台接到家長來電答不出來。後端 `VisitRequestDetailOut` 新增 `slot`（`VisitSlotBriefOut`：日期與起訖），案件查詢、家長端換 session／讀自己案件的查詢全部補 `selectinload`，確認與改期改為指派 relationship，回應當下就帶新的參觀時間；前端明細標題下方顯示「參觀時間」，列表新增該欄，家長填的偏好改名「家長方便時段」以免混淆。P1：確認預約、發布內容兩個對外且不可回退的動作補確認對話框（寫明排給誰、哪一天、會寄通知／官網目前是哪一版），停用使用者改用就地 popconfirm。總覽補「今天的參觀」清單（誰、幾點、哪一校，點進案件）與草稿直達連結，後端 dashboard 新增 `today_visit_list` 與 `pending_publish_kinds`。另修 `style.css` 對 `.el-message-box` 只覆寫 `max-width` 導致對話框在桌機撐成整行的問題，全站確認框一併回到 420px 置中。

驗證：後端 119 項 pytest（新增參觀時間展開、總覽清單兩項測試，對真 PostgreSQL）、前端 13 項 vitest、`vue-tsc` 型別檢查、`npm run contract:check` 全部通過。另起 8001 後端與 5175 前端對 `ivy_website_dev` 實測：總覽今日清單、案件列表欄位、明細參觀時間、兩個確認對話框、停用就地確認、手機 390px 版面，無 console 錯誤、無水平溢出，截圖在 `output/playwright/admin-p0p1/`。驗證用帳號、案件、時段已刪除，義華預約模式已還原為暫停。未實機驗證：草稿直達連結（dev 資料當時沒有未發布草稿，由後端測試覆蓋）。側欄與總覽版面為同日第二輪的既有工作，本輪未改動。

2026-09-21：完整官網與後台首次部署至 Railway 獨立專案 `ivy-website-admin`：官網 `https://web-production-04caa.up.railway.app/`，後台 `/admin/`。建立獨立 PostgreSQL 及 API 素材 volume，初始化五校與 18 筆 CMS 內容；四校未定巡覽維持待補。新增 Docker 部署設定、同源後台 history 路由與不覆蓋既有草稿的內容初始化工具，並修復 admin lockfile 的 esbuild 解析不一致及 API 降權後的家目錄設定。上線版本為固定工作目錄快照，部署期間新增的其他本機修改未自動併入。預約預設暫停，搜尋索引與實際寄信未啟用。維運與部署資訊見 `deploy/README.md`；線上 HTTP／登入／素材上傳清理驗證在 `output/railway-smoke.json`，瀏覽器截圖在 `output/playwright/railway-*.png`。

2026-09-21：無線稿分校 B 版改為上方水平五校，搭配 IG 限時動態式分段進度與照片短淡入；由捲動或點校名控制，手機維持五校一列。沿用 `design/campus-fullscreen-20260921/stage.html?direction=b`，僅更新此 mock-up；新增的 `b-stories.css`／`b-stories.js` 不套用到 A／C 或線稿探索頁。四種尺寸共 28 個狀態、原生／備援進度 18 個位置及鍵盤／減少動態皆通過。

2026-09-21：官網後台第二輪 UI/UX 優化（`admin/`）。側欄加入功能搜尋與分組收合，官網內容分成首頁／分校頁／全站與素材，並記住收合狀態；搜尋沿用角色限制；900px 以下改用 Element Plus 抽屜，支援 Esc 與焦點還原。總覽調整為營運摘要、待辦提醒與常用工作。內容編輯補強草稿／發布說明、處理中鎖定與載入狀態；修正取消離開時分頁標題誤變。案件列表增加清除篩選、可鍵盤開啟的家長連結、手機清單及過時回應保護；素材庫加入檔名／說明搜尋、重試與空狀態入口。全站調整文字對比、表單高度及窄螢幕對話框。未儲存的瀏覽器驗證文字均已還原。

驗證：本次提交內容以獨立副本執行 14 項單元測試、型別檢查與 production build 通過；Chrome 實測桌機、1024px、390px 與 320px 的相關畫面，包含導覽搜尋、手機抽屜、未儲存離開／取消／還原、素材搜尋重設與上傳對話框；量測的 1024／390／320px 頁面無水平溢出。沒有送出草稿、發布、上傳或改動預約資料；案件／素材庫當時為空，實際有資料列表與 Safari／Firefox 尚未驗證。build 仍提示單一 bundle 超過 500 kB。原型語法檢查與重打包通過，`preview.html` 無差異。本機 `.env.local`（不進版控）將官網連結指向當下運行中的 `http://localhost:3010`。


2026-09-21：接續 B 滿版分校提案，新增 B4「建築融景」mock-up：線稿融入米白背景並銜接照片邊緣，五校照片與線稿同時切換；手機改為上下融合。入口 `design/campus-b-blend-20260921/` 可對照原版 B，仍為探索稿，未整合至 Nuxt 首頁。

2026-09-21：Railway 部署前檢查修正 `web/app/utils/paperPrints.ts` 的 nullable three.js 型別：保留載入失敗退回 CSS 的行為，在成功載入後保存非 nullable 的模組參照供內部函式使用。Node 22.23.2 下前台型別檢查、38 項單元測試及正式建置通過；後台正式建置與 7 項單元測試通過。原型語法檢查與單檔重打包通過，`preview.html` 無差異。

2026-09-21：使用者選定分校滿版捲動的 B「左右分景」，接續提供建築線稿三款位置比較：B1 左欄底景、B2 校名標記、B3 照片下緣圖帶，位於 `design/campus-b-lineart-20260921/`。線稿跟著五校切換，含桌機／手機預覽；本輪仍為線稿位置探索，尚未整合至 Nuxt 首頁。

2026-09-21：新增首頁分校區「滿版＋捲動切校」三款獨立 mock-up：A 全景換幕、B 左右分景、C 橫向校園長廊，位於 `design/campus-fullscreen-20260921/`。比較頁可切桌機／手機，各款可獨立滿版試滑；保留目前的圖示、地址地圖與無句號校名。尚未選定或整合至 Nuxt 首頁。

2026-09-21：Nuxt 首頁分校資訊帶依截圖修正：移除校名後的黃色句號，恢復校園位置、參觀專線、LINE 與 Facebook 圖示；將 Google Maps 動作整合至地址文字（底線與外連箭頭），移除預約下方獨立的「查看位置與路線」。沿用 B 版校名大小、三欄配置與手機單欄，僅修改 `web/app/components/CampusBoard.vue`。

驗證：Playwright 1440／1024／390／320px × 五校共 20 組，圖示顯示、地址隨切校更新、無水平溢出與鍵盤焦點通過；地圖另開分頁以本機攔截外部回應驗證。截圖與結果在 `output/playwright/campus-contact-*`。`node --check app.js`、原型打包與 `git diff --check` 通過，`preview.html` 重打包後無差異；`web` 型別檢查受既有 `paperPrints.ts` 的 `three` 可能為 null 錯誤影響。

2026-09-21：修正 Nuxt 首頁「常春藤的一天」背景影片播放中卻只顯示靜態封面的問題：`DayExperience.vue` 補上獨立的影片就緒狀態，在 `playing` 後套用 CSS 既有的 `is-ready` 淡入；暫停時保留目前影格，播放失敗時仍使用封面。Chrome 實測桌機與 390px 手機版的顯示、播放、暫停／恢復、捲離／返回皆通過；38 項單元測試通過。

2026-09-21（續）：翻面鈕再縮小，三方向比稿（`design/flip-button-mockup-20260921/`：A 迷你膠囊、B 圓形圖示鈕、C 角落貼籤）後使用者選 C：28px 高、4px 圓角、微歪 2°，淺色紙感毛玻璃（米白 72%＋`blur(12px)`）＋綠字，圖示移到字前，像貼在相紙角的標籤；翻到背面轉深綠 80%、歪向另一邊、圖示鏡翻；手機 26px 並用 `::before` 補到 44px 觸控範圍。`DayMomentCard.vue` 圖示與文字順序對調。截圖 `output/playwright/flip-glass/site-c.png`、`mobile-front.png`。

2026-09-21：Nuxt 首頁拍立得翻面鈕改毛玻璃（`web/app/assets/css/styles.css` `.print-flip`）：沿用首屏影片鈕與頁首膠囊的配方——墨綠 62% 底、`blur(16px) saturate(1.3)`、白色細框、徽章改半透明白；hover 底色加深到 78%、徽章轉金；翻到背面加深到 84%。偏好減少透明度時回退實色綠／深綠。Playwright 截圖 `output/playwright/flip-glass/`。

2026-09-21：Nuxt 首頁「常春藤的一天」拍立得翻面鈕改版（`DayMomentCard.vue`＋`styles.css` `.print-flip`）：文字箭頭「↻」換成 Phosphor `i-arrow-counter-clockwise` 圓形徽章，膠囊去硬邊線改貼紙感陰影、字級 11→12px 半粗；hover 徽章轉暖黃並微抬、按下徽章縮一下；翻到背面後整顆反白成深綠＋黃徽章、圖示水平鏡翻，狀態一眼可辨。拿掉與 `aria-expanded` 重複的 `aria-pressed`。減少動態與強制色彩模式同步補上。驗證：Playwright 1440／390 三態截圖 `output/playwright/flip-btn/`，無 console 錯誤。

2026-09-21：Nuxt 首頁（`web/`）展開導覽選單套用與頁首膠囊相同的深綠毛玻璃：墨綠 74% 不透明度、16px 背景模糊與亮色細框；保留導覽、五校與電話排版。不支援背景濾鏡或使用者偏好減少透明度時，回退實色綠底。選單最大寬度保留左右各 16px，修正手機被原有 420px 最小寬度裁切的問題。

2026-09-21：Nuxt 首頁（`web/`）「孩子的一天」拍立得改用比稿 R 的 three.js 紙張翻面（`web/app/utils/paperPrints.ts`＋`DayMomentCard.vue`）：翻面時紙張彎曲抬升、光影與游標微傾、顯影在貼圖裡進行。單一 WebGL context、貼圖樣式從 DOM 取、減少動態／無 WebGL 退回 CSS 版；three 0.186 為 `web/` 新依賴、延遲載入。vanilla 原型與 `preview.html` 不動。規則見 `DESIGN.md`「Nuxt 版改用 WebGL 紙張翻面」。

2026-09-21：Nuxt 首頁（`web/`）「常春藤的一天」補回原型的捲動行為：拍立得列表靠近時大標與 kicker 淡成底紋（`--word-fade` 從 1 降到 .16，對齊 app.js 的 `fadeBehindContent()`），並標出讀者停在哪一段讓該張相片時間戳亮起（`is-active`，對齊 `markActive()`）。改在 `DayExperience.vue`／`DayMomentCard.vue`，CSS 原本就有留 `opacity:var(--word-fade,1)`。

2026-09-21：Nuxt 首頁「近期活動／最新消息」移除三張活動卡及「所有活動／所有最新消息」的斜箭頭，採純文字與細底線，保留整卡點擊、鍵盤焦點及既有捲動換色。

2026-09-21：官網後台（`admin/`）整體 UI/UX 改版。原本 `style.css` 仍是 Vite 範本（紫色強調、18px、`#app` 置中加邊線），頂欄塞了 11 個連結，校區／狀態／角色都顯示原始代碼。現在：淺色主題、品牌深綠當 Element Plus primary、暖黃只用在「有未儲存或未發布」狀態；左側分組側欄（總覽／參觀預約／官網內容／系統）＋頂欄，900px 以下收成抽屜；`admin/src/api/labels.ts` 集中中文標籤與台北時區時間格式；十個內容編輯頁共用 `ContentEditor` 外殼（狀態列、載入骨架、黏底動作列、「儲存並發布」、還原修改、未儲存離開攔截）；分校內容切校前先確認；案件列表／明細／時段／通知／統計／稽核／素材庫全部改中文狀態、空狀態與確認對話框；素材庫改網格＋拖曳上傳。單元測試 `admin/src/__tests__/`（vitest，7 案例），Playwright 截圖與互動驗證在 `output/playwright/admin-ux*`。改前快照 `versions/before-admin-ux-20260921-152825/`。根目錄 vanilla 站與 `preview.html` 未動。

2026-09-21：首頁分校資訊帶採用使用者選定 B「校名主場」：放大 LINE Seed 校名、暖黃句點、低調地區與英文副標，聯絡資訊收成一欄，社群退為文字連結，預約按鈕採暖黃膠囊；手機改單欄。保留照片、切校與 BookingCta 設定，原型不回寫。


2026-09-21：Nuxt 首頁（`web/`）的「分校資訊 → 近期活動／最新消息」改為捲動連動的垂直換色。配色採用使用者選定的 A「霧藍（#DCE7EB）＋暖白（#FAF7EF）」：霧藍由上往下滑入暖白底，搭配深綠文字；同一道水平邊界掃過活動卡時，卡片同步由上到下換成暖黃／嫩綠／霧青。往上捲時效果退回，取代先前每張卡依滑鼠方向滑動的方式。原生 CSS view timeline 優先，不支援時用 passive scroll＋requestAnimationFrame；手機亦可捲動操作，減少動態與高對比模式使用靜態版。保留照片、整卡點擊與消息視窗。根目錄 vanilla 與 `preview.html` 維持已凍結原型，這次預覽請啟動 `web/`。

2026-09-18（晚）：頁首品牌的 30 週年版三個方向比稿在 `design/anniversary-directions/`（a 印章／b 第三行年份／c 上標小籤），1997 創校、2027 滿 30 年；都跑在主站真實頁首上，用 `index.html?anni=a|b|c#/home` 切換，膠囊與手機共用校徽右下角的金色「30」小點。「週年」兩字另切了 `assets/fonts/noto-sans-tc-600-anni.woff`。

2026-09-18（晚）：首屏那顆「預約參觀」CTA 改成**金色滿高色塊、貼齊視窗右緣、左下 44px 弧**（比稿代號 d9，已上站）。原本它和四個導覽項共用同一套雙行排版、只多一個框，會被讀成第五個導覽項，圖示還用了語意相反的打勾；現在與捲動後的黃膠囊同色，整條動線只剩一種長相，圖示換成日曆勾。貼邊是把 `.header-top` 在 901px 以上改成滿版、左邊補回 gutter，900px 以下退回金色膠囊（手機右邊還有漢堡）。同日把分校頁與預約頁也換成同一顆（原本是綠色圓角鈕），全站頁首現在只有一種預約鈕；人在預約頁時該連結帶 `aria-current="page"`。兩輪比稿（a–e 選色與形制、d1–d12 形狀、可調版 dx）的截圖與取捨留在 `design/book-cta-directions/`，`?book=` 參數與調校頁已隨定案移除。單檔 `preview.html` 已同步。

2026-09-18：首頁捲過首屏後，整條頁首讓位給置頂居中的深綠膠囊（校徽＋校名、選單、暖黃預約參觀），導覽四項收進膠囊的選單卡；只作用在首頁，分校頁與預約頁維持原樣。膠囊底色選深綠是因為首頁捲過首屏後的背景全是淺色，米白膠囊的邊界對比只有 1.0–1.4。三個方向的比較與大小／顏色調校頁在 `design/header-collapse-directions/`，規則見 `DESIGN.md`。單檔 `preview.html` 已同步；改前快照 `versions/before-header-pill-20260918-083004/`。同日修正膠囊「選單」文字被站內 `.menu-toggle span` 壓成白條的跑版，並依園方「置中太突兀」的回饋做了五種擺法比較（`design/header-collapse-directions/placement.html`，`index.html?pill=…` 可切），園方選定**整顆靠右**，已套成預設（右緣貼內容欄右緣）；其餘擺法保留為 `?pill=` 預覽參數。收合時機同日再改為**往下捲第一步（40px）就收**，不再等整段首屏揭幕結束；首屏頂部為導覽字而設的暗帶同步收掉，膠囊才不會融進照片。另做了「向下捲收起、向上捲出現」的 mock-up（`design/header-collapse-directions/autohide.html`，`index.html?autohide=1` 可切，含並排即時預覽與對照 GIF），同樣尚未套成預設。

2026-09-17：首頁已套用「首屏向上揭幕」轉場與淡綠品牌介紹。依上午回饋，品牌區改為左文右圖並放大照片，修正舊有 740px 最小高度與 680px 停用門檻造成筆電 100% 縮放無動畫的問題。下滑時影片與標語縮淡，再揭開「把每個孩子，放在心上」；手機縮短轉場，減少動態或首屏內容實際超過畫面時維持一般捲動。單檔 `preview.html` 已同步更新；原提案留在 `design/scroll-reveal-mockup/`。
2026-09-17（晚）：導覽列離開首屏後收進漢堡選單的三個互動 mock-up 在 `design/header-collapse-directions/`（A 同組收合、B 浮動膠囊、C 極簡列＋全幕選單），比較頁可切桌面／手機、跳狀態、模擬減少動態；截圖在同目錄 `shots/`，可分享的 Artifact：https://claude.ai/artifact/KwzBCVQSYgew8XB5cmbGhm 。使用者選 B 後另做 `b-tuning.html`：膠囊三檔尺寸×四種色調疊在真實首頁背景條上比較（附對比度）。**深綠 × M 已於 2026-09-18 套用主站**。


2026-09-16：分校資訊已套用 B「全幅橫景」版面，上方寬幅校舍照片，下方整合校名、聯絡方式、預約與小地圖。五校線稿放在標題右上並同步切換，移除樹木圍牆裝飾；手機改為直向排列。照片與線稿已內嵌到單檔預覽。提案在 `design/campus-layout-mockups-20260916/`、線稿來源在 `design/campus-line-art/`，設計規則見 `DESIGN.md`。

直接開啟 `preview.html` 即可預覽，照片、logo、CSS 與 JavaScript 都已內嵌，不需要安裝套件。外部官網、電話與地圖連結仍依裝置及網路運作。

可維護版本為 `index.html` + `styles.css` + `app.js` + `assets/`，可直接開啟 index.html 或執行：

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory /Users/yilunwu/Desktop/ivy-website-prototype
```

再瀏覽 http://127.0.0.1:8765/ 。這是本機預覽，尚未發布網站。

## 版控

本專案使用 Git，主分支為 `main`。程式碼、素材、設計文件與 `design/` 提案均納入版控；`versions/` 保留導入 Git 前的歷史快照，之後的修改以 commit 記錄。

`preview.html` 是供直接開啟的單檔交付版，也納入版控。修改網站原始檔後，請重新打包，並把原始檔與單檔版一起提交：

```sh
node --check app.js
python3 package_preview.py
git status --short
git diff --stat
git add <本次修改的檔案> preview.html
git diff --cached --stat
git commit -m "說明本次修改"
```

`git add` 中的 `<本次修改的檔案>` 請替換為實際路徑。可用 `git log --oneline` 查看版本紀錄；開新工作前可用 `git switch -c feat/功能名稱` 建立分支。

`.gitignore` 排除本機工具設定、瀏覽器紀錄、`output/` 畫面記錄、快取與環境私密設定。初始設定為本機版控；遠端位置可用 `git remote -v` 查看。

## 已製作

- 左上完整原始 logo、右上預約入口、手機導覽。
- 影片封面、品牌介紹、孩子的一天、分校資訊、A 版近期活動與最新消息，接續頁尾。
- 影片首屏與淡綠品牌區之間的捲動揭幕；原生 CSS 動畫優先，未支援時使用 JavaScript 備援。首屏完全離開時暫停影片，回來時保留使用者的播放／暫停選擇。
- 義華、明華、崇德、國際、仁武各自的介紹頁、官方照片、地址電話、Google 地圖連結。
- 獨立預約頁，先選校、再填寫聯絡資料；從校區進入會自動帶入該校。
- 表單驗證、返回修改、更換校區、示範結果；不發送請求、不存入 localStorage。
- 照片放大，鍵盤 Esc 關閉後將焦點還給原按鈕。

## 待補內容與限制

- 使用者尚無影片。目前呈現義華校照片，並標示「影片封面示意」。不顯示假的播放按鈕。
- 要換影片：將影片放在 assets/，把 app.js 頂部 `HERO_VIDEO_SRC` 設成例如 `assets/campus-film.mp4`。已有靜音、暫停／播放、載入失敗封面，以及減少動態偏好處理。實際影片與各裝置播放相容性需在素材提供後再驗收。
- 五校基本地址、電話、外觀照片取自官方；各校詳細課程、招生名額、收費、參觀時段仍待園方提供。沒有把義華課程或照片當成其他校區資訊。
- 首頁品牌標語是設計提案文案，正式使用前請園方確認。
- 預約只顯示測試結果，不寄信、不連資料庫、不建立實際預約。
- 已於瀏覽器桌面、平板、手機尺寸驗證；尚未於實體 iPhone / Android 做裝置驗收。

## 來源

- 使用者提供：原 prototype `/Users/yilunwu/Downloads/preview.html`、完整常春藤 logo 圖片。
- 常春藤義華校：https://www.ivykids.tw/ （首頁生活照片、教育理念、活動與校園環境）
- 常春藤機構：https://www.ivykidschool.com/ （五校地址電話、明華／崇德／國際／仁武照片）
- 首頁影片呈現參考：https://seasonarts.org/ ，沒有使用其影片或品牌素材。
- 下載照片已轉為 WebP，照片來源見 assets/sources.json。

## 驗證記錄

- JavaScript 語法檢查通過。
- 首頁 375 / 390 / 768 / 1024 / 1440px 無水平溢出。
- 375 / 768 / 1440px 校區頁、選校頁、填表頁無水平溢出。
- 五校路由、各校圖片、各校自動帶入預約入口通過。
- 選校→填表→預覽→修改→更換校區流程通過。
- 無效輸入阻擋、手機空格與連字號正規化、離開後資料清除通過。
- 手機選單展開／關閉、相簿 Esc 關閉／焦點恢復通過。
- 操作檢查中未發現 JavaScript runtime error。

畫面記錄位於 output/playwright/。修改可維護版後，執行 `python3 package_preview.py` 重新產生單檔版本。

## 新增：孩子的一天

首頁「校園生活」現在會進入六片刻的互動故事。直達連結：`#/home/life`。
- 六階段：早安入園、好奇探索、一起用餐、安靜片刻、午後玩耍、帶故事回家。
- 2026-09-18 關於常春藤與孩子的一天之間加了第二道區塊簾幕：往下捲時關於區塊停住並由下往上被擦掉，露出孩子的一天（與首屏 → 關於同一種切換）。
- 2026-09-18 改為拍立得顯影版（`design/day-timeline-directions/` 比稿的 Q 版）：固定影片背景、sticky 大字「常春藤的一天」隨相片靠近淡成底紋、六張隨捲動顯影的相片，點相片或按鈕翻到背面看故事與家長提問。時刻改用官網一日流程。備份 `versions/before-day-polaroid-20260918-160145/`。
- 2026-09-16 曾為橫向文字分頁與開放式圖文雙欄（已被上一項取代）。
- 方向鍵與 Home / End 可切換分頁，Tab 進入故事內容。
- 用餐／午休使用義華教室照片作空間參考並標示待補；日常文字為情境提案，不代表已核定作息。
- 新版的照片及標題起點保持穩定；問答展開不會拉長照片。手機文字分頁可橫向滑動，選取項目會保持可見。
- 2026-09-16 驗證：320／375／390／768／1024／1440px 無橫向溢出，六個片刻面板高度差為 0；問答展開照片尺寸不變，所有主要控制項至少 44px。Home／End、方向鍵、Tab、最後一段返回早安入園正常，`preview.html` 同步重新打包。
- 改版前單檔保存在 `versions/before-day-experience.html`。
- 本次文字分頁改版前備份：`versions/before-day-editorial-20260916-104150/`。

## 2026-09-10 技術審查與打磨

以 impeccable audit 搭配 Playwright + axe-core 掃描六個頁面（首頁、孩子的一天、義華校、仁武校、預約選校、預約填表）× 三種視口（375 / 768 / 1440）。改版前單檔保存在 `versions/before-audit-polish.html`。

修正內容：
- 預約表單「孩子年齡」少了「2 歲以下」選項（缺 `<option>` 標籤），已補上。
- hero 由固定 `height` 改為 `min-height`，文字放大或字級放大時不再被 `overflow:hidden` 裁切；各視口高度與改前一致。修正小於 400px 時校區頁 hero 被首頁規則蓋成 550px 的 cascade 問題，回到設計值 420px。
- axe：`tour-detail` 的 `<aside role="tabpanel">` 改為 `<div>`；校區頁聯絡面板的 `<aside>` 改為 `<div>`（不再是巢狀 landmark）；照片拖曳區補 `role="group"`。三項違規歸零。
- 觸控範圍補到 44px：FAQ 摺疊列、校區卡片標題與電話／認識校區連結、麵包屑、校區頁電話、頁尾原官網連結、頁尾五校連結。
- 字級底線：圖說、頁尾、麵包屑、步驟列、校區標籤、提示文字由 10–11px 提到 12–13px；小螢幕預約按鈕字級 13px。
- 首頁與校區頁 hero 圖片加 `fetchpriority="high"`，`index.html` 預載首頁 hero 圖（單檔版打包時自動移除）。
- 色彩 token：新增 `--ink`、`--mint`、`--error`、`--trail`、`--trail-visited`，取代散落的 rgba 與 oklch 字面值。
- 「孩子的一天」改用固定存在的 sr-only 即時區域播報切換結果（原本的 aria-live 隨面板重繪而失效）。
- 校區卡片改為 flex 直排，電話列固定貼底，地址換行時各卡對齊。
- 手機號碼欄位補 `title`，瀏覽器驗證提示會說明格式。

- 首次繪製時 `main` 仍是空的，頁尾會先貼在頁首下方、等 app.js 渲染後再被推開，桌機量到 CLS 0.42。`index.html` 以一行 inline script 標記 `html.js`，CSS 讓尚未渲染的 `main` 撐滿一個視口高度；無 JS 時維持原本頁首／頁尾／提示的順序。

驗證：18 個頁面／視口組合 axe 違規 0（僅剩文字疊圖的 color-contrast 需人工判讀，已目視確認）；無水平溢出；載入與滾動全頁 CLS 皆為 0；單檔 `preview.html` 以 file:// 開啟無 console 錯誤、資源全數內嵌、年齡選項 6 個。
- 中文優先：15 處英文段落小標改為中文（認識常春藤、五校介紹、教育理念、孩子的一天、校園探索、校園活動、參觀前的問題、預約參觀、參觀須知、交通與聯絡、示範結果等），導覽列英文副標移除，校區資料不再需要英文名。
- 箭頭收斂：↗ 只留給外部連結（原官網、活動頁、Google 地圖），→／← 只留給表單步驟與片刻切換；校區卡片移除重複的 ↗ 圖示連結（原本一張卡有四個連到同一頁的連結）。
- 圖示：導入 Phosphor Regular 共 24 個圖示，內嵌 SVG sprite（約 9KB），取代原本的 ↗ ↓ → ← ↺ ⛶ ✓ 等字元；電話、地圖、預約、片刻時間軸、照片探索工具列、表單步驟都有對應圖示，並統一按鈕內圖文間距。

## 字型方向提案

三個方向並排的設計畫布已儲存為私密連結，見 `design/font-directions/README.md`（含連結、子集化字型與產生器）。園方選定後再把字型接進站內。

「關於常春藤」區塊（2026-09-15）：三個方向的畫布在 `design/believe-directions/`（含連結與產生器），採用左文右圖版並已實作進首頁；未採用的方向保留在畫布第二頁。

園方於 2026-09-10 選定方向 B：標題改用 LINE Seed TW（Bold 700、hero 800），字型子集放在 `assets/fonts/`（含說明與重新產生指令），頁尾註明字型來源；`package_preview.py` 會把字型內嵌進單檔版。


## 2026-09-14 主視覺審查與優化

對首屏主視覺做了一次設計審查（兩份獨立評估：人工設計審查＋`impeccable detect` 自動掃描），啟發式合計 24/40。結論是版型沒問題，問題在「深色影片 hero」的模板反射把真實校園照壓成陰天。以下為已執行的修正，規則同步寫進 `DESIGN.md`。

**遮罩（P1）** `.studio-hero::before` 從「左側 78% 全黑橫幅」改為三條分別對應頁首、底部說明列、左側文字欄的帶，全部改用 `--ink` token。孩子所在的右側恢復全日光。桌面白字對真實照片的平均對比實測：導覽 5.78、eyebrow 4.65、預約鈕 5.01、副標 6.08、標題 5.07，全部過 4.5:1（先前導覽 4.14、eyebrow 4.08、預約鈕 3.55 未過）。

**手機（P1）** 原本 1440×578 的橫幅照被拉進 390×844 的首屏，只露出原圖寬度 19%、放大 1.46 倍，孩子的臉被切半；且白色制服正好落在文字位置，副標對比只有 2.66，加厚遮罩救不回來。改為照片佔上方一帶、下緣淡入深綠，文案與說明列落在 `--deep` 面板上：

| 指標 | 修改前 | 修改後 |
|---|---|---|
| 可見原圖寬度 | 19% | 46% |
| 照片縮放 | 放大 1.46× | 縮小 0.6× |
| 副標對比 | 2.66 | 13.8 |
| 頁首對比（壓在照片上） | 3.36–4.25 | 5.55–6.36 |

**主次（P1）** hero 主鈕改為實心暖黃配深綠字（9.65:1），文案改「預約來校園走走」，明說是預約；頁首「預約參觀」維持白框幽靈鈕當重複入口。焦點環有 5px offset，落在按鈕外的深色底上（13.97:1）。

**文案（P2）** 刪除第四句標語 `.hero-note`；底部左側從「在生活裡探索，在陪伴中成長。」改為「五所校園：三民 · 左營 · 鳥松 · 仁武」，回應想比較校區的家長；移除 `max-width:14ch`（原本在手機折成「在生活裡探索，在／陪伴中成長。」）。

**字型（P2）** `.studio-hero h1` 的 `font-weight` 從 700 改回定案的 800（`lineseed-eb.woff` 原本預載卻沒有任何規則用到），行高 1.55 收到 1.3。

**狀態（P1）** `#media-caption` 只在 `video` 的 `playing` 事件後才改成影片文案。先前海報狀態下畫面是孩子、文字卻寫「自然花草 · 示範影片」。自動播放除 `saveData` 外也擋 `effectiveType` 為 2g／3g。已實測減少動態情境：影片暫停、圖說維持「義華校 · 生活影像」、提供播放鈕。

**版面** `.studio-hero-grid` 的 `padding-block` 改 `clamp(28px,5vh,56px)`。1280×800 與 1440×900 實測 hero 皆收進一屏，暫停鈕不再被推到摺線下（先前在 y=746 與 y=777）。

**細節（P3）** 移除 eyebrow 的裝飾圓點與死碼 `.paper-sun`／`.hero-sprout`／`.studio-hero-image figcaption`；漢堡鈕線條 1px×20px 改 2px×22px 並加上與預約鈕相同的白框；頁首與底部分隔線透明度統一為 .6；hero 內的 `rgb(0 0 0 / a)` 與 `#fff` 字面值全改為 token。

**打包器** `package_preview.py` 原本只內嵌 `styles.css`，`studio.css` 完全沒進 `preview.html`，等於打包出來的單檔預覽沒有工作室主題。已修正並重新產生 `preview.html`（已實際載入驗證）。

**尚未處理（需園方素材）** 海報原圖僅 1440px 寬，正式版建議至少 2400px，並另拍一張直式校園照供手機使用；首屏影片已改用園方廣告片剪出的 `assets/hero-campus.mp4`（1080×800、11.7 秒、2.5MB），來源與剪法見 `design/hero-video/build.sh`；正式版仍建議提供無字幕、無浮水印的 1920×1080 原始素材重剪。

## 五校介紹加地圖與社群（2026-09-15，已採用方向 B）

首頁五校卡片與各校「交通與聯絡」頁加入 Google 地圖、LINE 官方帳號、Facebook。三個呈現方向的比較頁仍留在 `design/campus-directions/`（A 地圖清單／B 卡片加地圖抽屜／C 校區分頁）供參考；使用者選定 **B 卡片加地圖抽屜**，已實作進站：

- 首頁五校卡片新增電話下方一列：LINE、Facebook 圓形圖示 + 地圖按鈕；按地圖，卡片下方展開抽屜（免金鑰的 Google 地圖單點嵌入、LINE／Facebook 大按鈕、預約入口）。桌機預設展開義華校；手機需要點擊才展開，且會插在被點的卡片正下方。
- 各校內頁「交通與聯絡」（`#/校區/contact`）從純文字連結改為內嵌 Google 地圖 + LINE／Facebook 按鈕。
- 地圖 iframe 進到視口附近才載入（IntersectionObserver + `data-src`），避免 Google 的 embed 搶走頁面焦點與捲動位置。
- **資料缺口**：只查到義華校的 LINE（`lin.ee/gwl8fnA`）與粉絲專頁（`facebook.com/ivy.kids.fb`）；明華、崇德、國際、仁武的 LINE 官方帳號與各校粉專未查到，畫面上 LINE 以虛線「帳號待補」呈現、Facebook 暫時指向常春藤機構粉專（`facebook.com/ivykid`），不冒用義華帳號。**請園方提供四校的 LINE 與粉專連結，補進 `app.js` 的 `campuses` 物件（`line`／`facebook`／`fbNote`）。**
- Google 地圖目前是免金鑰的單點嵌入，一次只顯示一所；若要五校同框，需園方用 Google「我的地圖」建圖或申請 Maps API 金鑰（見 `design/campus-directions/README.md`）。

## 五校入口重排（2026-09-16）

依設計回饋把首頁「五校介紹」從五張聯絡資料卡改成真正的校園入口；mock-up 畫布 https://claude.ai/artifact/8PpG9rz5rc5UV1VaHfoGas ，工作檔在 `design/campus-entry-mockup/`。

- 五校同寬入口只留照片（4:3、逐張決定裁切位置）＋校名＋地區，整塊是一個連結；地址、電話、社群圓鈕、地圖按鈕、短橫線全部移除，校名不加箭頭。
- 下方常駐「校區位置與聯絡資訊」：校區 tab（滑鼠、方向鍵、點地圖圖釘都能切換）、地址電話、「預約參觀Ｘ校」主鈕、LINE／Facebook 文字連結、五校位置示意地圖（選校放大該校圖釘），右上角「規劃路線」開 Google 導航。沒有收合／展開列，也沒有關閉叉叉。
- 社群圖示重做：36px 細框圓徽章＋標題＋小字說明，取代原本的彩色圓鈕與大膠囊；各校內頁「交通與聯絡」同步換用。
- 首頁的 Google 地圖 iframe 改為 SVG 示意圖（座標來源 `design/campus-directions/`，只留視窗內 14 區，約 10KB）；各校內頁仍保留 Google 單點嵌入。
- 驗證：1440px 無水平溢出、tab／方向鍵／圖釘切換與路線連結同步、無主控台錯誤；`preview.html` 已重新打包。改前快照 `versions/before-campus-directory-20260916-140939/`。規則寫在 DESIGN.md「五校入口重排」。

## 五校分區輪播上站（2026-09-16 下午）

使用者在畫布 https://claude.ai/artifact/8PpG9rz5rc5UV1VaHfoGas 第三頁先選 A3，再改為 **A2 版面＋單一長橢圓軌道**（15:34 定案），並指定照片多些圓角；已照最終版改進首頁，取代中午上站的五校目錄版。

- 標題與引言置中；「← 選校軌道 →」置中：五校在同一條淡灰米底的長橢圓軌道裡，選中的是實心綠膠囊；不分地區（15:38 拿掉地區小標與分組線）。
- 左大照片（4:3、24px 圓角、逐校裁切）＋校區介紹句；右欄先 240px 示意地圖（16px 圓角），再校名地區、地址電話、「預約參觀Ｘ校」主鈕與「認識Ｘ校」校區頁入口、LINE／Facebook 徽章。手機軌道滿版，上一／下一校改到照片圖說列右側。
- 切換：軌道 tab 鍵盤操作、上一／下一校首尾循環、點地圖圖釘；照片預載後 200ms 淡入淡出，減少動態直接換，手動切換時 aria-live 播報目前校區。每 6 秒自動循環五校，依使用者要求移除暫停／播放鈕。滑鼠停留、鍵盤焦點位於區塊內、觸控按住、離開可視範圍或背景分頁時暫停；結束操作後重新計滿 6 秒繼續。減少動態效果時不自動播放。
- 打包器改為替換 `photoSrc` 單一定義；`preview.html` 已重打包，照片、字型皆內嵌。
- 驗證：1440px 與 390px 無水平溢出、無主控台錯誤；tab／方向鍵／上一下一校／圖釘切換後照片、介紹、資訊、地圖、路線、播報全部同步。改前快照 `versions/before-campus-carousel-20260916-152420/`（目錄版）與 `versions/before-campus-a2-20260916-153422/`（A3 版）；規則在 DESIGN.md「五校分區輪播」。


## 最新消息 A 版（2026-09-16）

- 已套用到首頁 `#/home/latest-news`，位置在分校資訊後，接續頁尾；導覽列與頁尾均有最新消息入口。
- 桌面左側三個活動日期卡、右側三則圖文消息；手機改為上下排列，消息使用縮圖加標題。配色、字型與間距延續選定的 A 版。
- 點擊消息或活動會開啟詳情；「所有活動／所有最新消息」提供完整範例清單，可返回清單、Escape 關閉並還原焦點。切換路由時視窗會關閉。
- 消息、日期、活動皆為示意；既有校園圖像不代表該則消息實拍。正式資料待園方提供，沒有報名送出或後端串接。
- `app.js` 的 `homepageNews` 集中管理資料、版面與視窗；`studio.css` 的 `.home-news` / `.hn-*` 為專用樣式。圖片透過 `photoSrc` 內嵌，`preview.html` 已同步打包。
- 五方向比較仍保留於 `design/news-directions/`，首頁情境模式可繼續比較其他方向。
- 驗證：首頁與單檔版各 7 種寬度（1440、1100、1024、901、768、390、375px）皆無水平溢出、破圖或 JavaScript 例外；詳情、返回清單、Escape 焦點、路由往返均通過，單檔版無本機 assets 請求。實際截圖：`output/playwright/home-news-a-{desktop,mobile,context}.png`。

## 首頁收尾調整（2026-09-16）

依園方要求，首頁暫時移除 FAQ 與底部「親自走一趟」預約橫幅，最新消息後直接接頁尾；導覽列的「參觀須知」與頁尾的「常見問題」連結同步移除。頁首預約參觀、預約表單及各分校頁面保留原有功能。`preview.html` 已同步更新。


## 關於常春藤 B2（2026-09-17 定案）

首頁 `#/home/about` 已套用 `design/b-layout-extensions/b2.html` 的錯落雙照片版：保留 SINCE 1997、主標與加長的單段介紹，移除內容上方重複的「關於常春藤」小標。淡綠底上的裝飾大字改為「關於／常春藤」。

背景在導覽列下方固定，文字與照片跟隨頁面捲動；離開此區才一起帶走背景。依園方追加要求，內容上方再留 `32svh`（180–360px）背景，1440×900 時增加 288px；手機使用 `24svh`（160–240px）。既有首屏揭幕效果保留，單檔 `preview.html` 已同步。

驗證：Chromium 100% 視窗尺寸 1920×1080、1440×900、1280×650、1024×768、901×700、768×1024、390×844、375×667、320×568、720×450 無水平溢出、破圖或 JavaScript 例外。捲動 120px 時，背景大字位移 0、主標位移 -120px。原生及模擬不支援 scroll timeline 的 fallback、減少動態、導覽與校區連結往返皆通過；減少動態停用揭幕及背景固定，內容仍完整可讀。Hero 內容高於視窗時維持既有正常閱讀模式。Safari／Firefox 尚未實機驗證。

截圖位於 `output/playwright/home-belief-b2/`。整合前備份：`/private/tmp/ivy-before-belief-b2-20260917-105629/`。
