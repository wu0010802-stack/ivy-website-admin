#!/usr/bin/env python3
"""常春藤的一天背景片：只用明華〈2024幼幼班介紹Kathy〉一支，六個時段各一鏡的「小手與背影」版（2026-11-11 比稿）。

片源：output/day-fb-src-20261105/fb-minghua-815137417136803-3840x2160.mp4（FB 版，3840×2160 AV1 29.97fps 沒標記）。
Drive 上的〈2024幼幼班介紹Kathy.mp4〉是同一支成片（同長度、同畫面、校徽字幕一樣燒在裡面），只差碼率，所以沿用本機這支。
左上校徽（x 165–1102、y 90–281）、字幕 90.4–94.4% 高，裁切框一律躲開（FORBID）。

跟 11-05 明華＋仁武版（12 鏡、同段硬切、近景正臉）不同的地方：
- 一個時段只放一鏡，共六鏡，沒有硬切；換鏡一律溶接 1 秒，最後一鏡溶回片頭。
- 只挑不拍正臉的鏡頭（背影、小手、空景），臉最多是側面或遠處。
- 每鏡放慢到 0.38–0.5 倍（minterpolate 補格），讓每鏡停留 4–5 秒。

色彩照 11-05：以 BT.601 解 → screen-17.cube（沒標記影片在 Mac 上的樣子）→ EXPOSE → 標 BT.709 原色／矩陣＋sRGB 轉換函數。

用法（repo 根目錄）：
  python3 -I design/day-film-kathy-20261111/build.py review            # 每鏡裁切框預覽 → WORK/review.jpg
  python3 -I design/day-film-kathy-20261111/build.py desktop mobile    # 中間檔＋成片
  python3 -I design/day-film-kathy-20261111/build.py stats             # 每秒、每鏡平均 Y
"""
import io, subprocess, sys
from collections import namedtuple
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SRC = ROOT / 'output/day-fb-src-20261105/fb-minghua-815137417136803-3840x2160.mp4'
WORK = ROOT / 'output/day-kathy-20261111'
SCREEN = ROOT / 'output/hero-115-20261103/tools/screen-17.cube'
SWS = 'accurate_rnd+full_chroma_int+full_chroma_inp+lanczos'
SW, SH, FPS, MATRIX = 3840, 2160, 30000 / 1001, 'bt601'
FADE, HOLD = 1.0, 0.3
NAME = 'day-kathy'
# 不能進裁切框的區域 (x0, y0, x1, y1)：字幕帶、校徽
FORBID = [(0, 1935, 3840, 2160), (0, 0, 1150, 300)]

# 代號、起迄秒數、放慢倍率、桌機裁切 (x, y, 寬；高＝寬×9/16)、手機裁切 (x, y, 寬；高＝寬×16/9)、時段、說明
Clip = namedtuple('Clip', 'key a b speed desk mob slot note')
CLIPS = [
    Clip('hug', 141.00, 142.95, 0.42, (300, 300, 2880), (1250, 0, 1085), '08:00 早安入園', '校門口，老師蹲下來抱住孩子（孩子背對鏡頭）'),
    Clip('sorter', 133.56, 135.70, 0.45, (300, 300, 2880), (790, 300, 918), '09:10 好奇探索', '小手把形狀放進套盒'),
    # 第一版這裡是「老師遞碗、孩子自己吃」（83.34–85.08）：這支片的用餐鏡頭都拍正臉，放上頁面後男孩的臉佔右邊快兩成寬，換成背影
    Clip('backs', 28.80, 31.20, 0.5, (480, 300, 2880), (1500, 0, 1085), '11:40 一起用餐', '孩子背著手排隊（沒有不拍正臉的用餐鏡頭，用排隊代替）'),
    Clip('lavender', 0.06, 1.92, 0.4, (480, 300, 2880), (1700, 0, 1085), '12:30 安靜片刻', '沒有人的遊戲場，薰衣草在溜滑梯前輕輕晃'),
    Clip('slide', 38.75, 40.35, 0.4, (0, 300, 2880), (1130, 300, 918), '14:20 午後玩耍', '紅磚牆前，孩子溜下滑梯跑開（遠景）'),
    Clip('shoes', 78.76, 80.18, 0.38, (480, 300, 2880), (1300, 0, 1085), '16:30 帶故事回家', '孩子坐在鞋櫃前自己穿鞋（溶回早上校門口）'),
]
EXPOSE = 'curves=all=0/0 0.5/0.43 1/0.93'
TONE = {}
TONE_PORTRAIT = {}
# 第一版桌機：校門口擁抱平均 Y 140、套盒 134，最亮一秒 146（現行 133、11-05 版 136）；手機 128／125、最亮一秒 132，不用壓
TONE_DESKTOP = {'hug': 'curves=all=0/0 0.5/0.44 1/0.90', 'sorter': 'curves=all=0/0 0.5/0.46 1/0.93'}
VARIANTS = {'desktop': (1440, 810, 22, 'desk'), 'mobile': (720, 1280, 25, 'mob')}


