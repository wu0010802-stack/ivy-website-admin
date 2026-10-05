# 參觀後追蹤：參觀案件與招生入學整合設計

日期：2026-10-04
狀態：草案，待使用者審閱；2026-10-04 使用者已回覆 F-Q1–F-Q4（第 2 節），招生規格 Q1 的擬稿見附錄 A
對象：業主、接手實作的 Claude
基準：`origin/main` `eab7df4`（招生入學已部署、正式站開關關閉；migration head `d2b7f4c9e1a3`）

前置文件：

- 招生入學：`docs/specs/2026-09-30-website-admissions-design.md`（以下稱「招生規格」）。
- 家長自選場次：`docs/specs/2026-09-30-parent-self-booking-design.md`（以下稱「預約規格」）。

本規格補上「參觀之後的追蹤」，並把參觀案件與招生入學接成一條流程。漏斗階段、狀態轉換、名額與統計公式都不改；新增的欄位與表一律是官網延伸，園務欄位快照（`contracts/ivy-recruitment/ivy-schema.json`）不變。

## 1. 背景與目標

使用者 2026-10-04：「家長完成參觀後可以有後續追蹤，然後參觀完成後案件也要自動導入到招生入學那邊，形成一整個流程。」

### 1.1 現況

> 2026-10-05 更新：表中的 `ArrivalsTab.vue` 已刪除，見 DESIGN.md「拿掉官網預約分頁」。

| 環節 | 現況 | 位置 |
|---|---|---|
| 參觀前聯絡 | 預約案件有聯絡紀錄與「下次聯絡」，到期列進總覽「到期待追蹤」 | `backend/app/booking/workflow_service.py:392`、`backend/app/booking/pending_kinds.py:35-40` |
| 到場確認 | 場次開始後列在總覽「參觀時間過了，還沒標記到場」與招生「官網預約」分頁，逐筆按「已到場」「未到場」 | `admin/src/components/admissions/ArrivalsTab.vue:81-104` |
| 導入招生 | 標記已到場時，同一個交易建立招生訪視（開關開啟時） | `backend/app/booking/workflow_service.py:253-254`、`backend/app/admissions/booking_link.py:78-101` |
| 參觀後追蹤 | 招生訪視只有一格「電訪回應」（`parent_response`），新內容蓋掉舊的 | `backend/app/admissions/models.py:104` |
| 正式站 | `WEBSITE_ADMISSIONS_ENABLED=false`，等招生規格 Q1（同意文字、保存天數） | `deploy/README.md:226-233` |

### 1.2 斷點

1. **到場那一刻追蹤就斷了。** 「到期待追蹤」排除已到場的案件（`pending_kinds.py:39`）。預約明細對已到場的案件仍顯示「下次聯絡」選擇器（`admin/src/views/VisitDetailView.vue:940`），但設了不會出現在任何待辦（同檔 `:774-776` 的註解也寫明不算）。
2. **招生訪視沒有追蹤機制。** 沒有下次聯絡時間、沒有負責人、沒有逐次紀錄。
3. **「逾 14 天待追」用建檔時間算**（`backend/app/admissions/stats.py:332`），聯絡過也照樣算逾期，看不出誰真的沒人追。
4. **參觀前的聯絡紀錄留在預約頁**，招生頁看不到，同事要兩頁來回。
5. **到場要逐筆按。** 一天好幾場時容易拖著沒標，沒標就不會進招生。

### 1.3 成功標準

1. 標記已到場（單筆或批次）後，招生訪視已建立、已有負責人，不需要人工重打。不是每位家長都會聯絡，所以不自動排聯絡；要追的，同事隨時能排下次聯絡。
2. 參觀後每一次聯絡都留一筆紀錄：時間、方式、有沒有聯絡到、內容。不覆寫。
3. 每筆還在追的招生訪視（已訪視、已預繳，未匿名化）一定落在三種追蹤狀態之一：已到期、已排定、未排定。招生頁與總覽看得到已到期的數量；未排定的有清單可查，但不算待辦。
4. 標記註冊或退出時，追蹤自動結束。不會再有「設了提醒卻永遠不會出現」的狀態。
5. 招生訪視的歷程看得到整條時間線：參觀前聯絡 → 到場 → 參觀後聯絡 → 預繳／註冊。
6. 轉移契約照舊可用：匯出程式多輸出延伸資料，園務欄位快照與契約測試的園務部分不變。

## 2. 已裁定事項

| 日期 | 裁定 | 來源 |
|---|---|---|
| 2026-10-04 | 參觀完成後要有後續追蹤，並自動導入招生入學，形成完整流程 | 使用者 |
| 2026-10-04 | 看過以下方向後要求寫成規格：導入時機維持「確認已到場」、到場可批次標記、招生訪視加下次聯絡、負責人與逐次聯絡紀錄、招生頁與總覽列出到期 | 使用者 |
| 2026-10-04 | F-Q1：**不自動排第一次聯絡**。使用者回覆「不一定會聯絡」：參觀後要不要聯絡、什麼時候聯絡，由同事逐筆決定。建檔時只沿用預約上還沒到的下次聯絡（第 6.1 節） | 使用者 |
| 2026-10-04 | F-Q2：聯絡紀錄匯出成延伸檔；併入園務時依時間串成文字，附加在 `notes` 末尾（第 11 節） | 使用者 |
| 2026-10-04 | F-Q3：統計的「逾 14 天待追」不改，維持與園務一致（依建檔時間）；真正的到期清單看「待追蹤」分頁 | 使用者 |
| 2026-10-04 | F-Q4：使用者同意 30 天。F-Q1 改成不自動排之後，這條只用在自動排程，已不適用，不實作 | 使用者 |
| 2026-10-04 | 招生規格 Q1 交由 Claude 擬稿：隱私權政策補「參觀後招生聯繫與紀錄」的用途、保存期間與孩子資料用途，招生訪視保存 730 天（附錄 A）。園方在後台發布隱私權政策、設好保存天數後才算裁定生效 | 使用者 |

「導入時機維持確認已到場」的理由：場次時間一過就自動導入，沒來的家長也會進漏斗，「參觀→預繳率」的分母會被灌大；園務的漏斗也從「已訪視」起算；成效統計也已規定不能用「日期已過」判定到場（DESIGN.md「成效統計補強」）。

