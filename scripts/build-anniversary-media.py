#!/usr/bin/env python3
"""30 週年分頁（/anniversary）的影片與素材。

來源是《手牽手，走到 30》展示作的輸出資料夾（repo 外、已 gitignore 的
output/ivy-30th-20261003/：dist/film.mp4、dist/film-portrait.mp4、page-assets/）。
重算影片或素材場之後跑一次：

    python3 scripts/build-anniversary-media.py --src ~/Desktop/ivy-website-admin/output/ivy-30th-20261003

輸出到 web/public/assets/anniversary/，檔名帶內容雜湊（/assets 是長快取），
並改寫 web/app/utils/anniversary/media.ts。需要 ffmpeg 與 Pillow。
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web/public/assets/anniversary'
TS = ROOT / 'web/app/utils/anniversary/media.ts'
CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']


def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:10]


def publish(tmp: Path, stem: str, ext: str) -> str:
    name = f'{stem}-{digest(tmp)}.{ext}'
    shutil.copyfile(tmp, OUT / name)
    return f'/assets/anniversary/{name}'


def ffmpeg(*args: str) -> None:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


def encode(src: Path, dst: Path, scale: str, kbps: int) -> None:
    # 兩階段平均位元率；輕度降噪讓紙紋顆粒不吃位元；faststart 讓 Range 串流能邊下邊播
    vf = f'scale={scale}:flags=lanczos,hqdn3d=1.2:1.2:4:4'
    common = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-b:v', f'{kbps}k', '-maxrate', f'{int(kbps * 1.5)}k', '-bufsize', f'{kbps * 2}k']
    with tempfile.TemporaryDirectory() as d:
        log = str(Path(d) / 'pass')
        ffmpeg('-i', str(src), '-vf', vf, *common, '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null')
        ffmpeg('-i', str(src), '-vf', vf, *common, '-pass', '2', '-passlogfile', log, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(dst))


def poster(src: Path, dst: Path, width: int, at: float = 29.0) -> None:
    with tempfile.TemporaryDirectory() as d:
        png = Path(d) / 'f.png'
        ffmpeg('-ss', str(at), '-i', str(src), '-frames:v', '1', str(png))
        im = Image.open(png).convert('RGB')
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        im.save(dst, 'WEBP', quality=84, method=6)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, type=Path)
    a = ap.parse_args()
    src = a.src.expanduser()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*'):
        old.unlink()
    media: dict = {}
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        encode(src / 'dist/film.mp4', tmp / 'desk.mp4', '1920:1080', 3000)
        media['filmDesktop'] = publish(tmp / 'desk.mp4', 'film-desktop', 'mp4')
        encode(src / 'dist/film-portrait.mp4', tmp / 'mob.mp4', '720:1280', 1500)
        media['filmMobile'] = publish(tmp / 'mob.mp4', 'film-mobile', 'mp4')
        poster(src / 'dist/film.mp4', tmp / 'pd.webp', 1600)
        media['posterDesktop'] = publish(tmp / 'pd.webp', 'poster-desktop', 'webp')
        poster(src / 'dist/film-portrait.mp4', tmp / 'pm.webp', 900)
        media['posterMobile'] = publish(tmp / 'pm.webp', 'poster-mobile', 'webp')
        poster(src / 'dist/film.mp4', tmp / 'fd.webp', 960, at=0.75)
        media['firstDesktop'] = publish(tmp / 'fd.webp', 'first-desktop', 'webp')
        poster(src / 'dist/film-portrait.mp4', tmp / 'fm.webp', 540, at=0.75)
        media['firstMobile'] = publish(tmp / 'fm.webp', 'first-mobile', 'webp')
    pa = src / 'page-assets'
    media['fields'] = {k: publish(pa / f'fields-{k}.webp', f'fields-{k}', 'webp') for k in CAMPUS_KEYS}
    media['crestFields'] = publish(pa / 'crest-fields.webp', 'crest-fields', 'webp')
    media['kidsBody'] = publish(pa / 'kids-body.webp', 'kids-body', 'webp')
    media['kidsBorder'] = publish(pa / 'kids-border.webp', 'kids-border', 'webp')
    media['paper'] = publish(pa / 'paper-tile.webp', 'paper', 'webp')
    meta = json.loads((pa / 'meta.json').read_text())
    media['cards'] = meta['cards']
    media['kid'] = meta['kid']
    body = json.dumps(media, ensure_ascii=False, indent=2)
    TS.write_text(
        '// 由 scripts/build-anniversary-media.py 產生，不要手改。\n'
        '// 影片與素材場來自《手牽手，走到 30》展示作（output/ivy-30th-20261003）。\n'
        f'export const ANNI_MEDIA = {body} as const\n'
    )
    for k, v in media.items():
        if isinstance(v, str):
            print(k, v, (OUT / Path(v).name).stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
