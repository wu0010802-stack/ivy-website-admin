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