## 3. 範圍

### 3.1 本次要做

- 招生訪視三個延伸欄位、新表 `recruitment_contact_logs`（第 5 節），一個 migration。
- 到場建檔時帶入負責人，並沿用預約上還沒到的下次聯絡；不自動排聯絡（第 6.1 節）。
- 記錄聯絡、改下次聯絡與負責人、待追蹤清單、負責人選單的 API（第 9 節）。
- 標記註冊、退出時清掉下次聯絡（第 6.5 節）。
- 預約端防呆：已到場、已取消的案件不能再設「下次聯絡」（第 6.6 節）。
- 後台：招生「待追蹤」分頁、記錄聯絡對話框、歷程抽屜合併聯絡紀錄、看板卡片與明細欄位、預約明細「參觀後追蹤」區塊、官網預約批次標記到場、總覽「招生待追蹤」（第 7 節）。
- 保存政策、轉移契約、測試（第 10–12 節）。

### 3.2 本次不做

- 不改漏斗階段、狀態轉換、名額規劃、統計公式；「逾 14 天待追」照舊（F-Q3）。
- 不自動排第一次聯絡（F-Q1）。
- 不寄提醒：到期只在後台顯示，不寄 Email、LINE 或推播。
- 不自動導入還沒確認到場的預約；未到場（`no_show`）仍用預約端既有的下次聯絡追（`follow_up_due` 本來就涵蓋 `no_show`）。
- 不把預約的聯絡紀錄複製到招生，只在招生歷程唯讀顯示。
- 側欄徽章、聯絡內容範本、批次改負責人、批次標記未到場：之後再說。
- 不改正式站開關的開啟條件：招生規格 Q1 仍是上線前提（第 10 節、附錄 A）。
- 不改隱私權政策的程式或後台初稿：附錄 A 的文字由園方貼進後台「隱私權政策」發布（正式內容存在資料庫，不在 repo）。

## 4. 整體流程

```
家長自選場次（confirmed）
  │  參觀前：預約聯絡紀錄＋下次聯絡（既有；總覽「到期待追蹤」）
  ▼
場次開始 → 總覽「參觀時間過了，還沒標記到場」／招生「官網預約」分頁（新增：可勾選多筆）
  ├─ 未到場 → 預約結案（no_show）；要再約就用預約的下次聯絡（既有）
  └─ 已到場 → 同一個交易：預約 completed＋建招生訪視＋負責人（不自動排聯絡）   ← 第 6.1 節
                 ▼
         要追的：排下次聯絡（待追蹤「未排定」、預約明細、歷程抽屜都能排）      ← 第 6.4 節
                 ▼
         招生「待追蹤」分頁：已到期／7 天內／未排定；總覽「招生待追蹤」        ← 第 6.2、7.1 節
                 ▼
         記錄聯絡（每次一筆，一定要決定下次聯絡或不用再追）                    ← 第 6.3 節
                 ▼
         已預繳（照樣追）→ 已註冊／退預繳／退註冊 → 下次聯絡自動清掉           ← 第 6.5 節
```

## 5. 資料模型

### 5.1 `recruitment_visits` 新增欄位（官網延伸）

| 欄位 | 型別 | 空值 | 規則 |
|---|---|---|---|
| `follow_up_at` | timestamptz | 是 | 下次聯絡時間；null＝未排定。DB CHECK `ck_recruitment_visits_follow_up_open`：`follow_up_at IS NULL OR (enrolled = false AND withdrawn_at IS NULL AND anonymized_at IS NULL)`，已註冊、已退出、已匿名化的訪視一定沒有下次聯絡 |
| `follow_up_owner_id` | uuid FK `users.id` ON DELETE SET NULL | 是 | 追蹤負責人；null＝未指派。指派時須是啟用中、有 `admissions.write`、涵蓋該校區的帳號（第 6.4 節） |
| `last_contacted_at` | timestamptz | 是 | 最近一次聯絡紀錄的 `contacted_at`。服務層在同一個交易維護，取最大值：補登一筆較早的聯絡不會把它往回改 |

- 索引：`(campus_key, follow_up_at)`，partial `WHERE anonymized_at IS NULL`。
- 三個欄位都受既有樂觀鎖 `version` 保護：改任何一個，`version`＋1、`updated_at` 更新。
- 既有資料：三欄都是 null，所以還在追的訪視都落在「未排定」。正式站開關關閉，正式庫的招生訪視應為 0 筆；migration 只新增欄位與表，不改寫資料。

### 5.2 `recruitment_contact_logs`（新表，官網延伸）

每筆是參觀後的一次聯絡，比照預約的 `visit_contact_notes`（`backend/app/booking/models.py:299`）：只新增，不編輯、不刪除；記錯就補一筆更正。

| 欄位 | 型別 | 空值 | 規則 |
|---|---|---|---|
| `id` | uuid PK | 否 | |
| `recruitment_visit_id` | uuid FK `recruitment_visits.id` ON DELETE CASCADE | 否 | 刪除訪視時一起刪（同歷程） |
| `contacted_at` | timestamptz | 否 | 聯絡時間；沒帶用送出當下。可補登較早的時間，不能晚於現在 |
| `channel` | String(16) | 否 | CHECK `IN ('phone','line','in_person','other')`：電話、LINE、當面、其他 |
| `reached` | Boolean | 否 | 有沒有聯絡到 |
| `note` | Text | 是 | 1–1000 字。聯絡到時必填；沒聯絡到時選填（例：「沒接」） |
| `next_follow_up_at` | timestamptz | 是 | 記這筆時排的下次聯絡（快照，只給歷程顯示；現值以訪視的 `follow_up_at` 為準） |
| `created_by` | uuid FK `users.id` ON DELETE SET NULL | 是 | |
| `created_at` | timestamptz | 否 | |

索引：`(recruitment_visit_id, contacted_at)`。`RecruitmentVisit` 加 relationship `contact_logs`，`passive_deletes=True`（同 `events`）。

### 5.3 常數（`backend/app/admissions/constants.py`）

| 名稱 | 值 | 用途 |
|---|---|---|
| `UPCOMING_WINDOW_DAYS` | 7 | 待追蹤分頁「7 天內」的範圍 |
| `CONTACT_CHANNELS` | `phone`、`line`、`in_person`、`other` | 後台文案：電話、LINE、當面、其他 |

