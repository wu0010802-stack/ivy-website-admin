"""產生 Nuxt 官網響應式 WebP；保留母檔，內容雜湊避免長效快取過期。

執行：python3 scripts/optimize-site-images.py（需 Pillow）
"""
from pathlib import Path
from hashlib import sha256
import json
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web/public/assets'
OUTPUT = ASSETS / 'responsive'
OUTPUT.mkdir(exist_ok=True)
manifest = {}
for source in sorted(ASSETS.glob('*.webp')):
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        width, height = image.size
        candidates = []
        digest = sha256(source.read_bytes() + b'webp-q84-method6-v1').hexdigest()[:12]
        for size in [480, 800, 1200]:
            if size >= width:
                continue
            target = OUTPUT / f'{source.stem}-{digest}-{size}.webp'
            resized = image.resize((size, round(height * size / width)), Image.Resampling.LANCZOS)
            resized.save(target, 'WEBP', quality=84, method=6)
            candidates.append({'src': f'/assets/responsive/{target.name}', 'width': size})
        candidates.append({'src': f'/assets/{source.name}', 'width': width})
        manifest[source.stem] = {'width': width, 'height': height, 'candidates': candidates}
target = ROOT / 'web/app/generated/image-manifest.json'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'{len(manifest)} 張圖片；衍生檔 {sum(p.stat().st_size for p in OUTPUT.glob("*.webp")):,} bytes')
