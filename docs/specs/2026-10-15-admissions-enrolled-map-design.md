# 在籍學生分布（2026-10-15）設計

日期：2026-10-15
狀態：10-15 實作完成、本機驗證通過（含真實清冊本機比對），待部署。設計經使用者 10-15 在對話中逐段同意（資料與匯入、API 與畫面）；實作時依真實清冊的比對結果補強的部分已回寫本檔（§3.2、§3.4）
基準：`origin/main` `aae0debc`
分支：`feature/enrolled-map-20261015`（worktree `~/Repositories/ivy-website-wt/enrolled-map-20261015`）

## 1. 背景與目標

使用者要在招生入學 → 統計分析 → 區域分析（`/admin/admissions?campus=yihua&tab=stats&sub=area`）看「在籍學生住在哪裡」，並能依年齡分組。區域分析目前只有招生端的資料（參觀家長、公開人口、新屋），官網沒有任何學生名冊（`docs/specs/2026-09-30-website-admissions-design.md` 寫明「官網沒有學生檔」）。

第一份資料是使用者從全國教保資訊網匯出的義華幼生清冊（`園所幼生清冊資料匯出.xls`，抬頭「高雄市私立常春藤幼兒園幼生清冊」、列印日期 2026/10/15，192 位）。這個檔案**不進版控**，也不放進 worktree。

### 1.1 成功標準

1. 區域分析的地圖模式多一顆「在籍學生」，義華切過去後，每位學生在地圖上有一個點（座標取整到約 100 m），可以用班別篩選。
2. 地圖下方有「在籍學生」表，包含距離分布（距離帶 × 班別）與里排行，兩張都可以匯出 CSV。
3. 這份清冊至少九成學生有點（exact／nearby）；沒有點的學生依原因列出人數。
4. 學生地址不離開使用者的 Mac：比對在本機完成，正式站只收去識別結果。

### 1.2 使用者裁定（2026-10-15）

| # | 事項 | 裁定 |
|---|---|---|
| E1 | 資料怎麼進系統 | 使用者交檔，由 agent 匯入一次；後台**不做上傳**，之後要更新再交檔 |
| E2 | 年齡分組 | **班別**（幼幼／小／中／大），以清冊所在學年、9/1 足歲為基準，沿用 `academic.grade_for_birthday` |
| E3 | 呈現方式 | **每位學生一個點**（不是依里上色）。這是在「在籍學生」這份新資料上推翻 10-08 規格 §10「不存家長座標」的規則；訪視資料維持不存座標 |
| E4 | 比對在哪裡做 | **本機比對**，正式站只匯入去識別 JSON |

### 1.3 實作裁定（預設值，使用者可改）

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| E5 | 座標精度 | 緯度、經度各取到小數 3 位（南北約 111 m、東西約 103 m） | 足以看出街區尺度的聚集，又不會精確到門牌；資料庫用 `numeric(6,3)`／`numeric(7,3)` 強制 |
| E6 | 同一格多人 | 後端依取整座標合併成一點，回傳各班人數；2 位以上的點畫大一級 | 手足同住或鄰居不會疊成看不見的點；點開寫「這附近 N 位」 |
| E7 | 9/1 未滿 2 歲 | 算**幼幼班** | 這份清冊有 1 位，10/15 前已滿 2 歲，實際在幼幼班 |
| E8 | 9/1 已滿 6 歲 | 歸「其他」：計入總數，篩選只在人數大於 0 時出現 | 不強行塞進大班；這份清冊沒有 |
| E9 | 班別上色 | 點一律用操作藍（`--admin-accent`，白色描邊），班別用篩選切換 | 地圖上已經有四種幼兒園類型色、本機構金、托嬰洋紅、招生機會玫瑰，再加四色會和幼兒園圓點混淆 |
| E10 | 距離 | 查詢時才用取整座標和**目前的**本校座標計算，取整到 100 m，分帶沿用 `area.DISTANCE_BANDS`（0-1、1-3、3-6、6+、none） | 不存距離欄位；校址變了也不用重匯。取整誤差最多約 75 m，對公里級的分帶影響可以忽略 |
| E11 | 誰看得到 | 和區域分析其他端點相同：`admissions.read`＋校區範圍（總部、該校 `campus_admin`、`reception`） | 這些角色本來就看得到訪視明細地址 |
| E12 | 重新匯入 | 該校整批取代（單一交易） | 清冊是某一天的快照，不做增量 |

