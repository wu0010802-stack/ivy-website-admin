# A 經典對開：30 週年光影開幕

使用者選定原三案中的 A，要求布幕更逼真。2026-09-23 追加提供的週年校徽暖金投影與 3、2、1 倒數。本版保留左右拉開與金色細邊，與 Nuxt 首頁共用 `web/app/utils/entranceCurtain.ts` 的實際布幕引擎。

- [可重播／拖曳的質感預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)
- [本機 Nuxt 首頁](http://127.0.0.1:3136/)：同分頁工作階段只播放一次。
- [原版 A 比較](http://127.0.0.1:8842/design/entrance-curtain-three-20260922/?view=a)

預覽頁的背景為 2026-09-23 本輪實際首頁靜態截圖；本機 Nuxt 首頁則是實際頁面與影片。未部署、未提交。

## 2026-09-23 最新：中央橫式膠卷

電腦改為中央 16:9 橫框，最大 880px、寬度至多容器 64%，四周保留紅布幕。框內圓圈與倒數共用中心，數字依實際墨色重心校正橫向，垂直按可見字形置中；校徽與倒數圓圈仍共用高度。手機與播放時序維持原樣。

證據 `output/playwright/film-panel-20260923/`，獨立建置 `output/film-panel-build/`，本機首頁 3136；此版取代下方滿版膠卷紀錄。

## 2026-09-23 前版：電腦採參考圖膠卷

>900px 的倒數改為滿幅米褐色片底、深褐大數字與單粗圓框、左右齒孔、十字線及掃針。膠卷另用 Three.js 平面呈現，顆粒／污點／刮痕低對比；圓框與原校徽同中心、同高度。900px 以下保持原暖金布面投影。

先校徽 1.5 秒 → 321 各一秒 → 淡回紅布幕 → 3.4 秒拉幕，總長 7.9 秒。獨立建置 `output/desktop-film-build/`，本機 3136 預覽。本輪證據 `output/playwright/desktop-film-20260923/`，未部署。

## 2026-09-23 前版：校徽 → 電影 321 → 拉幕

先出現校徽 1.5 秒，再換成同中心、同高度的電影倒數圓盤；3、2、1 各一秒，最後拉幕 3.4 秒，總長 7.9 秒。雙圓環、十字線、每秒順時針掃針及低對比顆粒營造復古電影感，深酒紅大數字與暖金投影沿著布褶變形。原始 PNG 不變，兩階段不重疊。

此版本取代以下歷史紀錄的同時上下排列與 6.4 秒時序；`harmony/` 留作上一版構圖紀錄。本輪獨立 Nuxt build／預覽使用 `output/film-build/` 與 3136 port。

## 2026-09-23 協調性精修

[桌機／手機前後比較](harmony/index.html)使用實際首頁截圖。布料改沉穩酒紅、加寬布褶並降低兩側亮度，校徽約收小 9%（桌機）／16%（手機），和圓潤數字合成一組置中。倒數靠近校徽且亮度稍低；360ms 平滑淡入、拉幕前段 816ms 退光。保持原圖、完整 321 與 6.4 秒總時長。

## 2026-09-23 動態與渲染優化

拉幕採五次緩動、加重下襬延遲並放慢擺動；最後的 1 在第三秒結束後以 180ms 退光，總動畫仍為 6.4 秒。倒數期間重用陰影，開幕／拖曳／尺寸改變時重算。同一閉幕拖曳操作的 draw calls 24→10，約減少 58%；旋轉尺寸後拖回相同進度，canvas 截圖完全一致。此為繪製呼叫數，不是 FPS／電量量測。重播立即回首格，完成後隱藏略過鈕。修正首頁殘留 18% 陰影在動畫移除時突然變亮的問題，陰影在拉幕進度 80% 時即完全退去。

## 視覺與生命週期

- 不規則的大摺與細小張力皺褶、下襬起伏，以及左右不完全相同的布面。
- Three.js MeshPhysicalMaterial、非金屬高粗糙度、絨面 sheen、程序化纖維 bump texture；燈光、VSM 自身陰影與布幕投影均隨真實幾何形變變化。
- 右片鏡射時同步反轉三角形方向，維持法線與陰影偏移正確。金色下襬另用織邊材質。
- 軌道上緣先拉動、下方重量稍後跟上；校徽先行 1.5 秒、完整 3 秒倒數後，接 3.4 秒開幕（總計 7.9 秒）。此為設計導向形變，不宣稱物理布料模擬。
- Nuxt 在初次首頁繪製前設定輕量封面，hydration 後延遲載入 WebGL。過晚 hydration 仍於 1.8 秒跳過；模組／圖片初始化等待上限約 2.8 秒，圖片就緒後才開始完整倒數，不加速數字。整體 watchdog 11.5 秒，無 hydration 的 CSS 封面仍於 5.5 秒放行。結束後取消 RAF、釋放 observer、材質、紋理、shadow map、renderer 並移除 dialog。
- 原生 modal 提供鍵盤隔離；略過與 Escape 立即返回主要內容。減少動態、高對比、節省資料、慢網路、錨點連結、非首頁，以及本工作階段已看過者不載入布幕引擎。失敗／切至背景直接露出頁面。

## 維護

修改引擎後重建本頁的 JS：

```sh
node design/entrance-curtain-a-velvet-20260922/build-preview.mjs
python3 -m http.server 8842 --bind 127.0.0.1
```

`velvet.js` 是以 esbuild 打包引擎與共用時序、並替換本機 Three.js import 的衍生檔，不另維護副本邏輯。沿用現有依賴與 MIT 授權 Three.js，無 CDN 或新增付費服務。

## 投影來源

原始 1254 × 1254px PNG 完整保留（約 1.37 MiB），透過 shader 取非米白內容的遮光密度，以暖金光投射到變形布面，沒有白底矩形。文字與人物沿用提供圖；倒數字形用本機 Canvas 生成，不需第三方服務。投影只在符合進站條件、延後載入引擎後才下載。

## 驗證證據

最新電腦膠卷：Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。實際首頁 1440／901／390px 的校徽→321→拉幕、工作階段一次、無水平溢出與倒數中略過／WebGL context loss／減少動態驗證通過，無 runtime／shader error。320／390／900px 各五個關鍵影格與前版像素完全一致；1440→390→1440 切換正確，尾段透明及資源釋放正常。原型語法、重打包與 diff 檢查通過，preview.html 雜湊不變。建置保留既有 CSS calc/clamp 與 chunk 大小警告；Safari／iOS 實機未驗證。 證據 `output/playwright/desktop-film-20260923/`。

最新電影倒數：Node 22 型別檢查、119 項單元測試及獨立 Nuxt build 通過。Chrome／Apple M2 的 1440×900、768×1024、390×844、320×568 共 30 組播放／備援檢查通過，無 runtime／hydration／shader error；包含校徽先行、逐秒倒數、完整拉幕、各階段略過、同工作階段不重播，以及載入失敗放行。實際布面投影外框高度差低於 1%，圓盤與校徽共用投影中心（不同輪廓受布褶扭曲後，像素外框中心差 0.5–4.5px）。原始 PNG 雜湊相同，原型語法／重打包／diff 檢查通過，preview.html 雜湊不變。建置仍有既有 CSS calc/clamp 解析及 chunk 大小警告；Safari／iOS 實機未驗證。 證據 `output/playwright/film-countdown-20260923/`。

動態與渲染精修：Node 22 typecheck、117 項單元測試與最終 Nuxt build 通過。29 組進站／備援檢查通過；尾段陰影修正後，另以 1440×900、390×844、320×568 實際首頁逐秒倒數、完整開幕、重新整理不重播，以及預覽尾段透明度／重播重新確認，均無 runtime／hydration／shader error。中央 canvas alpha 實測由原先固定 46/255，改為 23→1→0；原型語法與重打包通過，preview.html hash 不變。既有拍立得變更及執行中並行修改的 studio.css 保留。Safari／iOS 實機未驗證。 本輪證據在 `output/playwright/entrance-motion-20260923/`。

協調性精修：Node 22 typecheck、105 項單元測試、Nuxt build 通過；Chrome／Apple M2 在 1440×900、768×1024、390×844、320×568 的逐秒倒數／開幕及各項備援共 29 組檢查通過，無 runtime／hydration／shader error。原型語法及重打包通過，preview.html hash 不變；五個其他未提交產品檔案 hash 保持一致。Safari／iOS 實機尚未驗證。 證據在 `output/playwright/entrance-harmony-20260923/`。

2026-09-23 投影版：Node 22 typecheck、105 項單元測試、Nuxt build 通過。Chrome／Apple M2 27 組檢查涵蓋 1440／390／320px 逐秒倒數、閉幕後才拉開、同工作階段略過、取消、圖片失敗／延遲與既有備援，無 runtime／hydration／shader error；證據在 `output/playwright/entrance-projection-20260923/`。

前版：Node 22 typecheck、102 項單元測試與 Nuxt build 通過。`verify.cjs` 20 組瀏覽器檢查通過；`visual-final.cjs` 另確認最終手機疏褶版在 1440／390／320px 渲染、重播與無溢出。Nuxt manifest hook 僅停止入口引擎本體的 SSR prefetch，共用 Three.js 的其他既有來源不受影響。

`output/playwright/entrance-curtain-a-20260922/` 包含材質、實際首頁與手機截圖、browser 驗證腳本、結果、建置 log，以及原有未提交檔案 hash。一般 Chrome 使用 `ANGLE Metal Renderer: Apple M2`；軟體 SwiftShader 的冷編譯較慢，曾觸發保護並留下診斷，不能用該次未捕捉到動畫推論一般 GPU 失敗。

Safari／iOS 實機、正式站與真實使用者效能未驗證。建置仍有既有 `studio.css` 的 calc/clamp 解析警告與共用 Three.js 大 chunk 提示；本輪未改動該 CSS。
