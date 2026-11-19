#!/usr/bin/env python3
"""常春藤的一天背景片：仁武九幕＋明華幼幼橫式六鏡混剪（2026-11-13 比稿）。

使用者看過首屏比稿（design/hero-landscape-20261113）後說「hero-section 先不動，我想要仁武九幕跟明華幼幼班橫式六鏡混剪
然後用在常春藤的一天」。十五鏡照一天的順序排（校舍空拍 → 牽手入園 → 教室 → 閱讀 → 操作 → 戶外），兩校交錯。

片源（都在 output/，不進版控；都沒有色彩標記）：
  rw  output/day-fb-src-20261105/fb-renwu-2352105698588693-1440x2560.mp4    仁武招生片，直式 1440×2560
  mh  output/day-fb-src-20261105/fb-minghua-815137417136803-3840x2160.mp4   明華〈幼幼寶貝的快樂生活〉，橫式 3840×2160
燒在畫面裡的校徽與字幕一律用裁切框避開、不補洞（FORBID；沒字幕的鏡頭標 nosub）。
  桌機 16:9 → 1440×810；手機 9:16 → 720×1280。直式片裁橫、橫式片裁直，所以每一鏡在其中一種裝置上都只剩原畫面的一小段。

節奏照現行版（明華幼幼六鏡）的做法：全部放慢（minterpolate 補格）、換鏡溶接、最後一鏡溶回片頭；
但鏡頭是使用者指定的十五鏡（有正臉、有近景），不是現行版「只挑背影與小手」的規則。

色彩：BT.601 解 → screen-17.cube（沒標記的片在 Mac 螢幕上的樣子）→ 每鏡各自壓到同一個平均亮度（TARGET_Y，
對齊現行版的 118）→ 標 BT.709 原色／矩陣＋sRGB 轉換函數。補格很慢，中間檔不帶亮度曲線，曲線在接片時才套。

用法（repo 根目錄）：
  python3 -I design/day-film-mix-20261113/build.py review            # 每鏡裁切框預覽 → output/day-mix-20261113/review-*.jpg
  python3 -I design/day-film-mix-20261113/build.py desktop mobile    # 中間檔＋成片＋封面
  python3 -I design/day-film-mix-20261113/build.py stats             # 每秒、每鏡平均 Y
  python3 -I design/day-film-mix-20261113/build.py pick:desktop pick:mobile pick:stats   # 第二輪：使用者挑的十四鏡 → day-pick-*
"""
import io, json, subprocess, sys
from collections import namedtuple
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = ROOT / 'output/day-mix-20261113'
SCREEN = ROOT / 'output/hero-115-20261103/tools/screen-17.cube'
SWS = 'accurate_rnd+full_chroma_int+full_chroma_inp+lanczos'
FADE = 0.7
NAME = 'day-mix'
TARGET_Y = 118.0   # 現行版桌機平均 Y 118.1（limited range 8-bit）
# CRF：現行版（六鏡 20.6 秒）用 22／25 是 7.0／3.8 MB；十五鏡 25.8 秒照舊會到 11.5／6.3 MB，所以各加 2
VARIANTS = {'desktop': (1440, 810, 24, 'desk'), 'mobile': (720, 1280, 27, 'mob')}

Source = namedtuple('Source', 'file w h fps subtitle logo')
SOURCES = {
    'rw': Source('fb-renwu-2352105698588693-1440x2560.mp4', 1440, 2560, 30000 / 1001, (150, 1470, 1290, 1600), (1130, 0, 1440, 300)),
    'mh': Source('fb-minghua-815137417136803-3840x2160.mp4', 3840, 2160, 30000 / 1001, (0, 1935, 3840, 2160), (0, 0, 1150, 300)),
}