### 1.4 不做

- 後台上傳清冊（E1）。
- 門牌換版後自動重比：正式站沒存地址，也無從重比；快照固定在匯入時的門牌版本（115-10），畫面會寫出清冊日期與門牌版本。
- 依里上色、熱力圖、聚合群集（cluster）：192 個點用不到。
- 其他四校：資料格式相同時用同一套流程匯入，不另寫程式；沒匯入的校按鈕停用。
- 性別、入學日期、實際年齡：清冊有這些欄位，但不匯入。

## 2. 清冊格式（教保資訊網匯出）

- 檔案是 UTF-8 HTML，副檔名 `.xls`（`<meta http-equiv=Content-Type …>` 開頭），內含兩個 `<table>`：
  - 第一個是抬頭：機構名稱，加上「列印日期：YYYY/MM/DD」。
  - 第二個是名冊：欄位為 `編號`、`性別`、`出生日期`（YYYY/MM/DD）、`通訊地址`、`入學日期`、`實際年齡`，沒有姓名。
- 解析只用標準庫 `html.parser`，不加 `openpyxl` 之類的套件。
- **必要欄位**只有 `出生日期`、`通訊地址`（依表頭文字找欄，不依位置）；其餘欄位讀了就丟。
- **列印日期**決定學年：`academic.current_term(列印日期)[0]`，例如 2026/10/15 → 115 學年。找不到列印日期時，CLI 要求用 `--roster-date` 指定，不自己猜。
- 地址的實際樣態（2026/10/15 這份，只記統計，不記內容）：
  - 165 筆以「〇〇里〇鄰」開頭，沒有縣市與區；6 筆以「〇〇里」開頭、沒有鄰；19 筆直接從路名開始。
  - 只有 2 筆寫了完整縣市區（含外縣市）。
  - 另有 10 筆地址和別筆完全相同，推測是手足。
- 現有 `parse_address()` 要求地址以區開頭，這份清冊有 190 筆會整筆解析失敗。所以要先補行政區（§3.2）。

## 3. 本機比對

程式放在 `backend/app/admissions/enrolled/`，**正式站也會部署**（同一包程式），但比對指令只在本機對本機資料庫跑。

### 3.1 本機比對庫

- 用專屬的本機 PostgreSQL 庫（例如 `ivy_website_enrolled_1015`）：
  1. `alembic upgrade head`；
  2. 匯入已發布的校區內容，`campus_point()` 要從這裡取得校址；
  3. `geo-sync --doorplates-file <115-10 CSV>`，CSV 在本機從高雄市資料平台下載。
- 門牌版本必須和正式站使用中的版本相同（目前是 115-10）。
- 用完把這個庫刪掉。

### 3.2 補行政區（`enrolled/locate.py`）

輸入是一筆地址文字；輸出是 `GeoMatch`（沿用 `matcher.GeoMatch`），另加一個「補區方式」。

0. **異體字**（2026-10-15 依真實清冊比對結果補強）：清冊常把「德」寫成「徳」（U+5FB3），NFKC 不會轉換。比對前先對照成門牌表用字（目前只有 徳→德，`locate._VARIANTS`）；只用在清冊比對（`locate_roster_address`、`rest_text`、報告用的 `masked_address`），不動訪視共用的 `normalize_text`。

1. **地址有寫區，或寫了外縣市**：直接走 `matcher.locate()`。補區方式記為 `written`。
2. **以「〇〇里」開頭**（沿用 `address._VILLAGE`；里名前面不能有其他字）：
   1. 在使用中的門牌批次裡，找出有這個里名的區，作為候選區。
   2. 對每個候選區，把地址改寫成「區＋里之後的部分」，再走 `parse_address()` → `locate_parsed()`。
   3. 優先接受「比對到的里＝地址寫的里」的結果。
   4. 只有一個候選區時，補區方式記為 `village_unique`；有多個時依「挑選規則」取其一，記為 `village_nearest`。
   5. 所有候選區比對到的里都和地址寫的不同時（例如里界調整過），依「挑選規則」取其一，補區方式記為 `village_mismatch`。
   6. 門牌表沒有這個里名（找不到候選區）時，拿掉里與鄰，改走第 3 步用街路找。
