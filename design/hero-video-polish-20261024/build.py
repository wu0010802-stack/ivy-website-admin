#!/usr/bin/env python3
"""首屏影片第二版調色與壓縮（2026-10-24）。

沿用 09-23 平順版的七鏡頭（FFV1 無損中間檔，第 5、7 鏡原速、其餘平順半速），每鏡套 grade.py
產生的 3D LUT，輸出 BT.709（limited range）10-bit 調色中間檔；交付檔都從這份中間檔各壓一次。

- 交付檔標 BT.709 原色／矩陣、sRGB 轉換函數（IEC 61966-2-1）：調色本來就是在 sRGB 做的，這是如實標註。
  實測 1080×800 片在 macOS 的 Chrome（硬體解碼）與 WebKit：沒標記或標 709 轉換函數，中間調都被抬高約
  11/255（舊檔還會被當 SMPTE 170M 多做一道色域轉換），播放瞬間比封面亮一截、蒙一層灰；標 sRGB 兩邊都與
  原值相差 ≤1/255。
- 封面直接取調色中間檔第 0 格，用 709 解回 RGB，跟影片第一格同一個來源。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = ROOT / 'output/hero-video-polish-20261024'


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


grade = _load('hero_grade_20261024', HERE / 'grade.py')
COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv']
SWS = 'accurate_rnd+full_chroma_int+full_chroma_inp+lanczos'
# FFV1／mkv 只留得住矩陣，影格上的原色與轉換函數是 unknown，會蓋過輸出端的 -color_* 旗標，先在影格上補齊。
TAG_FRAMES = 'setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709'
# 原片是 10 Mbps 的廣告成品，散景與牆面平坦區留著壓縮方塊，提了對比後更明顯（H.264 會照樣再壓一次）。
# 門檻 .01／半徑 16 只抹平坦區的小階差；.02 起細髮絲開始變軟（比較圖在 output/…/deband/）。
DEBAND = 'deband=1thr=0.01:2thr=0.01:3thr=0.01:range=16:blur=1'
# (檔名, 編碼器, CRF)：VMAF（對調色中間檔）見 README。AV1 優先、H.264 後備。
DELIVERIES = [
    ('hero-desktop-av1', 'av1', 24),
    ('hero-desktop-h264', 'h264', 18),
    ('hero-mobile-av1', 'av1', 38),
    ('hero-mobile-h264', 'h264', 26),
]


def run(args):
    subprocess.run(args, check=True)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]))


def lossless_shots(source):
    """未調色的七鏡頭 FFV1；已有就沿用（同一份原片、同一套濾鏡，產出相同）。"""
    temp = ROOT / 'output/hero-grade-20261020/lossless'
    clips = [temp / f'shot-{index:02d}.mkv' for index in range(1, 8)]
    if all(clip.exists() for clip in clips):
        return clips
    if source is None:
        raise SystemExit('沒有未調色中間檔，請給園方原片路徑重做。')
    previous = _load('hero_grade_20261020', ROOT / 'design/hero-video-grade-20261020/build.py')
    restoration_manifest = json.loads((ROOT / 'design/hero-video-restoration-20260922/manifest.json').read_text())
    if sha256(source) != restoration_manifest['source_sha256']:
        raise SystemExit('來源須為既有已確認的園方原片。')
    temp.mkdir(parents=True, exist_ok=True)
    clips, _ = previous.lossless_shots(source, temp)
    return clips


def graded_master(clips):
    """每鏡套 LUT → BT.709 10-bit FFV1，再接成一支。回傳 (中間檔, 每鏡參數)。"""
    out = WORK / 'graded'
    out.mkdir(parents=True, exist_ok=True)
    shots = []
    for index, clip in enumerate(clips, 1):
        est = grade.estimate_shot(clip)
        cube = out / f'shot-{index:02d}.cube'
        grade.write_cube(cube, est['gains'], est['black_point'])
        target = out / f'shot-{index:02d}.mkv'
        print(f'調色 鏡頭 {index}/7：增益 {est["gains"]}、黑位 {est["black_point"]}', flush=True)
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', str(clip),
             '-filter_threads', '2', '-vf',
             f'scale=in_color_matrix=bt601:in_range=tv:out_range=pc:flags={SWS},format=rgb48le,'
             f'lut3d=file={cube}:interp=tetrahedral,'
             f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le,{DEBAND}',
             '-an', '-c:v', 'ffv1', '-level', '3', '-threads', '2', *COLOR_TAGS, str(target)])
        shots.append({'shot': index, **{k: est[k] for k in ('gains', 'black_point', 'black_lstar', 'neutral_oklab')}})
    playlist = out / 'concat.txt'
    playlist.write_text(''.join(f"file 'shot-{index:02d}.mkv'\n" for index in range(1, 8)))
    master = out / 'graded-master.mkv'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(playlist),
         '-c', 'copy', str(master)])
    return master, shots


ASSETS = ROOT / 'web/public/assets'
# (第幾格, 輸出, 寬, 高, WebP 品質)：尺寸與舊檔相同。首屏封面是響應式母檔（衍生圖由 optimize-site-images.py 壓）；
# 「一起跑向前」封面是消息區直接用的 720 寬圖，片源就是首屏手機檔的第 12 格。
POSTERS = [(0, ASSETS / 'hero-campus-restored-v1-still.webp', 1080, 800, 90),
           (12, ASSETS / 'campus-film-run.webp', 720, 533, 84)]


def posters(master):
    from PIL import Image
    for frame, target, width, height, quality in POSTERS:
        png = WORK / f'poster-{target.stem}.png'
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-vf',
             f"select='eq(n\\,{frame})',scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},"
             f"format=rgb48le,scale={width}:{height}:flags=lanczos,format=rgb24",
             '-frames:v', '1', '-fps_mode', 'passthrough', str(png)])
        before = target.stat().st_size if target.exists() else 0
        with Image.open(png) as image:
            image.save(target, 'WEBP', quality=quality, method=6)
        print(f'封面 {target.name}：{before:,} → {target.stat().st_size:,} bytes', flush=True)


def encode(master):
    variants = []
    for name, codec, crf in DELIVERIES:
        target = HERE / f'{name}.mp4'
        print(f'輸出 {name}：{codec} CRF {crf}', flush=True)
        if codec == 'h264':
            # 10-bit 中間檔降 8-bit 給 H.264（High profile 瀏覽器都能硬體解）
            video = ['-vf', f'{TAG_FRAMES},format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow',
                     '-crf', str(crf), '-threads', '2']
        else:
            video = ['-vf', TAG_FRAMES, '-c:v', 'libsvtav1', '-preset', '4', '-crf', str(crf), '-pix_fmt', 'yuv420p10le',
                     '-svtav1-params', 'lp=2']
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-an', *video,
             *COLOR_TAGS, '-movflags', '+faststart', str(target)])
        info = probe(target)
        stream = info['streams'][0]
        assert len(info['streams']) == 1 and stream['codec_type'] == 'video'
        tags = tuple(stream.get(k) for k in ('color_space', 'color_primaries', 'color_transfer', 'color_range'))
        assert tags == ('bt709', 'bt709', 'iec61966-2-1', 'tv'), f'{target.name} 色彩標記不完整：{tags}'
        variants.append({'file': target.name, 'codec': stream['codec_name'], 'pix_fmt': stream['pix_fmt'],
                         'width': stream['width'], 'height': stream['height'], 'fps': stream['r_frame_rate'],
                         'frames': stream.get('nb_frames'), 'duration': info['format']['duration'],
                         'bytes': target.stat().st_size, 'crf': crf, 'sha256': sha256(target)})
    return variants


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, nargs='?', help='園方原片「常春藤廣告+配音 (1).mp4」（已有未調色中間檔時可省略）')
    args = parser.parse_args()
    clips = lossless_shots(args.source.resolve(strict=True) if args.source else None)
    master, shots = graded_master(clips)
    posters(master)
    variants = encode(master)
    restoration_manifest = json.loads((ROOT / 'design/hero-video-restoration-20260922/manifest.json').read_text())
    manifest = {'source_filename': restoration_manifest['source_filename'], 'source_sha256': restoration_manifest['source_sha256'],
                'lossless_from': 'design/hero-video-grade-20261020/build.py（未調色七鏡頭）',
                'grade': {k: getattr(grade, k) for k in ('TONE', 'WB_TARGET', 'WB_STRENGTH', 'BLACK_FLOOR', 'BLACK_STRENGTH',
                                                         'VIBRANCE', 'VIB_START', 'VIB_FADE', 'KNEE', 'KNEE_ROOM',
                                                         'SKIN_HUE', 'SKIN_VIB', 'SKIN_TURN', 'LUT_SIZE')},
                'deband': DEBAND, 'color': 'BT.709 原色與矩陣、sRGB 轉換函數、limited range（解碼原片用 BT.601）', 'shots': shots, 'variants': variants}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)