# 代號、片源、起迄秒數、放慢倍率、桌機裁切 (x, y, 寬；高＝寬×9/16)、手機裁切 (x, y, 寬；高＝寬×16/9)、這鏡有沒有字幕、說明
Clip = namedtuple('Clip', 'key src a b speed desk mob sub note')
POOL = [
    Clip('aerial', 'rw', 39.45, 40.42, 0.4, (0, 900, 1440), (160, 300, 1120), False, '仁武｜空拍校舍與操場'),
    # 書包左下角印著「SCHOOL 教育機構」（x 0–170），兩個框都從 x=190 起
    Clip('hand', 'rw', 0.95, 1.70, 0.31, (190, 766, 1250), (190, 0, 826), True, '仁武｜老師牽著孩子走進走廊'),
    Clip('line', 'mh', 23.15, 24.85, 0.7, (480, 300, 2880), (1400, 0, 1085), True, '明華｜教室裡沿著線走，女孩指著鏡頭笑'),
    Clip('library', 'rw', 3.70, 4.75, 0.44, (0, 660, 1440), (300, 0, 826), True, '仁武｜圖書室遠景'),
    Clip('readtop', 'rw', 4.85, 6.10, 0.52, (0, 640, 1440), (304, 0, 826), True, '仁武｜俯拍坐在地毯上看書'),
    Clip('finger', 'rw', 9.00, 11.00, 0.83, (0, 1100, 1440), (170, 300, 1100), False, '仁武｜手指著繪本的字'),
    Clip('thread', 'mh', 118.20, 119.90, 0.7, (120, 300, 2880), (1500, 0, 1085), True, '明華｜男孩穿線'),
    Clip('train', 'mh', 76.40, 78.10, 0.7, (480, 300, 2880), (1500, 0, 1085), True, '明華｜搭肩排成火車'),
    Clip('ball', 'rw', 2.70, 3.55, 0.35, (0, 600, 1440), (640, 300, 658), True, '仁武｜紅磚校舍前踢球'),
    # 上方有一個戴口罩的孩子（y 240–455），兩個框都在他下面
    Clip('chalk', 'rw', 30.55, 32.05, 0.62, (0, 660, 1440), (420, 470, 562), True, '仁武｜俯拍操場上的粉筆畫'),
    Clip('wave', 'mh', 35.90, 37.60, 0.7, (300, 300, 2880), (1650, 0, 1085), True, '明華｜攀爬架後面的孩子對鏡頭揮手'),
    Clip('slide1', 'mh', 18.30, 20.00, 0.7, (240, 300, 2880), (1900, 0, 1085), True, '明華｜溜滑梯，前景紅花'),
    Clip('slide', 'rw', 32.15, 33.90, 0.73, (0, 850, 1440), (160, 300, 1120), False, '仁武｜女孩從溜滑梯出來'),
    Clip('slide2', 'mh', 177.15, 178.85, 0.7, (360, 300, 2880), (1300, 0, 1215), False, '明華｜溜滑梯下來對鏡頭笑'),
    Clip('girls', 'rw', 34.02, 35.40, 0.57, (0, 560, 1440), (440, 300, 658), True, '仁武｜兩個女孩爬拱橋'),
    # ── 第二輪（使用者挑鏡）加進來的 ──
    # 現行版（design/day-film-kathy-20261111）的三鏡，裁切框照舊、只取中間一段配合這支片的節奏
    Clip('hug', 'mh', 141.35, 142.45, 0.42, (300, 300, 2880), (1250, 0, 1085), True, '明華｜校門口，老師蹲下來抱住孩子（背影）'),
    Clip('sorter', 'mh', 134.00, 135.20, 0.45, (300, 300, 2880), (790, 300, 918), True, '明華｜小手把形狀放進套盒'),
    Clip('lavender', 'mh', 0.40, 1.50, 0.42, (480, 300, 2880), (1700, 0, 1085), True, '明華｜沒有人的遊戲場，薰衣草在溜滑梯前晃'),
    # 使用者要「小女孩認真指著書」：仁武片裡手指繪本的前一鏡。字幕橫在她的腰上（y 1470–1600），臉在字幕上面、
    # 指著書的手在字幕下面，一個框放不下兩樣，這裡取臉與上半身，緊接著的 finger 那鏡就是手指在書上。
    Clip('readgirl', 'rw', 6.40, 8.20, 0.75, (0, 540, 1440), (560, 300, 658), True, '仁武｜小女孩低頭認真看著書'),
    # 試做（使用者同意為這一鏡破例補字幕）：用 readgirl-mask.png 把「展現自信」四個字補掉（ffmpeg removelogo），
    # 手機直式就能從臉取到指著書的手。桌機是橫的，臉到手有 1600px 高、16:9 最多 810，補不補字幕都放不下，所以桌機框不變。
    Clip('readgirl2', 'rw', 6.40, 8.20, 0.75, (0, 540, 1440), (150, 380, 1130), False, '仁武｜小女孩低頭指著書（字幕補掉）'),
    # ── 第三輪（使用者再排一次）加進來的 ──
    Clip('shoes', 'mh', 79.00, 79.95, 0.4, (480, 300, 2880), (1300, 0, 1085), True, '明華｜孩子坐在鞋櫃前自己穿鞋'),
    # 使用者：「幫我避開有一段小朋友愁眉苦臉的畫面」＝28.7–29.1 秒畫面右邊低著頭的女孩；29.3 秒起只剩背影
    Clip('backs', 'mh', 29.45, 30.65, 0.5, (480, 300, 2880), (1500, 0, 1085), True, '明華｜孩子背著手排隊'),
    # 薰衣草排了兩次：同一鏡切成前後兩段，第二段框往右移一點
    Clip('lav1', 'mh', 0.06, 0.98, 0.38, (480, 300, 2880), (1700, 0, 1085), True, '明華｜薰衣草在溜滑梯前晃（前段）'),
    Clip('lav2', 'mh', 0.98, 1.90, 0.38, (860, 300, 2880), (2100, 0, 1085), True, '明華｜薰衣草在溜滑梯前晃（後段）'),
    # 使用者：「小女孩指著書（…同一個畫面裡看到臉和手，那就得把字幕修掉）幫我試試看」。字幕用遮罩補掉。
    # 手機直式：整個人從臉到手。桌機橫式放不下（臉到手 1600px 高、16:9 最多 810），改成鏡頭從臉往下搖到手（PAN）。
    Clip('readgirl3', 'rw', 6.25, 8.80, 0.6, (0, 540, 1440), (150, 380, 1130), False, '仁武｜小女孩低頭指著書（字幕補掉；桌機從臉搖到手）'),
]
# 這幾鏡在裁切前先用遮罩把燒進去的字幕補掉（遮罩＝整格大小的黑底白字，白的地方用周圍的畫面補）
MASKS = {'readgirl2': HERE / 'readgirl-mask.png', 'readgirl3': HERE / 'readgirl-mask.png'}
# 裁切框在鏡頭裡上下移動（假的搖鏡）：(代號, 桌機或手機) → (起點 y, 終點 y, 開始動的秒數, 停下來的秒數)，秒數是原片時間、從這一鏡的起點算
PAN = {('readgirl3', 'desk'): (540, 1520, 0.75, 1.90)}
BY_KEY = {c.key: c for c in POOL}
# 剪法 → 鏡頭順序。mix＝第一輪十五鏡；pick＝使用者看過每一幕的對照頁後指定的順序
# （「舊1 舊2 舊4 新7 新2 新3 新4 新5 新6（前面一點小女孩認真指著書）新10 新11 新14 新15」）
CUTS = {
    'mix': ['aerial', 'hand', 'line', 'library', 'readtop', 'finger', 'thread', 'train', 'ball', 'chalk', 'wave', 'slide1', 'slide', 'slide2', 'girls'],
    'pick': ['hug', 'sorter', 'lavender', 'thread', 'hand', 'line', 'library', 'readtop', 'readgirl', 'finger', 'chalk', 'wave', 'slide2', 'girls'],
    'pick2': ['hug', 'sorter', 'lavender', 'thread', 'hand', 'line', 'library', 'readtop', 'readgirl2', 'finger', 'chalk', 'wave', 'slide2', 'girls'],
    # 第三輪：「擁抱 穿鞋 孩子背著手排隊 沿線走 套盒 薰衣草 圖書室 俯拍看書 小女孩指著書 手指繪本 薰衣草 粉筆畫 揮手 溜滑梯 兩個女孩 牽手」
    'pick3': ['hug', 'shoes', 'backs', 'line', 'sorter', 'lav1', 'library', 'readtop', 'readgirl3', 'finger', 'lav2', 'chalk', 'wave', 'slide2', 'girls', 'hand'],
    # 第四輪：「擁抱 → 穿鞋 → 沿線走 → 套盒 → 圖書室 → 俯拍看書 → 小女孩指著書（用第二輪那版的、不要 AI 改過的）→ 手指繪本 → 薰衣草
    #          →（貼了空拍校舍的截圖）這幕的但是避開右上 logo → 粉筆畫 → 揮手 → 溜滑梯（女孩滑下來的、不是男孩）→ 兩個女孩 → 牽手」
    'pick4': ['hug', 'shoes', 'line', 'sorter', 'library', 'readtop', 'readgirl', 'finger', 'lavender', 'aerial', 'chalk', 'wave', 'slide', 'girls', 'hand'],
    # 同第四輪，但影片本身不壓暗（使用者想看拿掉遮罩的樣子；見 RAW）
    'pick4raw': ['hug', 'shoes', 'line', 'sorter', 'library', 'readtop', 'readgirl', 'finger', 'lavender', 'aerial', 'chalk', 'wave', 'slide', 'girls', 'hand'],
    # 2026-11-14：使用者「有一幕是穿鞋的可以幫我拿掉嗎」＝第四輪拿掉穿鞋，其餘十四鏡順序不變（擁抱直接溶到沿線走）
    'pick5': ['hug', 'line', 'sorter', 'library', 'readtop', 'readgirl', 'finger', 'lavender', 'aerial', 'chalk', 'wave', 'slide', 'girls', 'hand'],
}
CLIPS = [BY_KEY[k] for k in CUTS['mix']]
RAW = {'day-pick4raw'}   # 這幾支成片不套亮度曲線（原片在螢幕上的亮度）