3. **沒有里、直接從路名開始**：
   1. `parse_address()` 要有區才會切街路，所以先在地址前面暫時接上任一區名，只取它切出的街路名。再找出門牌表裡有這條街路的區，作為候選區。
   2. 對每個候選區，比照第 2 步比對。
   3. 只有一個候選區時記 `street_unique`；有多個時依「挑選規則」取其一，記 `street_nearest`。
4. **都找不到**：`unlocated`，原因記 `no_doorplate`。

**挑選規則**（多個候選區之間，2026-10-15 依真實清冊比對結果補強；`locate._best`），依序比較：

1. 有點的（`exact`、`nearby`）先於 `street`，再依序是 `district`、`pending`、`unlocated`。
2. 離本校的距離，四捨五入到整數公里（沒座標視為無限遠）。
3. 等級：`exact` 先於 `nearby`。
4. 實際距離，近的先。
5. 本校所在區優先。
6. 區名（結果才穩定）。

也就是有點的候選區之間，到本校的距離四捨五入到整數公里後相同時，精確門牌（`exact`）優先；否則選近的。理由：幼兒園學生多住在附近，同名路遠處的精確門牌不如近處的鄰近門牌可信（例：只寫一條多區都有的路名時，不選十幾公里外的精確門牌，而選幾公里內的鄰近門牌）。

- 候選區不限單一區，但「離本校最近」用的是本校座標。本校沒座標時，比對指令直接失敗，不輸出結果。
- `village_nearest`、`village_mismatch` 與 `street_nearest` 是推定結果，報告會分開計數，方便人工判斷。

### 3.3 輸出檔（去識別 JSON）

```json
{
  "format": "ivy-enrolled-points/1",
  "campus_key": "yihua",
  "roster_date": "2026-10-15",
  "school_year": 115,
  "doorplate_version": "115-10",
  "students": [
    {"grade": "小班", "district": "三民區", "village": "測試里", "match_level": "exact", "unlocated_reason": null, "lat": 22.651, "lng": 120.345}
  ]
}
```

- 每位學生一筆。只有 `exact`／`nearby` 有 `lat`／`lng`（先取整再寫檔）；其他等級兩欄都是 `null`。
- `district`／`village` 可以是 `null`（外縣市、對不到）。外縣市記 `match_level: "unlocated"`，同時記 `unlocated_reason: "outside_kaohsiung"`。
- `unlocated_reason` 每位學生都有這個欄位，值是 `no_address`、`outside_kaohsiung`、`no_doorplate`、`ambiguous_village` 其中之一，或 `null`（有點的學生都是 `null`）。
- `students` 依（班別順序、區、里、lat、lng、match_level、unlocated_reason）排序：排序鍵涵蓋每個輸出欄位，同一班別、同一區里、同一座標的學生不會因為原因不同而留下清冊的先後順序，列的順序對不回清冊編號。
- **不含**地址、編號、生日、性別、入學日期、補區方式。
- 檔案寫到 session 的 scratchpad（不進 repo、不放 worktree）。

### 3.4 比對報告（終端機輸出）

- 第一行是清冊日期、學年、門牌版本與總數；接著依序是有點的人數與比例、各比對等級人數、各補區方式人數（含「推定」小計）、各班別人數。
- 沒有點的學生，每筆印一行「等級／原因」，不印區、里。只有解析出來的街路是純中文路名（路、街、大道，可接「〇〇段」）時，才在後面接「路名…」；社區、大樓、棟、樓之類不是純路名的字樣一律不印，該筆只剩「等級／原因」。巷、弄、號、樓都不印。這是讓 agent 能修比對規則，又不把完整地址印進對話。
- 有點比例不到 90% 時，報告照印，但**不寫出檔案**，錯誤訊息寫到 stderr，**結束碼 2**；確認後加 `--allow-low-hit` 才寫檔。其他失敗（清冊讀不了、找不到列印日期又沒給 `--roster-date`、門牌沒匯入、本校沒座標）結束碼 1，也不寫檔。

### 3.5 CLI

```
python -m app.cli enrolled-match --roster <xls> --campus yihua --out <json> [--roster-date YYYY-MM-DD] [--allow-low-hit]
python -m app.cli enrolled-import --file <json>
python -m app.cli enrolled-import --clear --campus yihua
```