## 6. 流程與規則

### 6.1 建檔時帶入的追蹤欄位

在 `booking_link.ensure_from_visit_request` **新建立**訪視時（已有訪視就原樣回傳，不動追蹤欄位），以及手動新增（`POST /records`）時，套用以下規則。全部算完才寫入，與建立訪視同一個交易。

不自動排第一次聯絡（F-Q1，2026-10-04 使用者：「不一定會聯絡」）。新建的訪視預設落在「未排定」；要追的，同事從待追蹤分頁、歷程抽屜或預約明細排下次聯絡（第 6.4 節）。

1. **下次聯絡** `follow_up_at`：
   1. 預約上的 `follow_up_at` 有值且晚於現在：沿用。這是園方自己排的時間，到場後不該消失。手動新增沒有預約，跳過這一步。
   2. 其他情況：null（未排定）。
2. **負責人** `follow_up_owner_id`：依序取第一個「啟用中、有 `admissions.write`、涵蓋該校區」的帳號：
   1. 預約的承辦人 `assigned_staff_id`（手動新增沒有，跳過）。
   2. 這次操作的人（標記到場、補建或手動新增的人）。
   3. 都不符合：null（未指派）。

   目前 `booking.handle` 與 `admissions.write` 的預設角色相同，但兩邊要分開檢查，之後權限表改了也不會指派給看不到招生的人。
3. **預約本身不動**：不清預約的 `follow_up_at`、不加預約的 `version`，免得開著預約明細的人收到 409。已到場預約上的下次聯絡本來就不列入待辦；畫面與 API 的防呆見第 6.6 節。
4. `created` 事件的 `metadata_json` 加 `follow_up`：`booking`（沿用預約的下次聯絡）或 `none`。`created` 是官網延伸事件、不匯出（招生規格 5.4），加鍵不影響契約。
5. 不寫招生歷程以外的稽核：稽核沿用既有的 `visit_request.complete`、`recruitment_visit.create_from_booking`、`recruitment_visit.create`。

### 6.2 追蹤狀態（推導，不存欄位）

只看「未匿名化、階段為已訪視或已預繳」的訪視（第 5.1 節的 CHECK 保證其他訪視的 `follow_up_at` 一定是 null）：

| 狀態 | 代碼 | 條件 |
|---|---|---|
| 已到期 | `due` | `follow_up_at <= now` |
| 已排定 | `upcoming` | `follow_up_at > now`；待追蹤分頁的「7 天內」另加 `follow_up_at <= now + 7 天` |
| 未排定 | `unscheduled` | `follow_up_at IS NULL` |

只有「已到期」算待辦（分頁標籤數字、總覽）。「未排定」包含決定不聯絡的家長，只是方便查看的清單，不算待辦、不提醒。

條件放在新模組 `backend/app/admissions/follow_up.py` 的 `condition(kind, now)`，待追蹤清單、訪視明細篩選、總覽計數都從這裡取，比照 `booking/pending_kinds.py` 的做法：數字點進清單一定是同一批。

### 6.3 記錄聯絡

`POST /records/{id}/contact-logs`。檢查順序沿用狀態轉換：鎖列並確認讀得到這筆（404／403）→ 已匿名化（409 `RECRUITMENT_VISIT_ANONYMIZED`）→ 版本（409 `RECRUITMENT_VISIT_VERSION_CONFLICT`）→ 本節的規則（422）。

同一個交易內：

1. 寫一筆聯絡紀錄。
2. `last_contacted_at` 改成 `max(原值, contacted_at)`。
3. **下次聯絡必須決定**：請求的 `next_follow_up_at` 是必填欄位，值可以是時間或 null。
   - 時間：必須晚於現在，否則 422 `FOLLOW_UP_IN_PAST`。寫入訪視的 `follow_up_at`。
   - null：「不用再追」，清掉 `follow_up_at`。
   - 已註冊或已退出的訪視只能送 null，否則 422 `FOLLOW_UP_NOT_ALLOWED`。聯絡紀錄本身任何階段都能記。

   必填的原因：已到期的訪視記了一筆聯絡卻沒改時間，會一直留在「已到期」。預約端是「不送就不動」（`VisitDetailView.vue` 另外提示），招生端直接要求決定。
4. `update_parent_response=true` 時，把這次的 `note` 寫進訪視的 `parent_response`（取代原內容）。只在 `reached=true` 時可用，否則標準 422。
5. 訪視 `version`＋1、`updated_at` 更新。
6. 不寫 `recruitment_event_log`：聯絡紀錄本身就是歷程，也不影響匯出的歷程檔。
7. 稽核 `recruitment_visit.contact_logged`，metadata：`log_id`、`channel`、`reached`、`follow_up_set`、`follow_up_cleared`、`parent_response_updated`。不記內容（同預約的 `visit_request.add_contact_note`，`backend/app/booking/routes.py:1291-1305`）。
8. 回應 `{log, visit}`，畫面不用再讀一次。

其他驗證（標準 422，`loc` 指到欄位）：`contacted_at` 晚於現在回 422 `CONTACTED_AT_IN_FUTURE`（跟時間有關，用自訂碼）；`reached=true` 而 `note` 空白；`note` 超過 1000 字或含控制字元（沿用預約的 `_reject_control_chars`）；`channel` 不在清單。

### 6.4 只改下次聯絡或負責人

`PATCH /records/{id}/follow-up`：給「改期」「換負責人」用，不記聯絡紀錄。用 `model_fields_set` 區分：沒送＝不動，送 null＝清除（同招生規格 B17 的編輯規則）。

- `follow_up_at`：時間必須晚於現在（422 `FOLLOW_UP_IN_PAST`）；已註冊、已退出只能 null（422 `FOLLOW_UP_NOT_ALLOWED`）。
- `follow_up_owner_id`：要是啟用中、有 `admissions.write`、涵蓋該校區的帳號，否則 422 `FOLLOW_UP_OWNER_INVALID`，訊息比照預約指派（`workflow_service.py:466-471`）：「這個帳號已停用，不能指派」「這個帳號沒有招生入學的權限」「這個帳號沒有這個校區的權限」。任何階段都能改。
- 有實際改變才加 `version`、寫稽核 `recruitment_visit.follow_up_update`，metadata：`follow_up_set`、`follow_up_cleared`、`owner_changed`。
- 一般編輯 `PATCH /records/{id}` **不收**這三個欄位（`extra="forbid"`，送了就 422），追蹤欄位只有本節與第 6.3 節兩條路。

