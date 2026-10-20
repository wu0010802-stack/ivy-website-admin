# 附近同業：裁罰明細與評鑑結果（C 案，2026-10-20）設計

日期：2026-10-20
狀態：已實作（分支 `feature/admissions-data-20261020`，未部署；§8 實作紀錄）。使用者 10-20 要做（`docs/specs/2026-10-15-peer-comparison-design.md` §1.3 留下的 C 案；「裁罰明細放進後台要另外核可」＝使用者 10-20 這次的要求）。以下裁定是我的預設值，業主可改。
基準：`origin/main` `817d516d`
分支：`feature/admissions-data-20261020`（與場次使用情況小修、預售建案同分支，各自分 commit；migration 接在預售建案之後）

## 1. 目標

「附近幼兒園」目前只有「有裁罰紀錄」旗標、沒有評鑑。補上：

1. 每所園所近 3 年裁罰：件數、最近一次日期、處分種類與金額、違規條文與事由。
2. 每所園所最近一次評鑑：學年度、完成日、結果；展開看歷次。
3. 本校（五校）照樣顯示——自己的紀錄園方也該知道。

只在後台；不做分數、不排名、不做「最多裁罰」排行。

## 2. 資料來源（2026-10-20 實測）

| 項目 | 內容 |
|---|---|
| 裁罰 | kiang `ap.ece.moe.edu.tw` 的 `docs/data/punish/高雄市/<園所名稱>.json`，Pages 網址 `https://kiang.github.io/ap.ece.moe.edu.tw/data/punish/高雄市/<urlencode(名稱)>.json`。每檔是陣列的陣列：[0] 日期 `YYYY/MM/DD`、[1] 裁處文號、[2] 法條（含修正日）、[3] 違規條文＋事由（有時只有條號）、**[4] `負責人：姓名`／`行為人：姓名`（個資，丟棄）**、[5] 處分（`罰鍰：N元`／`停止招生：起~迄`／`減少招收人數：起~迄`／`停辦：起~迄`）、[6] 選填的裁處當時園所全名。高雄 238 檔、571 筆（2018-10～2026-10），近 12 個月 98 筆、49 所。kiang 約每 1–2 週更新 |
| 裁罰檔名單 | Pages 沒有目錄清單；用 GitHub API `GET https://api.github.com/repos/kiang/ap.ece.moe.edu.tw/contents/docs/data/punish/%E9%AB%98%E9%9B%84%E5%B8%82`（未驗證 60 次／小時，一次就夠）取檔名。`punish_all.json` **不讀**（以人名為鍵，10-08 規格已排除） |
| 評鑑 | 教保資訊網公開搜尋 `https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx`：GET 取 `__VIEWSTATE` 等隱藏欄位 → POST（`ddlCityS=18` 高雄、關鍵字空白、`btnSearch=搜尋`）→ 換頁 POST `__EVENTTARGET=PageControl1$lbNextPage`。全高雄 689 所、每頁 10 所、69 頁、每頁約 300 KB。**沒有驗證碼**。每所結果區塊有「評鑑情形」表（學年度、評鑑完成日、評鑑結果，另有「檢視」連結）。同區塊另有負責人姓名與電話 → **只解析評鑑表，其他欄位不讀**。結果值見過四種：全數指標通過基礎評鑑、部分指標通過基礎評鑑、全數指標通過追蹤評鑑、全數指標改善完畢（不保證窮盡，原文照存） |
| TLS | 本機 Python 對 ap.ece.moe.edu.tw 報 `CERTIFICATE_VERIFY_FAILED`（伺服器疑似沒送中繼憑證），curl 正常。**不關閉驗證**：用 `certifi` 加上一份隨程式提交的中繼憑證（實作時從伺服器鏈或 TWCA 官網取得，寫在 `backend/app/admissions/geo/certs/` 並註明來源與到期日）；仍失敗 → 走打包退路 |

## 3. 實作裁定