- `enrolled-match` 只讀資料庫（門牌、已發布校址），不寫入。
- `enrolled-import` 讀 JSON 檔：
  - **驗證**：用 pydantic，`extra="forbid"`，多出任何欄位（例如不小心帶到地址）就整份拒絕。另外驗證：
    - `format` 必須等於 `ivy-enrolled-points/1`；
    - `campus_key` 必須存在；
    - `grade` 只能是「幼幼班、小班、中班、大班、其他」；
    - `match_level` 只能是 `exact、nearby、street、district、unlocated`；
    - `unlocated_reason` 只能是 `no_address、outside_kaohsiung、no_doorplate、ambiguous_village` 或 `null`；
    - 有座標時等級必須是 `exact`／`nearby`；
    - 座標必須落在高雄市範圍框內，且最多 3 位小數；
    - 學生數至少 1 位、最多 5000 位。
    - 驗證失敗時，訊息只列欄位位置與錯誤種類（最多前 5 個），不印任何輸入值（檔案裡可能混進地址）。
  - **寫入**：在單一交易裡刪掉該校舊資料、寫入新資料。印出「匯入 yihua：N 位（有點 M 位），清冊日期 YYYY-MM-DD」。
  - **紀錄**：log 只記校區、人數與清冊日期。
- `--clear` 刪除該校的清冊與所有點。

## 4. 資料表（migration，接在 `c6a9e3f15d27` 之後）

只新增兩張表，不改既有資料，不需要備份閘門。

`enrolled_rosters`（每校一列）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `campus_key` | text PK，FK `campuses.key` RESTRICT | |
| `roster_date` | date not null | 清冊列印日期 |
| `school_year` | smallint not null | 民國學年 |
| `doorplate_version` | text not null | 比對用的門牌版本 |
| `total` | integer not null | 總人數 |
| `imported_at` | timestamptz not null default now() | |

`enrolled_student_points`（每位學生一列）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid PK | |
| `campus_key` | text not null，FK `enrolled_rosters.campus_key` ON DELETE CASCADE | |
| `grade` | text not null，CHECK in（幼幼班、小班、中班、大班、其他） | |
| `district` | text null | |
| `village` | text null | |
| `match_level` | text not null，CHECK in（exact、nearby、street、district、unlocated） | |
| `unlocated_reason` | text null | |
| `lat` | numeric(6,3) null | |
| `lng` | numeric(7,3) null | |

- 另加 CHECK：`(lat is null) = (lng is null)`，並且有座標時 `match_level in ('exact','nearby')`。
- 索引：`(campus_key)`。

## 5. API

`GET /api/website/v1/admin/admissions/area/enrolled?campus_key=yihua`

- 放在 `routes.py` 的 `/area/*` 群組。權限沿用 `_require_campus(user, "admissions.read", campus_key)`：沒有 capability 回 403，校區不在使用者範圍回 404。
- 只有 `admissions_enabled` 開著才掛路由，和其他招生端點一樣。
- 回應加 `Cache-Control: private, no-store`。
- service 放在 `backend/app/admissions/enrolled/query.py`。

**沒匯入**：`{"status": "not_imported"}`（日期與版本欄位為 null，`total` 為 0，其餘為空陣列）。

**有資料**：

```json
{
  "status": "ready",
  "roster_date": "2026-10-15",
  "school_year": 115,
  "doorplate_version": "115-10",
  "imported_at": "…",
  "total": 10,
  "grades": [{"grade": "幼幼班", "total": 2, "placed": 2}],
  "points": [{"lat": 22.651, "lng": 120.345, "counts": {"幼幼班": 0, "小班": 1, "中班": 1, "大班": 0, "其他": 0}}],
  "unplaced": [{"reason": "street", "counts": {"幼幼班": 0, "小班": 2, "中班": 1, "大班": 0, "其他": 0}}],
  "distance_bands": [{"band": "0-1", "counts": {"幼幼班": 1, "小班": 2, "中班": 1, "大班": 0, "其他": 0}}],
  "villages": [{"district": "三民區", "village": "測試里", "village_code": "…", "counts": {"幼幼班": 1, "小班": 1, "中班": 1, "大班": 0, "其他": 0}, "total": 3}]
}
```

