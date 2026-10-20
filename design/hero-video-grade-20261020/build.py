#!/usr/bin/env python3
"""首屏影片調亮（2026-10-20）：沿用 09-23 平順版的七鏡頭與畫質處理，在 FFV1 中間檔壓縮前加一道調色。

亮度走「白色 soft-light」曲線：中間調拉亮，0 與 1 不動，亮部不會爆白、黑位不會發灰；
色度等比放大一點，補回提亮後變淡的顏色。只動 YUV 的值，不經 RGB 往返。
封面（首屏、活動影片「一起跑向前」）套同一條曲線，影片接上封面時不跳色。
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import subprocess

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location(
    'hero_restoration', ROOT / 'design/hero-video-restoration-20260922/build.py')
restoration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restoration)

# 2026-10-20 比較 .5／.6／.7：.7 暗部開始發霧、頭髮少了層次，取 .6。
STRENGTH = 0.6
CHROMA = 1.06
ASSETS = ROOT / 'web/public/assets'
# 封面的調色來源（未調色）：首屏封面與 09-22 修復版封面同一檔；活動影片封面另存一份在這裡。
# 品質對齊原檔大小：首屏封面是響應式母檔（衍生圖另由 optimize-site-images.py 壓），活動影片封面直接給瀏覽器。
POSTERS = [
    (ROOT / 'design/hero-video-restoration-20260922/hero-restored-still.webp', ASSETS / 'hero-campus-restored-v1-still.webp', 90),
    (HERE / 'campus-film-run-ungraded.webp', ASSETS / 'campus-film-run.webp', 84),
]


def grade_filter(strength=STRENGTH, chroma=CHROMA):
    t = 'ld(0)'
    lift = f'{t}+{strength}*(if(lte({t},0.25),((16*{t}-12)*{t}+4)*{t},sqrt({t}))-{t})'
    # 只在 16–235（limited range）內套曲線，範圍外照原值。
    y = f'if(between(val,16,235),st(0,(val-16)/219);16+219*({lift}),val)'
    c = f'clip(128+(val-128)*{chroma},16,240)'
    return f"lutyuv=y='{y}':u='{c}':v='{c}'"


def lossless_shots(source, temp):
    """同 design/hero-video-smooth-20260923/build.py：第 5、7 鏡原速 30fps，其餘平順半速。"""
    clips, shots = [], []
    for index, (start, end) in enumerate(restoration.SHOTS, 1):
        natural = index in (5, 7)
        seek = math.floor(start)
        target = temp / f'shot-{index:02d}.mkv'
        motion = 'fps=30' if natural else restoration.MOTION
        filters = ','.join([
            f'trim=start={start-seek:.6f}:end={end-seek:.6f}',
            f'setpts=(PTS-STARTPTS)*{1 if natural else 2}',
            'delogo=x=896:y=8:w=176:h=176', 'crop=1080:800:0:0',
            restoration.RESTORE, motion, restoration.DETAIL, 'format=yuv420p',
        ])
        print(f'鏡頭 {index}/7：{"原速 30fps" if natural else "沿用平順半速"}', flush=True)
        restoration.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
                         '-ss', str(seek), '-t', str(math.ceil(end)-seek), '-i', str(source),
                         '-filter_threads', '2', '-vf', filters, '-an', '-r', '30',
                         '-c:v', 'ffv1', '-threads', '2', str(target)])
        clips.append(target)
        shots.append({'shot': index, 'source_start': start, 'source_end': end,
                      'speed': 1 if natural else 0.5, 'motion': motion,
                      'duration': restoration.probe(target)['format']['duration']})
    return clips, shots


def grade_posters():
    for source, target, quality in POSTERS:
        graded = ROOT / 'output/hero-grade-20261020' / f'{target.stem}.png'
        graded.parent.mkdir(parents=True, exist_ok=True)
        restoration.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                         '-vf', f'format=yuv444p,{grade_filter()},format=rgb24', str(graded)])
        with Image.open(graded) as image:
            image.save(target, 'WEBP', quality=quality, method=6)
        print(f'封面 {target.name}：{source.stat().st_size:,} → {target.stat().st_size:,} bytes', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='園方原片「常春藤廣告+配音 (1).mp4」')
    parser.add_argument('--posters-only', action='store_true', help='只重做封面')
    args = parser.parse_args()
    grade_posters()
    if args.posters_only:
        return
    source = args.source.resolve(strict=True)
    original_manifest = json.loads((ROOT / 'design/hero-video-restoration-20260922/manifest.json').read_text())
    if restoration.sha256(source) != original_manifest['source_sha256']:
        raise SystemExit('來源須為既有已確認的園方原片。')
    temp = ROOT / 'output/hero-grade-20261020/lossless'
    temp.mkdir(parents=True, exist_ok=True)
    clips, shots = lossless_shots(source, temp)
    playlist = temp / 'concat.txt'
    playlist.write_text(''.join(f"file '{clip.name}'\n" for clip in clips))
    variants = []
    for name, crf in [('hero-grade-master', 18), ('hero-grade-mobile-crf26', 26)]:
        target = HERE / f'{name}.mp4'
        print(f'輸出 {name}，1080×800／CRF {crf}', flush=True)
        restoration.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
                         '-f', 'concat', '-safe', '0', '-i', str(playlist), '-filter_threads', '2',
                         '-vf', f'setsar=1,{grade_filter()},format=yuv420p', '-an', '-c:v', 'libx264',
                         '-profile:v', 'high', '-preset', 'slow', '-crf', str(crf),
                         '-threads', '2', '-movflags', '+faststart', str(target)])
        info = restoration.probe(target)
        stream = info['streams'][0]
        assert len(info['streams']) == 1 and stream['codec_type'] == 'video'
        variants.append({'file': target.name, 'width': stream['width'], 'height': stream['height'],
                         'fps': stream['r_frame_rate'], 'frames': stream['nb_frames'],
                         'duration': info['format']['duration'], 'bytes': target.stat().st_size,
                         'crf': crf, 'sha256': restoration.sha256(target)})
    manifest = {'source_filename': source.name, 'source_sha256': restoration.sha256(source),
                'crop': '1080:800:0:0', 'denoise': restoration.RESTORE, 'detail': restoration.DETAIL,
                'grade': {'strength': STRENGTH, 'chroma': CHROMA, 'filter': grade_filter()},
                'shots': shots, 'variants': variants}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
