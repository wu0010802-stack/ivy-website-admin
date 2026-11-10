"""配樂＋擬音 → 成片聲音（48 kHz、24-bit），重新確認響度與真峰值。

    python3 mix_final.py [--vertical]

讀 output/anniversary-film/music/score-master.wav 與 foley(.wav|-v.wav)，輸出 film-audio(.wav|-v.wav)。
擬音已在 foley.py 裡定好音量（約 -33～-38 dBFS），這裡只相加；加完若整體響度偏離 -14 LUFS 超過 0.2 LU
就整體微調，真峰值（4 倍超取樣）超過 -1.0 dBTP 就再降。
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


def main():
    music, sr = sf.read(os.path.join(MUS, 'score-master.wav'), dtype='float64')
    foley, sr2 = sf.read(os.path.join(MUS, 'foley-v.wav' if VERT else 'foley.wav'), dtype='float64')
    assert sr == sr2 == 48000
    n = min(len(music), len(foley))
    mix = music[:n] + foley[:n]
    meter = pyln.Meter(sr)
    lufs = meter.integrated_loudness(mix)
    if abs(lufs + 14) > 0.2:
        mix *= 10 ** ((-14 - lufs) / 20)
    tp = true_peak_db(mix)
    if tp > -1.0:
        mix *= 10 ** ((-1.0 - tp) / 20)
    out = os.path.join(MUS, 'film-audio-v.wav' if VERT else 'film-audio.wav')
    sf.write(out, mix, sr, subtype='PCM_24')
    print(out, f'music {meter.integrated_loudness(music):.2f} LUFS → mix {meter.integrated_loudness(mix):.2f} LUFS, '
          f'true peak {true_peak_db(mix):.2f} dBTP, foley rms {20 * np.log10(np.sqrt(np.mean(foley ** 2)) + 1e-12):.1f} dBFS')


if __name__ == '__main__':
    main()
