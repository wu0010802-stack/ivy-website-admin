#!/usr/bin/env python3
"""「常春藤的一天」背景影片：繪本淡彩動畫六幕（2026-11-11）。

使用者看過 11-10 的真實影片版後覺得畫質不夠，要求改成全動畫。六幕依拍立得的時序：
早安入園 → 好奇探索 → 一起用餐 → 安靜片刻 → 午後玩耍 → 帶故事回家，最後一幕（黃昏）溶回第一幕（清晨），
兩幕同一個機位，loop 起來像日子又過了一天。

素材（都是 AI 生成，逐幕的提示詞、模型與工作編號在 prompts.md／manifest.json）：
- 關鍵畫面：GPT Image 2.6（2688×1520），風格參考站上的義華校鉛筆線稿、制服與書包的實物配色（不含孩子臉部）；
- 動畫：Kling 3.0 pro 圖生影片，每幕 5 秒、24fps、1912×1080、無聲；
- 放大：ByteDance 影片放大 2K（aigc 預設）→ 2546×1440。

這支腳本做的事：
1. 六幕以 BT.601 解碼（生成檔沒有色彩標記，逐格比對關鍵畫面是 601 limited 最接近）、縮到 2560 寬、裁成 2560×1440；
2. 亮部軟收（TONE），讓大標底下沒有接近紙白的像素；
3. 幕與幕之間 0.75 秒「水彩暈染」轉場：一張低頻雜訊＋由左往右的漸層當遮罩，濕邊不規則地掃過去；
4. 橫式母帶 2560×1440，另出一份 2:3 的直式母帶 960×1440：每一幕在畫面裡有自己的起訖中心（PAN），
   緩緩從一個人移到另一個人，手機不再是把橫式硬裁中間；
5. 母帶（FFV1 10-bit、BT.709／sRGB 標記）→ 桌機 1920×1080、橫拿手機 1280×720、直式手機 960×1440 三支 H.264，
   封面取橫式母帶第 0 格。

用法：
  python3 -I design/day-film-animation-20261111/build.py --clips <放 s1.mp4 … s6.mp4（放大檔）的資料夾> [--stage master|encode]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = ROOT / 'output/day-film-animation-20261111'
POSTER = ROOT / 'web/public/assets/day-poster.webp'
POSTER_SIZE = (1440, 810)   # 響應式母檔，同 10-25／11-10；衍生圖由 optimize-site-images.py 再壓
POSTER_QUALITY = 82

MW, MH, FPS = 2560, 1440, 24          # 橫式母帶
# 直式母帶 2:3。760px 以下的視窗都比它瘦或一樣（iPad mini 直拿 744×1133＝0.66），等高鋪滿、左右再裁：
# 一般手機（390×844）實際看到的是中間 665px＝橫式畫面寬度的 26%，所以每一幕的鏡頭中心（PAN）以 ±13% 的窗來排。
PW, PH = 960, 1440
TRANSITION = 18                        # 0.75 秒
WASH_SOFTNESS = 0.38                   # 濕邊的寬度（遮罩值域的比例）
WASH_SWEEP = 0.55                      # 遮罩裡「由左往右」的比重，其餘是低頻雜訊
EDGE_PIGMENT = 0.05                    # 濕邊前緣顏料堆積的加深量
SWS = 'accurate_rnd+full_chroma_int+full_chroma_inp+lanczos'
TAG_FRAMES = 'setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709'
COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv']

# 亮部軟收：KNEE 以下不動，以上用 tanh 收向 WHITE（輸入 1.0 → 約 WHITE − (WHITE−KNEE)×0.09）。
# 淡彩插畫的牆面與紙白很亮，疊完墨綠紗大標對比只有 2.0；數值由 measure/contrast.py 量出來（見 README）。
TONE_KNEE, TONE_WHITE = 0.60, 0.90

# 每一幕：檔名、取用的格（起, 迄）、直式鏡頭的中心（起, 迄；佔橫式畫面寬度的比例）、說明。
SCENES = [
    dict(key='hello', time='08:00', clip='s1', frames=(0, 121), pan=(0.57, 0.79), note='早安入園：牽手走向校門，老師在門口招手'),
    dict(key='discover', time='09:10', clip='s2', frames=(0, 121), pan=(0.43, 0.55), note='好奇探索：紫高麗菜變色實驗，倒進去暈成粉紅'),
    dict(key='lunch', time='11:40', clip='s3', frames=(0, 121), pan=(0.40, 0.56), note='一起用餐：自己拿湯匙，湯在冒煙'),
    dict(key='rest', time='12:30', clip='s4', frames=(0, 121), pan=(0.33, 0.62), note='安靜片刻：樹下看繪本、靠著老師睡著'),
    dict(key='outside', time='14:20', clip='s5', frames=(0, 121), pan=(0.38, 0.60), note='午後玩耍：操場吹泡泡'),
    # 4 秒後爸爸走到鏡頭前、頭頂貼到畫面上緣，只用前 96 格
    dict(key='home', time='16:30', clip='s6', frames=(0, 96), pan=(0.46, 0.42), note='帶故事回家：牽著爸爸、舉著今天的畫'),
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


def tone_lut():
    x = np.linspace(0, 1, 65536, dtype=np.float64)
    span = TONE_WHITE - TONE_KNEE
    y = np.where(x <= TONE_KNEE, x, TONE_KNEE + span * np.tanh((x - TONE_KNEE) / span))
    return y.astype(np.float32)


def frames_of(clip, start, end, lut):
    """逐格讀一幕：BT.601 limited 解成 16-bit RGB、縮到母帶尺寸、套亮部軟收，回傳 float32 (MH, MW, 3)。"""
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(clip), '-vf',
               f"select='between(n\\,{start}\\,{end - 1})',"
               f'scale={MW}:-2:in_color_matrix=smpte170m:in_range=tv:out_range=pc:flags={SWS},crop={MW}:{MH},format=rgb48le',
               '-fps_mode', 'passthrough', '-f', 'rawvideo', '-']
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    size = MW * MH * 6
    try:
        while True:
            data = process.stdout.read(size)
            if len(data) < size:
                break
            yield lut[np.frombuffer(data, dtype='<u2').reshape(MH, MW, 3)]
    finally:
        process.stdout.close()
        process.wait()


def ease(t):
    return t * t * (3 - 2 * t)


def portrait(frame, centre):
    """直式鏡頭：以 centre（佔寬度比例）為中心裁 PW×PH，位移到小數像素（兩個整數位移線性內插，鏡頭移動才不會一格一格跳）。"""
    left = min(max(centre * MW - PW / 2, 0), MW - PW - 1)
    x0 = int(np.floor(left))
    f = np.float32(left - x0)
    return frame[:, x0:x0 + PW] * (1 - f) + frame[:, x0 + 1:x0 + PW + 1] * f


def pan_centre(scene, local_index):
    start, end = scene['frames']
    progress = local_index / max(end - start - 1, 1)
    c0, c1 = scene['pan']
    return c0 + (c1 - c0) * ease(progress)


def wash_matte(width, height, seed):
    """水彩暈染的遮罩（0–1）：低頻碎形雜訊＋由左往右的漸層；值小的地方先被下一幕蓋過。"""
    rng = np.random.default_rng(seed)
    noise = np.zeros((height, width), dtype=np.float32)
    amplitude, total = 1.0, 0.0
    for cells in (4, 8, 16, 32):
        grid = rng.random((max(2, round(cells * height / width)) + 1, cells + 1)).astype(np.float32)
        layer = np.asarray(Image.fromarray(grid).resize((width, height), Image.BICUBIC), dtype=np.float32)
        noise += layer * amplitude
        total += amplitude
        amplitude *= 0.5
    noise = (noise / total - noise.min() / total)
    noise /= noise.max()
    sweep = np.linspace(0, 1, width, dtype=np.float32)[None, :]
    matte = WASH_SWEEP * sweep + (1 - WASH_SWEEP) * noise
    matte -= matte.min()
    return matte / matte.max()


def wash(a, b, matte, progress):
    """a → b：progress 0–1。濕邊前緣（alpha≈.5）稍微加深，像顏料堆在水的邊緣。"""
    t = np.clip((progress * (1 + WASH_SOFTNESS) - matte) / WASH_SOFTNESS, 0, 1)
    alpha = (t * t * (3 - 2 * t))[..., None]
    mixed = a * (1 - alpha) + b * alpha
    return mixed * (1 - EDGE_PIGMENT * 4 * alpha * (1 - alpha))


class Writer:
    """RGB float → FFV1 10-bit（BT.709 矩陣、limited）。"""

    def __init__(self, target, width, height):
        self.process = subprocess.Popen([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb48le',
            '-s', f'{width}x{height}', '-r', str(FPS), '-i', '-', '-vf',
            f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le,{TAG_FRAMES}',
            '-an', '-c:v', 'ffv1', '-level', '3', '-threads', '4', *COLOR_TAGS, str(target)], stdin=subprocess.PIPE)
        self.count = 0

    def write(self, frame):
        self.process.stdin.write((np.clip(frame, 0, 1) * 65535 + 0.5).astype('<u2').tobytes())
        self.count += 1

    def close(self):
        self.process.stdin.close()
        if self.process.wait() != 0:
            raise SystemExit('母帶寫入失敗')


def assemble(clips):
    """六幕接成兩支母帶。成片從第一幕的第 TRANSITION 格起，最後一幕暈回第一幕的頭 TRANSITION 格，loop 回頭時影格連續。"""
    out = WORK / 'master'
    out.mkdir(parents=True, exist_ok=True)
    landscape, tall = Writer(out / 'day-landscape.mkv', MW, MH), Writer(out / 'day-portrait.mkv', PW, PH)
    lut = tone_lut()
    readers = [frames_of(clips[scene['clip']], *scene['frames'], lut) for scene in SCENES]
    lengths = [scene['frames'][1] - scene['frames'][0] for scene in SCENES]

    def take(index, count, offset):
        """讀 index 幕接下來的 count 格，回傳 [(橫式, 直式)]；offset 是這批的第一格在該幕裡的序號。"""
        scene = SCENES[index]
        pairs = []
        for k in range(count):
            frame = next(readers[index])
            pairs.append((frame, portrait(frame, pan_centre(scene, offset + k))))
        return pairs

    heads = {0: take(0, TRANSITION, 0)}
    first_centre = pan_centre(SCENES[0], TRANSITION)
    for index, scene in enumerate(SCENES):
        body = lengths[index] - 2 * TRANSITION
        for k in range(body):
            frame = next(readers[index])
            landscape.write(frame)
            tall.write(portrait(frame, pan_centre(scene, TRANSITION + k)))
        tail = take(index, TRANSITION, lengths[index] - TRANSITION)
        following = (index + 1) % len(SCENES)
        if following not in heads:
            heads[following] = take(following, TRANSITION, 0)
        head = heads.pop(following)
        wide_matte, tall_matte = wash_matte(MW, MH, 20261111 + index), wash_matte(PW, PH, 20261211 + index)
        for k in range(TRANSITION):
            progress = (k + 1) / (TRANSITION + 1)
            landscape.write(wash(tail[k][0], head[k][0], wide_matte, progress))
            tall.write(wash(tail[k][1], head[k][1], tall_matte, progress))
        print(f'{scene["time"]} {scene["note"]}：{lengths[index]} 格', flush=True)
    landscape.close()
    tall.close()
    assert landscape.count == tall.count == sum(lengths) - len(SCENES) * TRANSITION
    print(f'母帶 {landscape.count} 格、{landscape.count / FPS:.2f} 秒；直式第一格的中心在橫式畫面的 {first_centre:.3f}', flush=True)
    return out / 'day-landscape.mkv', out / 'day-portrait.mkv', first_centre


def poster(master):
    png = WORK / 'day-poster.png'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-vf',
         f"select='eq(n\\,0)',scale={POSTER_SIZE[0]}:{POSTER_SIZE[1]}:in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},format=rgb24",
         '-frames:v', '1', '-fps_mode', 'passthrough', str(png)])
    before = POSTER.stat().st_size if POSTER.exists() else 0
    with Image.open(png) as image:
        image.save(POSTER, 'WEBP', quality=POSTER_QUALITY, method=6)
    print(f'封面 {POSTER.name}：{before:,} → {POSTER.stat().st_size:,} bytes', flush=True)


# (檔名, 母帶, 寬, 高, CRF)。紙紋與筆觸每格都在動，位元率比實拍片高：桌機 CRF 21 要 19.5 MB，CRF 24 是 11.9 MB、
# 1:1 細部看不出差別（對母帶 SSIM 0.978）；只做時間軸降噪（hqdn3d 0:0:4:4）省不到一成，不用。
DELIVERIES = [
    ('day-desktop', 'landscape', 1920, 1080, 24),
    ('day-mobile', 'landscape', 1280, 720, 26),     # 橫拿手機
    ('day-portrait', 'portrait', 960, 1440, 26),    # 直拿手機、760px 以下
]
# 縮小用 bicubic（lanczos 在鉛筆線旁有振鈴亮邊）；再把亮度鎖在亮部軟收的上限＋一點餘裕，
# 色度取樣與縮放造成的過衝不會變成大標底下的亮點。
DOWNSCALE = 'accurate_rnd+full_chroma_int+full_chroma_inp+bicubic'


def luma_ceiling():
    top = TONE_KNEE + (TONE_WHITE - TONE_KNEE) * float(np.tanh((1 - TONE_KNEE) / (TONE_WHITE - TONE_KNEE)))
    return round(64 + 876 * (top + 0.012))   # 10-bit limited range


def encode(masters):
    variants = []
    for name, which, width, height, crf in DELIVERIES:
        target = HERE / f'{name}.mp4'
        print(f'輸出 {name}：{width}×{height} H.264 CRF {crf}', flush=True)
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(masters[which]), '-an',
             '-vf', f'scale={width}:{height}:flags={DOWNSCALE},limiter=max={luma_ceiling()}:planes=1,{TAG_FRAMES},format=yuv420p',
             '-c:v', 'libx264', '-profile:v', 'high',
             '-preset', 'slow', '-crf', str(crf), '-threads', '4', *COLOR_TAGS, '-movflags', '+faststart', str(target)])
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
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--clips', type=Path, required=True, help='放 s1.mp4 … s6.mp4 的資料夾')
    parser.add_argument('--stage', choices=['master', 'encode'], default='encode')
    parser.add_argument('--reuse-master', action='store_true', help='母帶已經在 output/ 就不重組，只重出封面與交付檔')
    args = parser.parse_args()
    sources = json.loads((HERE / 'sources.json').read_text())
    clips = {}
    for scene in SCENES:
        path = (args.clips / f'{scene["clip"]}.mp4').resolve(strict=True)
        expected = sources[scene['clip']]['upscaled_sha256']
        if sha256(path) != expected:
            raise SystemExit(f'{path.name} 雜湊與確認版不同')
        clips[scene['clip']] = path
    if args.reuse_master:
        wide, tall = WORK / 'master/day-landscape.mkv', WORK / 'master/day-portrait.mkv'
        first_centre = pan_centre(SCENES[0], TRANSITION)
    else:
        wide, tall, first_centre = assemble(clips)
    if args.stage == 'master':
        raise SystemExit(0)
    poster(wide)
    variants = encode({'landscape': wide, 'portrait': tall})
    manifest = {
        'generated_with': sources,
        'frame': {'landscape': [MW, MH], 'portrait': [PW, PH], 'fps': FPS, 'transition_frames': TRANSITION},
        'tone': {'knee': TONE_KNEE, 'white': TONE_WHITE, 'luma_ceiling_10bit': luma_ceiling()},
        'wash': {'softness': WASH_SOFTNESS, 'sweep': WASH_SWEEP, 'edge_pigment': EDGE_PIGMENT},
        'portrait_first_centre': round(first_centre, 4),
        'color': '生成檔以 BT.601 limited 解碼；交付檔 BT.709 原色與矩陣、sRGB 轉換函數、limited range',
        'scenes': SCENES,
        'variants': variants,
    }
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps([{k: v for k, v in item.items() if k != 'sha256'} for item in variants], ensure_ascii=False, indent=2), flush=True)
