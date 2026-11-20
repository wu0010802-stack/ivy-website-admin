"""30 週年磅礴版 mock-up 的素材：從 web/public/assets 縮圖、壓影片、切字型。

在 repo 根目錄執行：
  uv run --no-project --with 'fonttools[woff]==4.63.0' --with pillow \
    python design/anniversary-grand-mockup-20261024/build-media.py [--fonts-only]

- 圖片：只縮小、轉 WebP，不調色、不裁切（裁切交給 CSS object-position）。
- 影片：首頁首屏那支（孩子奔跑，已套 10-20 調亮曲線）去聲音重壓。
- 字型：LINE Seed TW 用 web/ 的分片，只複製 index.html 用到的那幾片，@font-face 寫回 index.html
  的 /*fonts:start*/ … /*fonts:end*/ 之間；「30」的影片遮罩用 ExtraBold 的輪廓（不靠字型載入）。
"""
import json, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'web/public/assets'
OUT = Path(__file__).resolve().parent
MEDIA = OUT / 'media'

# 檔名: (來源, 最大寬度, 品質)
IMAGES = {
    # 五校外觀（web 的分校主圖）
    'campus-yihua.webp': ('yihua-exterior-v2.webp', 2400, 78),
    'campus-minghua.webp': ('minghua-enhanced-v1.webp', 2400, 80),
    'campus-chongde.webp': ('chongde-enhanced-v1.webp', 2400, 80),
    'campus-international.webp': ('international-enhanced-v1.webp', 2400, 80),
    'campus-renwu.webp': ('renwu-enhanced-v1.webp', 2400, 80),
    # 30 週年校徽（業主 2026-10-04 同意用在 /anniversary）
    'crest-30.webp': ('ivy-30th-anniversary-projection.webp', 960, 88),
    # 照片牆：中央那張起始是滿版，給大一點
    'wall-center.webp': ('about-hero.webp', 2000, 80),
    'wall-01.webp': ('cur-activities.webp', 900, 74),
    'wall-02.webp': ('cur-years.webp', 900, 74),
    'wall-03.webp': ('env-hero-hug.webp', 900, 74),
    'wall-04.webp': ('cur-daily-reading.webp', 900, 74),
    'wall-05.webp': ('campus-film-new-year.webp', 900, 74),
    'wall-06.webp': ('cur-integrated.webp', 900, 74),
    'wall-07.webp': ('about-together.webp', 900, 74),
    'wall-08.webp': ('cur-cognitive.webp', 900, 74),
    'wall-09.webp': ('cur-art.webp', 900, 74),
    'wall-10.webp': ('about-curious.webp', 900, 74),
    'wall-11.webp': ('cur-daily-motor.webp', 900, 74),
    'wall-12.webp': ('tour-chongde-field.webp', 900, 74),
    'wall-13.webp': ('cur-visit.webp', 900, 74),
    'wall-14.webp': ('cur-autonomy.webp', 900, 74),
}


def build_images():
    from PIL import Image
    for name, (src, width, q) in IMAGES.items():
        im = Image.open(SRC / src).convert('RGB')
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        im.save(MEDIA / name, 'WEBP', quality=q, method=6)
    shutil.copyfile(SRC / 'logo.png', MEDIA / 'logo.png')


def build_film():
    src = SRC / 'optimized/hero-desktop-a29a608cdd4d.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-an', '-c:v', 'libx264', '-preset', 'slow',
                    '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(MEDIA / 'film-run.mp4')], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(MEDIA / 'film-run.mp4'), '-frames:v', '1',
                    str(OUT / 'poster.png')], check=True)
    from PIL import Image
    Image.open(OUT / 'poster.png').convert('RGB').save(MEDIA / 'film-run.webp', 'WEBP', quality=80, method=6)
    (OUT / 'poster.png').unlink()


def page_chars(html: str) -> set[int]:
    # 只算畫面上的字：去掉 <style>、<script> 與標籤本身
    body = re.sub(r'<(style|script)\b.*?</\1>', '', html, flags=re.S)
    body = re.sub(r'<[^>]+>', '', body)
    # 程式裡會寫進畫面的字（計數器）
    extra = '第滿年所校園0123456789'
    return {ord(c) for c in body + extra if not c.isspace()}


def ranges(cps):
    cps = sorted(cps)
    out, start, prev = [], None, None
    for c in cps:
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            out.append((start, prev)); start = prev = c
    if start is not None:
        out.append((start, prev))
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in out)


def build_fonts():
    from fontTools.ttLib import TTFont
    page = OUT / 'index.html'
    html = page.read_text()
    need = page_chars(html)
    sub = SRC / 'fonts/subsets'
    for old in (MEDIA / 'fonts').glob('lineseed-*.woff2'):
        old.unlink()
    faces = []
    for weight, tag in ((700, 'bd'), (800, 'eb')):
        for f in sorted(sub.glob(f'lineseed-{tag}-*.woff2')):
            cmap = set(TTFont(f).getBestCmap())
            hit = cmap & need
            if not hit:
                continue
            shutil.copyfile(f, MEDIA / 'fonts' / f.name)
            faces.append(f"@font-face{{font-family:'LINE Seed TW';font-weight:{weight};font-display:swap;"
                         f"src:url(media/fonts/{f.name}) format('woff2');unicode-range:{ranges(cmap)}}}")
    shutil.copyfile(SRC / 'fonts/noto-serif-tc-500-campus.woff', MEDIA / 'fonts/noto-serif-tc-500-campus.woff')
    faces.append("@font-face{font-family:'Ivy Campus Serif';font-weight:500;font-display:swap;"
                 "src:url(media/fonts/noto-serif-tc-500-campus.woff) format('woff');"
                 "unicode-range:U+4EC1,U+5206,U+570B,U+5D07,U+5FB7,U+660E,U+6821,U+6B66,U+7FA9,U+83EF,U+8A0A,U+8CC7,U+969B}")
    block = '/*fonts:start*/\n' + '\n'.join(faces) + '\n/*fonts:end*/'
    html = re.sub(r'/\*fonts:start\*/.*?/\*fonts:end\*/', lambda _: block, html, flags=re.S)
    page.write_text(html)
    print(f'{len(faces)} @font-face, {len(need)} 字')


if __name__ == '__main__':
    MEDIA.mkdir(exist_ok=True)
    (MEDIA / 'fonts').mkdir(exist_ok=True)
    if '--fonts-only' not in sys.argv:
        build_images()
        build_film()
    if (OUT / 'index.html').exists():
        build_fonts()
