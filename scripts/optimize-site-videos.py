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
# 2026-10-29 首屏換成舊片＋明華〈快樂城堡〉混剪（同一套調色與標記，見該目錄 README）。
restoration = ROOT / 'design/hero-mix-minghua-20261029'
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
# 消息「一起跑向前」沿用 10-24 的舊首屏手機檔（七鏡戶外跑跳，封面 campus-film-run.webp 是它的第 12 格），
# 不跟著首屏換片；直接複製確認版，不重壓。
run_graded = ROOT / 'design/hero-video-polish-20261024'
run_approved = {item['file']: item for item in json.loads((run_graded / 'manifest.json').read_text())['variants']}
run_prepared = run_graded / 'hero-mobile-h264.mp4'
run_digest = sha256(run_prepared.read_bytes()).hexdigest()
if run_digest != run_approved[run_prepared.name]['sha256']:
    raise ValueError(f'「一起跑向前」影片與確認版雜湊不一致：{run_prepared.name}')
run_target = OUT / f'campus-run-{run_digest[:12]}.mp4'
shutil.copyfile(run_prepared, run_target)
manifest['campus-run'] = f'/assets/optimized/{run_target.name}'
print(f'campus-run: 採用 10-24 舊首屏手機檔 {run_target.stat().st_size:,} bytes', flush=True)
# 孩子的一天 2026-11-13 起換成明華＋仁武混剪（design/day-film-mix-20261113；11-12 是明華幼幼六鏡
# design/day-film-kathy-20261111），11-14 拿掉穿鞋那一鏡剩十四鏡（pick5）：桌機 16:9、手機另剪直式 9:16
# （構圖不同，不是同一支換編碼）。
# 兩支母帶就是確認版成片，直接交付、不再轉碼；雜湊對不上就停，免得放錯檔。
day_graded = ROOT / 'design/day-film-mix-20261113'
day_approved = {item['file']: item for item in json.loads((day_graded / 'manifest.json').read_text())['variants']}
DAY_MASTERS = {'day-film.mp4': 'day-pick5-desktop.mp4', 'day-film-mobile.mp4': 'day-pick5-mobile.mp4'}
# 以下 hero 轉檔參數只在母帶不是確認版時使用：2026-09-22 提高壓縮率（crf 33–34），
# 手機約 0.57 MB、桌機約 1.18 MB。day 影片直接交付母帶（進入視窗才載入）。
for name, source, width, crf in [
    ('hero-mobile', 'hero-campus.mp4', 720, 34),
    ('hero-desktop', 'hero-campus.mp4', 1280, 33),
    # 影片以 cover 鋪滿視窗：桌機 1440×810、手機直式 720×1280，各自的母帶原樣交付。
    ('day-desktop', 'day-film.mp4', 1440, None),
    ('day-mobile', 'day-film-mobile.mp4', 720, None),
]:
    original = SOURCES / source
    if crf is None:
        if sha256(original.read_bytes()).hexdigest() != day_approved[DAY_MASTERS[source]]['sha256']:
            raise ValueError(f'孩子的一天母帶與確認版雜湊不一致：{source}（應為 {DAY_MASTERS[source]}）')
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
