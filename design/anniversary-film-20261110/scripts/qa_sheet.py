"""成片檢查：每隔 N 秒取一格拼成總表（含時間與小節），另外輸出封面圖。

    python3 qa_sheet.py <video> [每幾秒一格，預設 2] [輸出檔]
    python3 qa_sheet.py --poster <video> <秒> <輸出.jpg>
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont


def grab(video, t, path, w=None):
    vf = 'scale=in_color_matrix=bt709:out_color_matrix=bt709' + (f',scale={w}:-2:flags=lanczos' if w else '')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', video, '-frames:v', '1', '-vf', vf, '-q:v', '2', path], check=True)


def sheet(video, step=2.0, out=None):
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]))
    tiles = []
    font = ImageFont.load_default(size=18)
    with tempfile.TemporaryDirectory() as tmp:
        t = 0.05
        while t < dur:
            p = os.path.join(tmp, f'{len(tiles):04d}.jpg')
            grab(video, t, p, 384)
            im = Image.open(p).convert('RGB')
            d = ImageDraw.Draw(im)
            d.rectangle([0, 0, 150, 24], fill=(0, 0, 0))
            d.text((4, 3), f'{t:6.2f}s  bar {t / (8 / 3):5.2f}', fill='white', font=font)
            tiles.append(im)
            t += step
    w, h = tiles[0].size
    cols = 8
    rows = (len(tiles) + cols - 1) // cols
    canvas = Image.new('RGB', (cols * w, rows * h), 'black')
    for i, im in enumerate(tiles):
        canvas.paste(im, ((i % cols) * w, (i // cols) * h))
    out = out or os.path.splitext(video)[0] + '-sheet.jpg'
    canvas.save(out, quality=85)
    print(out, len(tiles), 'tiles')


if __name__ == '__main__':
    if sys.argv[1] == '--poster':
        grab(sys.argv[2], float(sys.argv[3]), sys.argv[4])
        print(sys.argv[4])
    else:
        sheet(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 2.0, sys.argv[3] if len(sys.argv) > 3 else None)