- **`grades`**：依 `constants.GRADES` 的順序，最後接「其他」，只在人數大於 0 時出現。
- **`points`**：依取整座標分組加總。
- **`unplaced`**：沒有點的學生依原因分組，每項是 `{reason, counts}`，`counts` 是各班別人數（五個班別的鍵都有），讓前端依班別篩選加總。原因有四種，依下列順序排列：
  - `street`：只對到里；
  - `district`：只對到區；
  - `outside_kaohsiung`：外縣市；
  - `unlocated`：對不到。
  - 人數為 0 的原因不列。
- **`distance_bands`**：五個帶都列。有點、而且本校有座標時，用 `matcher.haversine_m` 計算距離後歸帶；其餘歸 `none`。
- **`villages`**：有里的學生（exact／nearby／street），依（區, 里）加總，換成 `village_code` 的方式比照 `opportunity.visits_by_village`。全部回傳，由前端取前 10 名並依篩選排序。

## 6. 畫面（admin）

- **模式按鈕**：`areaFormat.ts` 的 `MapMode` 加 `enrolled`，`MAP_MODES` 最後一顆是「在籍學生」。
  - 沒匯入時按鈕停用，`modeNotes` 寫「尚未匯入在籍名冊」，做法和現有停用模式相同。
  - 模式不進網址，維持現狀。
- **資料載入**：`AreaTab.vue` 比照 `loadOpportunity`，用 `useRequestSequence` 載入 `getAreaEnrolled`，換校區時重抓。
- **地圖（`AreaMap.vue`）在 `enrolled` 模式**：
  - **里**：`villageClass` 一律回傳無填色，只留里界。
  - **其他圖層**：半徑圈、本校星號照舊；幼兒園、托嬰的開關也不變。
  - **學生點圖層**（`enrolledGroup`）：
    - `L.circleMarker`，className `area-enrolled`；2 位以上的點加 `area-enrolled--multi`，半徑大一級。
    - 顏色由 `:deep` CSS 套用新 token `--area-enrolled`，值為 `var(--admin-accent)`，寫在 `admin/src/style.css`，註明理由。
    - 只在這個模式加到地圖上，切走就移除。
  - **篩選**：「全部 N｜幼幼班 N｜小班 N｜中班 N｜大班 N」（`el-radio-group`，放在圖例區；「其他」只在人數大於 0 時出現）。點依篩選重畫：只看選到的班別人數，0 的格子不畫。
  - **點的彈出框**：「這附近 N 位：小班 1、中班 1」（只列大於 0 的班別）。
  - **圖例**：
    - 第一行：點的樣例＋「清冊 2026/10/15・115 學年班別・地圖上 N 位」。
    - 有沒有點的學生時，再接「沒有點 M 位（只對到里 a、只對到區 b、外縣市 c、對不到 d）」，人數為 0 的項目不列；人數跟著班別篩選加總。
  - **地圖 `aria-label`**：加上「依在籍學生住處標點；同樣的資料在下方的在籍學生表」。
- **「在籍學生」表（新元件 `EnrolledPanel.vue`）**：
  - 只在 `status === "ready"` 時出現，放在地圖下方、`OpportunityPanel` 之前。
  - **距離分布**：列依序是 1 公里內、1–3、3–6、6 公里以上、沒有座標；欄是各班別與合計。
  - **里排行**：前 10 個里，跟著篩選走，依所選班別人數排序，同值再依名稱。
  - 兩張表都可以匯出 CSV，內容只有聚合數字，沿用既有表格的匯出方式。
- **篩選狀態放哪裡**：狀態放在 `AreaTab`，用 v-model 傳給 `AreaMap` 與 `EnrolledPanel`，兩邊同步。
- **手機**：沿用區域分析既有的窄版處理。六顆按鈕會換行，要在手機寬度實測。

## 7. 個資與保存

- 清冊原檔只在使用者的 Mac 上。agent 讀取時，對話裡只出現統計數字和遮罩地址（§3.4）。
- 正式站只存班別、區、里、比對等級、取整座標，沒有任何可直接識別個人的欄位。
- 10-08 規格 §10「不存家長座標」**只適用訪視**；在籍學生的取整座標是使用者 10-15 的裁定（E3）。
- 匯入用的 JSON 有取整座標：上傳 volume、匯入完成後，由使用者刪檔。agent 刪不了 volume 檔。
- 清除整校資料：`enrolled-import --clear --campus <key>`。
- 不納入招生的保存期限清除（`retention.py`）：這些資料列沒有個人識別欄位；更新的方式是整批取代。

