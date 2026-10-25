#!/usr/bin/env python3
"""「孩子的一天」背景影片補 sRGB 色彩標記（2026-10-25）。

舊檔（design/day-timeline-mockup 剪出的 1440×810 母帶）沒有色彩標記。macOS 的 Chrome（硬體解碼）與
Safari 會當 BT.601／SMPTE 170M 解，再把中間調抬高約 11/255、多轉一次色域；使用者至今看到、也據此調過
深綠紗的，是那個「被抬亮過」的畫面。只補標記的話，畫面會照原值顯示、中間調暗約 5 L*。

所以先把「瀏覽器實際顯示的樣子」量出來燒進像素，再標 BT.709 原色／矩陣＋sRGB 轉換函數：
- screen-17.cube：17³ 色票測試片（同格式、沒有標記）在 Chrome 與 WebKit 原尺寸播放的實測值
  （measure/make.py 產片、frames.cjs 截圖、read.py 讀色票；兩個瀏覽器平均差 0.38/255）。
- 用它重現正式站 12 格螢幕截圖：平均差 0.60/255（不轉換是 10.89）。
- 交付檔都從同一份 10-bit 中間檔各壓一次；封面取中間檔第 0 格。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = ROOT / 'output/day-film-color-20261025'
SOURCE = ROOT / 'design/day-timeline-mockup/media/day-film.mp4'  # 正式站 day-desktop 就是這支原封不動
SOURCE_SHA256 = '8ab1f375be85da2487f4cf414cbb3b90f409704d40fbb7b06ee4ba5a34932ba0'
LUT = HERE / 'screen-17.cube'
SWS = 'accurate_rnd+full_chroma_int+full_chroma_inp+lanczos'
TAG_FRAMES = 'setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709'
COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv']
# (檔名, CRF)：桌機以前直接用母帶（9.33 MB），重壓一次 CRF 22 大小相當（CRF 18 要 13.2 MB，放大兩倍也看不出差別）；
# 手機沿用 optimize-site-videos.py 的 CRF 25。VMAF 見 README。
DELIVERIES = [('day-desktop', 22), ('day-mobile', 25)]
POSTER = ROOT / 'web/public/assets/day-poster.webp'
POSTER_QUALITY = 84  # 響應式母檔，衍生圖由 optimize-site-images.py 以 68 再壓；大小與舊檔相當


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


def graded_master():
    if sha256(SOURCE) != SOURCE_SHA256:
        raise SystemExit('來源須為正式站現行的 day-film.mp4。')
    WORK.mkdir(parents=True, exist_ok=True)
    master = WORK / 'day-graded.mkv'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', str(SOURCE),
         '-filter_threads', '2', '-vf',
         f'scale=in_color_matrix=bt601:in_range=tv:out_range=pc:flags={SWS},format=rgb48le,'
         f'lut3d=file={LUT}:interp=tetrahedral,'
         f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le',
         '-an', '-c:v', 'ffv1', '-level', '3', '-threads', '2', str(master)])
    return master


def poster(master):
    from PIL import Image
    png = WORK / 'day-poster.png'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-vf',
         f"select='eq(n\\,0)',scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},format=rgb24",
         '-frames:v', '1', '-fps_mode', 'passthrough', str(png)])
    before = POSTER.stat().st_size
    with Image.open(png) as image:
        image.save(POSTER, 'WEBP', quality=POSTER_QUALITY, method=6)
    print(f'封面 {POSTER.name}：{before:,} → {POSTER.stat().st_size:,} bytes', flush=True)


def encode(master):
    variants = []
    for name, crf in DELIVERIES:
        target = HERE / f'{name}.mp4'
        print(f'輸出 {name}：H.264 CRF {crf}', flush=True)
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-an',
             '-vf', f'{TAG_FRAMES},format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow',
             '-crf', str(crf), '-threads', '2', *COLOR_TAGS, '-movflags', '+faststart', str(target)])
        info = probe(target)
        stream = info['streams'][0]
        assert len(info['streams']) == 1 and stream['codec_type'] == 'video'
        tags = tuple(stream.get(k) for k in ('color_space', 'color_primaries', 'color_transfer', 'color_range'))
        assert tags == ('bt709', 'bt709', 'iec61966-2-1', 'tv'), f'{target.name} 色彩標記不完整：{tags}'
        variants.append({'file': target.name, 'width': stream['width'], 'height': stream['height'],
                         'fps': stream['r_frame_rate'], 'frames': stream.get('nb_frames'),
                         'duration': info['format']['duration'], 'bytes': target.stat().st_size,
                         'crf': crf, 'sha256': sha256(target)})
    return variants


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    master = graded_master()
    poster(master)
    variants = encode(master)
    manifest = {'source': str(SOURCE.relative_to(ROOT)), 'source_sha256': SOURCE_SHA256,
                'lut': LUT.name, 'decode': 'BT.601 limited（瀏覽器對沒標記影片的解法）',
                'color': 'BT.709 原色與矩陣、sRGB 轉換函數、limited range', 'variants': variants}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)
