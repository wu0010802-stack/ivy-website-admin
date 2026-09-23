"""從既有廣告影片重取五張日常照片，保留原生 1080×800 與原取樣點。

執行：python3 scripts/restore-day-photos.py '/path/to/常春藤廣告+配音.mp4'
再執行 optimize-site-images.py --only day-hello day-discover day-lunch day-outside day-home。
需 FFmpeg 與 Pillow；只更新 Nuxt 素材，不修改凍結原型。
"""
from pathlib import Path
from hashlib import sha256
from io import BytesIO
import argparse
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA256 = '99c51061ff6c5198685ff46ba568a22c16b03af0e710f5a5b3db4e682fee787b'
SAMPLES = {'hello': 35.9, 'discover': 37.9, 'lunch': 16.9, 'outside': 30.3, 'home': 19.4}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    if sha256(args.source.read_bytes()).hexdigest() != SOURCE_SHA256:
        parser.error('來源與已確認影片不同，請先確認鏡頭與取樣秒數。')
    for name, seconds in SAMPLES.items():
        frame = subprocess.check_output([
            'ffmpeg', '-loglevel', 'error', '-threads', '2', '-ss', str(seconds),
            '-i', str(args.source), '-frames:v', '1', '-vf', 'crop=1080:800:0:0',
            '-f', 'image2pipe', '-vcodec', 'png', '-threads', '2', '-'
        ])
        target = ROOT / f'web/public/assets/day-{name}.webp'
        with Image.open(BytesIO(frame)) as image:
            image.save(target, 'WEBP', quality=94, method=6)
        print(f'{target.name}: 1080×800, {target.stat().st_size:,} bytes, {seconds}s')

if __name__ == '__main__':
    main()
