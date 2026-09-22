# 手機前台捲動與拍立得動畫診斷及修正（2026-09-22）

使用者確認執行後，已在 `web/` 實作下列修正。影響公開官網共用首頁，不涉及租戶資料、CMS、後台或資料庫；根目錄 vanilla 原型保持凍結，尚未提交、推送或部署。

## 實作內容

1. **穩定閱讀高度**：`motionViewport.ts` 讓 Hero、關於與日常簾幕、背景影片、大字及卡片間距使用相同高度。觸控裝置同寬的高度變動沿用本次基準；改寬／旋轉、內容尺寸改變及重新進入首頁仍重新量測。原生 Hero 的 `view-timeline-inset` 同步固定有效 scrollport 高度，避免只有 JS 穩定而 CSS 進度仍漂移。
2. **減少捲動中的版面工作**：簾幕量測不再反覆切換 still/on；浮水印位置與卡片相對座標只在尺寸改變時量測。每幀先集中讀取再寫入，progress 相同時跳過；影片只在播放條件變動時檢查，大字透明度移除額外 200ms transition。
3. **把紙張初始化移出連續滑動**：觸控裝置先使用既有 CSS 拍立得。停止滑動至少 200ms、卡片實際可見且出場／掀角／偷看／翻面已完成後，才逐張初始化 WebGL；離屏取消待辦、卸載釋放資源。接手時讀取最新正反面與顯影狀態，不重播動畫。桌機保留接近視窗時預載，沒有全面關閉手機 WebGL。
4. **精簡紙張重畫**：紙底與文字只畫一次，顯影只重畫照片區，掀角只更新角落；renderer 尺寸相同時不重設 backing buffer。保留既有照片、紙膠帶、900ms 手機顯影、44px 折角及彎曲光影。
5. **補上延後載入的翻面邊界**：量測 DOM 紙面時同步排除 CSS 翻轉，避免先翻背面再初始化時，照片左上標籤與右下時間戳被鏡像到錯誤位置；量測後還原原有 inline style。

初次只做貼圖／幾何精簡時，正式 build 的兩輪最長幀仍為 150–200ms，未呈現穩定改善，因此沒有把該版本當成完成。後續才加入停止滑動後初始化，並限制手機只處理畫面內卡片。初始化本身仍有成本；這次改善的重點是避免它與連續捲動同時競爭主執行緒。

## 修正後驗證

- **高度回歸**：390px 寬、780→720px 與 720→780px，首張拍立得頂端位移均為 **0px**，日常簾幕軌道高度不變；原版的同類測試曾向下跳約 396px、反向跳約 422px。原生 Hero 與 JS fallback 在高度變動時的 opacity／transform 也保持一致。整頁其他區塊仍有約 3px 的高度差，因此沒有宣稱全頁所有高度都被鎖定。
- **載入與翻面回歸**：4 秒連續捲動期間新紙張 canvas 為 **0**；停止在首張後，兩張可見卡片才初始化。先用 CSS 翻到背面，WebGL 接手後仍維持背面；回到正面時，照片標籤座標與從正面初始化完全一致（x=41.37px）。舊 build 此測試為 41.37px／154.58px，已先驗證失敗再修正。
- **瀏覽器互動**：手機六張正反面、點擊／Enter、aria-expanded／inert、桌機、JS timeline fallback、減少動態與無 WebGL；15 個接力對位取樣點、320px 無橫向溢出、橫直向旋轉、跨頁返回與介紹展開均通過，五種模式皆 0 pageerror。
- **工程檢查**：Node 22.23.2 下 72 項單元測試、Nuxt typecheck、正式 build 通過。新增 6 項穩定高度與 9 項共用 idle 佇列測試。`node --check app.js`、`python3 package_preview.py`、`git diff --check` 通過，`preview.html` 無差異。

同機 Chrome、390×844、DPR 3、4 倍 CPU 降速，每次新 context，以同一條 14 秒程式捲動路徑從首頁至分校，循序各兩輪。本次前後兩者皆為本機正式 build 與相同 fixture 素材，排除開發工具差異。

