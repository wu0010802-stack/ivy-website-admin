"""產生 Nuxt 官網響應式 WebP 與社群分享 JPG；保留母檔，內容雜湊避免長效快取過期。

執行：python3 scripts/optimize-site-images.py（需 Pillow）；
只更新部分素材：加 `--only day-hello day-discover …`，保留 manifest 其他項目。

- 預設 q84／[480, 800, 1200]；`OVERRIDES` 針對 Lighthouse 判定壓縮不足的照片
  個別降品質或加尺寸，參數進雜湊，改參數就換檔名。
- 每張另輸出一份「原尺寸重新編碼」候選檔：母檔多半是 q90+ 的匯出，桌機選到
  原圖時（例如 1440 的 day-poster）白白多下載 60–70 KB。省下 20% 以上才採用，
  否則仍指向母檔。
- `OG_IMAGES` 產 1200×630 JPG（居中裁切）供 og:image／twitter:image；
  社群平台對 WebP 支援不一致。檔名固定不帶雜湊，分享快取靠 URL 穩定。
- `DAY_PHOTOS`（常春藤的一天五張照片）保留影片原生解析度：衍生小圖 q92 並多一個
  160w，原生尺寸直接複製母檔到版本化網址，不再重新壓縮。
"""
from pathlib import Path
from hashlib import sha256
import json
import argparse
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web/public/assets'
OUTPUT = ASSETS / 'responsive'
OG_OUTPUT = ASSETS / 'og'
OUTPUT.mkdir(exist_ok=True)
OG_OUTPUT.mkdir(exist_ok=True)

DEFAULT_QUALITY = 84
DEFAULT_WIDTHS = [480, 800, 1200]
# 2026-09-22：day-poster 是背景影片底下的海報（上面還壓一層 shade），
# classroom／learning 是關於區塊的小照片，降品質肉眼看不出差異。
# hero-campus-still 是 LCP，補 640w 給 DPR 1.5–1.75 的手機。
OVERRIDES = {
    'day-poster': {'quality': 68},
    'classroom': {'quality': 72},
    'learning': {'quality': 72},
    'hero-campus-still': {'widths': [480, 640, 800]},
}
FULL_REENCODE_MIN_SAVING = 0.2
# 日常照片保留影片原生解析度，衍生小圖也降低再壓縮的細節損失。
DAY_PHOTOS = {f'day-{name}' for name in ['hello', 'discover', 'lunch', 'outside', 'home']}
DAY_QUALITY = 92
DAY_WIDTHS = [160, 480, 800, 1200]
# 分享圖：首頁 hero 與五校封面（campus.image 不開放 CMS 修改，清單固定）。
OG_IMAGES = ['hero-campus-restored-v1-still', 'yihua-exterior-enhanced-v1', 'minghua-enhanced-v1', 'chongde-enhanced-v1', 'international-enhanced-v1', 'renwu-enhanced-v1']
OG_SIZE = (1200, 630)


def encode(image: Image.Image, target: Path, quality: int) -> None:
    image.save(target, 'WEBP', quality=quality, method=6)


# 非照片：logo.webp 是頁首校徽的無損版（PNG 轉檔、供 SVG 濾鏡去背），不做響應式衍生。
SKIP = {'logo'}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--only', nargs='+', help='只更新指定素材代號，保留 manifest 其他項目')
args = parser.parse_args()
manifest_path = ROOT / 'web/app/generated/image-manifest.json'
manifest = json.loads(manifest_path.read_text()) if args.only and manifest_path.exists() else {}
sources = [ASSETS / f'{name}.webp' for name in args.only] if args.only else sorted(ASSETS.glob('*.webp'))
for source in sources:
    if source.stem in SKIP:
        continue
    day = source.stem in DAY_PHOTOS
    override = OVERRIDES.get(source.stem, {})
    quality = DAY_QUALITY if day else override.get('quality', DEFAULT_QUALITY)
    widths = DAY_WIDTHS if day else override.get('widths', DEFAULT_WIDTHS)
    if day:
        salt = f'webp-q{quality}-method6-v1'.encode()
    else:
        salt = (b'webp-q84-method6-v1' if not override
                else f'webp-q{quality}-method6-v2-{"-".join(map(str, widths))}'.encode())
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        width, height = image.size
        candidates = []
        digest = sha256(source.read_bytes() + salt).hexdigest()[:12]
        for size in widths:
            if size >= width:
                continue
            target = OUTPUT / f'{source.stem}-{digest}-{size}.webp'
            if not target.exists():
                encode(image.resize((size, round(height * size / width)), Image.Resampling.LANCZOS), target, quality)
            candidates.append({'src': f'/assets/responsive/{target.name}', 'width': size})
        full = OUTPUT / f'{source.stem}-{digest}-{width}.webp'
        if day:
            # 正式站的原檔網址有一天快取；原生尺寸也用版本化網址，直接複製以免再次壓縮。
            full.write_bytes(source.read_bytes())
            candidates.append({'src': f'/assets/responsive/{full.name}', 'width': width})
            manifest[source.stem] = {'width': width, 'height': height, 'candidates': candidates}
            continue
        if not full.exists():
            encode(image, full, quality)
        if full.stat().st_size <= source.stat().st_size * (1 - FULL_REENCODE_MIN_SAVING):
            candidates.append({'src': f'/assets/responsive/{full.name}', 'width': width})
        else:
            full.unlink()
            candidates.append({'src': f'/assets/{source.name}', 'width': width})
        manifest[source.stem] = {'width': width, 'height': height, 'candidates': candidates}

for name in OG_IMAGES:
    with Image.open(ASSETS / f'{name}.webp') as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        ImageOps.fit(image, OG_SIZE, Image.Resampling.LANCZOS, centering=(0.5, 0.4)).save(
            OG_OUTPUT / f'{name}.jpg', 'JPEG', quality=82, optimize=True, progressive=True)

target = ROOT / 'web/app/generated/image-manifest.json'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'{len(manifest)} 張圖片；衍生檔 {sum(p.stat().st_size for p in OUTPUT.glob("*.webp")):,} bytes；'
      f'分享圖 {len(OG_IMAGES)} 張 {sum(p.stat().st_size for p in OG_OUTPUT.glob("*.jpg")):,} bytes')