def use_cut(name):
    global CLIPS, NAME
    CLIPS, NAME = [BY_KEY[k] for k in CUTS[name]], f'day-{name}'


def run(args, **kw):
    return subprocess.run(args, check=True, **kw)


def src_path(c):
    return ROOT / 'output/day-fb-src-20261105' / SOURCES[c.src].file


def snap(c, t):
    fps = SOURCES[c.src].fps
    return round(t * fps) / fps


def crop_of(c, kind):
    x, y, w = getattr(c, kind)
    w -= w % 2
    h = round(w * 9 / 16) if kind == 'desk' else round(w * 16 / 9)
    return x, y, w, h - h % 2


def forbid(c):
    s = SOURCES[c.src]
    return [('校徽', s.logo)] + ([('字幕', s.subtitle)] if c.sub else [])


def check(c, kind):
    s = SOURCES[c.src]
    x, y, w, h = crop_of(c, kind)
    bad = []
    for y in (PAN[(c.key, kind)][:2] if (c.key, kind) in PAN else (y,)):
        if x < 0 or y < 0 or x + w > s.w or y + h > s.h:
            bad.append('超出畫面')
        for name, (fx0, fy0, fx1, fy1) in forbid(c):
            if x < fx1 and fx0 < x + w and y < fy1 and fy0 < y + h:
                bad.append(f'壓到{name}')
    return bad