| 版本 | 最長 rAF 間隔 | >33.4ms 間隔數 | Long Task 總時間 | 結束時紙張 canvas |
| --- | ---: | ---: | ---: | ---: |
| 原版正式建置，第 1 輪 | 233.3ms | 4 | 286ms | 6 |
| 原版正式建置，第 2 輪 | 150.0ms | 6 | 223ms | 6 |
| 修正後正式建置，第 1 輪 | 33.3ms | 0 | 0ms | 0 |
| 修正後正式建置，第 2 輪 | 50.0ms | 1 | 62ms | 0 |

兩版多數幀均約 16.7ms。修正後快速通過日常區塊的情境沒有建立 WebGL，因此減少了初始化與捲動重疊的長停頓；上方停止閱讀的獨立回歸證實紙張仍會載入、並正常翻面。不是全面移除 WebGL，也不是把原本所有初始化成本消除。

此為兩輪受控量測，含程式捲動後 500ms 的 Long Task 觀測，不代表真機 FPS、Core Web Vitals、已載入紙張後所有往返情境或普遍改善百分比。實機 iPhone Safari 的網址列／慣性捲動仍待驗證，尚未部署。

最終預覽：`http://127.0.0.1:3311`（本機正式 build／development fixture）。原始腳本、截圖及 JSON 在 `output/playwright/mobile-motion-audit/`；快照為 `versions/before-mobile-motion-20260922-085428/`。

驗證對應 09:26 完成的建置。工作區另於 09:29 出現進行中的 `CampusBoard.vue` 與輪播測試修改，本次未編輯這些檔案；上述預覽與效能數據尚未包含該分校整合，後續整合者需另外驗證合併後的區塊交界。

```sh
node output/playwright/mobile-motion-audit/viewport-regression.cjs http://127.0.0.1:3311
node output/playwright/mobile-motion-audit/idle-regression.cjs http://127.0.0.1:3311
node output/playwright/mobile-motion-audit/paper-layout-regression.cjs http://127.0.0.1:3311
node output/playwright/mobile-motion-audit/acceptance.cjs http://127.0.0.1:3311
node output/playwright/mobile-motion-audit/profile.cjs http://127.0.0.1:3311 build-after-profile.json optimized
```

## 初始診斷（以下為實作前的歷史紀錄）

以下保留原始量測、隔離實驗與當時的建議；「本輪未修改」等描述只指初始診斷階段。

範圍為 `ivy-website-admin/web` 公開首頁，不涉及園務系統、租戶資料、後台或資料庫。本輪完成唯讀診斷、瀏覽器暫時性 A/B 實驗與建議，沒有修改前台程式、提交或部署。

建議先穩定捲動過程中的版面幾何，再減少轉場的同步版面計算，最後選擇手機拍立得的渲染取捨。保留已定案的六張拍立得、紙膠帶、翻背面、背景影片與向上揭幕語意；WebGL 紙張彎曲是否在手機降級，另以實機與比稿決定。

## 已有證據

### 1. 高度跨過 760px 時，動畫模式會切換並推移下方內容

`useHomeReveal.ts:71–86` 每次 resize 都重新量測 `documentElement.clientHeight`。在手機寬度且高度低於 760px 時，`compactScreen` 會將首屏切為 `still`；高於門檻則可回到 `native`／`fallback`。這會改變首屏軌道高度及其後區塊的重疊位置。

在本機開發版、390px 寬、已滑到第一張拍立得時，固定 scrollY，將視窗高度 780→720px：

| 瀏覽器實驗 | 首屏模式 | 第一張卡片頂端 | 卡片位移 |
| --- | --- | --- | --- |
| 原版 | native → still | 179.56 → 575.50px | +395.94px |
| 暫時固定 JS 量測高度為 780px | native → native | 179.56 → 114.77px | −64.80px |

第二列只覆寫測試頁的 `documentElement.clientHeight` getter，是隔離變因的診斷手段，**不是建議的正式修法**。CSS 的 `svh` 仍隨模擬視窗調整，因此仍有一般高度變動造成的位移。結果支持：大幅跳位與首屏模式切換及相依幾何有關。

另有三種高度來源混用：

- `useHomeReveal.ts:73–78`、`useCurtain.ts:66`：`clientHeight`，前者將 `--reveal-height` 寫成 px。
- `DayExperience.vue:42–50`：`innerHeight` 控制大字淡化及 active card 判斷線。
- `styles.css:24,29,35`：影片、播放控制層、大標各自 sticky＋`100svh`；`studio.css:1092–1102` 的負 margin 同時使用 `--reveal-height` 和 `svh`。

