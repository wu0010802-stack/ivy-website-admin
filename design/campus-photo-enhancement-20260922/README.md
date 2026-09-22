# 五校校園圖片質感修復提案

2026-09-22。使用內建 `image_gen.imagegen`，依五校現有素材逐張提升清晰度、材質與色彩。使用者看過比較後明確確認「很棒 幫我替換」，已整合 Nuxt 並依後續要求部署至正式站（web deployment `2f074707-e2a7-47c2-99fc-005d1bc47c52`，SUCCESS）。五張生成結果均保存為 PNG 母檔及 quality 94 的 WebP；格式轉換沒有額外調色、銳化或放大。完整最終提示詞與來源輸出路徑見 [prompts.json](./prompts.json)。

預覽：[本機比較頁](http://127.0.0.1:8772/design/campus-photo-enhancement-20260922/)。五校按鈕、原圖／左右比較／修復版，以及原生滑桿可操作；支援鍵盤。直接開 `index.html` 也可使用，無套件或網路依賴。

| 校區 | 原圖尺寸 | 實際生成尺寸 | WebP |
|---|---|---|---|
| 義華 | 590 × 388 | 1546 × 1017 | [圖片](./images/yihua-exterior-enhanced-v1.webp) |
| 明華 | 1000 × 522 | 1737 × 906 | [圖片](./images/minghua-enhanced-v1.webp) |
| 崇德 | 1000 × 522 | 1736 × 906 | [圖片](./images/chongde-enhanced-v1.webp) |
| 國際 | 1000 × 522 | 1736 × 906 | [圖片](./images/international-enhanced-v1.webp) |
| 仁武 | 1000 × 522 | 1737 × 906 | [圖片](./images/renwu-enhanced-v1.webp) |

PNG 母檔位於同一 `images/`，檔名為 `<key>-enhanced-v1.png`；比較用原圖為 `<key>-original.webp`。詳細尺寸／WebP bytes 見 [images.json](./images.json)。提示詞要求的尺寸並未完全由工具採用；本表及頁面採用實測輸出尺寸，沒有額外插值放大。

## 品質與使用界線

- 這是生成式質感修復，不是取得更高解析的原始照片。細部窗格、屋瓦、招牌、人物、植栽與天空有重新生成的差異；不可宣稱全部忠於實景。
- 義華第一版招牌字形失真而捨棄，本資料夾採第二版。第二版垂直招牌為「常春藤幼稚園」，仍有材質／擺設與原圖差異。
- 明華整體磚牆、窗框與招牌更清楚，但局部窗格與街景細節存在重建。
- 崇德、國際、仁武的原素材就是建築示意圖；新版維持建築示意方向。崇德部分屋頂與人像、國際欄杆與人物、仁武鋪面與植栽等細節有差異。
- 使用者已接受比較結果並確認替換；Nuxt 使用新版檔名，原始圖片仍保留。若日後要求完全忠於現況，應使用園方提供的高解析原照。
- 本機未找到同張更高解析原圖；明華記錄於 `assets/sources.json` 的 Wix URL 實際下載仍只有 1000 × 522。

## 驗證

Chrome 1440／390／320px × 五校，共 15 組：圖片成功載入、解析度、三種顯示模式、滑桿方向鍵、下載連結與無水平溢出通過，零 runtime error。檢查程式及十張桌機／手機截圖在 `output/playwright/campus-photo-enhancement-20260922/`。

`node --check design/campus-photo-enhancement-20260922/preview.js`、`node --check app.js`、`python3 package_preview.py` 通過；根 `preview.html` 無差異。未驗證 Safari／Firefox 或手機實機。

## 官網整合

`web/public/assets/*-enhanced-v1.webp` 為上述 WebP 的完整複本；`web/server/data/site-fixture.json` 僅變更五校的 `image`。`scripts/optimize-site-images.py` 更新 `web/app/generated/image-manifest.json` 與 `web/public/assets/responsive/`。首頁及分校封面／分享圖同步採用新版，新聞與 CampusTour 沿用獨立舊素材。分校封面圖說改為「校園圖像」。

整合驗證：Chrome 四尺寸首頁及桌機／手機五校內頁共 30 組通過（新版檔名、srcset 選圖、尺寸、無溢出、鍵盤與連結），零 runtime error。初次檢查在頁面初始化／自動輪播期間等待指定校區逾時；檢查腳本改為等 Vue mounted 並以既有暫停鈕固定校區後，全套通過，未更動輪播產品程式。Nuxt typecheck、五張母檔雜湊、20 張圖尺寸及原始素材保留檢查通過。程式、30 筆紀錄與 20 張截圖在 `output/playwright/campus-photo-replacement-20260922/`。
