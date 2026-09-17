# 標題字型：LINE Seed TW（SIL OFL 1.1）

來源 https://seed.line.me/index_tw.html ，LINE 與華康共同製作，可商用。頁尾已註明出處。

- `lineseed-bd.woff`：Bold（700），子集為 `chars-bd.txt`，即 index.html 與 app.js 出現的所有非 ASCII 字元加 ASCII，供 h1/h2/h3、頁尾品牌名、大字電話使用。
- `lineseed-eb.woff`：ExtraBold（800），子集為 `chars-eb.txt`，只含 h1 用字（hero 標語、五校名、預約頁標題）。
- 內文維持系統字（PingFang TC / 微軟正黑體 / Noto Sans CJK），引言不用標題字型。

文案新增了子集裡沒有的字時，缺字會退回系統字顯示，不會壞；重新產生子集：

```sh
pyftsubset LINESeedTW_OTF_Bd.otf --text-file=chars-bd.txt --flavor=woff --no-hinting --desubroutinize --layout-features='*' --output-file=lineseed-bd.woff
```

正式上線改用 WOFF2（需 brotli）可再省約三成，或改用 cn-font-split 依 unicode-range 切片。

## 頁首品牌字型（2026-09-16）

- 中文「常春藤教育機構」使用 Noto Sans TC 600，檔案 `noto-sans-tc-600-brand.woff`。
- 品牌英文與導覽英文使用 Source Sans 3 400，檔案 `source-sans-3-400-brand.woff`；2026-09-17 擴充為 ASCII U+0020–U+007E，涵蓋大小寫英文、數字與基本標點。
- 來源為 [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2)，分別指定上述 family、字重與 `text` 取得用字子集，再以 FontTools 轉為 WOFF。英文子集擴充時已確認既有品牌字元的字寬不變。
- 原始授權：[Noto Sans TC](https://github.com/google/fonts/tree/main/ofl/notosanstc)、[Source Sans 3](https://github.com/google/fonts/tree/main/ofl/sourcesans3)。OFL 授權全文保存在各字型旁的 `*-OFL.txt`。
- `python3 package_preview.py` 會將這兩個子集內嵌到 `brand-fonts.css`，供 `index.html` 使用，並一併內嵌到單檔預覽。這能避免直接開啟本機 HTML 時，字型檔請求受到 file URL 的跨來源限制。
- 中文字型只用於 `.brand-name`；英文字型用於 `.brand-english` 與 `.header-en`，其他標題繼續使用 LINE Seed TW。中文品牌文案或英文非 ASCII 用字更動時需重新產生對應子集。
