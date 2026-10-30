#!/usr/bin/env python3
"""首屏影片：全明華〈快樂城堡〉13 鏡（2026-10-30 第三版，比稿 C）。

色彩標記與壓縮沿用 design/hero-video-polish-20261024（BT.709／sRGB 標記、AV1＋H.264）；鏡頭不調色：

- 原片沒有色彩標記，Mac 的 Chrome／Safari 以 BT.601 解再抬亮中間調；把這個「螢幕上的樣子」
  （design/day-film-color-20261025/screen-17.cube）燒進像素再標 sRGB，看起來跟原片一樣。所以中間檔保留原片的
  YUV 值、不轉矩陣，後段跟瀏覽器一樣以 BT.601 解。明華 4K 縮下來沒有壓縮方塊，不去方塊。
- 原片是 2160×3840 直式成品，校徽在畫面高度 2–11%、燒入字幕在 55–63%：裁 1080:800 的框放在兩者之間，
  不補洞；要往上移時把寬度縮到 1740、靠左，躲開右上校徽；字幕以上的範圍內也可以縮寬往下放大。比稿在 design/hero-mix-20261029（Desktop 工作區）。
- 第一版（b4b87b46）舊兩鏡＋明華六鏡、都套 10-24 的 grade.py；第二版（602a2b0d）照原片色調、舊兩鏡用 match.py 對齊；
  第三版不再用舊片，封面（第 0 格）換成第一鏡老師擁抱。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = ROOT / 'output/hero-minghua-more'
SCREEN_CUBE = ROOT / 'design/day-film-color-20261025/screen-17.cube'
POSTER = ROOT / 'web/public/assets/hero-campus-restored-v1-still.webp'
SOURCE_SHA256 = '9e3d1c9dd2b11813e04a60f9d86cc321b86ad32b473bdd80a41064e68cc49a22'


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


polish = _load('hero_polish_20261024', ROOT / 'design/hero-video-polish-20261024/build.py')
run, sha256 = polish.run, polish.sha256
SWS = polish.SWS

# (起, 迄, 裁切 x, 裁切 y, 裁切寬, 說明)：時間是原片秒數；裁切高＝寬 × 800/1080
SHOTS = [
    (3.02, 3.68, 0, 461, 2160, '老師擁抱'),        # 開場＝封面：3.02 秒起三個孩子的笑臉都在畫面裡，之前大半是老師後腦
    (3.75, 4.75, 0, 461, 2160, '盪架上的男孩'),
    (36.70, 37.60, 0, 461, 2160, '制服女孩大笑'),
    (8.10, 9.10, 0, 461, 2160, '圍著樂器大笑'),
    (13.25, 13.90, 0, 461, 2160, '舉手'),          # 之後有手揮過鏡頭
    (14.45, 15.35, 0, 461, 2160, '圍看色盤'),
    (25.40, 26.40, 190, 700, 1780, '跪坐聽講'),    # 往下放大：y=461 時上緣一排窗戶在導覽列後面，導覽對比只剩 4.54
    (27.40, 28.70, 0, 461, 2160, '大笑'),
    (6.20, 6.95, 0, 461, 2160, '老師抱孩子'),      # 6.2 秒前左側的模糊手臂比較大
    (33.45, 34.45, 0, 461, 2160, '紫色手掌'),
    (34.75, 35.65, 0, 400, 1740, '抬頭大笑'),      # 頭頂要往上，縮寬靠左躲校徽
    (37.85, 38.85, 0, 461, 2160, '踢足球'),
    (40.10, 40.70, 0, 461, 2160, '抱籃球'),        # 之後籃球被裁到
]


def lossless_shots(source):
    out = WORK / 'lossless'
    out.mkdir(parents=True, exist_ok=True)
    clips = []
    for index, (start, end, x, y, width, _) in enumerate(SHOTS, 1):
        target = out / f'shot-{index:02d}.mkv'
        if not target.exists():
            run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
                 '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', str(source), '-filter_threads', '2', '-vf',
                 f'crop={width}:{round(width * 800 / 1080)}:{x}:{y},'
                 # 保留原片 YUV 值（不轉矩陣），後段跟瀏覽器一樣以 BT.601 解
                 f'scale=1080:800:in_color_matrix=bt601:out_color_matrix=bt601:in_range=tv:out_range=tv:flags={SWS},'
                 'fps=30,format=yuv420p', '-an', '-c:v', 'ffv1', '-threads', '2', str(target)])
        clips.append(target)
    return clips


def graded_master(clips):
    out = WORK / 'graded'
    out.mkdir(parents=True, exist_ok=True)
    for index, clip in enumerate(clips, 1):
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', str(clip),
             '-filter_threads', '2', '-vf',
             f'scale=in_color_matrix=bt601:in_range=tv:out_range=pc:flags={SWS},format=rgb48le,'
             f'lut3d=file={SCREEN_CUBE}:interp=tetrahedral,'
             f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le',
             # 各鏡格式要一致，concat 複製串流後才解得開（lut3d 串接時 ffmpeg 曾協商成 yuva420p10le）
             '-an', '-pix_fmt', 'yuv420p10le', '-c:v', 'ffv1', '-level', '3', '-threads', '2', *polish.COLOR_TAGS,
             str(out / f'shot-{index:02d}.mkv')])
    playlist = out / 'concat.txt'
    playlist.write_text(''.join(f"file 'shot-{index:02d}.mkv'\n" for index in range(1, len(clips) + 1)))
    master = out / 'graded-master.mkv'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(playlist),
         '-c', 'copy', str(master)])
    return master


def poster(master):
    """首屏封面＝中間檔第 0 格（BT.709 解回 RGB），尺寸與品質同 10-24。"""
    from PIL import Image
    png = WORK / 'poster.png'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-vf',
         f"select='eq(n\\,0)',scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},format=rgb24",
         '-frames:v', '1', '-fps_mode', 'passthrough', str(png)])
    with Image.open(png) as image:
        image.save(POSTER, 'WEBP', quality=90, method=6)
    print(f'封面 {POSTER.name}：{POSTER.stat().st_size:,} bytes', flush=True)


def encode(master):
    # 交付檔寫到本目錄（polish.encode 寫死 10-24 目錄，所以暫時換掉它的 HERE）
    previous = polish.HERE
    polish.HERE = HERE
    try:
        return polish.encode(master)
    finally:
        polish.HERE = previous


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='〈明華寶貝的快樂城堡.mp4〉')
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    if sha256(source) != SOURCE_SHA256:
        raise SystemExit('明華影片雜湊與確認版不同。')
    master = graded_master(lossless_shots(source))
    poster(master)
    variants = encode(master)
    manifest = {'source': {'filename': '明華寶貝的快樂城堡.mp4', 'sha256': SOURCE_SHA256,
                           'drive_id': '1thDNYT50SR212NMUjd_tUIW3PQCDdUA5'},
                'grade': '不調色：screen-17.cube 燒原片沒標記時的螢幕樣貌',
                'screen_cube': 'design/day-film-color-20261025/screen-17.cube',
                'color': 'BT.709 原色與矩陣、sRGB 轉換函數、limited range',
                'shots': [{'shot': i, 'start': s[0], 'end': s[1], 'crop_x': s[2], 'crop_y': s[3], 'crop_width': s[4], 'note': s[5]}
                          for i, s in enumerate(SHOTS, 1)],
                'variants': variants}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)