**限制：** 此實驗是桌面 Chrome 的手機視窗尺寸變更，並非實機 Safari 網址列收合。真實瀏覽器對 `resize`、layout viewport、visual viewport 的反應仍須驗證，不能據此宣稱已重現使用者手機上的完整觸發條件。在固定視窗高度的取樣位置，影片與大標 sticky 沒有持續漂移。

### 2. 手機 WebGL 拍立得確實增加長幀風險

公開前台 `https://web-production-04caa.up.railway.app` 的 A/B 對照：Chrome headless，390×844、DPR 3、mobile/touch、4 倍 CPU 降速；每次使用新 browser context，以同一段 14 秒程式捲動路徑走過首頁至分校。A 為原版，B 在載入前讓 WebGL context 回傳 null，以啟用站內既有 CSS fallback，其餘程式維持原樣。順序 A→B→A→B，單一瀏覽器循序執行。

| 公開前台 | 最長 rAF 間隔 | >33.4ms 間隔數 | Long Task 總時間 | 紙張 canvas |
| --- | ---: | ---: | ---: | ---: |
| 原版，第 1 輪 | 316.7ms | 13 | 509ms | 6 |
| CSS fallback，第 1 輪 | 99.9ms | 3 | 153ms | 0 |
| 原版，第 2 輪 | 183.3ms | 11 | 298ms | 6 |
| CSS fallback，第 2 輪 | 66.7ms | 3 | 139ms | 0 |

兩個版本大多數幀都約 16.7ms，差異主要是進入卡片時的長停頓，並非全程都低幀率。表格為受控情境的量測值，不代表真機 FPS、正式 Core Web Vitals 或普遍改善百分比；GPU、網路、裝置負載與程式捲動／手指慣性捲動的差異會影響結果。

本機開發版另做兩輪，原版最長幀 250–266.7ms，CSS fallback 為 66.7ms。因開發版有 Nuxt DevTools 額外開銷，主要判讀以上方公開前台對照為準。

相關實作：

- `DayMomentCard.vue:195–204`：卡片距視窗 60% 預載範圍便初始化 WebGL，手機同樣啟用。
- `paperPrints.ts:187,214–225`：DPR 上限 2，每張卡片建立獨立 2D 顯示 canvas。
- `paperPrints.ts:547–606`：顯影動畫可逐幀重畫照片／文字貼圖，WebGL render 後再 `drawImage` 到卡片。
- `DayMomentCard.vue:39–54,86–95`、`paperPrints.ts:721–725`：顯影後自動掀角，折角尺寸持續改變時也會重畫正反面貼圖；首張接著微翻。

在本機 Long Animation Frame attribution 中，長幀落在 `paperPrints` 初始化、`render` 與轉場更新。A/B 能證明整條 WebGL 路徑有成本，但尚未逐項隔離「貼圖重畫／GPU copy／陰影／顯影／掀角」各自的占比。

### 3. 區塊轉場有同步版面計算，停用 WebGL 仍存在

`useCurtain.ts:45–48` 寫 `clipPath`、`inert` 後，呼叫進度 callback；`useRelayProgress` 在 `:128–135` 接著讀浮水印的 `getBoundingClientRect()`，再寫根元素的 CSS 變數。讀寫交錯會迫使瀏覽器在需要幾何資訊時同步處理尚未完成的 style／layout。

本機 Long Animation Frame attribution 實際記錄到 `useCurtain.ts` 的 `update` 有約 61–116ms 的 forced style/layout（4 倍 CPU 降速，包含 A/B 輪次）。它可能同時沖刷前面其他 callback 留下的待處理變更，不應把全部時間都歸給單行 `clipPath`。

`useCurtain.ts:63–75` 的 resize 量測也會先切 `still`、清裁切、讀高度，再切回 `on`；兩道巢狀簾幕均監看 panel 與 body 的尺寸，會相互觸發後續重新量測。這是應減少的版面工作，但目前未觀察到固定高度下的無限量測迴圈。

`DayExperience.vue:37–57` 每次全頁 scroll 也會讀列表、寫淡字變數、再讀全部六張卡片的位置，最後檢查影片播放狀態。它可進一步改成區塊可見時才更新，並將讀取集中在寫入之前。

### 4. 部分動效有「跟手進度＋時間緩動」重疊

