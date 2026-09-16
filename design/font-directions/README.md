# 字型方向比較畫布（2026-09-10）

畫布連結：https://claude.ai/code/artifact/277987e1-a6ef-4f42-8f85-e05d2ca503d3

園方於 2026-09-10 選定方向 B，畫布第一頁為選定的方向，第二頁保留未採用的 A 與 C。三個畫板內容相同、只有字型不同：方向 A 系統字（現況）、方向 B LINE Seed TW 標題、方向 C 在 B 之上以芫荽（Iansui）處理孩子視角的引言。

- `gen.py`：由同一份內容產生三個 `.dc.html` 畫板與 `canvas.json`；需要上一層 `assets/` 的 logo.png、hero.webp 與壓縮後的 campus.jpg，以及 scratchpad 的 Phosphor `ph.json`（可用 `https://api.iconify.design/ph.json?icons=...` 重新取得）。
- `fonts/`：子集化後的 `lineseed-bd.woff`（700）、`lineseed-eb.woff`（800）、`iansui.woff`（只含引言用字）。來源：LINE Seed TW（OFL 1.1，https://seed.line.me/index_tw.html）、芫荽 v1.020（OFL，https://github.com/ButTaiwan/iansui）。`chars.txt` 是畫板用字清單。
- 園方選定後：B 或 C 需把對應的 woff 放進 `assets/fonts/`、在 `styles.css` 加 `@font-face`，並在頁尾註明字型來源；正式站的子集要改用全站文案重新產生。