### 6.5 階段轉換的連動

`funnel.transition`（`backend/app/admissions/funnel.py:106`）：

- 轉到已註冊、或轉到退出（退預繳、退註冊）時，同一個交易把 `follow_up_at` 設為 null。事件的 `metadata_json` 不變。
- 負責人與 `last_contacted_at` 保留。
- 往回轉（取消註冊、取消退出）不會自動恢復下次聯絡，訪視會落在「未排定」。畫面在這兩種轉換成功後提示：「要排下次聯絡嗎？」，附「排下次聯絡」按鈕（開第 6.4 節的改期）。

### 6.6 預約端防呆

- `POST /admin/visit-requests/{id}/contact-notes`：案件是 `completed` 或 `cancelled` 時，帶非 null 的 `follow_up_at` 回 422 `FOLLOW_UP_NOT_TRACKED`，訊息「已到場或已取消的案件不會列入到期待追蹤；參觀後的追蹤請記在招生訪視」。清除（null＋`expected_version`）與單純記一筆聯絡照舊。`confirmed`、`no_show` 不受影響。
- 預約明細的畫面調整見第 7.6 節。

## 7. 後台畫面

### 7.1 招生入學「待追蹤」分頁

- 分頁 `followups`，標籤「待追蹤」，放在「漏斗看板」之後（`admin/src/admissions/useAdmissionsFilters.ts:6` 的 `ADMISSIONS_TABS` 加入）。標籤旁的數字是已到期筆數，每次讀完更新（同「官網預約」分頁的做法）。
- **不吃頁首的入學學年學期**：追蹤跟入學學期無關。清單上方寫「待追蹤不分入學學期」。
- 篩選：
  - 範圍（分段按鈕）：已到期（預設）、7 天內、未排定。
  - 負責人：全部、我負責的、未指派，以及各個帳號。
  - 兩者寫進網址：`fu`（`due` 是預設，不寫）、`owner`（`me`、`none` 或帳號 id）。
- 欄位：
  - 下次聯絡：已到期寫「逾 N 天」（台北日期相減；今天到期寫「今天 10:00」），用警示色。
  - 幼生：姓名＋班別；「（未填姓名）」加「待補」（同招生規格 B36）。
  - 階段 tag、參觀日期（民國）。
  - 聯絡人與電話：電話是 `tel:` 連結。
  - 最近聯絡：「10/05・電話・沒聯絡到」；沒有寫「還沒聯絡過」。
  - 負責人：停用的帳號寫「（已停用）」。
- 列操作：「記錄聯絡」（主要按鈕）、「改期／負責人」（小視窗，第 6.4 節；未排定的列叫「排下次聯絡」）、「歷程」（開歷程抽屜）。
- 「未排定」上方寫一句：「參觀後還沒排聯絡的家長。不是每位都要聯絡，這裡不算待辦；要追的按『排下次聯絡』。」
- 排序：已到期、7 天內依 `follow_up_at` 舊到新；未排定依參觀日新到舊（剛參觀的在最上面）。同值再依建立時間、id，排序可重現。
- 每頁 50 筆，顯示總數。
- 空狀態：
  - 已到期：「沒有到期要聯絡的家長。」
  - 7 天內：「接下來 7 天沒有排定的聯絡。」
  - 未排定：「還在追的訪視都排好下次聯絡了。」
- 390px：改成卡片列表，每張卡第一列是姓名與「逾 N 天」，下方是聯絡人、一顆撥號按鈕、一顆「記錄聯絡」按鈕。頁面不能整體橫向溢出。

### 7.2 記錄聯絡對話框（`ContactLogDialog.vue`）

待追蹤分頁、歷程抽屜、預約明細共用同一個元件。

| 欄位 | 規則 |
|---|---|
| 聯絡時間 | 預設現在；可改成較早的時間，不能選未來 |
| 方式 | 單選：電話（預設）、LINE、當面、其他 |
| 結果 | 單選，必選、不預選：聯絡到了／沒聯絡到 |
| 內容 | 聯絡到時必填；沒聯絡到時選填，placeholder「例如：沒接、轉語音信箱」；最多 1000 字 |
| 寫進電訪回應 | 只在「聯絡到了」時出現，預設勾。說明：「會取代目前的電訪回應；統計的未預繳名單顯示的就是電訪回應。」 |
| 下次聯絡 | 必選。快捷：明天 10:00、3 天後、1 週後、下週一（沿用預約明細的算法）；另可自選時間或選「不用再追」。預設：沒聯絡到→明天 10:00；聯絡到→不預選，由使用者決定。已註冊、已退出只顯示「不用再追」，並說明「已註冊或已退出的訪視不需要排下次聯絡」 |

- 送出成功提示：「已記下，下次聯絡 10/08（三）10:00」，或「已記下，不再列入待追蹤」。
- 409：沿用招生規格 B28 的文案「這筆招生訪視剛被其他人修改，已重新載入，請確認後再操作」。對話框不關、內容保留，另說「你的紀錄還沒送出」，重讀後讓使用者再送一次。
- 手機：對話框全螢幕，快捷按鈕自動換行。
- 鍵盤：單選群組都有 `aria-label`，Esc 關閉前若有打字要確認。

### 7.3 歷程抽屜（`EventsDrawer.vue`）

- 標題維持「參觀→入學 歷程」。頂部加「記錄聯絡」「排下次聯絡」兩個按鈕（有 `admissions.write` 且未匿名化時才有；已註冊、已退出不顯示「排下次聯絡」）。
- 時間線合併三種，依時間舊到新：
  1. 招生事件（既有）。
  2. 參觀後聯絡紀錄（新）：「電話・聯絡到了」＋內容＋記錄的人；有 `next_follow_up_at` 時加一行「排下次聯絡 10/08 10:00」。
  3. 參觀前聯絡紀錄：訪視有 `visit_request_id`，且使用者有 `booking.read` 時，另讀預約既有的 `GET /admin/visit-requests/{id}/contact-notes`，標「參觀前」、唯讀。預約已匿名化時照實顯示匿名化文字。讀取失敗只在該段寫「參觀前的紀錄讀不到」，不影響其他內容。
