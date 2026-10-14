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
- 只讀：連線設成 `default_transaction_read_only`，不改任何資料；所有校區在同一個 REPEATABLE READ 交易內查詢，五份資料是同一個快照。
- 每個校區一個資料夾，五個 JSONL：`recruitment_visits`、`recruitment_event_log`、`grade_intake_targets`、`extensions`、`recruitment_contact_logs`（2026-10-04 起，參觀後聯絡紀錄）。
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

`extensions.jsonl` 每筆訪視一列：`{"website_id", "visit_request_id", "enrolled_on", "tour_guide_user_id", "tour_guide_name", "english_name", "father_occupation", "mother_occupation", "follow_up_at", "last_contacted_at", "follow_up_owner_user_id", "follow_up_owner_name"}`。`english_name`、`father_occupation`、`mother_occupation` 是 2026-10-05 照園方紙本「幼兒基本資料」補的（英文名字、父親職業、母親職業），依保存政策匿名化後為 `null`。後四個是參觀後追蹤（2026-10-04）：時間是台北時間 naive；負責人名稱只放顯示名稱，沒設時為 `null`，不帶 Email。

`recruitment_contact_logs.jsonl` 每筆參觀後聯絡一列（官網延伸，園務沒有對應的表）：`{"website_id", "recruitment_visit_website_id", "contacted_at", "channel", "reached", "note", "next_follow_up_at", "created_by"}`。`channel` 是 `phone`／`line`／`in_person`／`revisit`／`other`（電話、LINE、當面、再參觀、其他；`revisit` 是 2026-10-05 加的）；`note` 依保存政策匿名化後為 `null`；`created_by` 是 `{"user_id", "name"}`（同歷程的 `website_actor`，沒有記錄者時為 `null`）。

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
| `grade_intake_targets.updated_by` | — | 不匯出：官網延伸（最後修改計畫名額的官網帳號），園務 `grade_intake_targets` 沒有對應欄位 |
| `follow_up_at`、`follow_up_owner_id`、`last_contacted_at` | — | 官網延伸（參觀後追蹤，2026-10-04），只放在 `extensions`；園務沒有對應欄位，下次聯絡與負責人不轉 |
| `english_name`、`father_occupation`、`mother_occupation` | — | 官網延伸（2026-10-05 照紙本補），只放在 `extensions`；園務招生沒有這些欄位（學生檔也沒有英文名、職業），併入時再決定放哪 |
| `recruitment_contact_logs` | `notes` 末尾 | 2026-10-04 使用者裁定（追蹤規格 F-Q2）：園務沒有對應表時，匯入端把同一筆訪視的聯絡紀錄依 `contacted_at` 舊到新串成「115.10.05 電話 聯絡到：內容」（沒聯絡到寫「沒聯絡到」；`note` 為 `null` 時只寫前半），一筆一行附加在 `notes` 末尾 |

其餘欄位名稱、型別、長度與園務相同，原樣轉。

## 歷程 metadata 與園務不同的地方（匯入端要對應）

`recruitment_event_log.metadata_json` 原樣匯出（只多 `website_actor`），下列事件的形狀與園務不同，匯入端要轉：

| 事件 | 官網寫法 | 園務寫法 | 匯入時 |
|---|---|---|---|
| `seat_reserved`、`seat_released` | `metadata_json` 是 `{"grade": 年級名稱, "school_year", "semester"}`；`from_stage`／`to_stage` 寫事件當下的階段（保留只會是 `deposited`；釋放也可能發生在 `visited`、`withdrawn`，保留座位在退預繳、取消預繳後不會自動清掉） | `{"grade_id": class_grades.id, "school_year", "semester"}`；`from_stage`／`to_stage` 固定 `deposited` | `grade` 依該租戶 `class_grades` 換成 `grade_id`（對不上留 null 並列入報告）；`from_stage`／`to_stage` 改寫成 `deposited` 與園務一致 |
| `converted` | `{"website_manual": true, "grade": 年級名稱, "school_year", "semester"}`；`student_id` 為 null（官網沒有學生檔） | `{"enrollment_seq", "enrollment_school_year", "classroom_id"}`；`student_id` 指向轉化建立的學生 | `enrollment_school_year` 取 `school_year`；`enrollment_seq`、`classroom_id` 官網沒有，留 null；`student_id` 用上面「`enrolled`」那列比對到的學生填，比對不到留 null；`website_manual` 保留，標示這是官網手動標記的註冊、不是園務轉化流程產生的 |

其他事件（`deposit_added`、`deposit_removed`、`revert_converted`、`withdrawn`、`withdraw_cancelled`）官網不寫 metadata（只有 `website_actor`）。

## 刻意與園務不同的地方（併入時由園務決定要不要跟進）

