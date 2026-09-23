# A 經典對開：紅絨布質感升級

使用者選定原三案中的 A，要求布幕更逼真。本版保留左右拉開與金色細邊，與 Nuxt 首頁共用 `web/app/utils/entranceCurtain.ts` 的實際布幕引擎。

- [可重播／拖曳的質感預覽](http://127.0.0.1:8842/design/entrance-curtain-a-velvet-20260922/)
- [本機 Nuxt 首頁](http://127.0.0.1:3125/)：同分頁工作階段只播放一次。
- [原版 A 比較](http://127.0.0.1:8842/design/entrance-curtain-three-20260922/?view=a)

預覽頁的背景仍為前一輪首頁靜態截圖；本機 Nuxt 首頁則是實際頁面與影片。未部署、未提交。

## 視覺與生命週期

- 不規則的大摺與細小張力皺褶、下襬起伏，以及左右不完全相同的布面。
- Three.js MeshPhysicalMaterial、非金屬高粗糙度、絨面 sheen、程序化纖維 bump texture；燈光、VSM 自身陰影與布幕投影均隨真實幾何形變變化。
- 右片鏡射時同步反轉三角形方向，維持法線與陰影偏移正確。金色下襬另用織邊材質。
- 軌道上緣先拉動、下方重量稍後跟上；時間預設 3.4 秒。此為設計導向形變，不宣稱物理布料模擬。
- Nuxt 在初次首頁繪製前設定輕量封面，hydration 後延遲載入 WebGL。載入等待上限 1.8 秒；首次 shader 編譯較慢時，動畫按剩餘預算縮短，總保護時間約 5.5 秒。結束後取消 RAF、釋放 observer、材質、紋理、shadow map、renderer 並移除 dialog。
- 原生 modal 提供鍵盤隔離；略過與 Escape 立即返回主要內容。減少動態、高對比、節省資料、慢網路、錨點連結、非首頁，以及本工作階段已看過者不載入布幕引擎。失敗／切至背景直接露出頁面。

## 維護

修改引擎後重建本頁的 JS：

```sh
node design/entrance-curtain-a-velvet-20260922/build-preview.mjs
python3 -m http.server 8842 --bind 127.0.0.1
```

`velvet.js` 是移除 TypeScript 型別並替換本機 Three.js import 的衍生檔，不另維護副本邏輯。沿用現有依賴與 MIT 授權 Three.js，無 CDN 或新增付費服務。

## 驗證證據

Node 22 typecheck、102 項單元測試與 Nuxt build 通過。`verify.cjs` 20 組瀏覽器檢查通過；`visual-final.cjs` 另確認最終手機疏褶版在 1440／390／320px 渲染、重播與無溢出。Nuxt manifest hook 僅停止入口引擎本體的 SSR prefetch，共用 Three.js 的其他既有來源不受影響。

`output/playwright/entrance-curtain-a-20260922/` 包含材質、實際首頁與手機截圖、browser 驗證腳本、結果、建置 log，以及原有未提交檔案 hash。一般 Chrome 使用 `ANGLE Metal Renderer: Apple M2`；軟體 SwiftShader 的冷編譯較慢，曾觸發保護並留下診斷，不能用該次未捕捉到動畫推論一般 GPU 失敗。

Safari／iOS 實機、正式站與真實使用者效能未驗證。建置仍有既有 `studio.css` 的 calc/clamp 解析警告與共用 Three.js 大 chunk 提示；本輪未改動該 CSS。
