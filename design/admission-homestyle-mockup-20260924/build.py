"""把 admission-homestyle.src.html 打包成可離線開啟的單檔 admission-homestyle-mockup.html。

- 圖片：縮圖後轉 WebP data URI（hero 1600px、其他 960px、logo 128px）。
- LINE Seed TW：只留本頁用到的字；另外檢查標題（h1–h3、巨大淡字、查詢結果）有沒有缺字。
- 需要 fontTools、Pillow：pip install fonttools pillow
執行：python3 design/admission-homestyle-mockup-20260924/build.py
"""
import base64
import io
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SRC = HERE / 'admission-homestyle.src.html'
OUT = HERE / 'admission-homestyle-mockup.html'
IMAGE_WIDTH = {'day-discover.webp': 1600, 'logo.webp': 552}

html = SRC.read_text(encoding='utf-8')


def data_uri(mime: str, raw: bytes) -> str:
    return f'data:{mime};base64,{base64.b64encode(raw).decode()}'


def image_uri(rel: str) -> str:
    path = (HERE / rel).resolve()
    im = Image.open(path)
    width = IMAGE_WIDTH.get(path.name, 960)
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=74, method=6)
    return data_uri('image/webp', buf.getvalue())


def lineseed_uri(text: str) -> str:
    font = TTFont(ROOT / 'web/public/assets/fonts/lineseed-bd.woff')
    options = subset.Options()
    options.flavor = 'woff'
    options.layout_features = ['*']
    sub = subset.Subsetter(options)
    sub.populate(text=text)
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = 'woff'
    font.save(buf)
    return data_uri('font/woff', buf.getvalue())


def strip_tags(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s)


# 標題缺字檢查：LINE Seed 是子集，缺字會退回系統字。
cmap = set(TTFont(ROOT / 'web/public/assets/fonts/lineseed-bd.woff').getBestCmap())
heading_text = ''.join(strip_tags(m) for m in re.findall(r'<h[1-3][^>]*>(.*?)</h[1-3]>', html, re.S))
heading_text += ''.join(re.findall(r'class="watermark"[^>]*>([^<]*)<', html))
# 查詢結果與分班名稱是 JS 動態產生，一併列入
heading_text += '學年度，寶貝就讀幼幼班小班中班大班小一。可以開始讀年月起（）已到國小年齡囉常春藤幼兒園0123456789'
missing = sorted({c for c in heading_text if not c.isspace() and ord(c) not in cmap})
print('標題缺字：', ''.join(missing) or '無')

body_text = strip_tags(re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=re.S))
script_text = ''.join(re.findall(r'<script>(.*?)</script>', html, re.S))
lineseed = lineseed_uri(heading_text + body_text + script_text)

html = html.replace('url(../../web/public/assets/fonts/lineseed-bd.woff)', f'url({lineseed})')
for name in ('noto-sans-tc-600-brand.woff', 'source-sans-3-400-brand.woff'):
    raw = (ROOT / 'web/public/assets/fonts' / name).read_bytes()
    html = html.replace(f'url(../../web/public/assets/fonts/{name})', f'url({data_uri("font/woff", raw)})')

cache: dict[str, str] = {}
def swap(m: re.Match) -> str:
    rel = m.group(1)
    if rel not in cache:
        cache[rel] = image_uri(rel)
    return f'{m.group(0).split("=")[0]}="{cache[rel]}"'

html = re.sub(r'(?:src|href)="(\.\./\.\./web/public/assets/[^"]+\.webp)"', swap, html)
assert '../../web/public' not in html, '還有沒內嵌的本機路徑'
html = html.replace('<!-- 2026-09-24 入學資訊頁「靠近首頁」mock。原始檔；build.py 把字型與圖片內嵌成 admission-homestyle-mockup.html。 -->',
                    '<!-- 2026-09-24 入學資訊頁「靠近首頁」mock（單檔）。由 admission-homestyle.src.html 經 build.py 產生，請改原始檔。 -->')
OUT.write_text(html, encoding='utf-8')
print(f'{OUT.name}: {OUT.stat().st_size / 1024:.0f} KB，圖片 {len(cache)} 張')
