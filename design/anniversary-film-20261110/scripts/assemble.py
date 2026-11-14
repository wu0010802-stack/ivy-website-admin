"""把 render.mjs 算好的分段影片接起來，加底片顆粒與輕微暗角，配上配樂，輸出交付檔。

    python3 assemble.py            # 主片（高畫質）＋網路版
    python3 assemble.py --check    # 只檢查分段是否完整連續
    python3 assemble.py --vertical # 直式 9:16 版（segments-v → ivy-30th-film-vertical-*.mp4）
    python3 assemble.py --remux-audio [--vertical]  # 只換聲音（影像不重編）

輸入：output/anniversary-film/segments/seg-<起>-<迄>.mkv（近無損 yuv444p、BT.709）
      output/anniversary-film/music/film-audio.wav（配樂＋擬音，48 kHz；mix_final.py 產生）
輸出：output/anniversary-film/final/
      ivy-30th-film-1080p-master.mp4   H.264 High CRF 16、AAC 320k（存檔、播放用）
      ivy-30th-film-1080p-web.mp4      H.264 High CRF 20、AAC 192k（LINE、FB、官網）
"""
from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(REPO, 'output', 'anniversary-film')
VERT = '--vertical' in sys.argv
SEG = os.path.join(OUT, 'segments-v' if VERT else 'segments')
FINAL = os.path.join(OUT, 'final')
TOTAL = 4320
# 配樂＋擬音（mix_final.py 的輸出）
AUDIO = os.path.join(OUT, 'music', 'film-audio-v.wav' if '--vertical' in sys.argv else 'film-audio.wav')

# 顆粒只加在亮度（強度 4；-tune grain 會讓位元率暴增到 78 Mb/s，改用 -tune film）；暗角很輕（角落約 -8%）
POST = 'noise=c0s=4:c0f=t+u,vignette=angle=0.2:mode=forward:eval=init,format=yuv420p'
TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']


def segments():
    segs = []
    for p in sorted(glob.glob(os.path.join(SEG, 'seg-*.mkv'))):
        m = re.search(r'seg-(\d+)-(\d+)\.mkv$', p)
        segs.append((int(m.group(1)), int(m.group(2)), p))
    segs.sort()
    # 同一起點只留最新的；檢查連續
    chain, cur = [], 0
    for a, b, p in segs:
        if a == cur:
            chain.append((a, b, p))
            cur = b
    if cur != TOTAL:
        raise SystemExit(f'分段不完整：只接到第 {cur} 格（需要 {TOTAL}）。現有：{[(a, b) for a, b, _ in segs]}')
    for a, b, p in chain:
        n = int(subprocess.check_output(['ffprobe', '-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries',
                                         'stream=nb_read_packets', '-of', 'csv=p=0', p]).decode().strip())
        if n != b - a:
            raise SystemExit(f'{os.path.basename(p)} 有 {n} 格，應為 {b - a}')
    return chain


def encode(chain, name, crf, abr, extra=()):
    os.makedirs(FINAL, exist_ok=True)
    lst = os.path.join(OUT, 'concat-v.txt' if VERT else 'concat.txt')
    with open(lst, 'w') as f:
        for _, _, p in chain:
            f.write(f"file '{p}'\n")
    dst = os.path.join(FINAL, name)
    cmd = ['ffmpeg', '-v', 'error', '-stats', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', AUDIO,
           '-filter_complex', f'[0:v]{POST}[v]', '-map', '[v]', '-map', '1:a',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-profile:v', 'high', '-level', '4.2', '-tune', 'film',
           '-x264-params', 'keyint=60:min-keyint=30', '-r', '30', *TAGS,
           '-c:a', 'aac', '-b:a', abr, '-ar', '48000', '-movflags', '+faststart', '-shortest',
           '-metadata', 'title=常春藤 30 週年紀念影片《長成自己喜歡的樣子》', '-metadata', 'artist=常春藤教育機構',
           '-metadata', 'comment=1997–2027。原創配樂；鋼琴取樣 Salamander Grand Piano V3（Alexander Holm，CC BY 3.0）。',
           *extra, dst]
    subprocess.run(cmd, check=True)
    return dst


def report(path):
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                                               'format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,pix_fmt,color_space,sample_rate',
                                               '-of', 'json', path]))
    loud = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                          capture_output=True, text=True).stderr
    summ = loud[loud.rfind('Summary:'):]
    il = re.search(r'I:\s+(-?[\d.]+) LUFS', summ)
    tp = re.search(r'Peak:\s+(-?[\d.]+) dBFS', summ)
    print(os.path.basename(path), json.dumps(info['format'], ensure_ascii=False))
    for s in info['streams']:
        print('  ', s)
    print('   integrated', il.group(1) if il else '?', 'LUFS, true peak', tp.group(1) if tp else '?', 'dBTP')


def remux_audio():
    """只換聲音：影像串流原樣複製（不重新編碼），聲音用最新的 film-audio 重新編 AAC。"""
    names = (('ivy-30th-film-vertical-master.mp4', '320k'), ('ivy-30th-film-vertical-web.mp4', '192k')) if VERT else \
        (('ivy-30th-film-1080p-master.mp4', '320k'), ('ivy-30th-film-1080p-web.mp4', '192k'))
    for name, abr in names:
        src = os.path.join(FINAL, name)
        tmp = src + '.tmp.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-i', AUDIO, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
                        '-c:a', 'aac', '-b:a', abr, '-ar', '48000', '-movflags', '+faststart', '-shortest',
                        '-map_metadata', '0', tmp], check=True)
        os.replace(tmp, src)
        report(src)


def main():
    if '--remux-audio' in sys.argv:
        remux_audio()
        return
    chain = segments()
    print('segments ok:', len(chain))
    if '--check' in sys.argv:
        return
    if not os.path.exists(AUDIO):
        raise SystemExit('找不到配樂 ' + AUDIO)
    jobs = ((('ivy-30th-film-vertical-master.mp4', 16, '320k'), ('ivy-30th-film-vertical-web.mp4', 20, '192k')) if VERT
            else (('ivy-30th-film-1080p-master.mp4', 16, '320k'), ('ivy-30th-film-1080p-web.mp4', 20, '192k')))
    for name, crf, abr in jobs:
        report(encode(chain, name, crf, abr))


if __name__ == '__main__':
    main()