| # | 事項 | 裁定 |
|---|---|---|
| C1 | 裁罰存哪些 | `geo_kindergarten_penalties`：園所 `source_id`（對不到為空）、檔名園所名稱、裁處日、裁處文號、法條、違規內容（[3] 原文，最多 300 字）、處分種類（罰鍰／停止招生／減少招收人數／停辦／其他）、金額（罰鍰才有）、期間起迄（其他三種）、**對象類別**（`operator`＝負責人、`staff`＝行為人，只存類別、不存姓名）。唯一鍵（園所名稱、裁處日、文號、法條、處分原文的雜湊） |
| C2 | 對到園所 | 檔名＝`geo_kindergartens.title` 精確比對；對不到再用 [6] 園所全名；仍對不到存 `source_id` 空（已停辦或改名，畫面不出現，但保留） |
| C3 | 一件 vs 一筆 | 同（園所、日期、文號）多筆＝一件；畫面「件數」以件計，展開列出每筆 |
| C4 | 對象類別的顯示 | `staff` 顯示為「教保人員個人受罰」，不寫人名；`operator` 顯示為「園方受罰」 |
| C5 | 評鑑存哪些 | `geo_kindergarten_evaluations`：`source_id`、園所名稱、學年度（民國）、完成日、結果原文。唯一鍵（名稱、學年度、結果）。「檢視」連結的參數是 session 加密值，不存 |
| C6 | 評鑑對到園所 | 搜尋結果的園所名稱＝`title` 精確比對；對不到不存 |
| C7 | 同步頻率 | 新 dataset `kindergarten_penalties`（每 7 天）、`kindergarten_evaluations`（每 30 天），`WEBSITE_GEO_AUTO_SYNC` 開著時跟在幼兒園同步之後；都加進 `DATASETS` 與 DB 約束 |
| C8 | 換版門檻 | 裁罰：這輪檔名清單少於表內園所數 80%（表內 ≥50）或下載錯誤（非 404）>10% → 不換。評鑑：抓到的園所數 <600 或頁數 <60 → 不換。都寫 `last_error`、保留舊資料 |
| C9 | 上限與節奏 | 裁罰單檔 256 KB、整輪 10 分鐘、請求間隔 0.2 秒；評鑑單頁 2 MB、整輪 15 分鐘、請求間隔 1 秒（政府站，放慢）。User-Agent 沿用 `sync.USER_AGENT`，不帶帳號 |
| C10 | 打包退路 | `fetch_geo_bundle.py` 新增 `kindergarten_evaluations`（本機抓 69 頁，存成我們自己的 CSV：名稱、學年度、完成日、結果，**不含姓名電話**）與 `kindergarten_penalties`（本機抓 238 檔、轉成 C1 欄位的 CSV，**人名欄不寫出**）；`geo-sync --bundle` 匯入 |
| C11 | 畫面（附近幼兒園清單） | 列上：既有「有裁罰紀錄」旗標改成「近 3 年裁罰 N 件」（N=0 不顯示；3 年外才有的寫「3 年前有裁罰」淡色）；新增評鑑小字「112 學年 追蹤評鑑 全數指標通過」（取最近一次）。展開詳情：裁罰表（日期、處分、違規內容、對象類別），評鑑表（學年度、完成日、結果）。沒資料寫「無公開紀錄」 |
| C12 | 同業收費區塊 | 不加裁罰與評鑑（不混進價格比較） |
| C13 | 說明文字 | 「裁罰與評鑑是全國教保資訊網公開資料（裁罰經 kiang 整理）。裁罰對象為教保人員個人時，不代表園方受罰；人名一律不顯示。」 |
| C14 | 本校 | 本校與其他四校照常顯示（F12／F13 不影響這兩項） |

## 4. 不做

- 人名、負責人、電話、評鑑報告內容與連結。
- 排行、分數、地圖著色、彈出框、總結句。
- 托嬰的違反法令紀錄（10-15 §1.3 已排除，維持）。
- 公開官網顯示。

## 5. API

