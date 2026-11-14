"""配樂＋擬音 → 成片聲音（48 kHz、24-bit），重新確認響度與真峰值。

    python3 mix_final.py [--vertical]

讀 output/anniversary-film/music/score-master.wav 與 foley(.wav|-v.wav)，輸出 film-audio(.wav|-v.wav)。
擬音已在 foley.py 裡定好音量（約 -33～-38 dBFS），這裡只相加（音效的音頭撞到配樂峰值的地方先閃避，見 duck_under_peaks）；加完若整體響度偏離 -14 LUFS 超過 0.2 LU
就整體微調；真峰值（4 倍超取樣）壓在 -1.5 dBTP 以下——AAC 編碼後峰值會再冒出約 0.3–0.5 dB，
這樣成品才守得住 ≤ -1 dBTP（-1.0 時 192k 版量到 -0.8）。
"""
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
MUS = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'output', 'anniversary-film', 'music'))
VERT = '--vertical' in sys.argv


def true_peak_db(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.abs(up).max() + 1e-12)


def duck_under_peaks(music, foley, sr, tol_db=0.1, max_iter=24):
    """音效的音頭疊在配樂本來就頂到天花板的那一下（例如第 18 小節定音鼓的音頭），真峰值會被再推高，
    整體音量就得跟著往下拉（2026-11-11 加星環的鐘聲後掉了 0.4–0.6 LU）。
    這裡只在那前後 20 毫秒把音效壓低（側鏈式的閃避），直到混音的真峰值不比配樂本身高過 tol_db，整體音量不動。"""
    target = true_peak_db(music) + tol_db
    foley = foley.copy()
    half = int(0.02 * sr)
    ducked = []
    for _ in range(max_iter):
        up = signal.resample_poly(music + foley, 4, 1, axis=0)
        mag = np.abs(up).max(axis=1)
        if 20 * np.log10(mag.max() + 1e-12) <= target:
            break
        c = int(mag.argmax()) // 4
        a, b = max(0, c - half), min(len(foley), c + half)
        foley[a:b] *= (1 - 0.94 * np.hanning(b - a))[:, None]
        ducked.append(round(c / sr, 3))
    return foley, ducked


def main():
    music, sr = sf.read(os.path.join(MUS, 'score-master.wav'), dtype='float64')
    foley, sr2 = sf.read(os.path.join(MUS, 'foley-v.wav' if VERT else 'foley.wav'), dtype='float64')
    assert sr == sr2 == 48000
    n = min(len(music), len(foley))
    music, foley = music[:n], foley[:n]
    foley, ducked = duck_under_peaks(music, foley, sr)
    if ducked:
        print('音效在這幾個時間點讓給配樂的峰值（秒）：', ducked)
    mix = music + foley
    meter = pyln.Meter(sr)
    lufs = meter.integrated_loudness(mix)
    if abs(lufs + 14) > 0.2:
        mix *= 10 ** ((-14 - lufs) / 20)
    tp = true_peak_db(mix)
    if tp > -1.5:
        mix *= 10 ** ((-1.5 - tp) / 20)
    out = os.path.join(MUS, 'film-audio-v.wav' if VERT else 'film-audio.wav')
    sf.write(out, mix, sr, subtype='PCM_24')
    print(out, f'music {meter.integrated_loudness(music):.2f} LUFS → mix {meter.integrated_loudness(mix):.2f} LUFS, '
          f'true peak {true_peak_db(mix):.2f} dBTP, foley rms {20 * np.log10(np.sqrt(np.mean(foley ** 2)) + 1e-12):.1f} dBFS')


if __name__ == '__main__':
    main()