def clip_file(c, kind, part='main'):
    return WORK / f'clips/{kind}-{c.key}{"" if part == "main" else "-" + part}.mkv'


def main_file(c, kind):
    """第一鏡的主檔少了搬到片尾的那段，另存一個檔名，同一鏡在別的剪法裡才不會拿到短的。"""
    return clip_file(c, kind, 'first') if c is CLIPS[0] else clip_file(c, kind)


def render_clip(c, kind, a, b, out):
    """一鏡：裁切 → 縮到輸出尺寸 → 補格放慢 → 照原片色調（screen-17）→ BT.709 10-bit 中間檔（不帶亮度曲線）。"""
    if out.exists():
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    W, H = {'desk': (1440, 810), 'mob': (720, 1280)}[kind]
    x, y, w, h = crop_of(c, kind)
    fps = SOURCES[c.src].fps
    # 多讀 2 個原始格再補：minterpolate 只補到最後一個原始格，不多讀的話尾巴會凍住
    fix = f'removelogo=f={MASKS[c.key]},' if c.key in MASKS else ''
    if (c.key, kind) in PAN:   # 裁切框的 y 隨時間走（smoothstep，起步與停下都是緩的）
        y0, y1, t0, t1 = PAN[(c.key, kind)]
        u = f'clip((t-{t0})/{t1 - t0},0,1)'
        y = f"'{y0}+{y1 - y0}*(3*pow({u},2)-2*pow({u},3))'"   # 整段用單引號包住，裡面的逗號才不會被當成濾鏡分隔
    vf = (f'trim=duration={b - a + 2 / fps:.4f},setpts=PTS-STARTPTS,{fix}crop={w}:{h}:{x}:{y},'
          f'scale={W}:{H}:in_color_matrix=bt601:out_color_matrix=bt601:in_range=tv:out_range=tv:flags={SWS},'
          f'minterpolate=fps={30 / c.speed:.4f}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,'
          f'setpts=PTS/{c.speed},fps=30,trim=duration={(b - a) / c.speed:.4f},setpts=PTS-STARTPTS,'
          f'scale=in_color_matrix=bt601:in_range=tv:out_range=pc:flags={SWS},format=rgb48le,'
          f'lut3d=file={SCREEN}:interp=tetrahedral,'
          f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le,setsar=1')
    run(['ffmpeg', '-v', 'error', '-y', '-threads', '4', '-ss', f'{a - 0.004:.4f}', '-t', f'{b - a + 0.4:.3f}',
         '-i', str(src_path(c)), '-vf', vf, '-an', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '8',
         '-pix_fmt', 'yuv420p10le', '-threads', '4', str(out)])
    print(f'  {out.name} {(b - a) / c.speed:.2f}s', flush=True)


def head_cut():
    first = CLIPS[0]
    return snap(first, first.a + FADE * first.speed)   # 片頭前 FADE 秒搬到片尾，讓最後一鏡溶回來


def clips(kind):
    for c in CLIPS:
        bad = check(c, kind)
        if bad:
            raise SystemExit(f'{c.key} {kind}: {"、".join(bad)}')
    first = CLIPS[0]
    for c in CLIPS:
        render_clip(c, kind, head_cut() if c is first else snap(c, c.a), snap(c, c.b), main_file(c, kind))
    render_clip(first, kind, snap(first, first.a), head_cut(), clip_file(first, kind, 'tail'))


def duration(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                     capture_output=True, text=True).stdout)