`styles.css:36` 為已由捲動計算的標題 opacity 再加 200ms transition。快速來回滑動時，顯示值會追趕目標值，可能讓接力感覺拖尾。這屬原始碼確認的候選改善，**尚未單獨做 A/B 或實機主觀驗收**。

## 建議執行順序

| 順序 | 改善 | 保留的體驗與取捨 |
| --- | --- | --- |
| 1 | 統一穩定的動畫高度基準；手機同方向捲動期間不因網址列高度變化跨越模式門檻。把「初次判斷是否放得下」、寬度／方向改變、內容尺寸改變和純可視高度改變分開處理。 | 保留現有版面與揭幕；核心目標是閱讀位置連續。仍須處理旋轉、字體完成與真實內容增高，不能一律忽略 resize。 |
| 2 | 將轉場量測與每幀更新分開，合併讀取後再寫入；快取不變的幾何，progress 相同時不重寫，離開相關範圍就停止多餘更新。必要時評估讓兩道簾幕與 Hero／News 一樣使用原生 scroll timeline。 | 保留向上擦除；CSS timeline 仍須檢查完整支援與渲染成本，不能假定換成 CSS 就一定不卡。 |
| 3 | 手機先試保留紙張翻面的精簡版本：顯影避免逐幀重畫文字、降低陰影／DPR 成本、只更新可見卡片；首次掀角提示避開快速捲動期。 | 保留已定案的紙張彎曲方向；這些細項尚未分開量測，須逐項驗證，不能先保證改善幅度。 |
| 4 | 若精簡 WebGL 仍不夠流暢，再比較「手機 CSS 翻面、桌機 WebGL」。 | 本輪已有較低長幀成本的證據；照片、紙膠帶、六張內容、點擊翻背面可保留，但手機會少掉 WebGL 的柔軟彎曲與光影。這是待選方向，未改成正式預設。 |
| 5 | 大字淡化直接跟隨捲動進度；卡片 active 可用區域觀測／快取位置，影片播放只在相關狀態改變時更新。 | 保留大字淡成背景的設計。不要藉此把區塊揭幕換成曾被否決的單純文字淡出。 |

手機的 `100dvh` 不適合作為一鍵修正：它本來就會隨動態視窗變化，整條 sticky／negative-margin 版面若跟著更新，仍可能跳動。背景填滿可視區域的需求與內容閱讀位置的穩定性應分開處理。[WebKit viewport units 說明](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)

動畫優先減少 layout／paint 與不必要的圖層成本；需要持續更新的位置或透明度可優先用 transform／opacity，但須實際量測所選效果。[web.dev 動畫效能指引](https://web.dev/articles/animations-and-performance)

## 後續驗收範圍

- 實機 iPhone Safari 的網址列展開／收合、向下與向上慣性滑動；依使用者回覆追加 iPhone Chrome／LINE 或 Android Chrome。
- 390px 與較小手機寬度、初始高度在 760px 門檻兩側、橫直向旋轉；記錄卡片 anchor 與轉場邊界的連續性。
- 正式 build 的同路徑前後對照，以及首次進場、已載入後往返、點擊翻面各自的長幀資料。
- 六張正反面內容、點擊／Enter／Space、inert、減少動態、首頁錨點與跨頁返回。
- 固定桌機視覺與既有 News 換色規則。工作區另有使用者進行中的設計目錄，實作前重新確認差異。

本輪沒有為未修改的前台重跑單元測試或打包原型；既有測試主要涵蓋靜態尺寸與截圖，尚無真實手機慣性捲動與網址列行為的驗證。沒有聲稱實機問題已修復。

## 重現與原始資料

```sh
node output/playwright/mobile-motion-audit/inspect.cjs
node output/playwright/mobile-motion-audit/resize-proof.cjs
node output/playwright/mobile-motion-audit/profile.cjs
node output/playwright/mobile-motion-audit/profile.cjs https://web-production-04caa.up.railway.app production-profile.json
```

本機預覽使用既有 `http://127.0.0.1:3010`。腳本與 `inspect.json`、`resize-proof.json`、`profile.json`、`production-profile.json`、五個區塊截圖保存在本機 `output/playwright/mobile-motion-audit/`（gitignored）。CSS fallback 與固定高度均只存在各次隔離瀏覽器 context，結束後已關閉。
