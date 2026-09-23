# 五校線稿 hover 淡彩（2026-09-23）

使用者要首頁分校頁籤的線稿在 hover 時變彩色。原線稿（`../campus-line-art/`）是純線條、沒有彩色版，所以用各校實景修復照的顏色做一層淡彩。

- `make_colour_wash.py`：只需 numpy＋Pillow。以手動對位點做 TPS 變形，把照片顏色對齊到線稿；中值濾波＋高斯模糊做出水彩感；只在線稿有筆觸處上色，天空淡化。照片裡的文字與號誌用 `PATCHES` 補色、行人用 `GROUND_FROM` 逐列中位數抹掉。
- 輸出 `web/public/assets/campus-line-art-<校區>-colour.webp`（768×512，只有顏色、不含線條），再跑 `python3 scripts/optimize-site-images.py --only campus-line-art-<校區>-colour …`。
- `preview-<校區>.webp`：左為目前靜止樣子，右為 hover 後（模擬前台線條濾鏡後 multiply 到米白底）。

對位點以 768 寬座標記錄；線稿或照片換掉時要重取。前台 `CampusBoard.vue` 以 multiply 疊在原線稿上，只在 `@media(hover:hover)` 顯示。
