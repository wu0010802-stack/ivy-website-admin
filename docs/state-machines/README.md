# 狀態機

這個專案裡「有幾種狀態、哪些轉移合法、由誰寫入」原本只存在各個函式的 `if` 裡。2026-11-17 把它們盤點出來，定了一個做法。

## 做法

**後端一張登記表當唯一來源，其他都從它產生；執行期的程式不動。**

| 東西 | 位置 | 誰維護 |
|---|---|---|
| 登記表 | `backend/app/state_machines.py` | 人（或 agent）手寫 |
| 守門測試 | `backend/tests/test_state_machines.py` | 登記表與程式分歧就紅 |
| 狀態圖與轉移表 | [domain.md](domain.md) | 自動產生 |
| 前端用的狀態清單 | `contracts/state-machines.json` | 自動產生 |
| TypeScript 型別 | `contracts/generated/state-machines.d.ts` | 自動產生 |
| 後台標籤涵蓋測試 | `admin/src/__tests__/stateMachineLabels.test.ts` | 後端加狀態、後台沒補標籤就紅 |

為什麼不引進狀態機套件、也不把守衛改成讀表：現有的守衛都有測試、帶著業主裁定過的例外（提早到、冪等取消、租約過期重領），改寫只有風險沒有新行為。登記表只描述、測試負責對齊，正式站的行為一行都沒變。招生階段是例外——它本來就是讀表執行（`funnel._CAPABILITY`），登記表直接讀那張表，不另抄一份。

守門測試檢查四件事：

1. 狀態值和 model 的 Enum 或資料庫 CHECK 相同。
2. 每條轉移寫的函式存在，而且函式裡真的寫了那個狀態。
3. 登記以外的檔案不准寫 `status`／`review_status`（新的寫入點要先登記）。
4. 預約案件對後台端點做 4 個狀態 × 3 個動作全組合：表上沒有的一律 409、狀態不動。

## 要改狀態時

1. 先讀 [domain.md](domain.md) 裡那一台的圖與轉移表。
2. 改 `backend/app/state_machines.py`（加狀態、加轉移、或把新檔案加進 `writers`），再改對應的 service。新增狀態值要連資料庫 CHECK 一起改（寫 migration）。
3. `npm run contract:generate` 重新產生三個檔。
4. 跑 `cd backend && uv run pytest tests/test_state_machines.py`，以及 `npm --prefix admin run test:unit -- stateMachineLabels`（後台有畫面的狀態要補中文標籤，用字和登記表相同）。

轉移的寫入集中在該狀態機的 service 裡，不要在路由直接寫 `xxx.status = …`。

## 前端的流程狀態

前端沒有登記表：畫面流程多半是幾個 `ref` 拼出來的，各自有測試，這次沒有重寫。新寫或大改流程時照下面的既有寫法，不要再加一組互相牽制的布林。

- **一個流程一個具名狀態**：用單一 union 的 `ref` 或 `computed`，不用多個布林。範例：後台 `ResetPasswordView.vue` 的 `PageState`、`usePushNotifications.ts` 的 `PushState`、`MediaReplaceDialog.vue` 的 `step`、`useVisitCase.ts` 的 `pendingAction`（`busy` 由它推導）；官網 `AnniversaryIntro.vue` 的 `state`、`SiteHeader.vue` 的 `headerState`、`pages/preview.vue` 的 `status`、`NewsDialog.vue` 的 `view`。
- **會被新請求取代的讀取**：後台用 `composables/useRequestSequence.ts`（`begin()`／`isCurrent()`），回應、錯誤、`loading` 都要先確認還是最新的那一次。
- **後端狀態的型別**：從 `contracts/generated/state-machines.d.ts` 引用，不手寫 union。
- **邏輯放純函式**：判斷抽到 `utils/`（官網）或 `composables/`（後台）的純函式並寫單元測試，元件只接線。範例：官網 `utils/entrance-timeline.ts`、`utils/visit-result.ts`、`utils/third-party-analytics.ts`；後台 `composables/visitCaseStage.ts`。
- **要撐過重新整理的狀態**：放 `sessionStorage`，讀回來時驗形狀（內容使用者改得到），而且只放填到一半的東西。範例：官網預約表單的草稿（`VisitForm.vue` 的 `restoreDraft`、`utils/idempotency-key.ts` 的 `restoredIdempotencyKey`）。預約成功就清掉草稿；之後要找回修改入口靠伺服器發的 HttpOnly cookie（`VisitRememberedNotice.vue`，只顯示日期、場次、校區），不把姓名電話留在瀏覽器。

### 現有流程在哪裡（2026-11-17 盤點）

後台 `admin/src/`：

| 流程 | 檔案 | 狀態怎麼表示 |
|---|---|---|
| 登入與 session | `stores/auth.ts`、`router/index.ts`、`router/unauthorized.ts` | `user`、`previousUserId`、`logoutPending` 推導；401 就地恢復有防重入 |
| 內容編輯器 | `composables/useContentItem.ts`、`components/ContentEditor.vue` | `saving`／`publishing`／`conflict` 加 `snapshot`；按鈕可用性集中在 `ContentEditor` 的 computed |
| 案件明細 | `composables/useVisitCase.ts`、`composables/visitCaseStage.ts` | `pendingAction` 單一來源；畫面階段是 `caseStage` 純函式 |
| 案件列表 | `views/VisitRequestsView.vue` | 約十個旗標，靠 `loadVersion` 擋過時回應 |
| 素材上傳 | `composables/mediaUpload.ts` | `UploadStatus` union 加 `running` |
| 替換素材 | `components/MediaReplaceDialog.vue` | `step` union 加 `busy` |
| 重設密碼頁 | `views/ResetPasswordView.vue` | `PageState` union |
| 推播開關 | `composables/usePushNotifications.ts` | `PushState` union |
| 帳號管理 | `views/UsersView.vue` | 多個旗標，由 `operationBusy` 彙總 |
| 匯入 | `components/admissions/imports/*ImportCard.vue` | 選檔 → 預覽 → 確認 → 套用，多個旗標 |

官網 `web/app/`：

| 流程 | 檔案 | 狀態怎麼表示 |
|---|---|---|
| 預約表單 | `components/VisitForm.vue`、`components/VisitRememberedNotice.vue` | 步驟由網址決定；設定、場次、送出、結果各一組 `ref`；草稿放 `sessionStorage`，成功後的修改入口靠記住預約的 cookie |
| 家長改期／取消 | `pages/visit/manage.vue`、`composables/useParentVisit.ts` | `pending`／`busy`／`unavailable`／`error` 加三個互斥面板 |
| 頁首 | `components/SiteHeader.vue` | `headerState` union 加選單的開、關、動畫中 |
| 孩子的一天 | `components/DayExperience.vue`、`components/DayMomentCard.vue` | 影片與拍立得各自多個旗標；WebGL 名額在 `utils/paper-budget.ts` |
| 首屏影片 | `components/HeroVideo.vue` | 多個旗標加閉包變數 |
| 進站布幕 | `components/EntranceCurtain.vue`、`utils/entrance-policy.ts`、`utils/entrance-timeline.ts` | `<html data-ivy-entrance>` 加元件內的 `phase`；時間軸是純函式 |
| 30 週年開場 | `components/AnniversaryIntro.vue` | `state` union |
| 第三方分析 | `utils/third-party-analytics.ts` | 純函式工廠，閉包內六個旗標 |
| 已發布內容 | `server/utils/published-site.ts` | 新鮮 → ETag 重驗 → 失敗退回上一份 → 沒有舊內容才 503 |
