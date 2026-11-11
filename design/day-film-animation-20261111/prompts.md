# 生成用的提示詞（2026-11-11）

工作編號與各檔雜湊在 `sources.json`。參考圖兩張，都不含孩子的臉：

- **校舍線稿**：`web/public/assets/campus-line-art-yihua.webp`（站上義華校的鉛筆線稿）。
- **服裝配色**：園方影片裡的運動服下半身與書包特寫（白上衣、下半藍綠、胸前斜紅帶；書包紅身、寶藍前蓋、黃側袋）。提示詞要求書包上不寫字。

## 共用的風格段（每一幕開頭）

> Picture-book illustration for a kindergarten website, painted by hand: fine graphite pencil linework with soft transparent watercolour washes and touches of gouache on warm cream cold-press paper, visible paper grain, gentle wet edges and pigment blooms. … Palette: deep ivy green, leaf green, warm cream, terracotta orange, golden yellow accents; rich mid tones, shadows in cool green-grey; avoid large pure white areas. Children about five years old with natural proportions (not chibi, no oversized heads), simple small dot eyes, soft rosy cheeks, black hair, Taiwanese. Quiet, tender, observational mood. Wide cinematic 16:9 frame: main figures in the central third, calmer scenery toward the left and right edges. No text, no letters, no numbers, no logos, no signature, no border.

固定角色：Mei（兩條低馬尾、黃色髮圈的女孩）、Hao（短西瓜皮頭的男孩）、老師（低馬尾、黃色長袖上衣配藍綠領口袖口）。

第一幕用上面兩張參考圖生成；第二到第六幕改拿**第一幕的成品**＋服裝參考當參考圖，開頭寫「A new page of the same hand-painted picture book as the first reference image. Match it exactly in painting style, in character design and in palette」，角色與畫風才會一致。

## 各幕的情境段

| 幕 | 時間 | 情境（提示詞摘要） |
|---|---|---|
| 1 早安入園 | 08:00 | 城堡校舍在晨光裡，Mei 與 Hao 背著書包、牽手、背對鏡頭沿小路走向校門，老師在門口彎腰招手；左緣大樹、天上兩三隻鳥 |
| 2 好奇探索 | 09:10 | 窗邊教室角落，圍著矮木桌做紫高麗菜變色實驗：三個玻璃罐（紫、粉紅、藍綠），Mei 把一小杯透明液體倒進去、紫水暈成粉紅；Hao 拿放大鏡湊很近；老師蹲在旁邊 |
| 3 一起用餐 | 11:40 | 四個孩子圍著矮桌，不鏽鋼碗裝飯菜與湯；Hao 自己舀一口、腮幫子鼓鼓的；Mei 兩手捧湯碗吹氣；老師在餐車旁舀湯 |
| 4 安靜片刻 | 12:30 | 草地大樹下的野餐墊：Mei 趴著看繪本、腳在空中晃；Hao 靠著老師睡著；旁邊一台繪本書車；校舍在遠處 |
| 5 午後玩耍 | 14:20 | 綠色操場：Mei 吹泡泡，Hao 踮腳伸手，另一個短髮女孩抬手笑；大小泡泡飄滿畫面 |
| 6 帶故事回家 | 16:30 | 同第一幕的機位，校舍在金色夕照裡；Mei 牽著爸爸、舉著今天畫的蠟筆畫邊走邊說；後面 Hao 撲進蹲著的媽媽懷裡；老師在門口揮手 |

第五幕重畫過一次：第一版四個孩子在跑跳，圖生影片時最右邊那個孩子的髮型與臉每秒都在變。第二版改成三個孩子、都站在原地（「No one is running or jumping」），動畫就穩了。

## 圖生影片的提示詞（Kling 3.0 pro、5 秒、無聲）

每一幕都是「Hand-painted watercolour picture-book animation.」＋該幕只寫**小而自然的動作**（走路、倒水、舀飯、翻頁、吹泡泡、樹葉晃、光斑移動、鳥滑過），結尾固定：

> Keep the pencil-and-watercolour illustration style, the paper grain and the colours exactly as in the first frame; stable faces, hands and clothing, no morphing, no new objects. Static camera. Calm, gentle pace.

第一、二幕另外寫了「very slow, subtle push-in」。第五幕第二版多加「Nobody jumps or runs; the three children stay in their places」。

## 逐幕檢查到的事

- 第 1、2、3、4 幕：每秒抽一格與細部裁切看過，臉、手、制服沒有變形。
- 第 6 幕：4 秒以後爸爸走到鏡頭前、頭頂貼到畫面上緣，`build.py` 只用前 96 格（4 秒）。
- 放大（ByteDance 2K、aigc）：鉛筆線與髮絲變銳利，畫風與顏色沒變；與原生檔縮圖比平均差 1.3/255。
- 生成檔沒有色彩標記：第一幕第 0 格分別以 601／709、limited／full 解碼後跟關鍵畫面比，**BT.601 limited 最接近**（平均差 1.79/255，709 是 2.70、偏藍 4），所以 `build.py` 以 601 解。
