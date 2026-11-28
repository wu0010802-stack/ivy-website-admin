"""把園方 4K 直式影片剪成 16:9 鏡頭序列（JPEG 影格），需要的鏡頭用 RIFE 補幀做慢動作。

來源（園方雲端「官網素材／影片」，下載到 output/anniversary-film/src/，不進版控）：
  minghua.mp4     〈明華寶貝的快樂城堡〉2160×3840、29.97fps、51 秒；燒入字幕在高 55–64%、校徽在右上
  graduation.mp4  〈2026 畢業典禮宣傳片〉2160×3840、29.97fps、60 秒；字幕在高 15–24%、校徽在左上

每個鏡頭的 16:9 框以 (cx, cy, w) 表示：中心點佔來源寬高的比例、框寬佔來源寬的比例（高 = 寬 × 9/16）。
框一律避開燒入字幕與右上／左上的校徽。

輸出：output/anniversary-film/shots/<id>/0001.jpg …（2304×1296，比成片 1920×1080 大 1.2 倍，留給畫面內的慢推）。
影格數 = 鏡頭拍數 × 20（30fps、90 BPM）。速度 speed < 1 時用 RIFE 4.26 補中間格。

    python3 prepare_footage.py preview            # 每個鏡頭取中間一格、畫出框，輸出檢查用的總表
    python3 prepare_footage.py build [id ...]     # 產生影格（已存在且格數正確的鏡頭跳過）
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(REPO, 'output', 'anniversary-film')
SRC = {'mh': os.path.join(OUT, 'src', 'minghua.mp4'), 'gr': os.path.join(OUT, 'src', 'graduation.mp4')}
SRC_W, SRC_H, SRC_FPS = 2160, 3840, 30000 / 1001
OUT_W, OUT_H, FPS = 2304, 1296, 30
VERTICAL = '--vertical' in sys.argv  # 直式 9:16 版：框改成 (cx, cy, w)，高 = 寬 × 16/9，輸出 1296×2304 到 shots-v/
if VERTICAL:
    OUT_W, OUT_H = 1296, 2304
# 直式框（沒列的用預設：明華取字幕上方 0–55% 高、寬 55%；畢業典禮取字幕下方）
VCROP = {
    'mh-paint': (0.50, 0.820, 0.36), 'mh-laugh-drum': (0.45, 0.275, 0.55), 'mh-hand-up': (0.55, 0.275, 0.55),
    'mh-colour-wheel': (0.40, 0.275, 0.55), 'mh-chicken': (0.60, 0.330, 0.44), 'mh-basketball': (0.52, 0.275, 0.55),
    'mh-boy-look-up': (0.40, 0.275, 0.55), 'mh-run-camera': (0.55, 0.275, 0.55),
    'gr-drum': (0.45, 0.625, 0.75), 'gr-sing': (0.50, 0.500, 0.75), 'gr-arm-up': (0.50, 0.500, 0.75),
}
VDEFAULT = {'mh': (0.50, 0.275, 0.55), 'gr': (0.50, 0.625, 0.75)}
FRAMES_PER_BEAT = 20

# id、來源、入點（秒）、鏡頭結束（秒，硬上限：下一鏡的剪接點）、拍數、速度、框 (cx, cy, w)
SHOTS = [
    # 第三幕〈每一天〉
    dict(id='mh-yard-hug', src='mh', t=1.51, end=2.769, beats=4, speed=0.42, crop=(0.50, 0.392, 1.00)),
    dict(id='mh-hug-smile', src='mh', t=5.81, end=6.974, beats=4, speed=0.38, crop=(0.50, 0.330, 0.90)),
    dict(id='mh-run-girls', src='mh', t=0.05, end=1.502, beats=2, speed=0.60, crop=(0.45, 0.400, 0.80)),
    dict(id='mh-climb', src='mh', t=3.72, end=4.79, beats=2, speed=0.70, crop=(0.45, 0.280, 0.80)),
    dict(id='mh-laugh-drum', src='mh', t=8.06, end=9.19, beats=2, speed=0.70, crop=(0.44, 0.245, 0.85)),
    dict(id='mh-hand-up', src='mh', t=13.20, end=13.90, beats=2, speed=0.45,  # 13.9 秒後有大人的手揮過鏡頭
          crop=(0.50, 0.300, 0.80)),
    dict(id='mh-colour-wheel', src='mh', t=14.42, end=15.649, beats=2, speed=0.80, crop=(0.50, 0.320, 0.90)),
    dict(id='mh-water-table', src='mh', t=20.20, end=22.789, beats=2, speed=0.80, crop=(0.50, 0.360, 1.00)),
    dict(id='mh-water-cups', src='mh', t=15.80, end=17.93, beats=2, speed=0.80, crop=(0.50, 0.330, 0.85)),
    dict(id='mh-water-hands', src='mh', t=18.00, end=19.77, beats=2, speed=0.80, crop=(0.50, 0.270, 1.00)),
    dict(id='mh-curious', src='mh', t=25.35, end=27.20, beats=2, speed=0.80, crop=(0.50, 0.360, 0.90)),
    dict(id='mh-boy-laugh', src='mh', t=27.40, end=30.31, beats=4, speed=0.70, crop=(0.55, 0.270, 0.85)),
    dict(id='mh-chicken', src='mh', t=35.70, end=37.75, beats=4, speed=0.50, crop=(0.50, 0.360, 0.85)),
    dict(id='mh-basketball', src='mh', t=40.10, end=42.30, beats=4, speed=0.60, crop=(0.50, 0.330, 0.90)),
    dict(id='mh-art-mess', src='mh', t=30.40, end=31.88, beats=2, speed=0.70, crop=(0.50, 0.370, 1.00)),
    dict(id='mh-paint', src='mh', t=31.95, end=33.35, beats=2, speed=0.80, crop=(0.50, 0.300, 1.00)),
    dict(id='mh-purple-hands', src='mh', t=33.37, end=34.668, beats=4, speed=0.43, crop=(0.50, 0.415, 0.85)),
    dict(id='mh-look-up', src='mh', t=34.67, end=35.669, beats=4, speed=0.32, crop=(0.50, 0.300, 0.85)),
    dict(id='mh-boy-look-up', src='mh', t=38.96, end=40.06, beats=2, speed=0.70, crop=(0.50, 0.320, 0.85)),
    dict(id='mh-run-camera', src='mh', t=42.60, end=45.30, beats=4, speed=0.60, crop=(0.50, 0.290, 1.00)),
    # 第四幕〈發光〉
    dict(id='gr-hands', src='gr', t=39.92, end=42.90, beats=8, speed=0.52, crop=(0.50, 0.480, 0.80)),
    dict(id='gr-crowns', src='gr', t=25.62, end=27.694, beats=4, speed=0.70, crop=(0.50, 0.480, 0.90)),  # 原本的芭蕾鏡頭裁掉頭、舞台投影閃爍，換掉
    dict(id='gr-drum', src='gr', t=19.05, end=20.80, beats=4, speed=0.60, crop=(0.50, 0.440, 1.00)),
    dict(id='gr-sing', src='gr', t=29.50, end=33.30, beats=4, speed=0.80, crop=(0.50, 0.380, 0.90)),
    dict(id='gr-arm-up', src='gr', t=35.60, end=39.30, beats=4, speed=0.80, crop=(0.50, 0.330, 0.90)),
    dict(id='gr-gowns', src='gr', t=46.87, end=48.60, beats=4, speed=0.60, crop=(0.50, 0.380, 0.90)),
    dict(id='gr-arms-raised', src='gr', t=51.65, end=53.55, beats=4, speed=0.68, crop=(0.50, 0.390, 1.00)),
    dict(id='gr-spotlight', src='gr', t=27.70, end=29.396, beats=8, speed=0.29, crop=(0.50, 0.460, 1.00)),
]


def crop_px(shot):
    if VERTICAL:
        cx, cy, w = VCROP.get(shot['id'], VDEFAULT[shot['src']])
        cw = round(w * SRC_W / 2) * 2
        ch = round(cw * 16 / 9 / 2) * 2
    else:
        cx, cy, w = shot['crop']
        cw = round(w * SRC_W / 2) * 2
        ch = round(cw * 9 / 16 / 2) * 2
    x = int(round(cx * SRC_W - cw / 2))
    y = int(round(cy * SRC_H - ch / 2))
    x = max(0, min(SRC_W - cw, x))
    y = max(0, min(SRC_H - ch, y))
    return x, y, cw, ch


def source_span(shot):
    """回傳實際用到的來源時間 (a, b)。第一格是入點之後的第一個來源格。"""
    n = shot['beats'] * FRAMES_PER_BEAT
    f0 = math.ceil(shot['t'] * SRC_FPS - 1e-6)
    ratio = shot['speed'] * SRC_FPS / FPS
    last = f0 + (n - 1) * ratio + 1  # 補幀要用到右邊的鄰格
    return f0 / SRC_FPS, last / SRC_FPS


def check(shot):
    a, b = source_span(shot)
    # 鏡頭結束點是下一鏡第一格；再留一格安全距離
    limit = (round(shot['end'] * SRC_FPS) - 2) / SRC_FPS
    if b > limit + 1e-6:
        raise SystemExit(f"!! {shot['id']}: 需要到 {b:.3f}s，超過鏡頭可用範圍 {limit:.3f}s")


def preview():
    thumbs = []
    font = ImageFont.load_default(size=16)
    for s in SHOTS:
        check(s)
        a, b = source_span(s)
        tmp = tempfile.mktemp(suffix='.jpg')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{(a + b) / 2:.3f}', '-i', SRC[s['src']], '-frames:v', '1',
                        '-vf', 'scale=in_color_matrix=bt709:out_color_matrix=bt709,scale=270:480', tmp], check=True)
        im = Image.open(tmp).convert('RGB')
        os.remove(tmp)
        d = ImageDraw.Draw(im)
        x, y, cw, ch = crop_px(s)
        k = 270 / SRC_W
        d.rectangle([x * k, y * k, (x + cw) * k, (y + ch) * k], outline=(255, 230, 0), width=3)
        lab = Image.new('RGB', (270, 22), 'black')
        ImageDraw.Draw(lab).text((4, 2), f"{s['id']} {a:.2f}-{b:.2f}", fill='white', font=font)
        tile = Image.new('RGB', (270, 502), 'black')
        tile.paste(im, (0, 0))
        tile.paste(lab, (0, 480))
        thumbs.append(tile)
    cols = 10
    rows = math.ceil(len(thumbs) / cols)
    sheet = Image.new('RGB', (cols * 270, rows * 502), 'gray')
    for i, t in enumerate(thumbs):
        sheet.paste(t, ((i % cols) * 270, (i // cols) * 502))
    path = os.path.join(OUT, 'shots-preview-v.jpg' if VERTICAL else 'shots-preview.jpg')
    sheet.save(path, quality=85)
    print(path)


def extract(shot, tmpdir):
    """抽來源影格（裁好、縮到輸出大小），回傳檔案清單；第 0 張對應入點。"""
    a, b = source_span(shot)
    a -= 0.25 / SRC_FPS  # 讓 -ss 落在入點那一格之前一點，第一張就是入點格
    x, y, cw, ch = crop_px(shot)
    vf = (f'scale=in_color_matrix=bt709:out_color_matrix=bt709,crop={cw}:{ch}:{x}:{y},'
          f'scale={OUT_W}:{OUT_H}:flags=lanczos+accurate_rnd+full_chroma_int')
    # 多抽 2 格，補幀需要右邊的鄰格
    dur = b - a + 3 / SRC_FPS
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{a:.4f}', '-i', SRC[shot['src']], '-t', f'{dur:.4f}',
                    '-vf', vf, '-fps_mode', 'passthrough', os.path.join(tmpdir, '%04d.png')], check=True)
    return sorted(os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.endswith('.png'))


def scan_jumps(dst, n):
    """相鄰兩格的平均差異；某一格比中位數大 5 倍以上（且 > 12/255）就回報。"""
    prev, diffs = None, []
    for k in range(1, n + 1):
        im = np.asarray(Image.open(os.path.join(dst, f'{k:04d}.jpg')).convert('L').resize((192, 108)), np.float32)
        if prev is not None:
            diffs.append(np.abs(im - prev).mean())
        prev = im
    d = np.array(diffs)
    med = np.median(d) + 1e-3
    bad = [i + 2 for i, v in enumerate(d) if v > 5 * med and v > 12]
    return bad


def build(ids):
    from rife import Rife
    rife = None
    for s in SHOTS:
        if ids and s['id'] not in ids:
            continue
        check(s)
        n = s['beats'] * FRAMES_PER_BEAT
        dst = os.path.join(OUT, 'shots-v' if VERTICAL else 'shots', s['id'])
        meta_path = os.path.join(dst, 'meta.json')
        meta = dict(s, crop_px=crop_px(s), frames=n, out=[OUT_W, OUT_H])
        if os.path.exists(meta_path) and json.load(open(meta_path)) == json.loads(json.dumps(meta)):
            print('skip', s['id'])
            continue
        shutil.rmtree(dst, ignore_errors=True)
        os.makedirs(dst)
        with tempfile.TemporaryDirectory() as tmp:
            files = extract(s, tmp)
            cache: dict[int, np.ndarray] = {}

            def frame(i):
                i = min(i, len(files) - 1)
                if i not in cache:
                    cache.clear() if len(cache) > 6 else None
                    cache[i] = np.asarray(Image.open(files[i]).convert('RGB'))
                return cache[i]

            ratio = s['speed'] * SRC_FPS / FPS  # 每一個輸出格前進幾個來源格
            for k in range(n):
                p = k * ratio
                i = int(math.floor(p + 1e-6))
                f = p - i
                if f < 0.02:
                    img = frame(i)
                elif f > 0.98:
                    img = frame(i + 1)
                else:
                    if rife is None:
                        rife = Rife()
                    img = rife(frame(i), frame(i + 1), f)
                Image.fromarray(img).save(os.path.join(dst, f'{k + 1:04d}.jpg'), quality=94, subsampling=0)
                if k % 20 == 0:
                    print(f"{s['id']} {k + 1}/{n}", flush=True)
        jump = scan_jumps(dst, n)
        if jump:
            print(f"!! {s['id']}: 影格 {jump} 前後差異異常大（可能跨到別的鏡頭），請檢查", flush=True)
        json.dump(meta, open(meta_path, 'w'), ensure_ascii=False, indent=1)
        print('done', s['id'], flush=True)


if __name__ == '__main__':
    argv = [a for a in sys.argv[1:] if not a.startswith('--')]
    cmd = argv[0] if argv else 'preview'
    if cmd == 'preview':
        preview()
    elif cmd == 'build':
        build(argv[1:])
