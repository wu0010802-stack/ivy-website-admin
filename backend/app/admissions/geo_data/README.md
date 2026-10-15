# 高雄市里界（招生區域分析）

`kaohsiung-villages.geojson`：高雄市 893 個里的界線，給後台區域分析地圖著色、以及
`app/admissions/geo/boundaries.py` 的 (區, 里) → 里代碼對照。

- 來源：內政部國土測繪中心「村里界圖（TWD97經緯度）」<https://data.gov.tw/dataset/7438>，
  檔案 `VILLAGE_NLSC_1150817`（115/08/17 版），政府資料開放授權條款第 1 版。
- 座標：TWD97 經緯度（與 WGS84 差在公分級，Leaflet 直接用）。
- 處理：只留高雄市、去掉 11 筆「未編定村里」（`VILLNAME` 空白，含東沙、南沙——不濾掉地圖
  `fitBounds` 會縮到南海）；只留 `TOWNNAME`、`VILLNAME`、`VILLCODE`；mapshaper 簡化 10%
  （`keep-shapes`），座標精度 1e-5 度。約 600KB，gzip 約 130KB。
- 里代碼（`VILLCODE`）與內政部戶政司人口統計 ODRP014 的 `district_code` 相同：115 年 9 月版高雄市
  893 里代碼與名稱 100% 對得上（2026-10-13 實測）。招生機會（`app/admissions/opportunity.py`）用界圖算
  每個里的面積重心（`boundaries.village_centroids`），判斷里在不在本校半徑內；人口本身不隨程式提交，
  由公開資料同步（`app/admissions/geo/population.py`）每月匯入資料庫。
- 里的變化（2026-10-14，`app/admissions/trends.py`）也用同一套代碼：各里出生（ODRP061，2026-10-14 起取代 ODRP010）、遷入遷出（ODRP011）與一年前的
  年齡由同步匯入月份歷史表（`app/admissions/geo/village_series.py`）。115-07 高雄里鄰調整後，舊月份有 11 個代碼
  不在這份里界檔（已廢止的里）；歷史表照存，里界調整合併時用。里界檔本身已是調整後的 893 里。
- 各里所得（2026-10-14 C 段，`app/admissions/geo/income.py`）沒有里代碼，用（區名、里名）對這份里界檔
  （`boundaries.village_code`）：112 年度 879／893 對得到，對不到的 11 列是 115-07 廢止的舊里、14 個新設的里沒有所得。
  另有 10 個里名字對得到、但 115-07 界線改過（福山、新上、菜公、清豐、八卦、達卡努瓦、中北、屏山、宏毅、成功）；
  115-07 的調整還在近 12 個月內時，它們在里的變化裡會被合併、合併的列不列所得；之後照列所得並標「*」
  （遷入遷出表存 25 個月，看得到這次調整，2026-10-14 實測 10 個里的行政區域調整都過門檻）。

## 重新產生

```bash
mkdir -p /tmp/villages && cd /tmp/villages
curl -sSLo villages.zip 'https://www.tgos.tw/tgos/VirtualDir/Product/a04697c8-64db-450a-a105-3eb471c45abd/%E6%9D%91(%E9%87%8C)%E7%95%8C(TWD97%E7%B6%93%E7%B7%AF%E5%BA%A6).zip'
unzip -o villages.zip
npx -y mapshaper@0.7.80 VILLAGE_NLSC_*.shp encoding=utf8 \
  -filter 'COUNTYNAME=="高雄市" && VILLNAME!=""' \
  -filter-fields TOWNNAME,VILLNAME,VILLCODE \
  -simplify 10% keep-shapes \
  -o kaohsiung-villages.geojson format=geojson precision=0.00001
```

換版時同步改 `boundaries.py` 的 `BOUNDARY_VERSION`，並重跑 `tests/test_geo_boundaries.py`。

# 國小學區（里的變化 D 段，2026-10-14）

`school-districts-115.csv`、`elementary-schools-115.csv`：高雄市 115 學年度的「里 → 國小」對照與學校名錄，給
`app/admissions/geo/school_districts.py` 讀（`SCHOOL_DISTRICT_YEAR = 115`），區域分析「里的變化」表的「國小學區」欄與
「依國小學區」表用。不建資料表、不同步，每學年人工換一次檔。規格 `docs/specs/2026-10-14-admissions-village-trends-design.md`
§2.4、§3.4、§4.5。

