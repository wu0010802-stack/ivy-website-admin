#!/usr/bin/env python3
"""首屏影片混剪 B「明華為主」（2026-10-29）。

舊首屏第 1、3 鏡（同 10-24 的未調色 FFV1 七鏡）＋〈明華寶貝的快樂城堡〉六鏡，調色、色彩標記與壓縮沿用
design/hero-video-polish-20261024（grade.py 每鏡 LUT、BT.709／sRGB 標記、AV1＋H.264）。

- 新片是 2160×3840 直式成品，校徽在畫面高度 2–11%、燒入字幕在 55–63%：裁 1080:800 的框放在兩者之間，
  不補洞；要往上移時把寬度縮到 1740、靠左，躲開右上校徽。比稿在 design/hero-mix-20261029（feature/website-admin）。
- 新片沒有色彩標記，是 HD 成品，以 BT.709 解；中間檔轉成 BT.601 矩陣，讓後段跟舊片一樣以 BT.601 解回 RGB。
- 影調：新片與舊片共用同一條 TONE 曲線。實測套完後新片六鏡平均 L* 62.9–75.2，與舊片七鏡 61.7–74.2 同一區間
  （README 有逐鏡數字），不另調。
- 第一鏡與 10-24 相同，封面（第 0 格）不用換。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = ROOT / 'output/hero-mix-minghua-20261029'
NEW_SHA256 = '9e3d1c9dd2b11813e04a60f9d86cc321b86ad32b473bdd80a41064e68cc49a22'


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


polish = _load('hero_polish_20261024', ROOT / 'design/hero-video-polish-20261024/build.py')
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
         f'scale=1080:800:in_color_matrix=bt709:out_color_matrix=bt601:in_range=tv:out_range=tv:flags={SWS},'
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
    shots = []
    for index, (shot, clip) in enumerate(clips, 1):
        est = grade.estimate_shot(clip)
        cube = out / f'shot-{index:02d}.cube'
        grade.write_cube(cube, est['gains'], est['black_point'])
        target = out / f'shot-{index:02d}.mkv'
        print(f'調色 鏡頭 {index}/{len(clips)}（{shot[0]}）：增益 {est["gains"]}、黑位 {est["black_point"]}', flush=True)
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', str(clip),
             '-filter_threads', '2', '-vf',
             f'scale=in_color_matrix=bt601:in_range=tv:out_range=pc:flags={SWS},format=rgb48le,'
             f'lut3d=file={cube}:interp=tetrahedral,'
             f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le,{polish.DEBAND}',
             '-an', '-c:v', 'ffv1', '-level', '3', '-threads', '2', *polish.COLOR_TAGS, str(target)])
        shots.append({'shot': index, 'source': shot[0], 'cut': list(shot[1:]),
                      **{k: est[k] for k in ('gains', 'black_point', 'black_lstar', 'neutral_oklab')}})
    playlist = out / 'concat.txt'
    playlist.write_text(''.join(f"file 'shot-{index:02d}.mkv'\n" for index in range(1, len(clips) + 1)))
    master = out / 'graded-master.mkv'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(playlist),
         '-c', 'copy', str(master)])
    return master, shots


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
    master, shots = graded_master(clips)
    variants = encode(master)
    old = json.loads((ROOT / 'design/hero-video-polish-20261024/manifest.json').read_text())
    manifest = {'sources': [{'role': 'old', 'filename': old['source_filename'], 'sha256': old['source_sha256']},
                            {'role': 'new', 'filename': '明華寶貝的快樂城堡.mp4', 'sha256': NEW_SHA256,
                             'drive_id': '1thDNYT50SR212NMUjd_tUIW3PQCDdUA5'}],
                'grade': 'design/hero-video-polish-20261024/grade.py（新舊片同一套參數）',
                'deband': polish.DEBAND, 'color': 'BT.709 原色與矩陣、sRGB 轉換函數、limited range',
                'shots': shots, 'variants': variants}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)