## 8. 測試與驗證

**後端（pytest，用獨立測試庫）**
- **清冊解析**：用合成的 HTML 測資，結構仿照真檔、內容全是假資料；**真檔不進 repo**。
  - 涵蓋：依表頭文字找欄、缺必要欄位、讀列印日期、找不到列印日期。
  - 涵蓋：班別換算的邊界，包括 9/1 當天、未滿 2 歲 → 幼幼班、滿 6 歲 → 其他。
- **補區**：用 `geo_helpers` 的門牌測資，涵蓋：
  - 有寫區；
  - 里名只在一區；
  - 里名在兩區，用里一致與最近距離選；
  - 里名和門牌表對不上（`village_mismatch`）；
  - 異體字（徳→德）：單獨寫街路、與帶里名的地址都比對得到；
  - 只有路名、一區；
  - 只有路名、兩區取最近；
  - 遠處有精確門牌、近處只有鄰近門牌時選近處；兩區距離四捨五入到整數公里後相同時精確門牌優先；
  - 外縣市；
  - 對不到；
  - 本校沒座標時指令失敗。
- **輸出 JSON**：只有規定的欄位、排序正確（含只差 `unlocated_reason` 的兩筆，順序與清冊順序無關）、座標已取整、沒有點的等級座標是 null。
- **比對報告與 CLI**：報告只印等級、原因與純路名（社區、大樓、樓棟字樣不印）；有點比例不到 90% 時不寫檔、結束碼 2，加 `--allow-low-hit` 才寫；沒有列印日期又沒給 `--roster-date` 時失敗。
- **`enrolled-import`**：
  - 整批取代；
  - `--clear`；
  - 多出欄位被拒（包含 `address`）；
  - 不合法的班別、等級、座標範圍、小數位數被拒；
  - 失敗時舊資料原封不動。
- **API**：
  - 權限：403、404，`editor`／`readonly` 被擋；
  - `not_imported`；
  - 同一格合併、各班計數；
  - `unplaced` 分類；
  - 距離帶，包括本校沒座標時全部歸 `none`；
  - `villages` 的代碼；
  - `Cache-Control`。
- **migration**：schema 測試，涵蓋 CHECK 約束。

**契約**：重產 `contracts/openapi.json`、`contracts/generated/website-api.d.ts`，跑契約檢查。

**admin（vitest，Node 22）**
- `areaFormat.test.ts`：六個模式。
- `areaMap.test.ts:709`：按鈕清單；停用與註記；點圖層的繪製與篩選；多人點；彈出框文字；圖例與沒有點的說明。
- `EnrolledPanel` 新測試：距離分布、里排行的排序與篩選、匯出 CSV。
- `areaTab.test.ts`：載入、換校區、失敗。

**stack e2e**：在 `admissions-area.spec.ts` 加一段（stack 不跑 CLI，CLI 由後端測試涵蓋）：
1. 用 `tests/stack/db.ts` 的 `seedEnrolled` 直接寫兩張表（合成資料，重複執行先清掉）；
2. 切到「在籍學生」，點的數量正確；
3. 切班別後點的數量會變；
4. 表格的數字正確；
5. 沒匯入的校按鈕是停用的。

**真實資料（本機，上線前）**
- 照 §3.1 建比對庫，跑 `enrolled-match`，把報告給使用者看，有點比例目標 ≥ 90%。
- 本機起 api＋admin，匯入真實 JSON，用 Playwright 截桌機 1440 與手機 390 的畫面給使用者看。截圖放 `output/`（已 gitignore），不提交。

## 9. 上線

1. 使用者同意後，推 main 觸發部署。推 main 就是部署，指令由使用者用 `!` 執行。
2. migration 只新增表，不需要備份正式 DB。
3. 部署後匯入，步驟由使用者執行：
   1. `! railway volume … files -v api-volume upload <JSON> /enrolled-yihua-20261015.json`
   2. `! railway ssh … --service api -- python -m app.cli enrolled-import --file /data/enrolled-yihua-20261015.json`
   3. 在自己的終端機或 Railway 網頁刪掉 volume 上的 JSON。
4. 使用者登入後台，確認義華的「在籍學生」畫面。
5. 部署紀錄寫進 `deploy/README.md`。10-08 規格 §10 補一行，指向本規格的 E3。
