# 招生歷程加「修改招生資料」「排下次聯絡」（2026-10-15）設計

日期：2026-10-15
狀態：設計 10-15 經使用者核可；規格 10-15 經使用者核可（含寫規格時補的預設值）
基準：`origin/main` `aae0debc`（migration head `c6a9e3f15d27`；**本案不新增 migration**）
分支（實作）：`feature/admissions-history-events-20261015`
上游：10-15 後台功能盤點，使用者選定六項之一（第 2 波，先於「退出原因代碼」）。預約明細家庭頁規格把它列為另案（`docs/specs/2026-10-05-visit-family-page-design.md:69`：「要記就得加事件類型，會動到轉移契約的列舉，另案」）。

## 1. 背景與目標

招生歷程（`recruitment_event_log`）現在只記階段變化與座位：建立、預繳、註冊、退出等九種。改了訪視資料、改了下次聯絡日期，歷程上看不到，只有操作紀錄（總管理者與校區管理者才看得到）有一筆不帶內容的紀錄。

查證後，原本擔心的「會動到園務契約列舉」可以避開：`event_type` 是自由字串（沒有 PG enum 或 CHECK，`migrations/versions/4a7e2c9d1b63_admissions.py:96-116`），契約已有「官網專用事件」清單（`contracts/ivy-recruitment/ivy-schema.json:83`，目前只有 `created`），匯出用黑名單排除它們（`backend/app/admissions/export.py:182-192`）。新事件標成官網專用，園務端的列舉與匯入都不受影響。

### 1.1 成功標準

1. 在招生的歷程抽屜與預約明細家庭頁，看得到「修改招生資料：電話、地址」「排下次聯絡：10/20（一）10:00」這類紀錄，含是誰、什麼時候。
2. 歷程不記欄位內容（不放個資），匿名化之後仍可保留。
3. 匯出給園務的 JSONL 不出現這兩種事件；預繳速度、預約全程等統計不受影響。

### 1.2 裁定

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| H1 ✔ | 類型 | 新增 `details_updated`（修改招生資料）與 `follow_up_updated`（排下次聯絡） | 使用者 10-15 選定 |
| H2 ✔ | 官網專用 | 兩者加進 `WEBSITE_ONLY_EVENT_TYPES`，匯出不轉；契約 `website_only.event_types` 同步更新，`enums.event_types`（園務列舉）不變 | 園務沒有這類事件（`ivy-backend/api/recruitment/records.py:268-314` 改資料不寫事件），也沒有追蹤欄位 |
| H3 ✔ | 修改資料只記欄位名 | `metadata_json = {"fields": [排序後的欄位名]}`；不記舊值與新值；`reason` 為空 | `write_event` 的約定是「metadata 不放個資」（`records.py:120-145`）；匿名化只清 `reason`（`retention.py:72-73`） |
| H4 ✔ | 從預約同步的變更也記 | `booking_link.sync_from_visit_request` 真的改了欄位時寫 `details_updated`，`metadata_json.origin = "visit_request_sync"`；`actor_user_id` 是改預約的同仁，家長在管理頁改的為空 | 歷程才完整；畫面標「（從預約同步）」 |
| H5 ✔ | 排下次聯絡只記直接改的 | `PATCH …/follow-up` 真的改了 `follow_up_at` 或負責人時寫 `follow_up_updated`；**記錄聯絡時順便排的不寫**；註冊、退出時系統自動清掉下次聯絡也不寫 | 記錄聯絡那筆底下已顯示下次聯絡（DESIGN.md:2360-2364）；階段事件本身就說明了為什麼清掉 |
| H6 | `follow_up_updated` 的 metadata | `{"follow_up_at": ISO 字串或 null, "previous_follow_up_at": ISO 字串或 null, "owner_changed": bool}`；不記負責人 id | 日期不是個資；負責人顯示要查名字，先只標「負責人已變更」 |
| H7 | 階段欄 | `from_stage = to_stage = derive_stage(visit)`（`funnel.py:62`） | `to_stage` NOT NULL；同座位事件的寫法（`intake.py:70`） |
| H8 | 「最後處理」 | 這兩種事件有 actor，會更新家庭頁的「最後處理」（`admin/src/admissions/family.ts:124-139`） | 修改資料與排聯絡本來就是處理動作 |
| H9 | 舊資料 | 不回補 | 過去的變更沒有可靠來源（操作紀錄只有欄位名、且非每個角色看得到） |

### 1.3 不做

- 記錄欄位的前後值、負責人是誰。
- 其他動作（聯絡紀錄、座位、刪除）改寫法。
- 園務端改動、轉移契約的園務列舉改動。

## 2. 現況（`origin/main` `aae0debc`）