1. 統計比率分母為 0 回 `null`（畫面顯示「—」）；園務回 0，會把「沒有資料」看成「轉換率零」。
2. 來源分析依原文分組；園務的來源別名合併表（`_SOURCE_GROUP_ALIASES`，義華專屬字詞）沒有移植。
3. 主鍵是 uuid、時間存 UTC（匯出時才轉台北時間 naive）。
4. 「已註冊」只有 `enrolled` 旗標與註冊日期 `enrolled_on`，沒有學生檔；退註冊、取消註冊只要 `admissions.convert`，不刪學生檔。
5. 年級固定四個名稱（幼幼班、小班、中班、大班），存名稱不存 `class_grades.id`。
6. 官網多寫 `created` 事件（`metadata_json.origin` 為 `manual` 或 `visit_request`）；園務不寫，匯出時略過。
7. 狀態不允許的轉換回 422 `TRANSITION_NOT_ALLOWED`；園務回 400。
8. 月比（本月對上月）任一邊是 `null`，差值也是 `null`；園務會算成 100.0－0，上月沒資料就誤報。「本月漏斗轉換下滑」警示 2026-10-12 起不再看月比，改由第 19 點判斷。
9. 同票排序：園務的班別、接待人員、介紹者 × 來源、未預繳原因只有單鍵降序，同票順序看資料庫；官網一律加第二鍵「標籤字串升序（Python 字碼順序）」。來源分析照園務三鍵（參觀降、預繳降、來源升）。來源失衡同占比時取標籤升序的第一個（園務取 SQL 回傳順序）。
10. 警示與行動入口的 `target_tab`：官網是 `records`（`target_filter.month`）／`nodeposit`／`source`，園務是 `detail`／`nodeposit`／`area`。行動入口「查看區域機會」（`AREA_OPPORTUNITY`）改成「查看來源結構」（`REVIEW_SOURCE`），只在來源失衡時出現：官網的區域分析（2026-10-08 起，見第 18 點）不做市場機會判讀，警示與行動入口都不指到區域分析。
11. 未預繳：`/stats` 只回分布與數字（`no_deposit_reasons`、`no_deposit_priority`、`no_deposit_summary`）；名單是 `GET /no-deposit-records`（對應園務 `/no-deposit-analysis`），query 與 `summary` 口徑照抄，另篩入學學年學期，每列只回畫面要的欄位（不含電話、地址、生日）。母體同園務：未預繳且未退出（退預繳後殘留的高潛力原因不算）。排序：園務 `ORDER BY month DESC, seq_no` 是字串排序（同月「10」排在「2」前面，`99.12` 排在 `115.01` 前面），官網改成民國月份排序鍵降序、序號開頭數字升序（沒有數字的排在後面），再以 `created_at`、`id` 收尾。已匿名化的列不另標示（姓名欄已是匿名化文字）。
12. 統計的參考月份必須是三位數民國年月（`115.09`）；格式錯（含 `99.12`）回 422 `INVALID_REFERENCE_MONTH`（訊息照園務原文），園務是未處理的 `ValueError`（500）。
13. 唯一幼生 `unique_visit`／`unique_deposit` 對已匿名化的列以列 id 計：匿名化後姓名與生日都被清掉，照「姓名｜生日」去重會把不同孩子併成同一個；代價是同一個孩子的一筆訪視匿名化後，唯一幼生由 1 變 2（六個計數與比率不受影響）。
14. 五校比較（`GET /compare`）是官網延伸，數字是招生案件數（同一個孩子在兩校各參觀一次算兩筆）；回物件 `{as_of, school_year, semester, rows}`，比率附分子分母；併入後對應園務平台層的跨租戶報表。
15. 同階段轉換（X→X）回 422 `TRANSITION_NOT_ALLOWED`；園務回 409 `STAGE_ALREADY`。
16. 未預繳的「逾期」（預設 14 天、`overdue_days`）與「冷名單」（90 天）看**參觀日** `visit_date`：參觀日 <= 台北今天－N 天就算（2026-10-06 起）；園務看 `created_at`（建檔時間 <= 現在－N 天），補登舊訪視或預約隔很多天才按已到場時，逾期會從建檔那天重新起算。近 30／90 天、來源失衡的 90 天窗口仍照園務看 `created_at`。
17. 訪視明細的 `has_deposit=false` 篩選排除已退出（`withdrawn_at` 有值）的列，和統計的未預繳同一批（2026-10-06 起）；園務明細的「未預繳」篩選只看 `has_deposit`。
18. 區域分析（2026-10-08，`docs/specs/2026-10-08-admissions-area-design.md`）：`district` 由官網伺服器從**地址文字**解析出行政區名填寫（行政區字串，例「三民區」；舊高雄縣鄉鎮市如「仁武鄉」轉成新區名；門牌資料尚未匯入、只比對到區、里有歧義時也有值），表單仍不收；高雄市門牌坐標開放資料只用來補里與座標（到本校的距離），不決定行政區。外縣市地址（`outside_kaohsiung`）與解析不出高雄市區名的地址，官網的 `district` 為 NULL；園務由後端 regex 從地址切出「○○區」（未寫進欄位時查詢當下解析），外縣市地址也會切出該縣市的「○○區」。兩邊口徑不同（官網只認高雄市 38 區並處理舊高雄縣鄉鎮、外縣市留空；園務 regex 只認「○○區」字樣、不分縣市），併入時要擇一。官網另有 `recruitment_visit_geo`（里、比對等級、未定位原因、到本校直線距離），以及公開資料表 `geo_doorplates`、`geo_kindergartens`、`geo_dataset_status`（之後另有 `geo_village_population`，2026-10-14 起再加各里出生、遷入遷出、年齡的月份歷史 `geo_village_births`、`geo_village_migration`、`geo_village_ages`，以及各里所得 `geo_village_income`、新成屋交屋 `geo_new_home_sales`；同日另加托嬰名單 `geo_babycare` 與附近園所異動紀錄 `geo_provider_events`），都不在轉移契約內。官網不做地址分析同意勾選，`geocoding_consent_at` 仍不填；家長地址不送任何外部服務（園務送 Google／TGOS）。匿名化時清掉里與距離、保留 `district`（同園務）。
19. 預繳速度與可能範圍（2026-10-12，`docs/specs/2026-10-12-admissions-deposit-pace-design.md`），都是讀取時計算、不改資料表與匯出：
    - `/stats` 新增 `deposit_timing`（參觀後第 7／14／30／60／90 天累積預繳率、`visits_reached`、`half_by_day`、`missing_time`；預繳少於 10 筆時 `status: insufficient`）與 `deposit_pace`（參考月份的應有／實際預繳數與 `slow`）。
    - 預繳時間取最後一筆 `deposit_added` 事件（台北日期）；之後退出的也算預繳過。參觀日在未來、預繳過卻沒有 `deposit_added` 事件的訪視不列入。補登舊訪視會讓天數偏長。
    - `FUNNEL_DROP`（標題改「本月預繳比過去慢」）：不再比月比的百分點、也不再比參觀轉註冊；改用其他月份（含參考月份之後的月份）的訪視算「參觀後第 N 天累積預繳率」（Kaplan–Meier），算出參考月份每位家長到今天應有的預繳數，實際明顯偏少（Poisson-binomial P ≤ 0.10 且少 2 筆以上）才報；其他月份的預繳少於 10 筆不判斷。訊息改寫為「{月份} 參觀的 {n} 位家長，依過去的預繳速度到今天應有約 {E} 筆預繳，實際預繳過 {O} 筆（含之後退出）。」園務照月比 −10 個百分點判斷，月初家長還沒到預繳時間就會誤報。
    - `SOURCE_IMBALANCE`：占比 ≥ 40% 不變；判斷從「預繳率低於整體」改成「這個來源近 90 天的家長，依同一個 90 天窗口內其他來源的預繳速度明顯偏少」，新來源剛投放、或這一季大家都慢都不會誤報。訊息改寫為「{來源} 近 90 天占比 {x}%，依其他來源的預繳速度應有約 {E} 筆預繳，實際預繳過 {O} 筆（含之後退出）。」，行動入口 `REVIEW_SOURCE` 描述改為「{來源} 近 90 天占比 {x}%，預繳比其他來源慢，先看這個來源的後續追蹤。」（第 9、10 點的排序與 target 規則不變）。
    - 班別、來源、帶參觀老師、行政區、里、距離帶、五校比較每列多 `visit_to_deposit_range`：Beta 收縮（事前強度 10、全體 (預繳+1)/(參觀+2)）的 80% 範圍。
    - 算法集中在 `backend/app/admissions/estimation.py`（只用標準函式庫），併入時由園務決定要不要跟進。

## 漂移檢查（手動，不進 CI）

```bash
cd backend
uv run python scripts/check_ivy_recruitment_contract.py --ivy-backend ../../ivy-backend
```

只用 `ast` 讀園務原始碼（不 import、不連資料庫），比對 `ivy-schema.json` 的欄位、未預繳原因與優先度、來源分類、階段、事件類型、退出來源；年級在園務前端，不在檢查範圍。準備併入前、或園務招生模組有改動時執行；不一致就更新快照與本文件、評估官網要不要跟進，並把 `ivy_backend_commit` 改成新的 commit。

## 合約測試（進 CI）

`backend/tests/test_admissions_contract.py` 用合成資料跑匯出，逐列檢查：欄位齊全、型別可轉換、長度不超過園務欄位、NOT NULL 成立、列舉值合法、民國月份與日期格式、歷程都接得回訪視。
