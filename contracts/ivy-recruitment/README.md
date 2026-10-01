# 招生入學轉移契約（官網 → 園務）

官網後台的招生入學模組（`backend/app/admissions/`）照抄園務的資料模型，併入園務
（ivyManageSystem）時整批轉移。本目錄是兩邊的契約：

| 檔案 | 內容 |
|---|---|
| `ivy-schema.json` | 園務三張表的欄位（名稱、型別、長度、可否為空）與列舉值快照 |
| `grade-cases.json` | 年級與學期換算的共用案例（官網後端、官網前台、後台都讀） |

對齊的園務版本：`ivy-backend` `dfd230c3`。規格：`docs/specs/2026-09-30-website-admissions-design.md` 第 5、12 節。

## 怎麼匯出

```bash
cd backend
uv run python scripts/export_ivy_recruitment.py --campus yihua=1 --campus renwu=3 --out <輸出目錄>
```

- `--campus 校區=租戶編號` 可以給多個；校區對租戶不寫死（明華、崇德、國際的租戶還不存在）。
- 只讀：連線設成 `default_transaction_read_only`，不改任何資料。
- 每個校區一個資料夾，四個 JSONL：`recruitment_visits`、`recruitment_event_log`、`grade_intake_targets`、`extensions`。
- 內容含幼生姓名、生日、家長電話：資料夾 0700、檔案 0600，已存在的檔案不覆寫。用完刪除，不要放進 repo 或雲端硬碟。

## 列的格式

前三個檔每一列都是：

```json
{"website_id": "官網 uuid", "columns": {"園務欄位": "值"}, "mapping": {"匯入時要對應的官網值": "值"}}
```

- `columns` 只有園務表的欄位（`ivy-schema.json` 的欄位扣掉 `id`），可以直接 INSERT；園務重新配 `id`。
- 外鍵與年級 id 在 `columns` 一律是 `null`，由匯入端依 `mapping` 填：

| 表 | `columns` 留空的欄位 | 用 `mapping` 的哪個值填 |
|---|---|---|
| `recruitment_visits` | `provisional_grade_id` | `mapping.provisional_grade`（年級名稱）→ 該租戶 `class_grades.id` |
| `recruitment_visits` | `tour_guide_employee_id` | `mapping.tour_guide_name` → 同名員工；對不上留空並列入報告 |
| `recruitment_event_log` | `recruitment_visit_id` | `mapping.recruitment_visit_website_id` → 這次匯入的新訪視 id |
| `grade_intake_targets` | `grade_id` | `mapping.grade`（年級名稱）→ 該租戶 `class_grades.id` |

- `recruitment_visits.columns.tenant_id` 用命令列給的租戶編號；`mapping.campus_key` 是官網校區。
- `student_id`、`actor_user_id`、`expected_start_label` 一律 `null`：官網沒有學生檔；官網帳號沒有對應的園務帳號（改記在 `metadata_json.website_actor`，見下）；`expected_start_label` 由園務依備註重算。

`extensions.jsonl` 每筆訪視一列：`{"website_id", "visit_request_id", "enrolled_on", "tour_guide_user_id", "tour_guide_name"}`。

## 欄位轉換

| 官網 | 園務 | 規則 |
|---|---|---|
| `id`（uuid） | `id`（Integer） | 重新配發；歷程靠 `mapping.recruitment_visit_website_id` 重接 |
| `campus_key` | `tenant_id` | 命令列的對照 |
| `visit_date`（Date） | `visit_date`（String 50） | 民國字串 `115.09.08` |
| `month`、`seq_no` | 同名 | 原樣（`115.09`；同校同月序號） |
| `birthday`、`enrolled_on` | `birthday`；`extensions` | ISO 日期 `2026-09-08` |
| `created_at`、`updated_at`、`withdrawn_at`、`geocoding_consent_at`、歷程 `created_at` | 同名（DateTime，台北時間 naive） | 官網存 UTC，匯出轉台北時間、去掉時區 |
| `provisional_grade`（年級名稱） | `provisional_grade_id` | 見上表 |
| `grade_intake_targets.grade` | `grade_id` | 見上表 |
| `tour_guide_user_id`／`tour_guide_name` | `tour_guide_employee_id` | 見上表；兩個都另外放在 `extensions` |
| 歷程 `actor_user_id` | `metadata_json.website_actor` | `{"user_id": 官網帳號 uuid, "name": 顯示名稱}`（沒設顯示名稱時 `name` 為 `null`，匯出檔不帶同事 Email）；`actor_user_id` 留空 |
| `visit_request_id` | （沒有對應欄位） | 放在 `extensions`；官網預約模組併入時再對應新 id |
| `enrolled` | 同名 | 園務以學生檔為準：`enrolled=true` 的依「姓名＋生日」唯一比對學生，設 `students.recruitment_visit_id`；比對不到或多筆的列入人工清單，不自動建學生 |
| `version`、`anonymized_at`、`created` 事件 | — | 不轉（`created` 是官網延伸，建立時間以 `recruitment_visits.created_at` 為準） |

其餘欄位名稱、型別、長度與園務相同，原樣轉。

## 刻意與園務不同的地方（併入時由園務決定要不要跟進）

1. 統計比率分母為 0 回 `null`（畫面顯示「—」）；園務回 0，會把「沒有資料」看成「轉換率零」。
2. 來源分析依原文分組；園務的來源別名合併表（`_SOURCE_GROUP_ALIASES`，義華專屬字詞）沒有移植。
3. 主鍵是 uuid、時間存 UTC（匯出時才轉台北時間 naive）。
4. 「已註冊」只有 `enrolled` 旗標與註冊日期 `enrolled_on`，沒有學生檔；退註冊、取消註冊只要 `admissions.convert`，不刪學生檔。
5. 年級固定四個名稱（幼幼班、小班、中班、大班），存名稱不存 `class_grades.id`。
6. 官網多寫 `created` 事件（`metadata_json.origin` 為 `manual` 或 `visit_request`）；園務不寫，匯出時略過。
7. 狀態不允許的轉換回 422 `TRANSITION_NOT_ALLOWED`；園務回 400。

## 漂移檢查（手動，不進 CI）

```bash
cd backend
uv run python scripts/check_ivy_recruitment_contract.py --ivy-backend ../../ivy-backend
```

只用 `ast` 讀園務原始碼（不 import、不連資料庫），比對 `ivy-schema.json` 的欄位、未預繳原因與優先度、來源分類、階段、事件類型、退出來源；年級在園務前端，不在檢查範圍。準備併入前、或園務招生模組有改動時執行；不一致就更新快照與本文件、評估官網要不要跟進，並把 `ivy_backend_commit` 改成新的 commit。

## 合約測試（進 CI）

`backend/tests/test_admissions_contract.py` 用合成資料跑匯出，逐列檢查：欄位齊全、型別可轉換、長度不超過園務欄位、NOT NULL 成立、列舉值合法、民國月份與日期格式、歷程都接得回訪視。
