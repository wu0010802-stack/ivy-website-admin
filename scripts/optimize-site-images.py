"""產生 Nuxt 官網響應式 WebP；保留母檔，內容雜湊避免長效快取過期。

執行：python3 scripts/optimize-site-images.py（需 Pillow）
"""
from pathlib import Path
from hashlib import sha256
import json
import argparse
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web/public/assets'
OUTPUT = ASSETS / 'responsive'
OUTPUT.mkdir(exist_ok=True)
# 日常照片保留影片原生解析度，衍生小圖也降低再壓縮的細節損失。
DAY_PHOTOS = {f'day-{name}' for name in ['hello', 'discover', 'lunch', 'outside', 'home']}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--only', nargs='+', help='只更新指定素材代號，保留 manifest 其他項目')
args = parser.parse_args()
manifest_path = ROOT / 'web/app/generated/image-manifest.json'
manifest = json.loads(manifest_path.read_text()) if args.only and manifest_path.exists() else {}
sources = [ASSETS / f'{name}.webp' for name in args.only] if args.only else sorted(ASSETS.glob('*.webp'))
for source in sources:
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        width, height = image.size
        candidates = []
        quality = 92 if source.stem in DAY_PHOTOS else 84
        digest = sha256(source.read_bytes() + f'webp-q{quality}-method6-v1'.encode()).hexdigest()[:12]
        for size in [160, 480, 800, 1200]:
            if size >= width:
                continue
            target = OUTPUT / f'{source.stem}-{digest}-{size}.webp'
            resized = image.resize((size, round(height * size / width)), Image.Resampling.LANCZOS)
            resized.save(target, 'WEBP', quality=quality, method=6)
            candidates.append({'src': f'/assets/responsive/{target.name}', 'width': size})
        if source.stem in DAY_PHOTOS:
            # 正式站的原檔網址有一天快取；原生尺寸也用版本化網址，直接複製以免再次壓縮。
            target = OUTPUT / f'{source.stem}-{digest}-{width}.webp'
            target.write_bytes(source.read_bytes())
            candidates.append({'src': f'/assets/responsive/{target.name}', 'width': width})
        else:
            candidates.append({'src': f'/assets/{source.name}', 'width': width})
        manifest[source.stem] = {'width': width, 'height': height, 'candidates': candidates}
target = ROOT / 'web/app/generated/image-manifest.json'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'{len(manifest)} 張圖片；衍生檔 {sum(p.stat().st_size for p in OUTPUT.glob("*.webp")):,} bytes')
