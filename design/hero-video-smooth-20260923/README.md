# Hero 影片動作流暢修正（2026-09-23）

使用者回報提高畫質後仍有頓挫感。桌機／手機 Chrome 分別比較新舊畫質版本，各量測 14 秒，皆無掉幀與超過 90ms 的呈現間隔；影片本身第 5、7 鏡則有 50% 近重複影格，封裝 30fps、實際動作只有 15fps。

保留七段鏡頭及畫質處理，第 5 鏡戶外遊戲與第 7 鏡跳躍改回原片 1× 速度、真實 30fps，不使用會造成手腳重影的光流補幀。其餘五鏡保留既有平順半速。總長由 11.7 秒改為 9.833333 秒、295 幀。

| 檔案 | 畫質 | 大小 |
|---|---|---|
| `hero-smooth-master.mp4` | 1080×800、CRF 18，桌機用 | 5,672,935 bytes |
| `hero-smooth-mobile.mp4` | 1080×800、CRF 21，原手機版，保留作對照 | 3,975,560 bytes |
| `hero-smooth-mobile-crf26.mp4` | 1080×800、CRF 26，手機用（2026-09-23 晚起） | 2,255,989 bytes |

2026-09-23 晚，手機版改用 CRF 26：對 FFV1 中間檔的 VMAF 手機模型平均 99.88（最低 97.07）、一般模型平均 93.15，最差影格（第 36 格）1:1 放大只見頭髮與背景顆粒略軟。一般 4G 首訪少 1.6 MB。比對紀錄在 `output/mobile-perf-20260923/video/`。

兩版均為 H.264／yuv420p／30fps、無音軌、faststart；各自由 FFV1 無損中間檔壓縮一次。沿用原片 SHA-256 驗證、裁切、去校徽、輕度去噪與銳化，封面與版面不變。既有修復版留在 `../hero-video-restoration-20260922/`，本次不覆寫歷史素材。

重製（FFmpeg／FFprobe，最多 2 threads）：

```sh
python3 design/hero-video-smooth-20260923/build.py \
  "$HOME/Downloads/常春藤廣告+配音 (1).mp4"
```

產製腳本重用上一版的鏡頭定義與畫質濾鏡。更新母帶至 `web/public/assets/hero-campus.mp4` 後，執行 `python3 scripts/optimize-site-videos.py`，生成雜湊網址。

逐鏡影格節奏與瀏覽器量測紀錄：`output/hero-smooth-20260923/`。本次為本機整合，未部署。

驗證：兩版七鏡皆無近重複影格（108×80 灰階 MAE ≤0.35），FFprobe 確認 295 幀／30fps、faststart 與無音軌，交付檔 SHA-256 與母檔一致。Chrome 1440／390／320px 各連播 14 秒，均 0 掉幀、無超過 90ms 的影格呈現間隔，循環和暫停／恢復正常。Typecheck、119 項單元測試、原型語法／重打包及 diff 檢查通過，原型 hash 不變；Safari／iOS 實機未驗證。