- 抽屜上方摘要：階段、下次聯絡、負責人。

### 7.4 看板、訪視明細與編輯表單

- **看板卡片**（`FunnelCard.vue`，資料來自 `/board` 的 `_card`，`funnel.py:201`）：已訪視、已預繳的卡片，有排下次聯絡時多一行。
  - 已排定：「下次聯絡 10/08」。
  - 已到期：警示色「該聯絡了」。
  - 未排定：不加標示（不自動排之後，這是大多數卡片的預設狀態，標出來只是雜訊）。
- **訪視明細**（`RecordsTab.vue`）：新增「下次聯絡」「負責人」兩欄；篩選加「追蹤」（全部、已到期、7 天內、未排定）與「負責人」。
- **編輯表單**（`RecordDialog.vue`）：不加欄位。「電訪回應」下方加說明：「記錄聯絡時可以同步更新這一格」。

### 7.5 官網預約分頁：批次標記已到場

> 2026-10-05 更新：批次標記已到場已搬到參觀案件列表「只看尚未確認到場」，這個分頁已拿掉。

- 待確認清單加勾選欄與「全選」，工具列「勾選的 N 筆標記已到場」（`booking.handle`）。
- 確認框：「標記 N 筆已到場？會同時建立 N 筆招生訪視，之後在招生入學頁追蹤。沒來的請個別標記未到場。」
- 送出時依序呼叫既有的 `POST /admin/visit-requests/{id}/complete`，每筆各自一個交易，與單筆相同。過程中顯示「標記中 3／8」，按鈕停用。
- 完成：「已標記 N 筆已到場」。有失敗的（409 狀態已被改、網路錯誤）逐筆列出家長稱呼與原因，清單重讀。
- 不新增後端批次端點：每筆本來就要鎖預約列，逐筆處理讓「部分成功」的語意最單純，一天的量也只有幾十筆以內。
- 單筆「已到場」的確認框文案不變（`ArrivalsTab.vue:84`、`VisitDetailView.vue:634`）。

### 7.6 預約明細（`VisitDetailView.vue`）

> 2026-10-05 更新：「參觀後追蹤」區塊已由預約明細的家庭版面取代，見 `docs/specs/2026-10-05-visit-family-page-design.md` 第 5 節。

- **已到場且有招生訪視**：在聯絡紀錄區上方新增「參觀後追蹤」區塊。
  - 內容：招生階段、下次聯絡（已到期用警示色）、負責人、最近聯絡（時間・方式・聯絡到與否）。
  - 按鈕：「記錄聯絡」「排下次聯絡」（有 `admissions.write` 才有；分別開第 7.2 節的對話框與第 6.4 節的改期小視窗）、「到招生入學」（既有連結）。剛標完已到場、還沒排聯絡時，這裡就是最順手的入口。
- **已到場或已取消**：聯絡紀錄框隱藏「下次聯絡」選擇器，改寫一句：
  - 招生啟用時：「已到場的案件請在上方『參觀後追蹤』排下次聯絡。」
  - 招生未啟用或已取消時：「已到場或已取消的案件不會列入到期待追蹤。」
  - 案件上殘留的舊「預定聯絡」不再顯示在頁首（目前已不算到期，`:776`）。
- 其他狀態（含 `no_show`）照舊。

### 7.7 總覽

- 待辦清單新增一項「參觀後該聯絡的家長」（實作回寫：頁首摘要列是固定四格，第五格會破版，所以放進待辦清單，和「案件已到追蹤時間」並列）；只在回應有 `admissions_follow_up_due` 且大於 0 時顯示（開關開啟且有 `admissions.read`）。
- 連結到 `/admissions?tab=followups&campus=<第一個有到期的校區>`；全部是 0 時連到使用者的預設校區。多校帳號在數字下方列各校筆數（只列大於 0 的）。

## 8. 權限

| 動作 | capability |
|---|---|
| 看待追蹤、聯絡紀錄、負責人選單 | `admissions.read` |
| 記錄聯絡、改下次聯絡或負責人 | `admissions.write` |
| 歷程抽屜的參觀前紀錄 | 另需 `booking.read`（沿用既有 API） |
| 批次標記已到場 | `booking.handle`（沿用 `/complete`） |
| 總覽「招生待追蹤」 | `admissions.read`；開關開啟時才回 |

- 一律用 `require_scope(user, capability, [campus_key])`：沒有 capability 回 403，越權校區回 404。以訪視 id 存取時先載入、再用訪視的校區檢查（同招生規格第 7 節）。
- 負責人資格用 `has_capability(user, "admissions.write")` 加 `covers_campus`，不寫角色判斷（`tests/test_permission_table.py`）。
- editor、readonly 沒有招生權限，看不到負責人選單與聯絡紀錄。

## 9. API

前綴 `/api/website/v1/admin/admissions`。改完跑 `npm run contract:generate`，並通過 `npm run contract:check`。

| 方法與路徑 | 權限 | 說明 |
|---|---|---|
| GET `/follow-ups` | read | `campus_key` 必填；`scope`＝`due`（預設）／`upcoming`／`unscheduled`；`owner`＝`me`／`none`／帳號 id；`page`、`page_size`（預設 50、上限 100）。回 `{as_of, campus_key, scope, totals: {due, upcoming, unscheduled}, total, rows}`：`totals` 是全校區三種的數量（不受 `owner` 影響，給分頁標籤與分段按鈕用），`total` 是目前範圍加負責人篩選後的筆數；`upcoming` 只算 7 天內 |
| GET `/records/{id}/contact-logs` | read | 新到舊；每筆帶 `created_by_name`（顯示名稱，沒有用 Email，同招生歷程） |
| POST `/records/{id}/contact-logs` | write | 第 6.3 節；201，回 `{log, visit}` |
| PATCH `/records/{id}/follow-up` | write | 第 6.4 節；回 `RecruitmentVisitOut` |
| GET `/staff` | read | `campus_key` 必填；可當負責人的帳號（啟用中、`admissions.write`、涵蓋該校區）：`{id, display_name, email}`，依顯示名稱排序 |

`FollowUpRowOut`：`visit_id`、`child_name`、`grade`、`stage`、`visit_date`、`contact_name`、`phone`、`follow_up_at`、`follow_up_owner_id`、`follow_up_owner_name`、`follow_up_owner_active`、`last_contacted_at`、`last_contact_channel`、`last_contact_reached`、`version`。