- 既有附近幼兒園端點的每所園所多：`penalties_recent`（近 3 年件數）、`penalty_latest_on`、`has_older_penalty`、`evaluation_latest`（`{year, completed_on, result}` 或 null）。
- 新端點 `GET /admin/admissions/area/kindergartens/{source_id}/records`：該所全部裁罰（C1 欄位，不含姓名）與評鑑；權限同區域分析。展開時才讀。

## 6. 測試

- 裁罰解析：四種處分、只有條號、有第 7 欄、人名欄**一定不出現在輸出與資料庫**（測試斷言整列序列化後不含 `負責人：`、`行為人：` 後面的字）。固定測試檔用假名。
- 評鑑 HTML 解析：用剪過的假頁面（負責人、電話換假值），斷言輸出只有評鑑三欄。換頁表單欄位組裝。
- 對到園所、件數合併、門檻、404、上限。
- 前端：旗標文字三種狀態、評鑑小字、展開讀取、沒資料文案。

## 7. 部署

- migration 一支（兩張表＋兩個 dataset 約束）。
- 部署後查正式站兩個 dataset 第一輪結果；評鑑若 TLS 失敗，本機打包上傳。

## 8. 實作紀錄（2026-10-20）

分支 `feature/admissions-data-20261020`，migration `b8e2d6a4f931`（接 `a3d7f1c9b5e2`，一支）。和上面規格不同、或規格沒寫清楚、以實作為準的地方：

