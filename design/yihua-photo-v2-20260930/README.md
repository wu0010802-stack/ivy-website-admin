# 義華外觀照 v2（2026-09-30）

使用者：首頁義華校的圖片下半部被裁掉，舊官網（ivykidschool.com）有完整的圖，要換成完整的並提高畫質。成品 `web/public/assets/yihua-exterior-v2.webp`（2820×1684），取代義華的 `yihua-exterior-enhanced-v1`（1546×1017）。

## 為什麼被裁

`enhanced-v1` 圖檔本身是完整的，問題在版面：首頁五校卡在桌機是 2.13:1（1920 寬以上 2.32:1），照片是 1.52:1，`object-fit: cover` 只露出高度的 65–71%。從塔尖到遊具底部就占了照片高度的 78%，塔尖和地面不可能同時放進卡片，所以原本設 `panoramaPos: center 12%` 保住塔尖、切掉一樓以下。其他四校照片是 1.92:1，沒有這個問題。

只調 `object-position` 解決不了；卡片比例是五校共用的版面，也不改。所以改成讓照片本身變寬。

## 做法

1. **來源**：舊站 Wix 原始上傳 `8a3d6d_cfb59ec2fd8e45e5a4ca514127e0b18a~mv2.jpg`（`static.wixstatic.com/media/…`，不帶轉換參數即原檔），1560×1123，存成 `images/wix-original-1560x1123.jpg`。`enhanced-v1` 是 09-22 用 image_gen 從同一張圖的 590×388 小裁切重建的，這次改從原檔做，招牌與磚牆都照原貌（原圖塔上的英文小字糊到無法辨識；`enhanced-v1` 上清楚的「IVY KINDERGARTEN」是 09-22 提示詞指定的，不是從原圖讀出來的）。網路上找不到更高解析的版本。
2. **左右延伸背景**（`scripts/outpaint.py`，LaMa ONNX `Carve/LaMa-ONNX` 的 `lama_fp32.onnx`，本機 CPU）：左補 200px、右補 120px（1x），比例 1.674:1，建築置中。原圖是建築照片疊在天空、樹林、草地背景上的合成圖，延伸只動背景：最外側先鋪原圖右緣的背景條（x≥1470，翻面／鏡像），LaMa 只補中間接縫，兩側都有參考才不會糊。長椅、花台那一帶與左上天空交給 LaMa 重畫，不複製；原圖最外 2 欄偏暗，也一起補掉；左邊公寓與地面的合成直邊、右下花台被切齊的地方補柔。
3. **放大**：Real-ESRGAN x4plus（ncnn macOS 版 v0.2.5.0）放大 4 倍，再 LANCZOS 縮到 1.5 倍＝2820×1684（`scripts/finish.py`）。直式招牌「常春藤幼稚園」和上方英文字 Real-ESRGAN 會改掉字形，只在字形周圍換回原圖的保守放大（`images/sign-esrgan-vs-patched.jpg`）。WebP q90。`finish.py` 重跑的輸出與 repo 裡的母檔逐位元組相同。
4. **響應式**：`scripts/optimize-site-images.py` 對 v2 加 1600／2000／2400 三級（桌機 DPR2 的卡片要 2000–2900px），分享圖改用 v2。1440 寬 DPR2 卡片從 1546 那張（260 KB）改抓 2400（414 KB），DPR1 抓 1200（132 KB）。

## 焦點與線稿對位

- 首頁卡片 `panoramaPos: center 36%`：1280–1920 寬都從塔尖露到遊具與地面（`images/home-card-before-after.jpg`，第一張是改前）；手機 1.5:1 卡片露出整張的高度。分校頁封面 `heroPhotoPos: 85% 16%`：塔尖離上緣跟改前差不多，招牌六個字全露（改前切在「幼稚」）。預約頁縮圖沿用 `panoramaPos`，桌機直式縮圖跟改前一樣取中段。
- 淡彩速寫的線稿是對著 `enhanced-v1` 描的，對位表換算成 v2：先用邊緣圖＋FFT 相位相關求 `enhanced-v1 → v2`（x×1.480＋312、y×1.474＋82，分數 0.21，`scripts/register.py`），再套到舊表。線稿直接對 v2 分數只有 0.015，而且拿同一個方法重算舊表也重現不出來（y 偏 7px），塔尖會偏高，所以不採用（`images/line-art-registration.jpg`：左＝採用、右＝直接對）。動畫三個階段的截圖在 `images/home-sketch-stages.jpg`。

## 界線

- 左右延伸的天空、樹林、草地是模型補出來的背景，建築本體、遊具、招牌都是原圖像素（放大過）。不宣稱是原始高解析實拍；分校頁圖說維持「校園圖像」。
- `enhanced-v1` 母檔、衍生圖、分享圖都保留（舊內容或社群快取可能還指向它），只是義華不再使用。
- 若正式站有人跑過 `import-site-assets --write-drafts`，素材庫裡可能有一份以 `enhanced-v1` 當封面、焦點 50/12 的義華草稿；發布那份草稿會蓋回舊圖。
