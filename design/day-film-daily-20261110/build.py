#!/usr/bin/env python3
"""「孩子的一天」背景影片：園方真實日常片 13 鏡（2026-11-10）。

正式站原本的背景是義華遊藝表演紀錄（舞台燈光、2026 氣球字），跟「孩子的一天」的日常時序不搭；
10-13 審查就提過「背景改日常片」、當時缺素材。這版從園方雲端「官網素材」與既有分享的三支真實影片剪：

- 〈明華寶貝的快樂城堡.mp4〉2160×3840 直式、29.97fps、沒有色彩標記（首屏 10-30 版也是它）；
- 〈常春藤廣告+配音.mp4〉1080×1080、30fps、沒有色彩標記（09-22 首屏修復片的原片）；
- 〈115影片.MP4〉720×1280 直式、30fps、BT.709 標記（2026 年新片）。720 寬不夠鋪 1440，
  三段先用 ByteDance 2K 影片放大成 1440×2560，再裁 1440×810（見 README）。

鏡頭依一天的時序排：入園 → 探索 → 用餐 → 安靜片刻 → 午後玩耍 → 回家；刻意不用首屏 13 鏡用過的段落，
避開燒入字幕、右上校徽、口罩與手揮過鏡頭的格。快動作的鏡頭半速（minterpolate 補格，同 09-23 首屏做法），
鏡頭之間 0.5 秒溶接，最後一鏡溶回第一鏡再從溶接完成處起算，loop 接縫無跳格。

色彩：原片沒標記的兩支照首屏 10-29 第二版的規則，把「瀏覽器對沒標記影片的螢幕樣貌」
（design/day-film-color-20261025/screen-17.cube）燒進像素；115 新片有 BT.709 標記、以 BT.709 解再套同一個 LUT
（Mac 瀏覽器對 709 轉換函數一樣抬亮中間調）。各鏡再做小幅曝光／白平衡對齊（SHOTS 的 adjust），
交付檔標 BT.709 原色／矩陣＋sRGB 轉換函數、limited range。

用法：
  python3 -I design/day-film-daily-20261110/build.py \
      --minghua <明華寶貝的快樂城堡.mp4> --ad <常春藤廣告+配音.mp4> --f115 <115影片.MP4> \
      [--f115-upscaled <ByteDance 2K 放大後的三段合併檔>] [--stage lossless|graded|master|encode]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = ROOT / 'output/day-film-daily-20261110'
SCREEN_CUBE = ROOT / 'design/day-film-color-20261025/screen-17.cube'
POSTER = ROOT / 'web/public/assets/day-poster.webp'
POSTER_QUALITY = 84  # 同 10-25：響應式母檔，衍生圖由 optimize-site-images.py 以 68 再壓

WIDTH, HEIGHT, FPS = 1440, 810, 30
DISSOLVE = 0.5  # 秒；每個鏡頭之間與 loop 接縫都是同一個長度
SWS = 'accurate_rnd+full_chroma_int+full_chroma_inp+lanczos'
TAG_FRAMES = 'setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709'
COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv']
# 廣告原片是 10 Mbps 成品，散景與牆面有壓縮方塊（10-24 首屏同一支原片的發現），只對它去方塊
DEBAND = 'deband=1thr=0.01:2thr=0.01:3thr=0.01:range=16:blur=1'
# 半速補格：預設的動態搜尋在朝鏡頭跑的臉上會糊成一片（第一鏡中間女孩，每隔一格），改 umh 搜尋、範圍 64 就乾淨；
# blend 模式是雙影，不用。比較圖見 README。
MINTERP = 'minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:me=umh:search_param=64:vsbmc=1:scd=none'
# (檔名, CRF)：桌機 CRF 20（溶接與補格的畫面比舊片軟，CRF 22 在 1440 寬放大看得出方塊）；手機沿用 25。
DELIVERIES = [('day-desktop', 20), ('day-mobile', 25)]

# 原片沒有色彩標記的兩支，瀏覽器以 BT.601 解；115 新片標 BT.709。
SOURCES = {
    'minghua': {'filename': '明華寶貝的快樂城堡.mp4', 'drive_id': '1thDNYT50SR212NMUjd_tUIW3PQCDdUA5', 'matrix': 'bt601',
                'sha256': '9e3d1c9dd2b11813e04a60f9d86cc321b86ad32b473bdd80a41064e68cc49a22'},
    'ad': {'filename': '常春藤廣告+配音.mp4', 'drive_id': '1IzRwbfF04IqKw8NGHEsfDklA_HmzkSoz', 'matrix': 'bt601',
           'sha256': '99c51061ff6c5198685ff46ba568a22c16b03af0e710f5a5b3db4e682fee787b'},
    'f115': {'filename': '115影片.MP4', 'drive_id': '1ia44JtaLiGi1qkn3WOTwChtEexkGH6Qd', 'matrix': 'bt709',
             'sha256': '589cd2bc1b745518781b0f9e57e5ad39c2692037df5ab9f6c55947bd52e68baf'},
}
# 115 新片送去放大的三段（原片秒數）；放大檔是這三段依序接起來的 1440×2560
F115_SEGMENTS = [(25.9, 27.65), (34.85, 36.0), (43.9, 46.15)]

# 全片亮部軟收（0.85 → 0.78、1 → 0.92）：白衣、白牆、水桌與窗光不再是純白，大標底下最亮像素的對比從 2.02 回到舊片的 2.3 上下
# （measure/contrast.py 逐格：只收開場兩鏡時水桌、小提琴教室、全班跑那幾鏡仍 2.02–2.06）；中間調以下不動，膚色不變。
HIGHLIGHT_ROLLOFF = "curves=all='0/0 0.5/0.49 0.85/0.78 1/0.92'"

# 每鏡：來源、原片起迄秒、速度（<1 為慢動作、minterpolate 補到 30fps）、裁切 (x, y, 寬)（高＝寬×9/16）、調整濾鏡、說明。
# 裁切框都避開右上校徽（明華 2–11%、廣告 y 18–165／x 924–1059 px、115 2–9% 高）與燒入字幕（明華 55–63%、廣告 85–92%）。
SHOTS = [
    dict(src='ad', start=0.00, end=1.05, speed=0.5, crop=(0, 172, 1080), adjust='', note='入園：三個孩子朝鏡頭跑來（開場＝封面）'),
    dict(src='minghua', start=0.00, end=1.45, speed=0.5, crop=(0, 720, 2160), adjust='', note='入園：制服女孩在操場跑'),
    dict(src='minghua', start=7.00, end=7.95, speed=0.5, crop=(0, 600, 2160), adjust='', note='探索：兩個孩子看手上的葉子'),
    dict(src='minghua', start=15.60, end=17.95, speed=1.0, crop=(0, 520, 2160), adjust='', note='探索：黃衣男孩倒水（框往下放到手與水杯，頭頂切一點）'),
    dict(src='minghua', start=18.00, end=19.60, speed=1.0, crop=(0, 560, 2160), adjust='', note='探索：水裡的玩具魚與小手（特寫，換個景別）'),
    dict(src='minghua', start=20.30, end=22.50, speed=1.0, crop=(0, 560, 2160), adjust='', note='探索：一群孩子圍著水桌'),
    dict(src='ad', start=16.45, end=17.40, speed=0.5, crop=(0, 172, 1080), adjust='colorbalance=rm=-0.06:gm=0.03', note='用餐：女孩拿湯匙（「我自己來」）；原片偏洋紅，中間調往綠拉一點'),
    dict(src='f115', start=26.00, end=27.55, speed=0.65, crop=(0, 500, 720), adjust='', note='安靜：小提琴課全景（陽光教室）'),
    dict(src='f115', start=35.00, end=35.95, speed=0.5, crop=(0, 240, 720), adjust='', note='安靜：女孩拉小提琴特寫（35.0 起字幕已淡掉）'),
    dict(src='ad', start=36.50, end=37.80, speed=0.8, crop=(0, 172, 1080), adjust='', note='安靜：老師與孩子額頭相碰'),
    dict(src='minghua', start=30.30, end=31.80, speed=0.65, crop=(0, 560, 2160), adjust='eq=brightness=-0.03:gamma=0.93', note='午後：紙雪花滿天飛（白牆白紙，中位 L* 86，壓一點免得圖說沒對比）'),
    dict(src='minghua', start=42.95, end=44.45, speed=0.5, crop=(0, 260, 1700), adjust='', note='午後：男孩領頭衝向鏡頭（縮寬躲校徽、頭頂留空）'),
    dict(src='f115', start=44.25, end=46.10, speed=0.7, crop=(0, 560, 720), adjust='', note='回家：全班朝鏡頭跑來（44.2 前字幕還在淡、46.2 起有校徽）；收尾溶回第一鏡，兩鏡都是朝鏡頭跑，接縫像換了一天'),
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


def frames_of(path):
    # mkv 不記格數，要實際數
    return int(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                                        '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(path)]).decode().strip())


def shot_key(shot):
    params = {k: shot[k] for k in ('src', 'start', 'end', 'speed', 'crop')}
    if shot['speed'] < 1:
        params['minterpolate'] = MINTERP
    return hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()[:8]


def source_for(shot, paths):
    """回傳 (檔案, 起始秒, 裁切倍率, 解碼矩陣)。115 有放大檔時改讀放大檔，時間換算到合併檔、裁切座標 ×2。"""
    src = shot['src']
    if src == 'f115' and paths.get('f115_upscaled'):
        offset = 0.0
        for seg_start, seg_end in F115_SEGMENTS:
            if seg_start <= shot['start'] and shot['end'] <= seg_end + 1e-6:
                return paths['f115_upscaled'], shot['start'] - seg_start + offset, 2, probe_matrix(paths['f115_upscaled'], 'bt709')
            offset += seg_end - seg_start
        raise SystemExit(f'115 鏡頭 {shot["start"]}–{shot["end"]} 不在放大的三段裡')
    return paths[src], shot['start'], 1, SOURCES[src]['matrix']


def probe_matrix(path, default):
    stream = probe(path)['streams'][0]
    space = stream.get('color_space')
    return space if space in ('bt709', 'bt601', 'smpte170m') else default


def lossless_shots(paths):
    """每鏡裁切、縮到 1440×810、慢動作補格 → FFV1（保留原片 YUV 值、不轉矩陣）。"""
    out = WORK / 'lossless'
    out.mkdir(parents=True, exist_ok=True)
    clips = []
    for index, shot in enumerate(SHOTS, 1):
        path, start, scale_by, matrix = source_for(shot, paths)
        key = shot_key(shot) + ('-up' if scale_by != 1 else '')
        target = out / f'shot-{index:02d}-{key}.mkv'
        if not target.exists():
            x, y, w = (v * scale_by for v in shot['crop'])
            h = round(w * 9 / 16 / 2) * 2
            matrix_in = 'smpte170m' if matrix == 'bt601' else matrix
            filters = [f'crop={w}:{h}:{x}:{y}',
                       f'scale={WIDTH}:{HEIGHT}:in_color_matrix={matrix_in}:out_color_matrix={matrix_in}:in_range=tv:out_range=tv:flags={SWS}']
            if shot['speed'] < 1:
                filters += [f'setpts=PTS/{shot["speed"]}', MINTERP]
            filters += [f'fps={FPS}', 'format=yuv420p']
            print(f'裁切 鏡頭 {index}/{len(SHOTS)}：{shot["note"]}', flush=True)
            run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
                 '-ss', f'{start:.3f}', '-t', f'{shot["end"] - shot["start"]:.3f}', '-i', str(path),
                 '-filter_threads', '2', '-vf', ','.join(filters), '-an', '-c:v', 'ffv1', '-threads', '2', str(target)])
        clips.append((target, matrix))
    return clips


def graded_shots(clips):
    """各鏡：以各自的矩陣解成 RGB → 螢幕 LUT → 小幅對齊 → BT.709 10-bit FFV1（格式一致才能 xfade／concat）。"""
    out = WORK / 'graded'
    out.mkdir(parents=True, exist_ok=True)
    graded = []
    for index, ((clip, matrix), shot) in enumerate(zip(clips, SHOTS), 1):
        key = hashlib.sha1((clip.name + shot['adjust'] + HIGHLIGHT_ROLLOFF).encode()).hexdigest()[:8]
        target = out / f'shot-{index:02d}-{key}.mkv'
        if not target.exists():
            matrix_in = 'smpte170m' if matrix == 'bt601' else matrix
            chain = [f'scale=in_color_matrix={matrix_in}:in_range=tv:out_range=pc:flags={SWS}', 'format=rgb48le',
                     f'lut3d=file={SCREEN_CUBE}:interp=tetrahedral']
            if shot['adjust']:
                chain.append(shot['adjust'])
            chain.append(HIGHLIGHT_ROLLOFF)
            chain += [f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS}', 'format=yuv420p10le']
            if shot['src'] == 'ad':
                chain.append(DEBAND)
            print(f'調色 鏡頭 {index}/{len(SHOTS)}', flush=True)
            run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', str(clip),
                 '-filter_threads', '2', '-vf', ','.join(chain), '-an', '-pix_fmt', 'yuv420p10le',
                 '-c:v', 'ffv1', '-level', '3', '-threads', '2', *COLOR_TAGS, str(target)])
        graded.append(target)
    return graded


def assemble(graded):
    """13 鏡＋第一鏡再放一次，全部 0.5 秒溶接；輸出從第一鏡溶接完成處起、到最後溶回第一鏡完成處止，loop 無縫。"""
    out = WORK / 'master'
    out.mkdir(parents=True, exist_ok=True)
    sequence = graded + [graded[0]]
    lengths = [frames_of(clip) / FPS for clip in sequence]
    inputs = []
    for clip in sequence:
        inputs += ['-i', str(clip)]
    chain = []
    label = '[0:v]'
    elapsed = lengths[0]
    for index in range(1, len(sequence)):
        offset = elapsed - DISSOLVE
        nxt = f'[v{index}]'
        chain.append(f'{label}[{index}:v]xfade=transition=fade:duration={DISSOLVE}:offset={offset:.6f}{nxt}')
        label = nxt
        elapsed = offset + lengths[index]
    loop_end = sum(lengths[:-1]) - (len(sequence) - 2) * DISSOLVE  # 最後一鏡溶回第一鏡完成的時間點
    chain.append(f'{label}trim=start={DISSOLVE}:end={loop_end:.6f},setpts=PTS-STARTPTS,{TAG_FRAMES},format=yuv420p10le[out]')
    master = out / 'day-master.mkv'
    print(f'溶接 {len(graded)} 鏡：各鏡 {[round(v, 2) for v in lengths[:-1]]} 秒 → 成片約 {loop_end - DISSOLVE:.2f} 秒', flush=True)
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', *inputs,
         '-filter_complex', ';'.join(chain), '-map', '[out]', '-an', '-c:v', 'ffv1', '-level', '3', '-threads', '2',
         *COLOR_TAGS, str(master)])
    return master, lengths[:-1]


def poster(master):
    """封面＝母帶第 0 格（BT.709 解回 RGB），與影片第一格同源。"""
    from PIL import Image
    png = WORK / 'day-poster.png'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-vf',
         f"select='eq(n\\,0)',scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},format=rgb24",
         '-frames:v', '1', '-fps_mode', 'passthrough', str(png)])
    before = POSTER.stat().st_size if POSTER.exists() else 0
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


def check_sources(paths):
    for key, meta in SOURCES.items():
        digest = sha256(paths[key])
        if meta['sha256'] and digest != meta['sha256']:
            raise SystemExit(f'{meta["filename"]} 雜湊與確認版不同：{digest}')
        meta['sha256'] = digest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--minghua', type=Path, required=True)
    parser.add_argument('--ad', type=Path, required=True)
    parser.add_argument('--f115', type=Path, required=True)
    parser.add_argument('--f115-upscaled', type=Path)
    parser.add_argument('--stage', choices=['lossless', 'graded', 'master', 'encode'], default='encode')
    args = parser.parse_args()
    paths = {'minghua': args.minghua.resolve(strict=True), 'ad': args.ad.resolve(strict=True), 'f115': args.f115.resolve(strict=True),
             'f115_upscaled': args.f115_upscaled.resolve(strict=True) if args.f115_upscaled else None}
    check_sources(paths)
    clips = lossless_shots(paths)
    if args.stage == 'lossless':
        raise SystemExit(0)
    graded = graded_shots(clips)
    if args.stage == 'graded':
        raise SystemExit(0)
    master, lengths = assemble(graded)
    if args.stage == 'master':
        raise SystemExit(0)
    poster(master)
    variants = encode(master)
    manifest = {
        'sources': SOURCES,
        'f115_upscaled': ({'segments': F115_SEGMENTS, 'sha256': sha256(paths['f115_upscaled']), 'tool': 'ByteDance 影片放大 2K（Higgsfield）'}
                          if paths['f115_upscaled'] else None),
        'grade': '不調色：screen-17.cube 燒原片在瀏覽器裡的螢幕樣貌；各鏡 adjust 只做小幅對齊',
        'screen_cube': 'design/day-film-color-20261025/screen-17.cube',
        'color': 'BT.709 原色與矩陣、sRGB 轉換函數、limited range',
        'frame': {'width': WIDTH, 'height': HEIGHT, 'fps': FPS, 'dissolve': DISSOLVE},
        'shots': [{'shot': i, **shot, 'seconds': round(length, 3)} for i, (shot, length) in enumerate(zip(SHOTS, lengths), 1)],
        'variants': variants,
    }
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(variants, ensure_ascii=False, indent=2), flush=True)
