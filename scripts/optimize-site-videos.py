"""保留長度、畫面比例與母檔；依序轉檔，最多使用兩個執行緒。需 ffmpeg。"""
from pathlib import Path
from hashlib import sha256
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'web/public/assets'
OUT = ASSETS / 'optimized'
OUT.mkdir(exist_ok=True)
manifest = {}
restoration = ROOT / 'design/hero-video-smooth-20260923'
restored = json.loads((restoration / 'manifest.json').read_text())
approved = {item['file']: item for item in restored['variants']}
hero_deliveries = {
    # 滿版桌機保留母帶細節；高密度手機裁切後也需要完整 1080px。
    # 手機改用 CRF 26（2026-09-23 晚）：手機模型 VMAF 99.88，3.79 MB → 2.15 MB。
    'hero-desktop': 'hero-smooth-master.mp4',
    'hero-mobile': 'hero-smooth-mobile-crf26.mp4',
}
for name, source, width, crf in [
    ('hero-mobile', 'hero-campus.mp4', 720, 27),
    ('hero-desktop', 'hero-campus.mp4', 1280, 26),
    # 影片以 cover 鋪滿視窗；480×270 在直式手機會被放大數倍。
    # 桌機直接保留現有最佳母檔；手機也由同一母檔輸出，避免小檔二次壓縮。
    ('day-desktop', 'day-film.mp4', 1440, None),
    ('day-mobile', 'day-film.mp4', 1440, 25),
]:
    original = ASSETS / source
    if crf is None:
        digest = sha256(original.read_bytes()).hexdigest()[:12]
        target = OUT / f'{name}-{digest}.mp4'
        shutil.copyfile(original, target)
        manifest[name] = f'/assets/optimized/{target.name}'
        print(f'{name}: 保留母檔 {target.stat().st_size:,} bytes', flush=True)
        continue
    # 修復版已各自從 FFV1 中間檔壓縮完成，直接採用，避免再次轉碼損失細節。
    if name.startswith('hero-') and sha256(original.read_bytes()).hexdigest() == approved['hero-smooth-master.mp4']['sha256']:
        prepared = restoration / hero_deliveries[name]
        digest = sha256(prepared.read_bytes()).hexdigest()
        if digest != approved[prepared.name]['sha256']:
            raise ValueError(f'修復影片與確認版雜湊不一致：{prepared.name}')
        target = OUT / f'{name}-{digest[:12]}.mp4'
        shutil.copyfile(prepared, target)
        manifest[name] = f'/assets/optimized/{target.name}'
        print(f'{name}: 採用已確認的修復版 {target.stat().st_size:,} bytes', flush=True)
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
