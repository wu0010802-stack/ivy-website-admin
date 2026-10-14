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
- 里的變化（2026-10-14，`app/admissions/trends.py`）也用同一套代碼：各里出生（ODRP010）、遷入遷出（ODRP011）與一年前的
  年齡由同步匯入月份歷史表（`app/admissions/geo/village_series.py`）。115-07 高雄里鄰調整後，舊月份有 11 個代碼
  不在這份里界檔（已廢止的里）；歷史表照存，里界調整合併時用。里界檔本身已是調整後的 893 里。

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
