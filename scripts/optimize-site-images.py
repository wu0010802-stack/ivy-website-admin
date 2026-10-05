"""產生 Nuxt 官網響應式 WebP 與社群分享 JPG；保留母檔，內容雜湊避免長效快取過期。

執行：python3 scripts/optimize-site-images.py（需 Pillow）；
只更新部分素材：加 `--only day-hello day-discover …`，保留 manifest 其他項目。

- 預設 q84／[480, 800, 1200, 1600]；`OVERRIDES` 針對 Lighthouse 判定壓縮不足的照片
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
DEFAULT_WIDTHS = [480, 800, 1200, 1600]
# 2026-09-22：day-poster 是背景影片底下的海報（上面還壓一層 shade），
# classroom／learning 是關於區塊的小照片，降品質肉眼看不出差異。
# hero-campus-still 是 LCP，補 640w 給 DPR 1.5–1.75 的手機。
# 2026-09-29：首頁五校分頁線稿在手機只有 48–60px 寬（DPR3 約需 180px），補 240w，不必下載 480w。
# 2026-09-30：義華外觀 v2 母檔 2820px，首頁五校卡在桌機 DPR2 要 2000–2900px，補中間幾級，免得 1200 以上直接跳母檔。
# 2026-10-05：預設補 1600w。內頁首圖多是 object-fit:cover 裁成比原圖寬的框，DPR3 手機要 1180–1570px，
# 原本 1200 以上直接跳 2000 級母檔（about-hero 138 KB 對 1200w 75 KB）。只改品質的三張固定原本三級，
# 雜湊鹽值不變、不必重產。
OVERRIDES = {
    'day-poster': {'quality': 68, 'widths': [480, 800, 1200]},
    'classroom': {'quality': 72, 'widths': [480, 800, 1200]},
    'learning': {'quality': 72, 'widths': [480, 800, 1200]},
    'hero-campus-still': {'widths': [480, 640, 800]},
    'campus-line-art-yihua': {'widths': [240, 480, 800, 1200]},
    'campus-line-art-minghua': {'widths': [240, 480, 800, 1200]},
    'campus-line-art-chongde': {'widths': [240, 480, 800, 1200]},
    'campus-line-art-international': {'widths': [240, 480, 800, 1200]},
    'campus-line-art-renwu': {'widths': [240, 480, 800, 1200]},
    'yihua-exterior-v2': {'widths': [480, 800, 1200, 1600, 2000, 2400]},
}
FULL_REENCODE_MIN_SAVING = 0.2
# 日常照片保留影片原生解析度，衍生小圖也降低再壓縮的細節損失。
DAY_PHOTOS = {f'day-{name}' for name in ['hello', 'discover', 'lunch', 'outside', 'home']}
DAY_QUALITY = 92
DAY_WIDTHS = [160, 480, 800, 1200]
# 分享圖：首頁 hero 與五校封面（campus.image 不開放 CMS 修改，清單固定）。
OG_IMAGES = ['hero-campus-restored-v1-still', 'yihua-exterior-v2', 'minghua-enhanced-v1', 'chongde-enhanced-v1', 'international-enhanced-v1', 'renwu-enhanced-v1']
OG_SIZE = (1200, 630)


def encode(image: Image.Image, target: Path, quality: int) -> None:
    image.save(target, 'WEBP', quality=quality, method=6)


# 2026-10-02：五校線稿另產「墨線」版 `<代號>-ink`（黑線、透明底，濃淡在 alpha），給首頁分校分頁、
# 環境頁五校分頁、預約結果用。原本靠 CSS `grayscale(1) brightness(.72) contrast(3.2)`＋`mix-blend-mode:multiply`
# 把米白紙底融掉；iPhone（WebKit）只要把圖或它的祖先移到獨立合成層，multiply 就碰不到底色，露出整塊紙底方塊。
# 同一條曲線先算進 alpha：v＝clamp(2.304Y − 1.1)，黑線 alpha＝1 − v，疊在任何底色上＝底色 × v，與 multiply 相同，
# 但不需要混合模式。曲線在每個尺寸縮圖之後才套（瀏覽器也是縮到顯示尺寸才套 filter），細線濃淡才跟原本一樣。
# 寬度：首頁分頁 48–160px、環境頁 124–170px、預約結果 ≤220px，DPR 1–3。
LINE_ART_INK = {f'campus-line-art-{key}' for key in ['yihua', 'minghua', 'chongde', 'international', 'renwu']}
INK_WIDTHS = [160, 240, 360, 480, 720]
# alpha 有損 q70：與無損的 alpha 最多差 5/255、檔案約減半（240w 約 5.5 KB，與原線稿相當）
INK_ALPHA_QUALITY = 70
INK_CURVE = [round(255 * (1 - min(1, max(0, 2.304 * y / 255 - 1.1)))) for y in range(256)]


def ink_line_art(source: Path) -> None:
    name = f'{source.stem}-ink'
    digest = sha256(source.read_bytes() + f'ink-v1-aq{INK_ALPHA_QUALITY}-{"-".join(map(str, INK_WIDTHS))}'.encode()).hexdigest()[:12]
    candidates = []
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        width, height = image.size
        for size in INK_WIDTHS:
            scaled = image.resize((size, round(height * size / width)), Image.Resampling.LANCZOS)
            # CSS grayscale(1) 用 sRGB 值的 Rec.709 權重
            alpha = scaled.convert('L', matrix=(0.2126, 0.7152, 0.0722, 0)).point(INK_CURVE)
            ink = Image.new('RGBA', scaled.size, (0, 0, 0, 0))
            ink.putalpha(alpha)
            target = OUTPUT / f'{name}-{digest}-{size}.webp'
            if not target.exists():
                ink.save(target, 'WEBP', quality=DEFAULT_QUALITY, alpha_quality=INK_ALPHA_QUALITY, method=6)
            candidates.append({'src': f'/assets/responsive/{target.name}', 'width': size})
    # 無 srcset 時的退路（responsiveImage 的 src 固定是 /assets/<代號>.webp）：最大一級
    (ASSETS / f'{name}.webp').write_bytes(target.read_bytes())
    manifest[name] = {'width': INK_WIDTHS[-1], 'height': round(height * INK_WIDTHS[-1] / width), 'candidates': candidates}


# 非照片：logo.webp 是頁首校徽的無損版（PNG 轉檔、供 SVG 濾鏡去背），不做響應式衍生。
SKIP = {'logo'}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--only', nargs='+', help='只更新指定素材代號，保留 manifest 其他項目')
args = parser.parse_args()
manifest_path = ROOT / 'web/app/generated/image-manifest.json'
manifest = json.loads(manifest_path.read_text()) if args.only and manifest_path.exists() else {}
sources = [ASSETS / f'{name}.webp' for name in args.only] if args.only else sorted(ASSETS.glob('*.webp'))
for source in sources:
    # `-ink` 是下面 ink_line_art() 從線稿產生的，不當母檔
    if source.stem in SKIP or source.stem.endswith('-ink'):
        continue
    if source.stem in LINE_ART_INK:
        ink_line_art(source)
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
