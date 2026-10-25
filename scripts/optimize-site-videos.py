"""保留長度、畫面比例與母檔；依序轉檔，最多使用兩個執行緒。需 ffmpeg。"""
from pathlib import Path
from hashlib import sha256
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web/public/assets'
# 母帶只給這支腳本讀、不直接對外提供（2026-10-20 從 public/assets 搬出，免得映像與網站多帶 19 MB）。
# 內容與後台仍以 'assets/hero-campus.mp4' 等字串當鍵，由 media-policy.ts 對到 video-manifest.json。
SOURCES = ROOT / 'web/media-src'
OUT = ASSETS / 'optimized'
OUT.mkdir(exist_ok=True)
manifest = {}
# 2026-10-24 起採第二版調色（每鏡 LUT、BT.709 標記、去壓縮方塊），另多一份 AV1（見該目錄 build.py 與 README）。
restoration = ROOT / 'design/hero-video-polish-20261024'
restored = json.loads((restoration / 'manifest.json').read_text())
approved = {item['file']: item for item in restored['variants']}
MASTER = 'hero-desktop-h264.mp4'  # 同時是 web/media-src/hero-campus.mp4
hero_deliveries = {
    # 滿版桌機保留母帶細節（H.264 CRF 18）；高密度手機裁切後也需要完整 1080px（CRF 26）。
    'hero-desktop': 'hero-desktop-h264.mp4',
    'hero-mobile': 'hero-mobile-h264.mp4',
    # AV1 10-bit：VMAF 同級、小 32–33%，瀏覽器回報能順播才用（media-policy.ts 的 preferAv1）。
    'hero-desktop-av1': 'hero-desktop-av1.mp4',
    'hero-mobile-av1': 'hero-mobile-av1.mp4',
}
# 以下 hero 轉檔參數只在母帶不是確認版時使用：2026-09-22 提高壓縮率（crf 33–34），
# 手機約 0.57 MB、桌機約 1.18 MB。day 影片保留母檔解析度（進入視窗才載入）。
for name, source, width, crf in [
    ('hero-mobile', 'hero-campus.mp4', 720, 34),
    ('hero-desktop', 'hero-campus.mp4', 1280, 33),
    # 影片以 cover 鋪滿視窗；480×270 在直式手機會被放大數倍。
    # 桌機直接保留現有最佳母檔；手機也由同一母檔輸出，避免小檔二次壓縮。
    ('day-desktop', 'day-film.mp4', 1440, None),
    ('day-mobile', 'day-film.mp4', 1440, 25),
]:
    original = SOURCES / source
    if crf is None:
        digest = sha256(original.read_bytes()).hexdigest()[:12]
        target = OUT / f'{name}-{digest}.mp4'
        shutil.copyfile(original, target)
        manifest[name] = f'/assets/optimized/{target.name}'
        print(f'{name}: 保留母檔 {target.stat().st_size:,} bytes', flush=True)
        continue
    # 修復版已各自從 FFV1 中間檔壓縮完成，直接採用，避免再次轉碼損失細節。
    if name.startswith('hero-') and sha256(original.read_bytes()).hexdigest() == approved[MASTER]['sha256']:
        for key in (name, f'{name}-av1'):
            prepared = restoration / hero_deliveries[key]
            digest = sha256(prepared.read_bytes()).hexdigest()
            if digest != approved[prepared.name]['sha256']:
                raise ValueError(f'修復影片與確認版雜湊不一致：{prepared.name}')
            target = OUT / f'{key}-{digest[:12]}.mp4'
            shutil.copyfile(prepared, target)
            manifest[key] = f'/assets/optimized/{target.name}'
            print(f'{key}: 採用已確認的調色版 {target.stat().st_size:,} bytes', flush=True)
        continue
    digest = sha256(original.read_bytes() + f'h264-{width}-{crf}-v1'.encode()).hexdigest()[:12]
    target = OUT / f'{name}-{digest}.mp4'
    if not target.exists():
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(original),
                        '-an', '-vf', f'scale=min({width}\\,iw):-2', '-c:v', 'libx264',
                        '-preset', 'slow', '-crf', str(crf), '-pix_fmt', 'yuv420p',
                        '-threads', '2', '-movflags', '+faststart', '-y', str(target)], check=True)
    manifest[name] = f'/assets/optimized/{target.name}'
    print(f'{name}: {original.stat().st_size:,} → {target.stat().st_size:,} bytes', flush=True)
target = ROOT / 'web/app/generated/video-manifest.json'
target.write_text(json.dumps(manifest, indent=2) + '\n')
# 換參數或母帶後舊雜湊檔不會再被引用，留著只會撐大映像（2026-10-05 清掉 9 支、約 28 MB）
for stale in OUT.glob('*.mp4'):
    if f'/assets/optimized/{stale.name}' not in manifest.values():
        stale.unlink()
        print(f'刪除未引用的舊檔 {stale.name}', flush=True)
