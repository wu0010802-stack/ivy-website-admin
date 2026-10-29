#!/usr/bin/env python3
"""首屏影片混剪 B「明華為主」（2026-10-29 第二版：以明華原片的色調為準）。

舊首屏第 1、3 鏡（同 10-24 的未調色 FFV1 七鏡）＋〈明華寶貝的快樂城堡〉六鏡。色彩標記與壓縮沿用
design/hero-video-polish-20261024（BT.709／sRGB 標記、AV1＋H.264）；調色改成以明華原片為準（match.py）：

- 明華六鏡不調色：原片沒有色彩標記，Mac 的 Chrome／Safari 以 BT.601 解再抬亮中間調；把這個「螢幕上的樣子」
  （design/day-film-color-20261025/screen-17.cube）燒進像素再標 sRGB，看起來跟原片一樣。所以中間檔保留原片的
  YUV 值、不轉矩陣，後段跟瀏覽器一樣以 BT.601 解。
- 舊兩鏡先套同一個 cube，再套 match.py 算出的對齊 LUT（白平衡、三點影調、膚色），目標值從明華六鏡量。
- 新片是 2160×3840 直式成品，校徽在畫面高度 2–11%、燒入字幕在 55–63%：裁 1080:800 的框放在兩者之間，
  不補洞；要往上移時把寬度縮到 1740、靠左，躲開右上校徽。比稿在 design/hero-mix-20261029（feature/website-admin）。
- 第一版（b4b87b46）新舊片都套 10-24 的 grade.py，比明華原片亮、膚色淡。
- 舊第 1 鏡重調色，封面（第 0 格）跟著重做。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = ROOT / 'output/hero-minghua-tone'
SCREEN_CUBE = ROOT / 'design/day-film-color-20261025/screen-17.cube'
POSTER = ROOT / 'web/public/assets/hero-campus-restored-v1-still.webp'
NEW_SHA256 = '9e3d1c9dd2b11813e04a60f9d86cc321b86ad32b473bdd80a41064e68cc49a22'


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


polish = _load('hero_polish_20261024', ROOT / 'design/hero-video-polish-20261024/build.py')
match = _load('hero_match_20261029', HERE / 'match.py')
grade = polish.grade
run, sha256, probe = polish.run, polish.sha256, polish.probe
SWS = polish.SWS

# ('old', 第幾鏡) 或 ('new', 起, 迄, 裁切 y, 裁切寬)；時間是新片的秒數
SHOTS = [
    ('old', 1),
    ('new', 2.85, 3.68, 461, 2160),    # 老師擁抱
    ('new', 13.25, 13.90, 461, 2160),  # 舉手（之後有手揮過鏡頭）
    ('new', 14.45, 15.55, 461, 2160),  # 圍看色盤
    ('new', 27.40, 28.90, 461, 2160),  # 大笑
    ('new', 33.45, 34.65, 461, 2160),  # 紫色手掌
    ('new', 34.75, 35.65, 400, 1740),  # 抬頭大笑
    ('old', 3),
]


def new_lossless(source, start, end, y, width, target):
    height = round(width * 800 / 1080)
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
         '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', str(source), '-filter_threads', '2', '-vf',
         f'crop={width}:{height}:0:{y},'
         # 保留原片 YUV 值（不轉矩陣），後段跟瀏覽器一樣以 BT.601 解
         f'scale=1080:800:in_color_matrix=bt601:out_color_matrix=bt601:in_range=tv:out_range=tv:flags={SWS},'
         'fps=30,format=yuv420p', '-an', '-c:v', 'ffv1', '-threads', '2', str(target)])


def lossless_shots(old_source, new_source):
    old_clips = polish.lossless_shots(old_source)
    out = WORK / 'lossless'
    out.mkdir(parents=True, exist_ok=True)
    clips = []
    for index, shot in enumerate(SHOTS, 1):
        if shot[0] == 'old':
            clips.append((shot, old_clips[shot[1] - 1]))
            continue
        target = out / f'new-{index:02d}.mkv'
        if not target.exists():
            new_lossless(new_source, *shot[1:], target)
        clips.append((shot, target))
    return clips


def graded_master(clips):
    out = WORK / 'graded'
    out.mkdir(parents=True, exist_ok=True)
    target = match.target_of(grade, [match.read_screen(grade, clip, SCREEN_CUBE) for shot, clip in clips if shot[0] == 'new'])
    print(f'明華六鏡目標：{json.dumps(target, ensure_ascii=False)}', flush=True)
    decode = f'scale=in_color_matrix=bt601:in_range=tv:out_range=pc:flags={SWS},format=rgb48le'
    encode_709 = f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le'
    shots = []
    for index, (shot, clip) in enumerate(clips, 1):
        luts = f'lut3d=file={SCREEN_CUBE}:interp=tetrahedral'
        info = {'shot': index, 'source': shot[0], 'cut': list(shot[1:])}
        if shot[0] == 'old':
            params = match.estimate(grade, match.read_screen(grade, clip, SCREEN_CUBE), target)
            cube = out / f'shot-{index:02d}.cube'
            match.write_cube(grade, cube, params)
            luts += f',lut3d=file={cube}:interp=tetrahedral'
            # 舊原片是 10 Mbps 廣告成品，平坦區有壓縮方塊（同 10-24）；明華 4K 縮下來沒有，不去方塊
            vf = f'{decode},{luts},{encode_709},{polish.DEBAND}'
            info['match'] = params
            print(f'對齊 鏡頭 {index}（舊）：增益 {params["gains"]}、影調 {params["tone"][1:4]}、'
                  f'膚色 ×{params["skin_scale"]} {params["skin_turn"]:+}°', flush=True)
        else:
            vf = f'{decode},{luts},{encode_709}'
            print(f'鏡頭 {index}（明華）：原片螢幕樣貌', flush=True)
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', str(clip),
             '-filter_threads', '2', '-vf', vf,
             # 兩個 lut3d 串接時 ffmpeg 會協商成 yuva420p10le；各鏡格式不同時 concat 複製串流後解碼會壞，固定成同一種
             '-an', '-pix_fmt', 'yuv420p10le', '-c:v', 'ffv1', '-level', '3', '-threads', '2', *polish.COLOR_TAGS,
             str(out / f'shot-{index:02d}.mkv')])
        shots.append(info)
    playlist = out / 'concat.txt'
    playlist.write_text(''.join(f"file 'shot-{index:02d}.mkv'\n" for index in range(1, len(clips) + 1)))
    master = out / 'graded-master.mkv'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(playlist),
         '-c', 'copy', str(master)])
    return master, shots, target


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
    parser.add_argument('old_source', type=Path, help='園方原片「常春藤廣告+配音.mp4」')
    parser.add_argument('new_source', type=Path, help='〈明華寶貝的快樂城堡.mp4〉')
    parser.add_argument('--stage', choices=['lossless', 'all'], default='all')
    args = parser.parse_args()
    new_source = args.new_source.resolve(strict=True)
    if sha256(new_source) != NEW_SHA256:
        raise SystemExit('明華影片雜湊與確認版不同。')
    clips = lossless_shots(args.old_source.resolve(strict=True), new_source)
    if args.stage == 'lossless':
        raise SystemExit(0)
    master, shots, target = graded_master(clips)
    poster(master)
    variants = encode(master)
    old = json.loads((ROOT / 'design/hero-video-polish-20261024/manifest.json').read_text())
    manifest = {'sources': [{'role': 'old', 'filename': old['source_filename'], 'sha256': old['source_sha256']},
                            {'role': 'new', 'filename': '明華寶貝的快樂城堡.mp4', 'sha256': NEW_SHA256,
                             'drive_id': '1thDNYT50SR212NMUjd_tUIW3PQCDdUA5'}],
                'grade': '明華六鏡：screen-17.cube（原片螢幕樣貌）；舊兩鏡：screen-17.cube＋match.py 對齊明華',
                'screen_cube': 'design/day-film-color-20261025/screen-17.cube', 'target': target,
                'deband': polish.DEBAND, 'color': 'BT.709 原色與矩陣、sRGB 轉換函數、limited range',
                'shots': shots, 'variants': variants}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)