- 來源：高雄市政府教育局「115 學年度國民小學學區劃分一覽表」PDF（23 頁，2026-01-07 建立，副本
  `https://orgws.kcg.gov.tw/001/KcgOrgUploadFiles/237/RelFile/15482/507212/e07df8bf-d1de-4188-a87e-89c4c3909f6b.pdf`，
  sha256 `13a22f4074a5fc7f3dfd6c6f5748cef45b807657ed8f6d7ec2647226eee4eab5`）；學校代碼與地址取教育部「國民小學名錄」
  `https://stats.moe.gov.tw/files/school/115/e1_new.csv`（data.gov.tw 6087），高雄市公立 238 所。
- `school-districts-115.csv`：一列一個（里、學校），1,120 列、893 個里全有學校。欄位 `village_code`、`district`、
  `village`、`school_code`（教育部代碼；分校是「本校代碼-分校名」）、`coverage`（`full` 整里／`partial` 部分鄰）、
  `neighborhoods`（一覽表原文的鄰範圍，只當說明）、`free_zone`（和別校自由學區）、`note`。
  一個里對到 1 所 700 個、2 所 169、3 所 17、4 所 4、5 所 3；整里 809 列、部分 311 列。
- 整里／部分（2026-10-15 更正）：一覽表常把整個里拆成幾段鄰寫（灣中里鼎金國小「1-8、10-24、26 鄰」＋「9、25 鄰與
  民族國小自由學區」），腳本原本只認「全里」或沒寫鄰才算整里，這類 47 列被標成部分（含只有一所學校的前峰里「1-34 鄰」）；
  另外「1-8鄰與忠孝國小自由學區」這種鄰和「與」中間沒有標點的段落被整段當成整里，隆昌里、興邦里、西燕里 4 列反過來
  標錯。現在一所學校列的鄰涵蓋一覽表為這個里列出的所有鄰就算整里（已經有學校整里、或夾了路段社區條件的里不判斷），
  並用門牌 115-10 的「鄰」核對過全部 302 個只寫鄰的（里、學校）：只剩自助里（只有永清國小，一覽表寫 1-23 鄰、門牌
  另有 24 鄰；沒有別校，照整里）。
- `elementary-schools-115.csv`：241 個學校單位（238 所＋岡山國小灣裡分校、阿蓮國小峰山分校、廣興國小新威分校），
  `enrollment` 取一覽表備註：實驗教育 7 校大學區（`open`）、空間充裕 38 校（`spacious`）、總量管制 13 校（`capped`），
  其餘一般學區（`district`）。分校的區寫一覽表上分校那一列的區、地址留空（名錄只有本校地址）。
- `school-districts-115-overrides.csv`：人工處理的 35 列，逐列寫原因：
  - 改名、改制：新威國小 114 學年起是廣興國小新威分校；興中國小名錄改名興中原住民族小學。
  - 不是里的條件：油廠國小的台灣中油、台積電員工子女，山頂國小的「內厝路以北、水源路以南」。
  - 寫法：「崎漏區(崎漏里)」、峰山／峯山異體字。
  - 里寫在學校所在的區（4 個：瑞隆里、湖內里、本洲里、頂鹽里）改回里所在的區。
  - 表格漏標自由學區（一覽表備註有寫）：鳳山區光明里（曹公國小）、文衡里（文德、文華國小）。
  - 115-07 里鄰調整（一覽表在調整前公告；對照依市府民政局 7 區 21 里調整的公告與新聞報導）：新設的 13 個里沿用調整前
    的里——合併成的（北端←博愛＋慈愛、崇聖←聖西＋聖南、廍後←廍北＋廍南、南／北美術館←龍水）照抄整里或部分，
    從還在的里分出的（福愛、福華、福榮←福山，菜福、高鐵←菜公，新超←新上，清翔←清豐，八德←八卦）一律算部分；
    名字沒變、界線改了的五個里（福山、菜公、新上、清豐、八卦）加註「鄰範圍是調整前的編組」。
    併進既有里的舊里（中南→中北、祥和→屏山、宏南→宏毅、縣口→成功）和併入的里同一所學校整里，不必處理。
  - 灣內里：表格寫「2、8 鄰」、備註寫「2 至 8 鄰」，鄰範圍只存原文、加註。
  - 一覽表跳號、腳本判斷不了的整里（`full`）：光明里大東國小沒寫 7、24 鄰（曹公國小寫 1-15 鄰），門牌也沒有這兩鄰。
- 守門：`tests/test_school_districts.py`——里界檔每個里至少一所、代碼與里名和里界檔一致、每個學校代碼都在學校檔、
  同一（里、學校）只一列、兩所以上整里一定是自由學區、只有一所學校的里是整里、115 學年版的筆數（含整里／部分列數）。
  里界換版時這裡會擋下沒更新的對照檔。

## 換學年

每年約 12 月草稿、1 月正式公告（116 學年版推估 2026-12～2027-01）：

