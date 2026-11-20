# 園務同步端點：園務系統定期拉官網招生資料（2026-11-20）

## 1. 背景與裁定

業主（使用者）2026-11-20 裁定：過渡期就要讓園務系統（另一套 FastAPI，ivyManageSystem）持續拿到官網的預約與招生資料。這**取代**招生規格 `docs/specs/2026-09-30-website-admissions-design.md` §3.2「過渡期與園務系統串接或同步」不做的那一句（依 CLAUDE.md「有日期的較新業主裁定優先」）。

不變的前提：官網仍使用獨立資料庫、不連園務資料庫（`app/config.py` 會拒絕連到 `ivymanagement`）；方向是**園務來拉官網的 HTTP API**，官網不主動呼叫園務、不存園務的任何憑證。

## 2. 端點

`GET /api/website/v1/integrations/ivy-management/leads`（唯讀、機器專用）

| Query | 說明 |
|---|---|
| `campus_key` | 必填。五校代號（`yihua`、`minghua`、`chongde`、`international`、`renwu`） |
| `cursor` | 選填。上一頁回傳的 `next_cursor`；不透明字串，格式錯誤回 422 `INVALID_CURSOR` |
| `limit` | 選填，1–200，預設 200 |

回應（`LeadsPage`）：`{campus_key, as_of, items: [Lead], next_cursor}`，`as_of` 是這一頁開始查詢的 UTC 時間，`next_cursor` 為 `null` 才算取完。回應標頭 `Cache-Control: no-store`（錯誤回應也不快取）。`Lead` 的欄位與 id 規則見 `contracts/ivy-recruitment/README.md`「持續同步端點」與 `app/integrations/ivy_management/schemas.py`。

| 狀態 | 時機 |
|---|---|
| 200 | 成功 |
| 401 `INTEGRATION_AUTH_FAILED` | 沒帶標頭、金鑰不對、該校沒設定金鑰、校區代號不認得——**同一種回應**（錯誤碼與訊息相同），不洩漏哪個校區有設定 |
| 422 | `limit` 超出範圍、缺 `campus_key`（驗證之前就擋，不帶資料）；`cursor` 格式錯（驗證通過後才檢查，`INVALID_CURSOR`） |
| 429 `INTEGRATION_AUTH_RATE_LIMITED` | 同一來源 IP 驗證失敗 5 分鐘內超過 20 次（`Retry-After`） |
| 404 | 功能關閉（`WEBSITE_IVY_SYNC_KEY_HASHES` 沒設或空物件）；或設了 `NUXT_ADMIN_HOST` 後從官網主機（www）打 |

## 3. 驗證與設定

- 標頭 `X-Ivy-Integration-Key: <金鑰>`。伺服器算 `sha256(金鑰)`，與該 `campus_key` 設定的雜湊用 `hmac.compare_digest` 比對；校區沒設定時比對固定的假雜湊，不因為有沒有設定而走不同路徑。
- **不使用後台 session cookie**：不看 cookie，帶了有效 session 但沒有金鑰一樣 401。端點不經 `get_current_user`、也不碰 CSRF／Origin 檢查（只有 GET）。
- 設定 `WEBSITE_IVY_SYNC_KEY_HASHES`（`Settings.ivy_sync_key_hashes`）：JSON 物件「校區 → 金鑰的 SHA-256（64 個 hex，大小寫皆可、啟動時正規化為小寫）」。env 只放雜湊；欄位 `repr=False`；格式不合（不是物件、校區不認得、值不是 64 hex）啟動失敗，錯誤訊息不帶值。`Settings.ivy_sync_enabled` ＝ 至少設了一個校區。
- 掛載：只在 `ivy_sync_enabled` 時 `include_router`；**不綁** `admissions_enabled`（招生關閉時仍回預約資料，只是沒有招生訪視）。
- 失敗限流：沿用 `app/common/ratelimit.py`（計數存 PostgreSQL，bucket `ivy_sync_auth_fail`，5 分鐘 20 次，依來源 IP）。**只有失敗計數**：有效金鑰不被來源的失敗次數擋住（猜測金鑰不會因此變快）；擋的是第 21 次起的失敗請求。來源 IP 用 `ratelimit.client_key`（web 代理算的 `x-website-client-ip`）。
- Log：失敗 WARNING（來源、校區〔只記已知校區〕、有沒有帶標頭，不記金鑰）；成功 INFO（校區、回傳筆數、是否最後一頁）。**不寫稽核表**（園務每幾十分鐘拉一次，會洗版）。
- web：`web/server/utils/admin-host.ts` 的後台專屬 API 樣式加 `integrations`；設了 `NUXT_ADMIN_HOST` 後只有後台主機服務這條路徑。`x-ivy-integration-key` 靠 `api-proxy.ts` 既有的 `x-ivy-` 前綴規則轉送。