- 列舉 `backend/app/admissions/constants.py:53-65`（`EVENT_TYPES`、`WEBSITE_ONLY_EVENT_TYPES=("created",)`）；`schemas.py:27` `EventType = Literal[...]`（GET events 回應驗證）。
- 寫入函式 `records.write_event`（`records.py:120-145`）。
- 修改資料：`PATCH /admin/admissions/records/{id}`（`routes.py:244-278`）→ `records.update_visit`（`records.py:255-285`，回傳真的有變的欄位；不收 actor）；操作紀錄 `recruitment_visit.update`（`routes.py:270-277`）。
- 下次聯絡：`PATCH …/follow-up`（`routes.py:708-743`）→ `follow_up.update_follow_up`（`follow_up.py:203-232`，回傳有變的鍵：`follow_up_at`、`follow_up_owner_id`）；記錄聯絡 `follow_up.add_contact_log`（:149-199，docstring 明寫不寫歷程）。
- 同步：`booking_link.sync_from_visit_request`（`booking_link.py:145-209`，同步 `_SYNCED_FIELDS` :143）。
- 讀事件的地方：預繳速度 `deposit_pace.py:50-55`、預約全程 `journey.py:276-283` 都只讀 `deposit_added`（白名單，不受影響）；匯出 `export.py:182-192` 用黑名單；家庭頁「最後處理」讀所有有 actor 的事件。
- 契約：`contracts/ivy-recruitment/ivy-schema.json:80`（`enums.event_types`）、:83（`website_only.event_types`）；`backend/tests/test_admissions_contract.py:88-89,161,168`；`backend/tests/test_admissions_academic.py:103`；漂移檢查 `backend/scripts/check_ivy_recruitment_contract.py` 只比對園務端列舉。
- 前端：中文 `admin/src/admissions/constants.ts:73-93`（`EVENT_LABELS`、`eventLabel`）；變更行 `family.ts:104-118`（`recruitmentEventChanges`）；歷程抽屜 `components/admissions/EventsDrawer.vue:246-248`；家庭頁 `api/visitTimeline.ts:99-108`；欄位中文 `api/labels.ts:653-`（`RECRUITMENT_FIELD_LABELS`）；測試 `admissionsConstants.test.ts:30-34`。

## 3. 設計

### 3.1 後端

- `constants.py`：`EVENT_TYPES` 加兩個；`WEBSITE_ONLY_EVENT_TYPES = ("created", "details_updated", "follow_up_updated")`。
- `records.update_visit` 加關鍵字參數 `actor_user_id`；`changed` 非空時在同一交易 `write_event(event_type="details_updated", from_stage=to_stage=derive_stage(visit), actor_user_id=…, metadata={"fields": sorted(changed)})`。
- `follow_up.update_follow_up` 加 `actor_user_id`；`changed` 非空時寫 `follow_up_updated`（H6）；`previous_follow_up_at` 取改之前的值。
- `booking_link.sync_from_visit_request`：有變時寫 `details_updated`，metadata 加 `origin: "visit_request_sync"`。
- 呼叫端（routes）傳入目前使用者 id。
- 不動 `add_contact_log`、`funnel.transition`、`intake`。

### 3.2 契約

- `ivy-schema.json` 的 `website_only.event_types` 改成 `["created", "details_updated", "follow_up_updated"]`；`enums.event_types` 不變。
- `contracts/ivy-recruitment/README.md` 第 6 點（:92 附近「created 官網多寫」）補這兩種，說明「官網專用、不轉」。
- 重新產生 `contracts/openapi.json` 與 `contracts/generated/website-api.d.ts`（`EventType` 列舉變了）。

### 3.3 畫面

- `EVENT_LABELS` 加「修改招生資料」「排下次聯絡」；`eventLabel` 對 `details_updated` 且 `origin = visit_request_sync` 補「（從預約同步）」。
- `recruitmentEventChanges`：
  - `details_updated` → 一行「改了：電話、地址」（欄位中文用 `RECRUITMENT_FIELD_LABELS`，查不到用原欄位名）。
  - `follow_up_updated` → 「下次聯絡：10/20（一）10:00」或「改為不用再追」（新值為 null），`owner_changed` 時另一行「負責人已變更」。
- 歷程抽屜與家庭頁共用上面兩個函式，不另寫。

## 4. 測試

- 後端：
  - 修改資料有變 → 一筆 `details_updated`，metadata 只有欄位名、沒有任何值；沒變 → 不寫。
  - 從預約同步有變 → 一筆、帶 origin；沒變 → 不寫。
  - 改下次聯絡 → 一筆 `follow_up_updated`，前後值正確；只改負責人 → `owner_changed: true`；記錄聯絡時排的 → 不寫。
  - GET events 回得出新類型（回應驗證通過）。
  - 匯出 JSONL 不含新類型；`test_admissions_contract.py` 的 website_only 斷言通過；`check_ivy_recruitment_contract.py` 照常通過。
  - 匿名化後兩種事件保留、metadata 不變。
  - 預繳速度、預約全程的既有測試不變。
- admin vitest：`admissionsConstants.test.ts`（新類型有中文）、`recruitmentEventChanges` 兩種新變更行、歷程抽屜與家庭頁渲染。
- stack e2e：不另加（後端與元件測試已涵蓋）。

## 5. 部署與風險

- 不新增 migration、不新增環境變數。
- 舊版後台頁面（快取）讀到新類型時，`eventLabel` 查不到會顯示原字串——部署後重新整理即正常，可接受。

## 6. 與其他工作的關係

- 「退出原因代碼」：它的「補分類」若改用 PATCH records，會自動產生 `details_updated`；兩案同波，本案先做。
- 與第 1、3 波不共用檔案（第 3 波「預計入學時間」會動 `booking_link.fields_from_visit_request`，與本案動的 `sync_from_visit_request` 同檔不同函式，合併時注意）。
