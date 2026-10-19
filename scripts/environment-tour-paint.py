"""產生常春藤環境頁第四章「五所校園」校舍塗色的遮罩（2026-10-19 蠟筆塗鴉，utils/environment-doodles.ts）。

執行：python3 scripts/environment-tour-paint.py（需 Pillow）；五校墨線線稿（optimize-site-images.py 產的
`campus-line-art-<代號>-ink.webp`，720 寬）換了就要重跑。

選到一所學校時，孩子用蠟筆把那所的校舍塗上顏色：牆一色、屋頂另一色，塗在線稿後面、稍微塗出界。
塗色的形狀就是這裡算出來的兩張遮罩（白色＝可以塗，透明＝不塗），CSS `mask` 縮放到線稿的大小：

- `tour-paint-<代號>.png`：整棟校舍（含旁邊的樹）。線稿 alpha>40 當線 → MaxFilter(11) 把線與線之間的縫補起來 →
  從四邊 floodfill 標出「外面」→ 剩下的就是校舍 → MinFilter(7) 收回補縫多長的那圈、模糊後二值化 → 開運算去碎塊。
  補縫比收回多一點，所以會稍微塗出線外。
- `tour-paint-<代號>-roof.png`：屋頂帶＝每一欄最上面的校舍像素往下 40px（720×480 的單位），沿著建築的天際線。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web/public/assets'
KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
LINE_ALPHA = 40
CLOSE_GAPS = 11
SHRINK_BACK = 7
ROOF_BAND = 40


def binary(image: Image.Image, cut: int = 127) -> Image.Image:
    return image.point(lambda v: 255 if v > cut else 0)


def building_mask(alpha: Image.Image) -> Image.Image:
    width, height = alpha.size
    lines = binary(alpha, LINE_ALPHA).filter(ImageFilter.MaxFilter(CLOSE_GAPS))
    # 從四邊灌進去：灌得到的是外面（128），灌不到的空白被線圍住，算校舍
    for x in range(width):
        for y in (0, height - 1):
            if lines.getpixel((x, y)) == 0:
                ImageDraw.floodfill(lines, (x, y), 128)
    for y in range(height):
        for x in (0, width - 1):
            if lines.getpixel((x, y)) == 0:
                ImageDraw.floodfill(lines, (x, y), 128)
    inside = lines.point(lambda v: 0 if v == 128 else 255)
    inside = binary(inside.filter(ImageFilter.MinFilter(SHRINK_BACK)).filter(ImageFilter.GaussianBlur(2.5)), 110)
    return inside.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))


def roof_mask(inside: Image.Image) -> Image.Image:
    width, height = inside.size
    pixels = inside.load()
    roof = Image.new('L', inside.size, 0)
    out = roof.load()
    for x in range(width):
        top = next((y for y in range(height) if pixels[x, y]), None)
        if top is None:
            continue
        for y in range(top, min(height, top + ROOF_BAND)):
            if pixels[x, y]:
                out[x, y] = 255
    return binary(roof.filter(ImageFilter.GaussianBlur(1.5)), 120)


def save(mask: Image.Image, target: Path) -> None:
    image = Image.new('LA', mask.size, (255, 0))
    image.putalpha(mask)
    image.save(target, optimize=True)


for key in KEYS:
    with Image.open(ASSETS / f'campus-line-art-{key}-ink.webp') as ink:
        alpha = ink.convert('RGBA').getchannel('A')
    inside = building_mask(alpha)
    save(inside, ASSETS / f'tour-paint-{key}.png')
    save(roof_mask(inside), ASSETS / f'tour-paint-{key}-roof.png')
    print(key, (ASSETS / f'tour-paint-{key}.png').stat().st_size, (ASSETS / f'tour-paint-{key}-roof.png').stat().st_size)