def curve_points(mid, high):
    return f'curves=all=0/0 0.5/{mid:.3f} 1/{high:.3f}'


def pick_curve(path):
    """量這一鏡（取 8 格縮圖）的平均 Y，找一條把它壓到 TARGET_Y 的曲線；本來就比目標暗的不提亮。"""
    import numpy as np
    raw = run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf',
               f'fps=3,scale=160:-2:in_color_matrix=bt709:in_range=tv:out_range=pc:flags=bilinear,format=rgb24',
               '-f', 'rawvideo', '-'], capture_output=True).stdout
    rgb = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.float64) / 255

    def yavg(mid, high):
        # 過 (0,0)、(.5,mid)、(1,high) 的二次曲線，跟 ffmpeg curves 的樣條很接近；最後用成片實測驗
        a2 = 2 * high - 4 * mid
        b1 = 4 * mid - high
        out = np.clip(a2 * rgb ** 2 + b1 * rgb, 0, 1)
        return 16 + 219 * float((out @ np.array([0.2126, 0.7152, 0.0722])).mean())

    base = yavg(0.5, 1.0)
    if base <= TARGET_Y:
        return None, base, base
    # 先只壓中間調（亮部留 .93）；圖書室、繪本這種整片都亮的鏡頭壓不下來，再連亮部一起壓
    for high, floor in ((0.93, 0.25), (0.84, 0.2)):
        lo, hi = floor, 0.5
        for _ in range(24):
            mid = (lo + hi) / 2
            if yavg(mid, high) > TARGET_Y:
                hi = mid
            else:
                lo = mid
        if yavg(mid, high) <= TARGET_Y + 1:
            break
    return curve_points(mid, high), base, yavg(mid, high)


def build(variant):
    W, H, crf, kind = VARIANTS[variant]
    clips(kind)
    order = CLIPS + [CLIPS[0]]
    files = [main_file(c, kind) for c in CLIPS] + [clip_file(CLIPS[0], kind, 'tail')]
    curves = {}
    for c in CLIPS:
        curves[c.key] = pick_curve(main_file(c, kind))
        if NAME in RAW:
            curves[c.key] = (None, curves[c.key][1], curves[c.key][1])
        print(f'  {kind} {c.key}: 原本 Y {curves[c.key][1]:.1f} → {curves[c.key][2]:.1f} {curves[c.key][0] or "（不動）"}', flush=True)
    args, parts = ['ffmpeg', '-v', 'error', '-y', '-filter_threads', '2'], []
    for n, f in enumerate(files):
        args += ['-i', str(f)]
        post = curves[order[n].key][0]
        tone = (f',scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},format=gbrp16le,{post},'
                f'scale=out_color_matrix=bt709:out_range=tv:flags={SWS},format=yuv420p10le') if post else ''
        parts.append(f'[{n}:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS{tone}[i{n}]')
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
    run(args)
    print(f'{variant}: {len(CLIPS)} 鏡 {t:.2f}s {target.stat().st_size:,} bytes', flush=True)
    (HERE / f'shots-{variant}.json').write_text(json.dumps(
        [{'key': c.key, 'source': c.src, 'start': c.a, 'end': c.b, 'speed': c.speed, 'crop': crop_of(c, kind), 'subtitle': c.sub,
          'curve': curves[c.key][0], 'note': c.note} for c in CLIPS], ensure_ascii=False, indent=2) + '\n')
    poster(variant)


