"""保留長度、畫面比例與母檔；依序轉檔，最多使用兩個執行緒。需 ffmpeg。"""
from pathlib import Path
from hashlib import sha256
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web/public/assets'
OUT = ASSETS / 'optimized'
OUT.mkdir(exist_ok=True)
manifest = {}
# hero 影片 2026-09-22 提高壓縮率：手機 1.17 MB → 約 0.57 MB、桌機 2.32 MB → 約 1.18 MB。
# 母帶本身就是社群版放大後的軟畫面，crf 33–34 在同一幀對照下肉眼看不出差異
# （scratchpad frame-compare）。day 影片維持原參數（進入視窗才載入）。
for name, source, width, crf in [
    ('hero-mobile', 'hero-campus.mp4', 720, 34),
    ('hero-desktop', 'hero-campus.mp4', 1280, 33),
    ('day-desktop', 'day-film.mp4', 1280, 27),
    ('day-mobile', 'day-film-mobile.mp4', 480, 27),
]:
    original = ASSETS / source
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