既有端點的變更：

| 端點 | 變更 |
|---|---|
| `RecruitmentVisitOut`（所有回訪視的端點） | 加 `follow_up_at`、`follow_up_owner_id`、`last_contacted_at`。負責人名稱由前端用 `/staff` 對照；對不到（停用或刪除）寫「（已停用）」 |
| GET `/records` | 新篩選 `follow_up`（`due`／`upcoming`／`unscheduled`，條件同第 6.2 節）、`owner`（同 `/follow-ups`） |
| GET `/board` | 卡片加 `follow_up_at` |
| GET `/options` | 加 `contact_channels`（代碼與文案） |
| PATCH `/records/{id}`、POST `/records` | 請求仍不收追蹤欄位（`extra="forbid"`）；POST 依第 6.1 節帶入負責人 |
| GET `/admin/dashboard` | 開關開啟且有 `admissions.read` 時，加 `admissions_follow_up_due`（授權校區合計）與 `admissions_follow_up_due_by_campus`（`{campus_key: 筆數}`）；否則不回這兩個鍵 |
| POST `/admin/visit-requests/{id}/contact-notes` | 第 6.6 節的 422 `FOLLOW_UP_NOT_TRACKED` |

新錯誤碼（`admin/src/api/errors.ts` 補備援文案）：

| 碼 | HTTP | 情況 |
|---|---|---|
| `FOLLOW_UP_IN_PAST` | 422 | 下次聯絡不晚於現在 |
| `FOLLOW_UP_NOT_ALLOWED` | 422 | 已註冊或已退出的訪視排下次聯絡 |
| `FOLLOW_UP_OWNER_INVALID` | 422 | 負責人停用、沒有招生權限或沒有該校區 |
| `CONTACTED_AT_IN_FUTURE` | 422 | 聯絡時間晚於現在 |
| `FOLLOW_UP_NOT_TRACKED` | 422 | 已到場或已取消的預約設下次聯絡 |

稽核新增 action：`recruitment_visit.contact_logged`、`recruitment_visit.follow_up_update`。`admin/src/api/labels.ts` 要補文案，`labelCoverage` 測試會掃字面值。

## 10. 個資與保存

- 聯絡紀錄的內容是家長回應的自由文字，屬於個資，跟著招生訪視的保存政策走（`retention_policies.admissions_days`）。
- `retention.anonymize_visit`（`backend/app/admissions/retention.py:40`）另外清：
  - 這筆訪視所有聯絡紀錄的 `note`（設 null）。
  - `follow_up_at`（CHECK 要求）。
- 保留：聯絡紀錄的 `contacted_at`、`channel`、`reached`、`next_follow_up_at`，訪視的負責人與 `last_contacted_at`。這些不含家長個資。
- 匿名化條件不變（`updated_at` 早於 `now − admissions_days`）。記錄聯絡會更新 `updated_at`，所以還在追的訪視不會在追蹤中途被匿名化。
- 預約的匿名化仍與招生各自獨立；歷程抽屜裡的參觀前紀錄會隨預約匿名化變成匿名化文字。
- **招生規格 Q1 仍是正式站開關的前提**，而且範圍要多涵蓋「參觀後逐次聯絡的內容」。擬稿與上線步驟見附錄 A；園方發布隱私權政策、設好保存天數之前，這份規格做完了正式站也不能開。

## 11. 轉移契約

- `ivy-schema.json`（園務欄位快照）不變；`ivy_visit_row`、`ivy_event_row` 不變。
- `extensions.jsonl` 每列加：`follow_up_at`、`last_contacted_at`（台北時間 naive，同其他時間欄位）、`follow_up_owner_user_id`、`follow_up_owner_name`（只取顯示名稱，不帶 Email，同歷程的 `website_actor`）。
- 新檔 `recruitment_contact_logs.jsonl`（`export.py` 的 `FILES` 加入）。每筆一列：`website_id`、`recruitment_visit_website_id`、`contacted_at`、`channel`、`reached`、`note`、`next_follow_up_at`、`created_by`（`{"user_id", "name"}`）。目錄與檔案權限同其他檔（含個資，0700）。
- `contracts/ivy-recruitment/README.md`：
  - 「延伸欄位的去向」補上新欄位與新檔。
  - 去向（F-Q2，2026-10-04 使用者同意）：園務沒有對應表時，匯入端把聯絡紀錄依時間串成「115.10.05 電話 聯絡到：內容」，附加在 `notes` 末尾；下次聯絡與負責人不轉（園務沒有對應欄位）。
- 契約測試：新檔欄位齊全、`channel` 合法、`recruitment_visit_website_id` 都能接回 `recruitment_visits`、不含 Email。

## 12. 測試與驗收

後端用真 PostgreSQL（隔離測試庫，名稱含 `test`），`recruitment_contact_logs` 加進 `backend/tests/conftest.py` 的 TRUNCATE 清單（`:142`）。到場相關案例沿用招生規格第 14 節的「先 `book_slot`、再把場次日期改到過去」helper，不改系統時間；跟 `now` 有關的案例傳入固定的 `now`。