def snap(t):
    return round(t * FPS) / FPS


def crop_of(c, kind):
    x, y, w = getattr(c, kind)
    h = round(w * 9 / 16) if kind == 'desk' else round(w * 16 / 9)
    return x, y, w - w % 2, h - h % 2


def check(c, kind):
    x, y, w, h = crop_of(c, kind)
    bad = []
    if x < 0 or y < 0 or x + w > SW or y + h > SH:
        bad.append('超出畫面')
    for fx0, fy0, fx1, fy1 in FORBID:
        if x < fx1 and fx0 < x + w and y < fy1 and fy0 < y + h:
            bad.append(f'壓到禁區 {fx0},{fy0}–{fx1},{fy1}')
    return bad


def clip_file(c, kind, part='main'):
    return WORK / f'clips/{kind}-{c.key}{"" if part == "main" else "-" + part}.mkv'


def render_clip(c, kind, a, b, out):
    """一鏡：裁切 → 縮到輸出尺寸 → 補格放慢 → 照原片色調（screen-17）→ 曝光 → BT.709 10-bit 中間檔。"""
    if out.exists():
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    W, H = {'desk': (1440, 810), 'mob': (720, 1280)}[kind]
    x, y, w, h = crop_of(c, kind)
    tone = EXPOSE + (f',{TONE[c.key]}' if c.key in TONE else '') + \
        (f',{TONE_PORTRAIT[c.key]}' if kind == 'mob' and c.key in TONE_PORTRAIT else '') + \
        (f',{TONE_DESKTOP[c.key]}' if kind == 'desk' and c.key in TONE_DESKTOP else '')
    # 多讀 2 個原始格再補：minterpolate 只補到最後一個原始格，不多讀的話尾巴會凍住
    vf = (f'trim=duration={b - a + 2 / FPS:.4f},setpts=PTS-STARTPTS,crop={w}:{h}:{x}:{y},'
          f'scale={W}:{H}:in_color_matrix={MATRIX}:out_color_matrix={MATRIX}:in_range=tv:out_range=tv:flags={SWS},'
          f'minterpolate=fps={30 / c.speed:.4f}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,'
          f'setpts=PTS/{c.speed},fps=30,trim=duration={(b - a) / c.speed:.4f},setpts=PTS-STARTPTS,'
          f'scale=in_color_matrix={MATRIX}:in_range=tv:out_range=pc:flags={SWS},format=rgb48le,'
          f'lut3d=file={SCREEN}:interp=tetrahedral,{tone},'
          f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le,setsar=1')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-threads', '4', '-ss', f'{a - 0.004:.4f}', '-t', f'{b - a + 0.4:.3f}',
                    '-i', str(SRC), '-vf', vf, '-an', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '8',
                    '-pix_fmt', 'yuv420p10le', '-threads', '4', str(out)], check=True)
    print(f'  {out.name} {(b - a) / c.speed:.2f}s', flush=True)


def head_cut():
    first = CLIPS[0]
    return snap(first.a + (FADE + HOLD) * first.speed)  # 片頭前 FADE＋HOLD 秒搬到片尾，讓最後一鏡溶回來


def clips(kind):
    for c in CLIPS:
        bad = check(c, kind)
        if bad:
            raise SystemExit(f'{c.key} {kind}: {"、".join(bad)}')
    first = CLIPS[0]
    for c in CLIPS:
        render_clip(c, kind, head_cut() if c is first else c.a, c.b, clip_file(c, kind))
    render_clip(first, kind, snap(first.a), head_cut(), clip_file(first, kind, 'tail'))


def duration(path):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                                capture_output=True, text=True, check=True).stdout)


def build(variant):
    W, H, crf, kind = VARIANTS[variant]
    clips(kind)
    files = [clip_file(c, kind) for c in CLIPS] + [clip_file(CLIPS[0], kind, 'tail')]
    args, parts = ['ffmpeg', '-v', 'error', '-y', '-filter_threads', '2'], []
    for n, f in enumerate(files):
        args += ['-i', str(f)]
        parts.append(f'[{n}:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS[i{n}]')
    lens = [duration(f) for f in files]
    prev, t = 'i0', lens[0]
    for k in range(1, len(files)):
        out = f'x{k}' if k < len(files) - 1 else 'mix'
        parts.append(f'[{prev}][i{k}]xfade=transition=fade:duration={FADE}:offset={t - FADE:.3f}[{out}]')
        prev, t = out, t - FADE + lens[k]
    parts.append('[mix]format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709[out]')
    target = HERE / f'{NAME}-{variant}.mp4'
    args += ['-filter_complex', ';'.join(parts), '-map', '[out]', '-an', '-map_metadata', '-1', '-r', '30',
             '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-threads', '4',
             '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-colorspace', 'bt709', '-color_range', 'tv',
             '-movflags', '+faststart', str(target)]
    subprocess.run(args, check=True)
    print(f'{variant}: {len(CLIPS)} 鏡 {t:.2f}s {target.stat().st_size:,} bytes', flush=True)
    poster(variant)