- **`geo_dataset_status.dataset` 欄放寬到 32 字**（C7）：`kindergarten_penalties` 22 字、`kindergarten_evaluations` 24 字，原本欄寬 20 寫不進去。同一支 migration 放寬（PostgreSQL 放寬 varchar 長度不重寫資料表），降級先刪兩個新狀態列再縮回 20。其餘是規格的「兩張表＋dataset 約束」：兩張表各一個 `source_id` 索引、裁罰多 `kind`／`subject` 兩個 CHECK。
- **裁罰表欄位**（C1）：主鍵是自增 `id`，唯一鍵 `(school_name, occurred_on, doc_no, law, punishment_hash)`；`law` 160 字、`content` 300 字（C1 的上限）、`doc_no` 80 字；多一欄 `punishment_text`（120 字，**只有處分種類是 `other` 時才存**，其他種類用金額與期間表達）。`subject` 可空（來源沒標籤時）。人名欄只取冒號前面的標籤；文號、法條、其他處分、園所名稱這幾個會存的短欄位再保險一次，從「負責人」「行為人」起的字整段截掉（**不要求冒號**：真檔有一筆的裁處文號是「高市教幼字第負責人＋姓名＋號」，來源欄位錯置；截掉後文號變成「高市教幼字第」）；違規內容可能正常提到「負責人」這個詞，只截「負責人：…」或標籤緊接 2–4 個字就結束的（「…負責人王小明」）。
- **同一件有幾位受罰人會合併成一列**：唯一鍵不含對象，真檔 571 筆解析成 534 列（37 筆是同一件、同一條法條、同一處分，只差受罰的人）。畫面看不到「幾個人」，這是規格 C1 的取捨（不存人名），不是遺漏。
- **檔名清單讀不到時退回已知園所名稱**（規格沒寫）：GitHub API 對共用 IP 的未驗證請求限流（60 次／小時），Railway 的出口 IP 是共用的，很可能被限。清單回 HTTP 錯誤或連線失敗時，改成逐一試「營業中園所名稱＋表裡已有裁罰的園所名稱」（約 700 個請求、404 不算錯誤、同樣 0.2 秒間隔與 10 分鐘上限）；這時沒有檔名清單可比，C8 的「清單少於表內 80%」不檢查，下載錯誤門檻改用試過的名稱數算。日誌會寫「裁罰檔名清單讀不到（…），改用已知園所名稱逐一試」。
- **換版門檻的細節**（C8）：沒抓成功（逾時以外的錯誤、單檔超過 256 KB、解析失敗）的園所保留它們的舊列，其他照常整表替換；404（清單還列著、檔案已經沒了）不算錯誤，那一所的舊列會被刪掉。`--force` 只略過「到期」的判斷，**不略過門檻**（同幼兒園收費）。檔案匯入（打包的 CSV）不檢查門檻。
- **評鑑只存對得到園所的列**（C6），整表替換；同一個 `(名稱, 學年度, 結果)` 出現多次只留完成日最新的一筆。`completed_on` 可空（來源日期格式壞掉時），學年度要是 2–3 位數字、結果不是空字串才收，結果超過 100 字截斷。
- **評鑑頁解析只認 id 白名單**：園所名稱 `GridView1_lblSchName_N`、評鑑表 `GridView1_GridView11_N_lbl{SYear,Date,Result}_K`、頁碼三個 `PageControl1_lbl…`、`__` 開頭的隱藏欄位與 `hY`、縣市下拉。結果區塊裡的負責人、電話、「檢視」連結參數根本不會進記憶體。**線上的表單頁另有 `__EVENTTARGET`、`__EVENTARGUMENT`、`__LASTFOCUS` 三個隱藏欄位**（先前存的樣本沒有），換頁時 `__EVENTTARGET`／`__EVENTARGUMENT` 由我們設值蓋過去。縣市代碼（高雄＝18）從表單頁的下拉選單找「高雄市」，不寫死。
- **TLS**（C9、§2）：本機 Python 驗證失敗的原因確認是伺服器只送葉憑證。葉憑證 AIA 的 CA Issuers 是 `http://sslserver.twca.com.tw/cacert/secure_sha2_2023G3.crt`，取得 TWCA Secure SSL Certification Authority（簽發者 TWCA Global Root CA，在 certifi 裡），放 `backend/app/admissions/geo/certs/twca-secure-ssl-2023g3.pem`（檔頭註明來源、指紋、有效期間 **2023-10-16 至 2030-10-16**），`evaluations.ssl_context()` 用 certifi 加這張建 SSL context，驗證與主機名稱檢查都開著。`sync.new_client()` 多 `ssl_context` 參數，`run_geo_sync` 自己建客戶端時評鑑用專用的一個；測試注入的客戶端照用。`.gitignore` 的 `*.pem` 加這個公開憑證的例外。TLS 失敗時 `last_error` 寫「憑證驗證失敗（TLS）」。
- **換頁防呆**：每頁回來要檢查頁碼等於預期，對不上（表單失效、伺服器忽略換頁）就中止並寫「換頁後頁碼對不上」，不原地打轉；頁數超過 150 也中止。
- **打包退路**（C10）：bundle 多 `kindergarten_penalties`、`kindergarten_evaluations` 兩種（各限一個檔），`geo-sync` 多 `--kindergarten-penalties-file`、`--kindergarten-evaluations-file`；CSV 欄位見 `penalties.CSV_COLUMNS`、`evaluations.CSV_COLUMNS`（沒有姓名與電話欄）。`fetch_geo_bundle.py` 預設連同其他資料一起抓，另加 `--kindergarten-only` 只抓這兩項（不重抓人口、出生等）；下載有失敗或評鑑少於 600 所／60 頁就不打包，寫完再檢查 CSV 裡沒有「負責人：」「行為人：」。
- **API**（§5）：附近幼兒園端點每所多 `penalties_recent`、`penalty_latest_on`（**不限 3 年內**的最近一次）、`has_older_penalty`、`evaluation_latest`（學年度最大，同學年取完成日新的），回應頂層多 `penalties_synced_at`、`evaluations_synced_at`（從沒匯入成功是 null）。「近 3 年」是裁處日 ≥ 今天往前三年的同月同日（含當天）。新端點 `GET /admin/admissions/area/kindergartens/{source_id}/records` 要帶 `campus_key`（只用來檢查 `admissions.stats` 與校區範圍），不認得的 `source_id` 回 404；每筆裁罰另有 `recent`（是否在近 3 年內，和清單同一個起算日）。
- **畫面**（C11、C13）：明細用清單（日期＋處分＋對象，下一行是違規內容）而不是表格，窄螢幕不橫向溢出；3 年前的列淡色。評鑑小字把「全數指標通過追蹤評鑑」改寫成「追蹤評鑑 全數指標通過」，其他句型（「全數指標改善完畢」）原文照放。裁罰明細還沒匯入時，標籤維持名單上的「有裁罰紀錄」旗標（匯入後以明細為準，旗標不再顯示）。摘要說沒有裁罰也沒有評鑑的園所，展開時不打 API，直接寫「無公開紀錄」；沒匯入寫「尚未匯入」。C13 的說明文字在清單下方，裁罰、評鑑任一匯入過就顯示。C12：同業收費區塊沒有動。
- **系統狀態頁**：資料集清單多「幼兒園裁罰」「幼兒園評鑑」；過期判斷裁罰同名單 7 天、評鑑 30 天（各加 3 天寬限）。