| 編號 | 案例 | 必須成立 |
|---|---|---|
| F01 | 標記已到場新建訪視（預約沒有下次聯絡） | `follow_up_at` 為 null（未排定）；負責人＝預約承辦人；`created` metadata `follow_up=none` |
| F02 | 承辦人停用、沒有該校區、沒有承辦人 | 負責人改為標記的人；標記的人也不符合時為 null |
| F03 | 預約的下次聯絡晚於現在／早於現在 | 前者沿用（`follow_up=booking`）；後者為 null |
| F04 | 補建、手動新增；已有訪視時重複標記或補建 | 補建同 F01–F03；手動新增 `follow_up_at` 為 null、負責人＝建立者；重複時追蹤欄位不變 |
| F05 | 追蹤三種狀態的邊界（`follow_up_at == now` 算已到期；7 天整） | 與第 6.2 節一致；已註冊、已退出、已匿名化、他校都不列；`owner` 篩選 me／none／id；`totals` 不受 `owner` 影響 |
| F06 | 記錄聯絡 | `version` 加一；`last_contacted_at` 取最大值（補登較早的不會往回改）；`next_follow_up_at` 沒送 422、送 null 清除、送過去時間 422 `FOLLOW_UP_IN_PAST`；聯絡時間在未來 422 `CONTACTED_AT_IN_FUTURE`；聯絡到卻沒寫內容 422；`update_parent_response` 只在聯絡到時可用，會取代電訪回應 |
| F07 | 已註冊、已退出的訪視記錄聯絡或改期 | 下次聯絡非 null 回 422 `FOLLOW_UP_NOT_ALLOWED`；null 可以；聯絡紀錄照記 |
| F08 | 轉到已註冊、退預繳、退註冊；之後取消註冊、取消退出 | 前三者清掉 `follow_up_at`；往回轉後仍為 null（未排定）；負責人保留 |
| F09 | 兩人同時記錄聯絡或改期同一筆 | 後送者 409，聯絡紀錄不寫入、資料不被覆蓋 |
| F10 | 負責人驗證：停用、editor、他校帳號；帳號被刪 | 前三者 422 `FOLLOW_UP_OWNER_INVALID`；刪帳號後為 null |
| F11 | 權限：reception 記錄聯絡；editor／readonly 讀待追蹤；分校帳號用他校訪視 id | 第一個可以；第二個 403；第三個 404 |
| F12 | 開關關閉 | 新端點全部 404；總覽沒有 `admissions_*` 鍵；標記已到場不建訪視（既有行為不變） |
| F13 | 保存政策 | 清聯絡內容與 `follow_up_at`，保留方式、結果、時間；統計結果不變；匿名化後記錄聯絡回 409 |
| F14 | 匯出 | `extensions` 有新欄位；聯絡紀錄檔欄位齊全、外鍵接得回、不含 Email；園務三張表的輸出與改版前相同 |
| F15 | 預約聯絡紀錄 | `completed`、`cancelled` 設下次聯絡回 422 `FOLLOW_UP_NOT_TRACKED`；清除與單純記錄可以；`confirmed`、`no_show` 照舊 |
| F16 | 總覽計數 | 與 `/follow-ups` 的 `totals.due` 一致（同一個條件）；分校帳號只算自己的校區 |
| F17 | 後台單元測試 | 待追蹤三段與負責人篩選、網址還原、分頁標籤數字；對話框預設值、必選、409 保留內容；看板卡片兩種標示（未排定不標）；歷程三種合併排序、沒有 `booking.read` 時不讀參觀前紀錄；預約明細的追蹤區塊與已到場隱藏下次聯絡；批次標記（含部分失敗）；總覽連結 |
| F18 | 1440px 桌機、390px 手機 | 待追蹤（手機為卡片）、對話框、歷程抽屜、批次標記可用，頁面不橫向溢出；截圖存 `output/playwright/` |
| F19 | stack e2e | 兩位家長預約 → 用 psql 把本測試的場次移到昨天 → 官網預約勾兩筆一次標記已到場 → 待追蹤「未排定」有兩筆、「已到期」沒有 → 其中一筆「排下次聯絡」選明天 → 移到「7 天內」→ psql 把它的 `follow_up_at` 移到過去 → 出現在「已到期」、總覽數字為 1 → 記錄聯絡（沒聯絡到、明天）→ 離開已到期 → 標記預繳仍在追蹤 → 標記註冊後下次聯絡被清掉、離開「7 天內」 |

驗證指令（Node 22）：

- `npm --prefix admin run typecheck`、`npm --prefix admin run test:unit -- --maxWorkers=2`、`npm --prefix admin run build`
- `npm run contract:generate`、`npm run contract:check`
- `backend/` 內 `WEBSITE_TEST_DATABASE_URL=… uv run --frozen pytest -q`
- `npm run test:e2e:stack`（自訂 E2E 資料庫名稱與埠）
- 一次只跑一組（本機 8GB）

## 13. 待裁定

F-Q1–F-Q4 已在 2026-10-04 回覆，記在第 2 節。剩下：

| # | 問題 | 現況 | 何時需要 |
|---|---|---|---|
| 招生規格 Q1 | 隱私權政策是否寫明參觀後的招生聯繫與逐次聯絡紀錄；招生訪視保存幾天 | 擬稿完成（附錄 A：補三段文字、保存 730 天），待園方確認文字、補完其他【待確認】、發布並設定天數 | 正式站開啟前 |

## 14. 實作分段

分支 `feature/admissions-follow-up-20261004`，從 `main` 開。migration 接在 `d2b7f4c9e1a3` 之後，開工時用 `alembic heads` 確認只有一個 head。只在 feature 分支提交，未經使用者要求不 push、不併 main、不部署。

1. **A 後端**：
   - migration、models、constants；新模組 `follow_up.py`（狀態條件、負責人資格、記錄聯絡、改期）。
   - `booking_link`、`records`（建立時帶入負責人與預約的下次聯絡、篩選）、`funnel`（清除）、`retention`、`export`、schemas、routes、`/staff`。
   - 預約 contact-notes 防呆、總覽兩個鍵、契約 README。
   - 驗收 F01–F16。
2. **B 後台**：
   - `FollowUpsTab.vue`、`ContactLogDialog.vue`、改期小視窗。
   - `EventsDrawer`、`FunnelCard`、`RecordsTab`、`ArrivalsTab` 批次、`AdmissionsView` 分頁、`VisitDetailView` 追蹤區塊與防呆、`DashboardView`、`labels.ts`、`errors.ts`。
   - 驗收 F17–F18。
3. **C 端到端與文件**：
   - stack e2e（F19）。
   - README 頂部日期段落、DESIGN.md「招生入學」補追蹤規則、`docs/website-admin/acceptance.md` 驗收紀錄、`deploy/README.md`「招生入學」開啟步驟改寫成附錄 A.5 的順序。
   - `CLAUDE.md`「現況容易搞錯的事」：招生入學已併 main、已部署、開關關閉（目前仍寫未併 main、未部署）。

## 附錄 A：招生規格 Q1 擬稿（隱私權政策與保存天數）

2026-10-04 使用者交由 Claude 擬稿。以下是建議，園方在後台發布隱私權政策、設好保存天數之後才算裁定生效。這份不是法律意見；發布前請負責人（或法務）看過，連同政策裡其他【待確認】一起確認。

### A.1 從「同意」改成「告知」

