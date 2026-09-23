# A 經典對開：30 週年光影開幕

使用者選定原三案中的 A，要求布幕更逼真。2026-09-23 追加提供的週年校徽投影與 3、2、1 倒數；最新指定校徽維持原彩色。本版保留左右拉開與金色細邊，與 Nuxt 首頁共用 `web/app/utils/entranceCurtain.ts` 的實際布幕引擎。

- [可重播／拖曳的質感預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)
- [本機 Nuxt 首頁](http://127.0.0.1:3136/)：同分頁工作階段只播放一次。
- [原版 A 比較](http://127.0.0.1:8842/design/entrance-curtain-three-20260922/?view=a)

預覽頁的背景為 2026-09-23 本輪實際首頁靜態截圖；本機 Nuxt 首頁則是實際頁面與影片。未部署、未提交。

## 2026-09-23 最新預覽：絨布打光、光圈校徽、對焦倒數（A/14）

依評析把布幕、Logo、倒數三塊一起改。這一輪靠「光」讓絨布成立，而投影讀起來是光、不是貼紙。

- **布幕**：底色壓暗、絨毛光澤加強，亮部落在褶子轉折的側面；上方隱入暗處，下緣有暖色腳燈。褶形改成圓鼓布面加窄深褶溝，愈往下襬褶子愈開；下襬隨褶子起伏，金邊加寬成斜紋編繩，並受腳燈照亮。
- **修正既有陰影 bug**：VSM 會把「接收陰影」的物件也畫進深度圖。下襬金邊原本沒有變形用的深度材質，在陰影圖裡是一片 z=0、x／y 各 ±1 的隱形平面，壓暗了所有褶溝，並在 y=1 形成鋸齒尖刺。現在金邊共用布幕的深度材質。
- **Logo**：人物和緞帶改用同一套光的算法。柔邊追蹤光圈在 480ms 內打開、340ms 內收成一點，照亮絨布；墨線擋光，所以輪廓是暗紅，不再比布更黑。彩色區取代布色並帶 12% 布色。緞帶依原圖亮度投成暖金，呈金底深字。
- **倒數**：桌機和手機統一成單圈樣式。字表每格 768px，字型改用 LINE Seed TW ExtraBold（`lineseed-eb.woff2`），載入失敗時退回原備援字。掃針、扇形和霓虹光暈都拿掉。每個數字落下時短暫失焦、微亮再對準；「1」結束前燈光一亮，隨退光熄滅。
- **帷幔 `?valance=1`**：垂花帷幔配金色編繩，開幕進度過半後升起離場。這是比稿參數，Nuxt 首頁預設不開。
- 時序仍是 1.5＋3＋3.4 秒。時間軸移除 `sweep`，新增 `iris`／`flash`／`flare`。

[查看新版](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1&v=14)；[加帷幔比較](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1&v=14&valance=1)；本機 Nuxt 建置 <http://127.0.0.1:3141/>（fixture 內容）。快照 `versions/before-velvet-light-20260923-132931/`；證據 `output/playwright/velvet-light-20260923/`（`before/`、`after/`、`diagnosis/`）。未部署、未提交。

驗證：Node 22 `nuxt typecheck` 無錯誤輸出；`vitest run` 18 檔 120 項通過；獨立 Nuxt build 通過，僅有既有的 CSS calc/clamp 與 chunk 大小警告。實際首頁 1440×900（2×）與 390×844（3×）：倒數字型 `loaded`，校徽→321→開幕、清理（含字型移除）、無水平溢出、重新整理不重播，均無 runtime／shader error。預覽頁 1440／901（帷幔）／390／320px 關鍵影格無錯誤。`node --check app.js`、`package_preview.py` 通過，`preview.html` 與原始 PNG 雜湊不變。倒數中略過、WebGL context loss 與減少動態的 Vue 端流程本輪未改，也未另測；Safari／iOS 實機未驗證。

## 2026-09-23 前版：人物校徽置中基準修正（A/13）

人物校徽採「皇冠到 IVY KIDS」可見範圍置中，30th Anniversary 緞帶接在下方。先前以包含緞帶的整組外框置中，人物區域因此仍偏上；本輪把校徽的來源中心 y=495 對齊投影中心，倒數圓框保持畫面中心。材質、色彩、大小與時序沿用。

[查看新版](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/?p=0.1&v=13)。證據 `output/playwright/crest-centering-20260923/`，獨立建置 `output/crest-centering-build/`；快照 `versions/before-crest-centering-20260923-122208/`，未部署。

## 2026-09-23 前版：人物投影細修與置中

原始解析度先去除米白紙底及輪廓混色，再產生投影縮圖；人物的奶油色臉部、藍衣、粉紅裙保留，下方 30th Anniversary 維持暖金。色光隨布褶明暗起伏，光的柔度隨深度變化。校徽、倒數與聚光共用畫面正中央；比例、時序及備援機制保留。

高密度渲染上限 2×／450 萬像素。彩色投影衍生紋理只存在記憶體，原 PNG 不變；結束時一併釋放。快照 `versions/before-refined-projection-20260923-120523/`；證據 `output/playwright/refined-projection-20260923/`；獨立建置 `output/refined-projection-build/`，未部署。

## 2026-09-23 前版：彩色人物、金色週年緞帶

下方「30th Anniversary」緞帶依要求恢復上一版暖金投影，上方人物、皇冠、月桂與 IVY KIDS 繼續彩色。投影兩區在原圖緞帶間留白銜接，無新圖層；原 PNG、位置、比例與開場時序保留。證據 `output/playwright/gold-anniversary-20260923/`，獨立建置 `output/gold-anniversary-build/`；快照 `versions/before-gold-anniversary-20260923-115542/`，本機未部署。

## 2026-09-23 前版：彩色校徽、圓框電影投影

校徽保留藍衣、粉紅裙、綠色月桂與金色緞帶，沿布褶起伏呈現。桌機 321 加回單一暖金細圓框；低對比掃針、細顆粒、局部燈光呼吸與深褶失焦增加電影投影感，圈內仍保留紅絨布。手機同步恢復彩色校徽，倒數延續既有圓環。

校徽與倒數共用位置／高度，順序仍為校徽 1.5 秒 → 321 各一秒 → 拉幕 3.4 秒。證據 `output/playwright/cinema-projection-20260923/`，獨立建置 `output/cinema-projection-build/`。修改前快照 `versions/before-cinema-projection-20260923-114356/`、`versions/before-colour-logo-20260923-114736/`，本機預覽未部署。

## 2026-09-23 前版：只留數字

電腦版目前只保留暖金 3、2、1，直接投射在紅布幕上。膠卷底、圓圈、十字線、掃針、齒孔均移除，數字比例與光學置中、先校徽再倒數拉幕的順序維持原樣。手機繼續沿用圓環投影。

舊膠卷版保留於 `versions/before-number-only-20260923-112736/`，本輪證據 `output/playwright/number-only-20260923/`，獨立建置 `output/number-only-build/`。此為本機比較預覽，未部署。

## 2026-09-23 前版：中央橫式膠卷

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

原始 1254 × 1254px PNG 完整保留（約 1.37 MiB），透過 shader 去除近米白紙底、清理邊緣並轉換原始 RGB 色彩，以彩色光投射到變形布面，沒有白底矩形；人物奶油色臉部保留。文字與人物沿用提供圖；倒數字形用本機 Canvas 生成，不需第三方服務。投影只在符合進站條件、延後載入引擎後才下載。

## 驗證證據

人物校徽置中基準修正：Node 22 typecheck 與獨立 Nuxt build 通過。Chrome 桌機 1440px／2× 與手機 390px／3× 實際首頁完整播放、清理、無溢出及重新整理不重播均通過，無 runtime／shader error。1440／390／320px 的人物校徽外框中心偏差至多 3px；此輪量測以皇冠到 IVY KIDS 為範圍，週年緞帶不納入。原圖與凍結 preview.html 雜湊不變，原型語法／重打包及 diff 檢查通過。保留既有 CSS calc/clamp 與 chunk 大小建置警告；Safari／iOS 實機未驗證。 證據 `output/playwright/crest-centering-20260923/`。

人物投影細修與置中：Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。Chrome 實際首頁 1440／901px（2× DPR）及 390px（3× DPR）完整開場、無溢出、工作階段一次與倒數中略過／WebGL context loss／減少動態均通過，無 runtime／shader error。另確認 1440／390／320px 高密度預覽與繪圖像素上限；校徽及圓框的可見外框中心與畫面中心偏差至多 2px。原始 PNG 與凍結 preview.html 雜湊不變，原型語法／重打包／diff 檢查通過。建置仍有既有 CSS calc/clamp 與 chunk 大小警告；Safari／iOS 實機未驗證。 證據 `output/playwright/refined-projection-20260923/`。

週年緞帶恢復金色：Node 22 typecheck 與獨立 Nuxt build 通過。Chrome 1440／390px 實際首頁完整播放、清理、無溢出與重新整理不重播均通過，無 runtime／shader error；上方彩色區域與前版像素一致，下方緞帶內部與先前金色版一致。321／拉幕八張比較中只有兩張各一像素差 1/255。原始 PNG、凍結 preview.html 雜湊不變，原型語法／重打包及 diff 檢查通過。保留既有 CSS calc/clamp 與 chunk 建置警告；Safari／iOS 實機未驗證。 證據 `output/playwright/gold-anniversary-20260923/`。

彩色校徽／圓框投影：Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。Chrome 實際首頁 1440／901／390px 的彩色校徽→321→拉幕、清理、無溢出、同工作階段不重播，以及倒數中略過／WebGL context loss／減少動態均通過，無 runtime／shader error。手機倒數與拉幕四格比對，只有一格的一個像素差 1/255，維持原視覺；校徽依要求同步彩色。原始 PNG 與 preview.html 雜湊不變，原型語法／重打包／diff 檢查通過。建置保留既有 CSS calc/clamp 與共用 chunk 大小警告；Safari／iOS 實機未驗證。 證據 `output/playwright/cinema-projection-20260923/`。

純數字預覽：Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。Chrome 實際首頁 1440／390px 的校徽→321→拉幕、清理、無溢出及重新整理不重播通過，無 runtime／shader error。手機五個影格比對差異最多為每格單一像素、單色階 1/255，維持原視覺。原型語法、重打包及 diff 檢查通過，preview.html 雜湊不變；保留既有 CSS calc/clamp 與 chunk 大小建置警告，Safari／iOS 實機未驗證。 證據 `output/playwright/number-only-20260923/`。

中央橫框：Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。Chrome 1440／901／390px 完整開場、工作階段一次、略過與備援均通過，無 runtime／shader error；桌機兩尺寸確認四邊均露出紅布幕。1328×600 預覽的 3／2／1 水平墨色重心及垂直字形中心距框中心均小於 1px；390px 五個關鍵影格與前版 RGB 像素完全一致。原型語法／重打包／diff 檢查通過，preview.html 雜湊不變。建置保留既有 CSS calc/clamp 與 chunk 大小警告；Safari／iOS 實機未驗證。 證據 `output/playwright/film-panel-20260923/`。

最新電腦膠卷：Node 22 型別檢查、119 項單元測試與獨立 Nuxt build 通過。實際首頁 1440／901／390px 的校徽→321→拉幕、工作階段一次、無水平溢出與倒數中略過／WebGL context loss／減少動態驗證通過，無 runtime／shader error。320／390／900px 各五個關鍵影格與前版像素完全一致；1440→390→1440 切換正確，尾段透明及資源釋放正常。原型語法、重打包與 diff 檢查通過，preview.html 雜湊不變。建置保留既有 CSS calc/clamp 與 chunk 大小警告；Safari／iOS 實機未驗證。 證據 `output/playwright/desktop-film-20260923/`。

最新電影倒數：Node 22 型別檢查、119 項單元測試及獨立 Nuxt build 通過。Chrome／Apple M2 的 1440×900、768×1024、390×844、320×568 共 30 組播放／備援檢查通過，無 runtime／hydration／shader error；包含校徽先行、逐秒倒數、完整拉幕、各階段略過、同工作階段不重播，以及載入失敗放行。實際布面投影外框高度差低於 1%，圓盤與校徽共用投影中心（不同輪廓受布褶扭曲後，像素外框中心差 0.5–4.5px）。原始 PNG 雜湊相同，原型語法／重打包／diff 檢查通過，preview.html 雜湊不變。建置仍有既有 CSS calc/clamp 解析及 chunk 大小警告；Safari／iOS 實機未驗證。 證據 `output/playwright/film-countdown-20260923/`。

動態與渲染精修：Node 22 typecheck、117 項單元測試與最終 Nuxt build 通過。29 組進站／備援檢查通過；尾段陰影修正後，另以 1440×900、390×844、320×568 實際首頁逐秒倒數、完整開幕、重新整理不重播，以及預覽尾段透明度／重播重新確認，均無 runtime／hydration／shader error。中央 canvas alpha 實測由原先固定 46/255，改為 23→1→0；原型語法與重打包通過，preview.html hash 不變。既有拍立得變更及執行中並行修改的 studio.css 保留。Safari／iOS 實機未驗證。 本輪證據在 `output/playwright/entrance-motion-20260923/`。

協調性精修：Node 22 typecheck、105 項單元測試、Nuxt build 通過；Chrome／Apple M2 在 1440×900、768×1024、390×844、320×568 的逐秒倒數／開幕及各項備援共 29 組檢查通過，無 runtime／hydration／shader error。原型語法及重打包通過，preview.html hash 不變；五個其他未提交產品檔案 hash 保持一致。Safari／iOS 實機尚未驗證。 證據在 `output/playwright/entrance-harmony-20260923/`。

2026-09-23 投影版：Node 22 typecheck、105 項單元測試、Nuxt build 通過。Chrome／Apple M2 27 組檢查涵蓋 1440／390／320px 逐秒倒數、閉幕後才拉開、同工作階段略過、取消、圖片失敗／延遲與既有備援，無 runtime／hydration／shader error；證據在 `output/playwright/entrance-projection-20260923/`。

前版：Node 22 typecheck、102 項單元測試與 Nuxt build 通過。`verify.cjs` 20 組瀏覽器檢查通過；`visual-final.cjs` 另確認最終手機疏褶版在 1440／390／320px 渲染、重播與無溢出。Nuxt manifest hook 僅停止入口引擎本體的 SSR prefetch，共用 Three.js 的其他既有來源不受影響。

`output/playwright/entrance-curtain-a-20260922/` 包含材質、實際首頁與手機截圖、browser 驗證腳本、結果、建置 log，以及原有未提交檔案 hash。一般 Chrome 使用 `ANGLE Metal Renderer: Apple M2`；軟體 SwiftShader 的冷編譯較慢，曾觸發保護並留下診斷，不能用該次未捕捉到動畫推論一般 GPU 失敗。

Safari／iOS 實機、正式站與真實使用者效能未驗證。建置仍有既有 `studio.css` 的 calc/clamp 解析警告與共用 Three.js 大 chunk 提示；本輪未改動該 CSS。