## 4. 合併規則

一筆 lead＝一個家長報名。兩段，keyset 分頁（游標編「段別＋上一筆的 `created_at`＋id」，不用 OFFSET）：

1. 第一段 `vr`：該校 `excluded_at IS NULL` 的 `VisitRequest`，依 `(created_at, id)`；有 `RecruitmentVisit.visit_request_id` 對得上的就帶上。`id＝vr:<預約 uuid>`、`origin=visit_request`。
2. 第二段 `rv`：該校 `visit_request_id IS NULL` 的 `RecruitmentVisit`（手動建立或原預約已刪除），依 `(created_at, id)`。`id＝rv:<訪視 uuid>`、`origin=manual_visit`。
3. 連到被排除預約的訪視兩段都不回。
4. 第一段取完接第二段；全部取完 `next_cursor=null`。每頁多取一筆判斷有沒有下一頁，所以剛好取滿的最後一頁游標就是 `null`，不會多一個空頁。訪視與場次按頁批次查（一頁固定約 3–4 個查詢，不隨列數成長）。

沒有招生訪視的預約用 `booking_link.fields_from_visit_request` 換算，但 `visit_date` 只採場次日期（沒有場次就是 `null`，不用今天補）；階段用 `funnel.derive_stage`（不另寫一份）。已匿名化（預約或訪視任一）的列，個資欄位一律 `null`。

## 5. 不做

- 不寫入、不回寫、不提供刪除通知（見 §8）；不含歷程、聯絡紀錄、區域比對、帶參觀老師。
- 不新增表或欄位（沒有 migration）。
- 不做 `updated_since` 增量條件：資料量是一校一年數百筆等級，每次完整拉取就好。

## 6. 測試

`backend/tests/test_ivy_management_sync.py`（真 PostgreSQL）：設定驗證、功能關閉 404、各種驗證失敗同一種 401、有效 session 沒金鑰 401、失敗限流 429、校區隔離、被排除的預約與訪視、有／無訪視的欄位與階段、手動訪視在第二段、匿名化、分頁（含 `created_at` 相同的列、多種 limit、分頁中途新增）、cursor 亂填、查詢數不隨列數成長。web：`web/tests/admin-host.spec.ts`、`web/tests/api-proxy.spec.ts`。

## 7. 部署

見 `deploy/README.md` 頂部「園務同步端點：啟用步驟」：產生金鑰與雜湊、設 `WEBSITE_IVY_SYNC_KEY_HASHES`、把金鑰交給園務、冒煙測試、輪替、關閉。

## 8. 已知限制（給園務端實作者）

1. **沒有墓碑**：預約被排除或刪除後，那筆 id 只是不再出現。園務要反映的話，以「完整走完一輪游標後沒出現的 id」判斷，不要在單頁內推論。排除是可逆的（取消排除後 id 會回來）。
2. **快照不是交易一致的**：各頁各自查詢，走完一輪的期間資料可能新增或修改。游標位置以 `(created_at, id)` 為準，新建的預約因為 `created_at` 較新而排在後面，游標還在第一段時不會漏（游標已進入第二段後才建立的預約，這一輪看不到、下一輪才有）；已經取過的列在期間被修改要等下一輪才看得到。同一個 id 以最後一次取到的為準，`updated_at`（有訪視時）可比較新舊。
3. **每校只存一個金鑰雜湊**：輪替金鑰時，換掉到園務換好之間園務會收到 401（見部署文件）。
4. **來源 IP 限流依賴 web 代理帶的訪客 IP**：沒有帶時（直連 API）退回 peer 位址，所有呼叫端共用同一個桶。
5. 回應含家長與幼兒個資（姓名、電話、生日、地址）。招生規格 §15 Q1（隱私權政策補招生用途與保存天數）仍待裁定；啟用前要確認個資告知涵蓋「提供給園務系統」。