- 2026-10-02 起官網預約不再勾選同意（README 該日段落），所以招生規格 Q1 原本問的「同意書是否涵蓋招生用途」已經沒有同意書可改。
- 家長現在看到的是隱私權政策 `/privacy`（頁尾與預約表單都有連結），以及預約文案裡選填的「個資使用說明」。所以 Q1 要做的是**在隱私權政策寫清楚參觀後的招生用途、記錄哪些內容、保存多久**。
- 後台的隱私權政策初稿已經留了兩個位置（`admin/src/composables/privacyPolicyDraft.ts`）：第 3 段「蒐集目的與利用方式」與第 7 段「保存期間」的【待確認】。另外第 10 段「孩子的資料……只用來安排參觀與判斷適合的班別」跟招生紀錄的用途矛盾，也要一起改。
- 正式站的政策內容存在資料庫；初稿只在從未存過時載入。所以下面的文字是給園方貼進後台的，不改程式裡的初稿。

### A.2 隱私權政策要換掉的三處

貼進後台「全站與素材 → 隱私權政策」。

**第 3 段「蒐集目的與利用方式」**：把「【待確認：參觀後的招生聯繫與紀錄如何使用……】」這一行換成：

> - 您到園參觀後，由參觀校區的人員以電話、LINE 或當面與您聯繫入學事宜，例如回答課程問題、說明名額與報名方式。您可以隨時告訴我們不需要再聯絡，我們就會停止聯繫。
> - 保留參觀紀錄，用來安排後續聯繫與報名：參觀日期、孩子的姓名、生日與適讀班別、聯絡人與電話、每次聯絡的時間與您的回覆，以及是否預繳或註冊。參觀紀錄和預約資料一樣，只有參觀校區的人員看得到。
> - 用參觀紀錄統計招生情形，例如各班別的參觀與報名人數；統計結果不含個人資料。
> - 日後本網站的後台併入本園的園務管理系統時，參觀紀錄會一併移轉，仍只用於上述目的。

**第 7 段「保存期間」**：把「【待確認：參觀後的招生紀錄保存多久】」換成：

> - 參觀後的招生紀錄，在最後一次更新後保存 730 天（約兩年）。到期後刪除孩子的姓名、生日、聯絡人、電話、地址與聯絡內容，只保留不能識別個人的統計資料，例如參觀月份、班別、是否報名。

**第 10 段「孩子的資料」**：整段換成：

> 孩子的姓名與出生年月日由家長提供，用來安排參觀與判斷適合的班別；到園參觀後，也用於第 3 段所說的入學聯繫與參觀紀錄。

### A.3 預約表單的「個資使用說明」（選做）

預約表單已經連到完整的隱私權政策。園方若另外在「預約文案 → 隱私／個資使用說明」放了簡短說明，加一段：

> 到園參觀後，參觀校區可能會聯繫您說明入學事宜，並保留參觀紀錄。保存期間與您的權利，請見隱私權政策。

### A.4 招生訪視保存 730 天的理由

1. **招生週期長。** 常見兩歲先來參觀、隔年才報名小班。保存 365 天，可能在家長做決定之前紀錄就被清掉了。
2. **天數從最後一次更新起算**（`backend/app/admissions/retention.py` 的 `updated_at`）。還在追、還有新聯絡紀錄的不會被清；兩年都沒有任何動靜才清。
3. **清掉的是個資，不是統計。** 匿名化後統計數字不變（招生規格第 11 節），所以這個天數只看「做完一次招生需要多久」，不用為了報表留更久。
4. **併入園務時要能接回學生。** 已註冊的孩子要用姓名＋生日接學生檔（招生規格 12.4 第 6 步）；保存太短，併入前就被匿名化，會接不回去。

園方若想留得比較短，365 天（與預約資料的預設相同）也可以，代價是上面第 1、4 點。保存政策的 DB 限制是 30–3650 天。

### A.5 開啟正式站的順序（由園方或使用者操作）

> 2026-10-05 更新：「招生入學 → 官網預約」分頁已拿掉；已到場但沒有招生訪視的預約，改在預約明細按「建立招生訪視」逐筆補建。

1. 後台「全站與素材 → 隱私權政策」：換上 A.2 的三處，補完其他【待確認】（蒐集者名稱、資料所在地區、寄信服務商、Turnstile 段落、預約資料保存天數、聯絡 Email），填最後更新日期後發布。含【待確認】的版本後端不給發布。
2. （選做）預約文案的個資使用說明加 A.3 那段。
3. 後台「個資與搜尋設定 → 個資保存政策」把「招生訪視」設成 730 天。要讓它每天自動清，還要打開後台的「自動清理」，並在 Railway api 服務設 `WEBSITE_RETENTION_ALLOW_REAL_RUN=true`（`docs/website-admin/operations.md:91`）。
4. 以上都完成後，才在 Railway api 服務設 `WEBSITE_ADMISSIONS_ENABLED=true` 並重新部署 api（`deploy/README.md:232`）。開啟前已到場的預約，到「招生入學 → 官網預約」下方逐筆補建。

## 附錄 B：實作回寫（2026-10-04）

| 項目 | 調整 | 位置 |
|---|---|---|
| 總覽 | 「招生待追蹤」放進待辦清單，不加第五格摘要 | 第 7.7 節；`admin/src/views/DashboardView.vue` |
| 測試編號 | F-Q1 改為不自動排後，F01–F06 合併成 F01–F04，其後順延（共 F01–F19） | 第 12 節；`docs/website-admin/acceptance.md` |
| 聯絡時間 | 送來的聯絡時間比伺服器時間晚 2 分鐘以內當成時鐘誤差、改用現在；再晚才回 `CONTACTED_AT_IN_FUTURE` | 第 6.3 節；`backend/app/admissions/follow_up.py` `CONTACTED_AT_TOLERANCE` |
| 預約端防呆 | `lock_editable` 一併重讀 `status`，鎖住後才判斷已到場、已取消 | 第 6.6 節；`backend/app/booking/workflow_service.py` |
| 對話框寬度 | 記錄聯絡、改期對話框 580px，下次聯絡的六個選項桌機一列放得下；手機記錄聯絡全螢幕 | 第 7.2 節 |
| 看板 | 未排定的卡片不標 | 第 7.4 節（F-Q1 之後已寫入） |
