#!/usr/bin/env python3
"""30 週年分頁（/anniversary）的紀念影片《長成自己喜歡的樣子》網頁版素材。

來源是影片製作資料夾的輸出（已 gitignore 的 output/anniversary-film/，做法見
design/anniversary-film-20261110/README.md）：近無損分段（segments、segments-v）、混好的聲音
（music/film-audio*.wav）、沒有字卡的鏡頭影格（shots、shots-v）。影片重算之後跑一次：

    python3 scripts/build-anniversary-film.py            # 全部重做
    python3 scripts/build-anniversary-film.py --keep-film  # 只重做預告、封面、縮圖（沿用現有的兩支影片）

輸出到 web/public/assets/anniversary-film/（檔名帶內容雜湊，/assets 是長快取），並改寫
web/app/utils/anniversary/film-media.ts。和 scripts/build-anniversary-media.py（時間軸的素材場，
輸出到 assets/anniversary/）分開兩個資料夾，互不清對方的檔案。需要 ffmpeg、numpy、Pillow。

- 影片：桌機 1920×1080、手機直式 720×1280（直式不是裁的，是同一條時間軸重新排版的那一版）。
  兩階段平均位元率（桌機 2400k、手機 1400k）＋AAC 160k、faststart；單檔壓在 50 MB 以下。
  顆粒比交付檔輕（noise 2）：網頁位元率留不住顆粒，只留一點當暗部的抖色。
- 預告：七個沒有字卡的鏡頭接成約 10 秒的無聲循環（頭尾相接），封面就是它的第一格。
- 縮圖：「影片裡的話」六句各一張。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web/public/assets/anniversary-film'
TS = ROOT / 'web/app/utils/anniversary/film-media.ts'
URL = '/assets/anniversary-film'
FPS = 30
POST = 'noise=c0s=2:c0f=t+u,vignette=angle=0.2:mode=forward:eval=init,format=yuv420p'
COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

# 預告的鏡頭（依序）：每個取 54 格、相鄰交疊 10 格，最後一個疊回第一個
TEASER = ['mh-purple-hands', 'mh-run-camera', 'mh-hug-smile', 'gr-gowns', 'mh-look-up', 'mh-boy-laugh', 'gr-arms-raised']
TEASER_LEN, TEASER_FADE, TEASER_FROM = 54, 10, 8

# 「影片裡的話」六句的縮圖：鏡頭 id＋第幾格；第一句用成片第 1446 格（五顆星剛連成星座、校名還沒出來）
CUE_THUMBS: list[tuple[str, int]] = [('film', 1446), ('mh-yard-hug', 40), ('mh-basketball', 30), ('mh-look-up', 40), ('gr-hands', 60), ('gr-spotlight', 90)]


def run(*args: str) -> None:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:10]


def publish(tmp: Path, stem: str) -> str:
    name = f'{stem}-{digest(tmp)}{tmp.suffix}'
    (OUT / name).write_bytes(tmp.read_bytes())
    return f'{URL}/{name}'


def concat_list(src: Path, vertical: bool, tmp: Path) -> Path:
    segs = sorted((src / ('segments-v' if vertical else 'segments')).glob('seg-*.mkv'))
    # 分段要頭尾相接、蓋滿 4320 格
    spans = [tuple(int(x) for x in s.stem.split('-')[1:]) for s in segs]
    assert spans and spans[0][0] == 0 and spans[-1][1] == 4320 and all(a[1] == b[0] for a, b in zip(spans, spans[1:])), spans
    lst = tmp / ('concat-v.txt' if vertical else 'concat.txt')
    lst.write_text(''.join(f"file '{s}'\n" for s in segs))
    return lst


def encode_film(src: Path, vertical: bool, dst: Path, kbps: int, tmp: Path) -> None:
    lst = concat_list(src, vertical, tmp)
    audio = src / 'music' / ('film-audio-v.wav' if vertical else 'film-audio.wav')
    vf = ('scale=720:1280:flags=lanczos,' if vertical else '') + POST
    video = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.1', '-tune', 'film', '-b:v', f'{kbps}k', '-maxrate', f'{int(kbps * 1.6)}k',
             '-bufsize', f'{kbps * 3}k', '-g', '60', '-keyint_min', '30', '-r', str(FPS), *COLOR]
    log = str(tmp / ('pass-v' if vertical else 'pass-h'))
    base = ['-f', 'concat', '-safe', '0', '-i', str(lst)]
    run(*base, '-vf', vf, *video, '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null')
    run(*base, '-i', str(audio), '-map', '0:v', '-map', '1:a', '-vf', vf, *video, '-pass', '2', '-passlogfile', log,
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-shortest', str(dst))


def shot_frames(src: Path, vertical: bool, shot: str) -> list[Path]:
    return sorted((src / ('shots-v' if vertical else 'shots') / shot).glob('*.jpg'))


def teaser(src: Path, vertical: bool, dst: Path, size: tuple[int, int]) -> Image.Image:
    """回傳第一格（當封面）。影格在 Python 裡疊好再送進 ffmpeg，頭尾交疊所以循環沒有接縫。"""
    shots = []
    for shot in TEASER:
        files = shot_frames(src, vertical, shot)[TEASER_FROM:TEASER_FROM + TEASER_LEN]
        assert len(files) == TEASER_LEN, (shot, len(files))
        shots.append([np.asarray(Image.open(f).convert('RGB').resize(size, Image.LANCZOS), np.float32) for f in files])
    step = TEASER_LEN - TEASER_FADE
    proc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{size[0]}x{size[1]}', '-r', str(FPS), '-i', '-',
                             '-vf', 'vignette=angle=0.2:mode=forward:eval=init,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', '26',
                             '-g', '60', *COLOR, '-an', '-movflags', '+faststart', str(dst)], stdin=subprocess.PIPE)
    first = None
    assert proc.stdin
    for k, frames in enumerate(shots):
        nxt = shots[(k + 1) % len(shots)]
        for i in range(TEASER_FADE, TEASER_LEN):  # 每個鏡頭從淡入結束那一格開始，最後 10 格疊上下一個鏡頭的頭 10 格
            f = frames[i]
            j = i - step
            if j >= 0:
                a = (j + 1) / (TEASER_FADE + 1)
                a = a * a * (3 - 2 * a)
                f = f * (1 - a) + nxt[j] * a
            out = np.clip(f + 0.5, 0, 255).astype(np.uint8)
            if first is None:
                first = Image.fromarray(out)
            proc.stdin.write(out.tobytes())
    proc.stdin.close()
    assert proc.wait() == 0
    assert first is not None
    return first


def webp(im: Image.Image, dst: Path, width: int, quality: int = 82) -> None:
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS) if im.width != width else im
    im.save(dst, 'WEBP', quality=quality, method=6)


def cover(im: Image.Image, w: int, h: int, cx: float = 0.5, cy: float = 0.5) -> Image.Image:
    s = max(w / im.width, h / im.height)
    cw, ch = w / s, h / s
    x0 = min(max(0, im.width * cx - cw / 2), im.width - cw)
    y0 = min(max(0, im.height * cy - ch / 2), im.height - ch)
    return im.resize((w, h), Image.LANCZOS, box=(x0, y0, x0 + cw, y0 + ch))


def film_frame(src: Path, frame: int, tmp: Path) -> Image.Image:
    for seg in sorted((src / 'segments').glob('seg-*.mkv')):
        a, b = (int(x) for x in seg.stem.split('-')[1:])
        if a <= frame < b:
            png = tmp / f'f{frame}.png'
            run('-i', str(seg), '-vf', f'select=eq(n\\,{frame - a}),scale=in_color_matrix=bt709:out_color_matrix=bt709', '-frames:v', '1', str(png))
            return Image.open(png).convert('RGB')
    raise SystemExit(f'找不到第 {frame} 格的分段')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', type=Path, default=ROOT / 'output/anniversary-film')
    ap.add_argument('--keep-film', action='store_true', help='沿用 film-media.ts 裡現有的兩支影片，只重做預告、封面、縮圖')
    a = ap.parse_args()
    src = a.src.expanduser().resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    keep: dict[str, str] = {}
    if a.keep_film:
        old = json.loads(TS.read_text().split('export const ANNI_FILM = ', 1)[1].rsplit(' as const', 1)[0])
        keep = old['film']
        assert all((ROOT / 'web/public' / v.lstrip('/')).exists() for v in keep.values()), keep
    for f in OUT.glob('*'):
        if f'{URL}/{f.name}' not in keep.values():
            f.unlink()
    media: dict = {}
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        if keep:
            media['film'] = keep
        else:
            encode_film(src, False, tmp / 'film-desktop.mp4', 2400, tmp)
            encode_film(src, True, tmp / 'film-mobile.mp4', 1400, tmp)
            media['film'] = {'desktop': publish(tmp / 'film-desktop.mp4', 'film-desktop'), 'mobile': publish(tmp / 'film-mobile.mp4', 'film-mobile')}
        first_h = teaser(src, False, tmp / 'teaser-desktop.mp4', (1600, 900))
        first_v = teaser(src, True, tmp / 'teaser-mobile.mp4', (720, 1280))
        media['teaser'] = {'desktop': publish(tmp / 'teaser-desktop.mp4', 'teaser-desktop'), 'mobile': publish(tmp / 'teaser-mobile.mp4', 'teaser-mobile')}
        # 封面＝預告第一格，直接取原始影格縮圖（不經過影片壓縮）
        ph = Image.open(shot_frames(src, False, TEASER[0])[TEASER_FROM + TEASER_FADE]).convert('RGB')
        pv = Image.open(shot_frames(src, True, TEASER[0])[TEASER_FROM + TEASER_FADE]).convert('RGB')
        del first_h, first_v
        poster: dict = {'desktop': [], 'mobile': []}
        for w in (960, 1600, 2304):
            webp(ph, tmp / f'poster-desktop-{w}.webp', w)
            poster['desktop'].append({'src': publish(tmp / f'poster-desktop-{w}.webp', f'poster-desktop-{w}'), 'width': w})
        for w in (540, 900, 1296):
            webp(pv, tmp / f'poster-mobile-{w}.webp', w)
            poster['mobile'].append({'src': publish(tmp / f'poster-mobile-{w}.webp', f'poster-mobile-{w}'), 'width': w})
        media['poster'] = poster
        cues = []
        for i, (shot, n) in enumerate(CUE_THUMBS):
            im = film_frame(src, n, tmp) if shot == 'film' else Image.open(shot_frames(src, False, shot)[n]).convert('RGB')
            # 星座那一格只取右邊有星的那一塊；鏡頭影格置中偏上（臉通常在上半）
            thumb = cover(im, 480, 300, 0.66, 0.5) if shot == 'film' else cover(im, 480, 300, 0.5, 0.42)
            thumb.save(tmp / f'cue-{i}.webp', 'WEBP', quality=80, method=6)
            cues.append(publish(tmp / f'cue-{i}.webp', f'cue-{i}'))
        media['cues'] = cues
    media['bytes'] = {k: (ROOT / 'web/public' / v.lstrip('/')).stat().st_size for k, v in {**{f'film-{k}': v for k, v in media['film'].items()}, **{f'teaser-{k}': v for k, v in media['teaser'].items()}}.items()}
    TS.write_text(
        '// 由 scripts/build-anniversary-film.py 產生，不要手改。\n'
        '// 30 週年紀念影片《長成自己喜歡的樣子》的網頁版：影片、無聲預告、封面、「影片裡的話」縮圖。\n'
        f'export const ANNI_FILM = {json.dumps(media, ensure_ascii=False, indent=2)} as const\n'
    )
    for k, v in media['bytes'].items():
        print(f'{k:16s} {v / 1048576:6.1f} MB')
    over = {k: v for k, v in media['bytes'].items() if v > 50 * 1048576}
    assert not over, f'單檔超過 50 MB：{over}'


if __name__ == '__main__':
    main()