def poster(variant):
    """封面＝成片第 0 格；手機直式另一張。"""
    target = HERE / f'{NAME}-{variant}.mp4'
    png = WORK / f'.poster-{variant}.png'
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(target), '-frames:v', '1', '-vf',
         f'scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags={SWS},format=rgb24', str(png)])
    from PIL import Image
    name = f'{NAME}-poster.webp' if variant == 'desktop' else f'{NAME}-poster-{variant}.webp'
    Image.open(png).save(HERE / name, quality=82, method=6)
    png.unlink()


def review():
    """每鏡三格（頭、中、尾）整格畫面，畫上桌機（綠）與手機（橘）裁切框、校徽與字幕（紅）。"""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 18)
    WORK.mkdir(parents=True, exist_ok=True)
    for part, group in (('rw', [c for c in POOL if c.src == 'rw']), ('mh', [c for c in POOL if c.src == 'mh'])):
        s = SOURCES[part]
        scale = (480 if part == 'rw' else 270) / s.h
        tiles = []
        for c in group:
            for t in (c.a + 0.02, (c.a + c.b) / 2, c.b - 0.04):
                raw = run(['ffmpeg', '-v', 'error', '-threads', '2', '-ss', f'{t:.3f}', '-i', str(src_path(c)), '-frames:v', '1',
                           '-vf', f'scale={round(s.w * scale)}:{round(s.h * scale)}', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                          capture_output=True).stdout
                im = Image.open(io.BytesIO(raw)).convert('RGB')
                d = ImageDraw.Draw(im)
                for _, z in [('校徽', s.logo), ('字幕', s.subtitle)]:
                    d.rectangle([z[0] * scale, z[1] * scale, z[2] * scale, z[3] * scale], outline=(255, 40, 40), width=2)
                for kind, col in (('desk', (40, 255, 80)), ('mob', (255, 150, 0))):
                    x, y, w, h = crop_of(c, kind)
                    d.rectangle([x * scale, y * scale, (x + w) * scale - 1, (y + h) * scale - 1], outline=col, width=3)
                bad = check(c, 'desk') + check(c, 'mob')
                d.rectangle([0, 0, 190, 22], fill=(0, 0, 0))
                d.text((4, 2), f'{c.key} {t:.2f} {"BAD" if bad else "ok"}', fill=(255, 80, 80) if bad else (255, 235, 0), font=font)
                tiles.append(im)
        cols = 9 if part == 'rw' else 6
        w, h = tiles[0].width + 6, tiles[0].height + 6
        sheet = Image.new('RGB', (w * cols, h * ((len(tiles) + cols - 1) // cols)), (10, 10, 10))
        for k, im in enumerate(tiles):
            sheet.paste(im, ((k % cols) * w, (k // cols) * h))
        out = WORK / f'review-{part}.jpg'
        sheet.save(out, quality=84)
        print(out)


def stats(path):
    """每秒平均 Y（signalstats YAVG，limited range 8-bit），跟 10-30 以來各版 README 同一種量法。"""
    out = run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
               '-f', 'null', '-'], capture_output=True, text=True).stdout
    ys = [float(l.split('=')[1]) for l in out.splitlines() if 'YAVG' in l]
    per = [sum(ys[i:i + 30]) / len(ys[i:i + 30]) for i in range(0, len(ys), 30)]
    return sum(ys) / len(ys), max(per), per


if __name__ == '__main__':
    for v in sys.argv[1:] or ['desktop', 'mobile']:
        if ':' in v:   # pick:desktop、pick:stats…
            cut, v = v.split(':')
            use_cut(cut)
        if v == 'review':
            review()
        elif v == 'stats':
            for name in ('desktop', 'mobile'):
                p = HERE / f'{NAME}-{name}.mp4'
                if p.exists():
                    avg, mx, per = stats(p)
                    print(f'{name}: {duration(p):.2f}s {p.stat().st_size / 1048576:.2f} MB 平均 Y {avg:.1f}，最亮一秒 {mx:.1f}；每秒 {[round(x) for x in per]}')
        elif v in VARIANTS:
            build(v)
        else:
            raise SystemExit(f'不認得的目標：{v}')
