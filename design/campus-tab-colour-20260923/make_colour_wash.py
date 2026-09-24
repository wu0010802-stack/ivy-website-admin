"""分校頁籤 hover 淡彩底：把各校實景照片的顏色以 TPS 變形對齊到線稿，輸出只有顏色、不含線條的水彩層。

前台把這層以 multiply 疊在原線稿上，所以線條仍由原線稿提供，淡入時線條濃淡不變。
對位點皆為 768 寬座標：線稿 768×512；照片等比縮為 768 寬。只需 numpy＋Pillow。

執行：python3 design/campus-tab-colour-20260923/make_colour_wash.py
      → web/public/assets/campus-line-art-<校區>-colour.webp，本目錄 preview-<校區>.webp（左靜止、右 hover）
之後：python3 scripts/optimize-site-images.py --only campus-line-art-<校區>-colour …
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ASSETS = ROOT / 'web/public/assets'
W, H = 768, 512

PHOTOS = {
    'yihua': 'yihua-exterior-enhanced-v1', 'minghua': 'minghua-enhanced-v1', 'chongde': 'chongde-enhanced-v1',
    'international': 'international-enhanced-v1', 'renwu': 'renwu-enhanced-v1',
}
# (線稿 x, y) → (照片 x, y)
POINTS = {
    'yihua': [((610, 40), (614, 37)), ((690, 52), (688, 46)), ((75, 213), (78, 213)), ((725, 300), (733, 300)),
              ((722, 400), (718, 400)), ((190, 430), (185, 425)), ((478, 190), (472, 188)), ((177, 255), (180, 255)),
              ((412, 400), (410, 395)), ((103, 248), (108, 248)), ((460, 112), (455, 107))],
    'minghua': [((108, 117), (116, 72)), ((648, 93), (620, 53)), ((52, 152), (60, 100)), ((707, 133), (683, 86)),
                ((738, 340), (712, 290)), ((262, 340), (268, 280)), ((425, 378), (422, 310)), ((20, 400), (20, 330)),
                ((760, 395), (755, 332)), ((441, 183), (433, 132)), ((528, 172), (519, 121)), ((133, 172), (135, 122)),
                ((625, 150), (605, 98))],
    'chongde': [((97, 125), (128, 125)), ((50, 148), (85, 150)), ((79, 168), (110, 162)), ((637, 87), (617, 82)),
                ((712, 125), (682, 118)), ((612, 330), (596, 290)), ((720, 390), (698, 345)), ((10, 398), (0, 345)),
                ((55, 385), (90, 332)), ((423, 210), (415, 195)), ((347, 215), (350, 200)), ((505, 210), (490, 195)),
                ((358, 382), (360, 330))],
    'international': [((112, 93), (118, 105)), ((50, 145), (62, 150)), ((318, 146), (305, 150)), ((660, 72), (645, 87)),
                      ((728, 140), (698, 140)), ((193, 360), (190, 330)), ((627, 370), (618, 340)), ((55, 370), (62, 335)),
                      ((718, 370), (690, 345)), ((435, 245), (435, 240)), ((537, 180), (532, 178)), ((125, 180), (128, 178)),
                      ((75, 310), (80, 300))],
    'renwu': [((383, 125), (383, 117)), ((327, 193), (333, 172)), ((440, 193), (432, 172)), ((122, 145), (152, 125)),
              ((42, 203), (85, 168)), ((722, 203), (680, 168)), ((645, 143), (612, 125)), ((55, 372), (95, 300)),
              ((712, 372), (670, 300)), ((383, 368), (383, 300)), ((5, 418), (30, 348)), ((668, 418), (632, 348)),
              ((265, 225), (280, 192)), ((500, 225), (484, 192))],
}

# 地面從這一列（768 座標）以下改成逐列中位數：柏油路上的行人、斑馬線等直立小物會被抹平。
GROUND_FROM = {'minghua': 405, 'chongde': 402, 'renwu': 422}
# 照片裡的文字、號誌（線稿已刻意拿掉）：橢圓 (cx, cy, rx, ry, 指定色或 None=取外圈平均)
PATCHES = {
    'yihua': [(668, 205, 34, 118, None)],
    'minghua': [(740, 240, 22, 14, None), (658, 275, 22, 12, None)],
    'chongde': [],
    'international': [],
    'renwu': [],
}
# 長方形的招牌牆：(x0, y0, x1, y1, 指定色)。明華校名牆原本用橢圓補白，溢到兩側磚柱與底下花台，
# hover 時變成一圈白框（2026-09-24）；改成貼齊線稿招牌外框，白色只留在牆面內。
RECT_PATCHES = {
    'minghua': [(358, 360, 490, 393, (0.95, 0.94, 0.89))],
}


def tps_fit(src, dst, reg=40.0):
    """薄板樣條：src → dst。reg 讓對位點誤差被抹平，不會硬拗出扭曲。"""
    n = len(src)
    d = np.linalg.norm(src[:, None] - src[None], axis=-1)
    with np.errstate(divide='ignore', invalid='ignore'):
        K = np.where(d > 0, d * d * np.log(d), 0.0)
    K += reg * np.eye(n)
    P = np.hstack([np.ones((n, 1)), src])
    A = np.zeros((n + 3, n + 3))
    A[:n, :n], A[:n, n:], A[n:, :n] = K, P, P.T
    b = np.zeros((n + 3, 2))
    b[:n] = dst
    return np.linalg.solve(A, b)


def tps_eval(coef, src, pts):
    d = np.linalg.norm(pts[:, None] - src[None], axis=-1)
    with np.errstate(divide='ignore', invalid='ignore'):
        U = np.where(d > 0, d * d * np.log(d), 0.0)
    n = len(src)
    return U @ coef[:n] + coef[n] + pts @ coef[n + 1:]


def bilinear(img, x, y):
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    a, b = img[y0, x0], img[y0, x0 + 1]
    c, d = img[y0 + 1, x0], img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def saturate(rgb, amount):
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    return np.clip(lum[..., None] + (rgb - lum[..., None]) * amount, 0, 1)


def build(key, strength=0.62, sat=1.25):
    line = Image.open(ASSETS / f'campus-line-art-{key}.webp').convert('L').resize((W, H), Image.Resampling.LANCZOS)
    photo = Image.open(ASSETS / f'{PHOTOS[key]}.webp').convert('RGB')
    photo = photo.resize((W, round(W * photo.height / photo.width)), Image.Resampling.LANCZOS)
    pts = np.array(POINTS[key], float)
    src, dst = pts[:, 0], pts[:, 1]
    coef = tps_fit(src, dst)
    res = np.abs(tps_eval(coef, src, src) - dst).max()
    gy, gx = np.mgrid[0:H, 0:W].astype(float)
    grid = np.stack([gx.ravel(), gy.ravel()], 1)
    mapped = tps_eval(coef, src, grid).reshape(H, W, 2)
    ph = np.asarray(photo, float) / 255
    warped = bilinear(ph, mapped[..., 0], mapped[..., 1])
    # 水彩：先中值濾波壓平細節，再輕微模糊；越界處（照片外）不上色。
    inside = ((mapped[..., 0] >= 0) & (mapped[..., 0] <= photo.width - 1) &
              (mapped[..., 1] >= 0) & (mapped[..., 1] <= photo.height - 1)).astype(float)
    wimg = Image.fromarray((warped * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(7)).filter(ImageFilter.GaussianBlur(2.2))
    colour = saturate(np.asarray(wimg, float) / 255, sat)
    if key in GROUND_FROM:
        y0 = GROUND_FROM[key]
        colour[y0:] = np.median(colour[y0:], axis=1, keepdims=True)
    for cx, cy, rx, ry, fill in PATCHES[key]:
        e = ((gx - cx) / rx) ** 2 + ((gy - cy) / ry) ** 2
        ring = (e > 1.4) & (e < 2.6)
        c = np.array(fill) if fill else colour[ring].mean(0)
        w = np.clip((1.25 - e) / 0.35, 0, 1)[..., None]
        colour = colour * (1 - w) + c * w
    for x0, y0, x1, y1, fill in RECT_PATCHES.get(key, []):
        # 邊緣只留 1px 過渡，不往外暈開
        edge = np.minimum.reduce([gx - x0, x1 - gx, gy - y0, y1 - gy])
        w = np.clip(edge + 0.5, 0, 1)[..., None]
        colour = colour * (1 - w) + np.array(fill) * w
    # 只在線稿有筆觸的地方上色：墨量密度 → 柔邊遮罩，天空與四周留白成暈染邊。
    ink = 1 - np.asarray(line, float) / 255
    ink = np.clip((ink - 0.02) / 0.25, 0, 1)
    dens = np.asarray(Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14)), float) / 255
    mask = np.clip((dens - 0.05) / 0.12, 0, 1)
    mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), float) / 255
    mask *= np.asarray(Image.fromarray((inside * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10)), float) / 255
    # 天空（偏藍且亮）只留很淡的一層，避免屋頂外圍出現藍色光暈。
    r, g, b = colour[..., 0], colour[..., 1], colour[..., 2]
    sky = np.clip((b - np.maximum(r, g) - 0.04) / 0.12, 0, 1) * np.clip((b - 0.55) / 0.2, 0, 1)
    sky = np.asarray(Image.fromarray((sky * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)), float) / 255
    a = (strength * mask * (1 - 0.75 * sky))[..., None]
    wash = 1 - a * (1 - colour)
    out = Image.fromarray((np.clip(wash, 0, 1) * 255).round().astype(np.uint8))
    print(f'{key}: TPS 殘差最大 {res:.1f}px（768 座標）')
    return out, line


if __name__ == '__main__':
    for key in sys.argv[1:] or list(PHOTOS):
        wash, line = build(key)
        wash.save(ASSETS / f'campus-line-art-{key}-colour.webp', 'WEBP', quality=90, method=6)
        # 預覽：模擬前台 hover 的線條濾鏡後相乘到米白底
        l = np.asarray(line, float) / 255
        L = np.clip((l * 0.68 - 0.5) * 3.2 + 0.5, 0, 1)[..., None]
        paper = np.array([0xFA, 0xF8, 0xF0]) / 255
        comp = paper * L * (np.asarray(wash, float) / 255)
        rest = paper * np.clip((l * 0.72 - 0.5) * 3.2 + 0.5, 0, 1)[..., None]
        Image.fromarray((np.hstack([rest, comp]) * 255).astype(np.uint8)).save(HERE / f'preview-{key}.webp', 'WEBP', quality=82)