驗證（本機，Node 22）：

- **真檔（唯讀、不進 repo）**：kiang 高雄裁罰 238 檔、571 筆，0 筆略過；處分罰鍰 545、停止招生 14、減少招收人數 10、停辦 2；對象負責人 500、行為人 71。寫入乾淨資料庫（真 `preschools.json` 加教育部名單的營業中 689 所）：534 列、**對到園所 441 列／194 所**；件數（名稱、日期、文號）507 件，對到園所的 419 件；近 3 年（2023-10-20 起）對到園所的 195 件、94 所；近 12 個月 98 筆（和規格 §2 的 98 筆一致）。把真檔 267 個不重複的受罰人字串（2 字以上）逐一拿去比對輸出的文號、法條、違規內容、其他處分：**0 次命中**（第一版只截有冒號的標籤時，有 1 筆文號含人名，就是上面說的錯置，已修）；剩下命中的只有園所名稱／全名欄（1 個 5 字的字串，是受罰人欄寫了機構名稱、剛好是園所名稱的一部分，不是人名）。輸出裡也沒有任何「負責人」「行為人」字樣。
- **教保資訊網（唯一一次 GET＋一次 POST）**：用內附中繼憑證驗證通過（只用 certifi 時 `CERTIFICATE_VERIFY_FAILED`）；GET 表單頁取得隱藏欄位與縣市下拉（高雄市＝18、共 23 個縣市）；POST 搜尋第一頁：10 所、共 689 所、第 1／69 頁、22 列評鑑（9 所有評鑑、1 所「無」），結果值是「全數指標通過基礎評鑑」「全數指標通過追蹤評鑑」「全數指標改善完畢」三種。
- 後端（單一次執行，不是全套）：`test_geo_*.py` 全部、區域分析與同業相關 `test_admissions_*`、系統狀態、權限表共 1,445 passed，新增 `test_geo_penalties.py`（48）、`test_geo_penalties_sync.py`（25）、`test_geo_evaluations.py`（21）、`test_geo_evaluations_sync.py`（26）、`test_geo_penalty_bundle.py`（8）、`test_admissions_kindergarten_records.py`（13），並更新 `test_geo_schema.py`、`test_geo_loop.py`、`test_admissions_area.py`。後台全套 177 檔 2,988 passed、1 skipped，`typecheck` 無錯誤。契約已重產（`export_openapi.py --check`、`check-contract-types.mjs` 一致）。

沒驗證：正式站（尚未部署）；**評鑑「換頁」那一步沒有對真站試**（只准一次 GET 加一次 POST，只驗到第 1 頁；換頁表單用假教保資訊網驗過隱藏欄位有帶回去、頁碼會前進，真站若行為不同會在第一輪以「換頁後頁碼對不上」失敗，不會寫壞資料）；GitHub API 對 Railway 出口 IP 會不會限流；畫面沒有用真資料在瀏覽器看過（只有 vitest 與型別檢查）；stack e2e 沒有補（`admissions-area.spec.ts` 還沒有裁罰與評鑑的斷言）。