def poster(variant):
    """封面＝成片第 0 格；手機直式另一張（構圖與桌機不同，共用會在影片淡入時跳一下）。"""
    target = HERE / f'{NAME}-{variant}.mp4'
    png = WORK / '.poster.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(target), '-frames:v', '1', '-vf',
                    f'scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},format=rgb24', str(png)], check=True)
    from PIL import Image
    name = f'{NAME}-poster.webp' if variant == 'desktop' else f'{NAME}-poster-{variant}.webp'
    Image.open(png).save(HERE / name, quality=82, method=6)
    png.unlink()


def review():
    """每鏡三格（頭、中、尾）畫上桌機（綠）與手機（橘）裁切框、禁區（紅），拼成縮圖表。"""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 20)
    scale = 300 / SH
    rows = []
    for c in CLIPS:
        ims = []
        for t in (c.a + 0.04, (c.a + c.b) / 2, c.b - 0.04):
            raw = subprocess.run(['ffmpeg', '-v', 'error', '-threads', '2', '-ss', f'{t:.3f}', '-i', str(SRC), '-frames:v', '1',
                                  '-vf', f'scale={round(SW * scale)}:300', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                                 capture_output=True, check=True).stdout
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            d = ImageDraw.Draw(im)
            for fx0, fy0, fx1, fy1 in FORBID:
                d.rectangle([fx0 * scale, fy0 * scale, fx1 * scale, fy1 * scale], outline=(255, 40, 40), width=2)
            for kind, col in (('desk', (40, 255, 80)), ('mob', (255, 150, 0))):
                x, y, w, h = crop_of(c, kind)
                d.rectangle([x * scale, y * scale, (x + w) * scale - 1, (y + h) * scale - 1], outline=col, width=3)
            ims.append(im)
        row = Image.new('RGB', (sum(i.width + 6 for i in ims) + 260, 300), (25, 25, 25))
        d = ImageDraw.Draw(row)
        d.text((8, 8), c.key, fill=(255, 230, 0), font=font)
        d.text((8, 36), f'{c.a:.2f}–{c.b:.2f} x{c.speed}', fill=(220, 220, 220), font=font)
        d.text((8, 64), f'{(c.b - c.a) / c.speed:.2f}s', fill=(220, 220, 220), font=font)
        y0 = 92
        for kind in ('desk', 'mob'):
            bad = check(c, kind)
            d.text((8, y0), f'{kind}: {"OK" if not bad else "BAD"}', fill=(120, 255, 120) if not bad else (255, 80, 80), font=font)
            y0 += 28
        x0 = 260
        for im in ims:
            row.paste(im, (x0, 0)); x0 += im.width + 6
        rows.append(row)
    sheet = Image.new('RGB', (max(r.width for r in rows), sum(r.height + 6 for r in rows)), (10, 10, 10))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y)); y += r.height + 6
    out = WORK / 'review.jpg'
    sheet.save(out, quality=86)
    print(out)


def stats(path):
    """每秒平均 Y（signalstats YAVG，limited range 8-bit），跟 10-30／11-03／11-05 README 同一種量法。"""
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
                          '-f', 'null', '-'], capture_output=True, text=True, check=True).stdout
    ys = [float(l.split('=')[1]) for l in out.splitlines() if 'YAVG' in l]
    per = [sum(ys[i:i + 30]) / len(ys[i:i + 30]) for i in range(0, len(ys), 30)]
    return sum(ys) / len(ys), max(per), per, ys


def shot_stats(variant):
    _, _, _, ys = stats(HERE / f'{NAME}-{variant}.mp4')
    t, res = 0.0, []
    for n, c in enumerate(CLIPS):
        a = head_cut() if n == 0 else c.a
        ln = (c.b - a) / c.speed
        seg = ys[int((t + FADE) * 30):int((t + ln - FADE) * 30)]  # 只量沒在溶接的那段
        res.append((c.key, round(sum(seg) / max(len(seg), 1), 1), round(max(seg, default=0), 1)))
        t += ln - FADE
    return res


if __name__ == '__main__':
    for v in sys.argv[1:] or ['desktop', 'mobile']:
        if v == 'review':
            review()
        elif v == 'poster':
            for name in ('desktop', 'mobile'):
                poster(name)
        elif v == 'stats':
            for name in ('desktop', 'mobile'):
                p = HERE / f'{NAME}-{name}.mp4'
                if not p.exists():
                    continue
                avg, mx, per, _ = stats(p)
                print(f'{name}: 平均 Y {avg:.1f}，最亮一秒 {mx:.1f}；每秒 {[round(x) for x in per]}')
                print('  每鏡（平均, 最亮一格）', shot_stats(name))
        else:
            build(v)