```bash
cd backend
# 1. 下載新的一覽表 PDF 與教育部名錄（學年換成新的）
curl -sSLo /tmp/sd/districts-116.pdf '<教育局公告的 PDF 網址>'
curl -sSLo /tmp/sd/e1_new.csv 'https://stats.moe.gov.tw/files/school/116/e1_new.csv'
# 2. 複製 overrides 成新學年的檔，刪掉已不適用的列（腳本會列出「overrides 沒用到」）
cp app/admissions/geo_data/school-districts-115-overrides.csv app/admissions/geo_data/school-districts-116-overrides.csv
# 3. 轉換（pdfplumber 只在這支腳本用）；看報告：對不到里界、看不懂的項目、鄰合起來算整里的、和上一學年比多出或少掉的對應。
#    --doorplates 給當月的門牌坐標 CSV（資料平台的 File/DirectDownload/<guid>，見 deploy/README.md「公開地理資料同步」），
#    報告多「門牌核對」：標部分但門牌的鄰都在範圍內（確認後加 full）、判成整里但門牌有鄰不在範圍內（人工看）
uv run --with pdfplumber==0.11.4 python scripts/build_school_districts.py --pdf /tmp/sd/districts-116.pdf --schools /tmp/sd/e1_new.csv --year 116 --doorplates /tmp/sd/doorplates.csv
# 4. 補 overrides、重跑到報告乾淨；改 school_districts.py 的 SCHOOL_DISTRICT_YEAR、tests/test_school_districts.py 的筆數
uv run pytest tests/test_school_districts.py
```

舊學年的三個檔在新學年上線後刪掉（程式只讀 SCHOOL_DISTRICT_YEAR 那一份）。

## 幼兒園停辦回補（`kindergarten-closures-20261015.csv`）

幼兒園的營業中改以教育部名單（kiang `docs/data/高雄市.csv`）判斷後，第一次同步會一次下架 47 所（10-15 實測）kiang 還標營業中、
但已不在名單的舊筆。這份檔告訴同步每一所該怎麼處理，讓近 12 個月的停辦寫在它實際離開名單的那天，而不是同步當天。
規格 `docs/specs/2026-10-15-kindergarten-registry-design.md` §5。

- 來源：GitHub `kiang/ap.ece.moe.edu.tw` 的 `docs/data/高雄市.csv` 自 2025-06-01 起的 commit 歷史（187 版）；
  由新到舊逐版掃描，每所找出名單裡最新一個含它的版本，取下一個較新版本的日期（不用二分搜尋：歷史有殘缺版本，
  例如 2025-07-09 只有 351 列，也有些改名是 2025-06 之後才出現在名單、之後又離開）。
- 欄位 `source_id,name,left_on,reason`：
  - `source_id`：kiang 的 uuid，即 `geo_kindergartens.source_id`。
  - `name`：園所名稱，給人看，程式不讀。
  - `left_on`：離開教育部名單的日期（台北）＝名單歷史裡最新一個含這所的版本的下一個較新版本的日期；2025-06-01 起從沒出現過（更早就消失）的留空。`renamed` 的日期只是紀錄，同步不讀。
  - `reason`：`closed`（停辦）或 `renamed`（同地址、同設立日的另一筆在名單上＝改名或換承辦）。
- 同步怎麼用：只在某所**這一輪要從營業中變成下架**時查檔。`closed` 且有 `left_on` → 寫停辦事件，`occurred_on` 取 `left_on`；
  `closed` 但 `left_on` 空、或 `renamed` → 只下架、不寫事件。檔裡沒有的園所照一般規則（改名判斷，否則記同步當天）。
  事件靠既有唯一約束冪等，重跑不會重複。
- 10-15 的內容 47 筆：停辦 33（有離開日 16，其中近 12 個月 14；離開日空 17）、改名或換承辦 14（有離開日 13，其中近 12 個月 9；離開日空 1）。
- 產生指令（需要已登入的 `gh`，約 190 個 GitHub API 請求，約 2 分鐘）：

```bash
cd backend
uv run --frozen python scripts/build_kindergarten_closures.py --since 2025-06-01 \
    --out app/admissions/geo_data/kindergarten-closures-20261015.csv
```

- **不要刪**：同步每一輪都會載入這份檔（檔不在或格式不對，幼兒園整輪不換版、原因寫進 `last_error`），只是其中一列要到「某所這一輪要下架」時才用到。
  日後不用重產，除非要重做回補；檔名的日期是產生當天，不隨學年或月份換。
- 守門：`tests/test_geo_closure_backfill.py` 用同步的載入程式（`app/admissions/geo/closure_backfill.py`）讀這份真檔，欄位、`reason`、日期格式、`source_id` 重複任一不對就報錯；
  另檢查日期不在未來、童年綠地與愛爾蘭兩個已知案例對得上。
