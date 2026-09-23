#!/usr/bin/env python3
"""沿用修復版畫面；第 5、7 鏡恢復原速真實 30fps，消除半速重複幀。"""
import argparse
import importlib.util
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location(
    'hero_restoration', ROOT / 'design/hero-video-restoration-20260922/build.py')
restoration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restoration)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    original_manifest = json.loads((ROOT / 'design/hero-video-restoration-20260922/manifest.json').read_text())
    if restoration.sha256(source) != original_manifest['source_sha256']:
        raise SystemExit('來源須為既有已確認的園方原片。')
    temp = ROOT / 'output/hero-smooth-20260923/lossless'
    temp.mkdir(parents=True, exist_ok=True)
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
        info = restoration.probe(target)
        shots.append({'shot': index, 'source_start': start, 'source_end': end,
                      'speed': 1 if natural else 0.5, 'motion': motion,
                      'duration': info['format']['duration']})
    playlist = temp / 'concat.txt'
    playlist.write_text(''.join(f"file '{clip.name}'\n" for clip in clips))
    variants = []
    for name, crf in [('hero-smooth-master', 18), ('hero-smooth-mobile', 21)]:
        target = HERE / f'{name}.mp4'
        print(f'輸出 {name}，1080×800／CRF {crf}', flush=True)
        restoration.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
                         '-f', 'concat', '-safe', '0', '-i', str(playlist), '-filter_threads', '2',
                         '-vf', 'setsar=1,format=yuv420p', '-an', '-c:v', 'libx264',
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
                'shots': shots, 'variants': variants, 'status': 'local-only'}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
