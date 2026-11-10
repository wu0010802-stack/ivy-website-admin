"""《長成自己喜歡的樣子》配樂總譜（資料）＋ MIDI 輸出。

90 BPM、4/4、D 大調；第 36–43 小節升到 E 大調，第 43 小節的 A 和弦（E 的 IV＝D 的 V）轉回 D。
一小節 = 8/3 秒；第 n 小節（0 起算）在 n*8/3 秒。時間在這裡一律用「拍」（beat），t 秒 = beat * 2/3。

輸出：
- out/midi/<track>.mid：給 fluidsynth 的各聲部（MuseScore General 的分部弦樂、豎琴、鋼片琴…）
- out/piano.json：鋼琴音符與踏板（給 sampler.py）
- out/hits.json：提示點
"""
from __future__ import annotations

import json
import os
import random
import sys
from dataclasses import dataclass, field

import mido

BPM = 90
SPB = 60 / BPM            # 一拍幾秒
TOTAL_BARS = 54           # 144 秒
OUT = os.environ.get('MUSIC_OUT', '/home/user/ivy-website-admin/output/anniversary-film/music')

rng = random.Random(1997)


def B(bar: float, beat: float = 0.0) -> float:
    return bar * 4 + beat


def sec(beat: float) -> float:
    return beat * SPB


# ── 音名 ────────────────────────────────────────────────────────────────
PC = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
      'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


def N(name: str) -> int:
    letter = name[:-1] if name[-1].isdigit() else name
    octave = int(name[len(letter):])
    return PC[letter] + 12 * (octave + 1)


# ── 和弦 ────────────────────────────────────────────────────────────────
QUAL = {
    'maj': [0, 4, 7], 'min': [0, 3, 7], 'min7': [0, 3, 7, 10], 'dom7': [0, 4, 7, 10],
    'sus4': [0, 5, 7], 'min6': [0, 3, 7, 9], 'add9': [0, 4, 7, 2], 'maj7': [0, 4, 7, 11],
}
# 滾動琶音（八分音符）根音之上的音程：5、9、10、12、10、9、5
ARP = {
    'maj': [7, 14, 16, 19, 16, 14, 7], 'min': [7, 14, 15, 19, 15, 14, 7],
    'min7': [7, 10, 15, 19, 15, 10, 7], 'dom7': [7, 10, 16, 19, 16, 10, 7],
    'sus4': [7, 12, 17, 19, 17, 12, 7], 'min6': [7, 9, 15, 19, 15, 9, 7],
    'add9': [7, 14, 16, 19, 16, 14, 7], 'maj7': [7, 11, 16, 19, 16, 11, 7],
}
CHORDS = {
    'D': ('D', 'maj', 'D'), 'A/C#': ('A', 'maj', 'C#'), 'Bm': ('B', 'min', 'B'), 'G': ('G', 'maj', 'G'),
    'D/F#': ('D', 'maj', 'F#'), 'Em7': ('E', 'min7', 'E'), 'Asus4': ('A', 'sus4', 'A'), 'A': ('A', 'maj', 'A'),
    'A7': ('A', 'dom7', 'A'), 'Gm6': ('G', 'min6', 'G'), 'Gadd9': ('G', 'add9', 'G'),
    'E': ('E', 'maj', 'E'), 'B/D#': ('B', 'maj', 'D#'), 'C#m': ('C#', 'min', 'C#'), 'B': ('B', 'maj', 'B'),
    'Aadd9': ('A', 'add9', 'A'), 'Dadd9': ('D', 'add9', 'D'),
}

# 和聲進行：小節 → [(拍, 和弦)]
HARMONY_BARS = {
    0: 'D', 1: 'A/C#', 2: 'Bm', 3: 'G', 4: 'D/F#', 5: 'G', 6: 'Em7', 7: [(0, 'Asus4'), (2, 'A')],
    8: 'D', 9: 'A/C#', 10: 'Bm', 11: 'G', 12: 'Em7', 13: [(0, 'Asus4'), (2, 'A')],
    14: 'Bm', 15: 'G', 16: 'D/F#', 17: [(0, 'Em7'), (2, 'A7')], 18: 'Gadd9', 19: [(0, 'Asus4'), (2, 'A')],
    20: 'D', 21: 'A/C#', 22: 'Bm', 23: 'G', 24: 'D/F#', 25: 'G', 26: 'Em7', 27: [(0, 'Asus4'), (2, 'A')],
    28: 'Bm', 29: 'G', 30: 'D', 31: 'A', 32: 'G', 33: [(0, 'Asus4'), (2, 'A')],
    34: 'G', 35: [(0, 'A'), (2, 'B')],
    36: 'E', 37: 'B/D#', 38: 'C#m', 39: [(0, 'A'), (2, 'B')], 40: 'E', 41: [(0, 'C#m'), (2, 'B')],
    42: 'Aadd9', 43: [(0, 'Asus4'), (2, 'A')],
    44: 'D', 45: 'A/C#', 46: 'Bm', 47: 'G', 48: 'D/F#', 49: [(0, 'G'), (2, 'Gm6')], 50: 'Dadd9',
}
HARMONY: list[tuple[float, str]] = []
for bar, v in sorted(HARMONY_BARS.items()):
    for beat, ch in ([(0, v)] if isinstance(v, str) else v):
        HARMONY.append((B(bar, beat), ch))


def chord_segments(b0: float, b1: float):
    """[(start, end, chord)]，範圍 [b0, b1)。"""
    segs = []
    for i, (s, ch) in enumerate(HARMONY):
        e = HARMONY[i + 1][0] if i + 1 < len(HARMONY) else B(TOTAL_BARS)
        s2, e2 = max(s, b0), min(e, b1)
        if s2 < e2:
            segs.append((s2, e2, ch))
    return segs


def chord_tones(ch: str) -> list[int]:
    root, q, _ = CHORDS[ch]
    return sorted({(PC[root] + i) % 12 for i in QUAL[q]})


def place(pc: int, lo: int, hi: int) -> int:
    """把音級放到 [lo, hi] 之間最低的位置。"""
    m = lo + ((pc - lo) % 12)
    assert m <= hi + 11
    return m


# ── 資料結構 ────────────────────────────────────────────────────────────
@dataclass
class Note:
    beat: float
    dur: float
    pitch: int
    vel: float
    tight: bool = False   # 提示點上的音：時間不加人性化抖動


@dataclass
class Track:
    name: str
    bank: int
    program: int
    channel: int = 0
    pan: int = 64
    notes: list[Note] = field(default_factory=list)
    expr: list[tuple[float, int]] = field(default_factory=list)  # CC11 折線（拍, 值）

    def add(self, beat, dur, pitch, vel, tight=False):
        if isinstance(pitch, str):
            pitch = N(pitch)
        self.notes.append(Note(beat, dur, pitch, vel, tight))


HIT_BARS = {0, 8, 10, 14, 16, 18, 20, 34, 36, 40, 42, 44, 47, 50}


def is_tight(beat: float) -> bool:
    bar, rem = divmod(beat, 4)
    return rem < 1e-6 and int(bar) in HIT_BARS


# 各聲部（MuseScore General：bank 20 小提琴一部、25 二部、30 中提琴、40 大提琴、50 低音提琴；49 = Slow、48 = Fast）
T = {
    'vln1': Track('vln1', 20, 49, pan=40),
    'vln1mel': Track('vln1mel', 20, 48, pan=44),
    'vln2': Track('vln2', 25, 49, pan=52),
    'vla': Track('vla', 30, 49, pan=74),
    'vc': Track('vc', 40, 49, pan=86),
    'cb': Track('cb', 50, 49, pan=92),
    'pizz': Track('pizz', 0, 45, pan=58),
    'vcpizz': Track('vcpizz', 40, 45, pan=84),
    'harp': Track('harp', 0, 46, pan=30),
    'celesta': Track('celesta', 0, 8, pan=88),
    'glock': Track('glock', 0, 9, pan=78),
    'timp': Track('timp', 0, 47, pan=72),
    'horns': Track('horns', 0, 60, pan=80),
    'perc': Track('perc', 128, 48, channel=9, pan=64),
}
piano: list[Note] = []
pedal: list[tuple[float, float]] = []   # （拍）


def P(beat, dur, pitch, vel, tight=None):
    if isinstance(pitch, str):
        pitch = N(pitch)
    piano.append(Note(beat, dur, pitch, vel, is_tight(beat) if tight is None else tight))


# ── 旋律 ────────────────────────────────────────────────────────────────
MOTIF = {
    'A1': [(0, 1, 'A4'), (1, 1, 'D5'), (2, 1.5, 'F#5'), (3.5, .5, 'E5')],
    'A2': [(0, 3, 'E5'), (3, 1, 'A4')],
    'B1': [(0, 1, 'B4'), (1, 1, 'D5'), (2, 1, 'F#5'), (3, 1, 'A5')],
    'B2': [(0, 3, 'G5'), (3, .5, 'F#5'), (3.5, .5, 'E5')],
    'C1': [(0, 2, 'F#5'), (2, 1, 'E5'), (3, 1, 'D5')],
    'C2': [(0, 1, 'B4'), (1, 1, 'D5'), (2, 1.5, 'G5'), (3.5, .5, 'F#5')],
    'C3': [(0, 1.5, 'E5'), (1.5, .5, 'D5'), (2, 1, 'E5'), (3, 1, 'F#5')],
    'C4': [(0, 2, 'E5'), (2, 2, 'C#5')],
}
MELODY = {
    0: 'A1', 1: 'A2', 2: 'B1', 3: 'B2', 4: 'C1', 5: 'C2', 6: 'C3', 7: 'C4',
    8: 'A1', 9: 'A2', 10: 'B1', 11: 'B2',
    14: [(0, 1.5, 'F#5'), (1.5, .5, 'E5'), (2, 1, 'D5'), (3, 1, 'B4')],
    15: [(0, 1, 'D5'), (1, 1, 'E5'), (2, 2, 'G5')],
    16: [(0, 2, 'A5'), (2, 1, 'F#5'), (3, 1, 'D5')],
    17: [(0, 1.5, 'E5'), (1.5, .5, 'D5'), (2, 1, 'C#5'), (3, 1, 'E5')],
    18: [(0, 4, 'B5')],
    19: [(0, 2, 'A5'), (2, 1, 'G5'), (3, 1, 'E5')],
    20: 'A1', 21: 'A2', 22: 'B1', 23: 'B2', 24: 'C1', 25: 'C2', 26: 'C3', 27: 'C4',
    28: [(0, 1, 'D5'), (1, 1, 'F#5'), (2, 1.5, 'B5'), (3.5, .5, 'A5')],
    29: [(0, 1.5, 'G5'), (1.5, .5, 'F#5'), (2, 1, 'E5'), (3, 1, 'D5')],
    30: [(0, 1, 'F#5'), (1, 1, 'A5'), (2, 1.5, 'D6'), (3.5, .5, 'C#6')],
    31: [(0, 1.5, 'B5'), (1.5, .5, 'A5'), (2, 2, 'E5')],
    32: [(0, 2, 'D6'), (2, 1, 'B5'), (3, 1, 'G5')],
    33: [(0, 3, 'A5')],
    34: [(0, 1, 'D5'), (1, 1, 'G5'), (2, 1.5, 'B5'), (3.5, .5, 'A5')],
    35: [(0, 2, 'E5'), (2, 1, 'F#5'), (3, 1, 'D#5')],
    36: [(0, 1, 'B4'), (1, 1, 'E5'), (2, 1.5, 'G#5'), (3.5, .5, 'F#5')],
    37: [(0, 3, 'F#5'), (3, 1, 'B4')],
    38: [(0, 1, 'C#5'), (1, 1, 'E5'), (2, 1, 'G#5'), (3, 1, 'B5')],
    39: [(0, 1.5, 'A5'), (1.5, .5, 'G#5'), (2, 1, 'F#5'), (3, 1, 'B5')],
    40: [(0, 1, 'G#5'), (1, 1, 'B5'), (2, 2, 'E6')],
    41: [(0, 1.5, 'E6'), (1.5, .5, 'D#6'), (2, 1, 'C#6'), (3, 1, 'B5')],
    42: [(0, 4, 'C#6')],
    43: [(0, 2, 'A5'), (2, 1, 'E5'), (3, 1, 'C#5')],
    44: 'A1', 45: 'A2', 46: 'B1', 47: 'B2', 48: 'C1',
    49: [(0, 1, 'D5'), (1, 1, 'B4'), (2, 2, 'Bb4')],
    50: [(0, 10, 'A4')],
}


def melody_notes(b0: int, b1: int):
    out = []
    for bar in range(b0, b1):
        m = MELODY.get(bar)
        if m is None:
            continue
        for beat, dur, name in (MOTIF[m] if isinstance(m, str) else m):
            out.append((B(bar, beat), dur, N(name)))
    return out


# 樂句力度（鋼琴旋律）
def mel_vel(bar: int, beat: float, pitch: int) -> float:
    base = [(0, 50), (8, 60), (12, 58), (18, 74), (20, 64), (28, 74), (34, 58), (36, 82), (40, 96),
            (42, 92), (44, 52), (48, 48), (50, 46)]
    v = base[0][1]
    for b, val in base:
        if bar >= b:
            v = val
    v += (pitch - 74) * 0.6           # 高音稍強，樂句自然上揚
    if beat == 0:
        v += 4
    elif beat % 1:
        v -= 5
    return v


# ── 鋼琴 ────────────────────────────────────────────────────────────────
def piano_melody():
    for beat, dur, p in melody_notes(0, 51):
        bar = int(beat // 4)
        v = mel_vel(bar, beat % 4, p)
        P(beat, dur * 0.97, p, v)
        if 28 <= bar <= 33 or 36 <= bar <= 43:          # 八度加厚
            P(beat, dur * 0.97, p - 12, v - 12)


def root_low(ch: str, lo=38) -> int:
    root, _, _ = CHORDS[ch]
    return place(PC[root], lo, lo + 11)


def bass_low(ch: str, lo=36) -> int:
    _, _, bass = CHORDS[ch]
    return place(PC[bass], lo, lo + 11)


def piano_arp(b0, b1, vel, style='roll8', octave_shift=0, bass_oct=False):
    for s, e, ch in chord_segments(B(b0), B(b1)):
        _, q, _ = CHORDS[ch]
        r = root_low(ch) + octave_shift
        bass = bass_low(ch) + octave_shift
        ups = ARP[q]
        if style == 'roll8':
            k = 0
            t = s
            while t < e - 1e-6:
                idx = int(round((t - s) * 2)) % 8
                p = bass if idx == 0 else r + ups[idx - 1]
                v = vel + (6 if idx == 0 else 0) - (3 if idx % 2 else 0)
                P(t, 0.5 if idx else min(2.0, e - t), p, v)
                t += 0.5
                k += 1
        elif style == 'quarter':
            seq = [bass, r + 7, r + ups[2], r + 19]
            t = s
            while t < e - 1e-6:
                idx = int(round(t - s)) % 4
                P(t, (e - t) if idx == 0 else 1.0, seq[idx], vel + (5 if idx == 0 else 0))
                t += 1
        if bass_oct:
            P(s, min(2, e - s), bass - 12, vel - 8)


def piano_part():
    piano_melody()
    # 1. 開場：第 0 小節只有低音八度
    P(B(0), 4, 'D2', 40)
    P(B(0), 4, 'D3', 34)
    piano_arp(1, 8, 36, 'quarter')
    # 2. 主歌
    piano_arp(8, 12, 44)
    # 年份滾動：左手持續低音，右手 A5 跟著撥弦每個八分音符輕敲
    P(B(12), 4, 'E2', 48)
    P(B(12), 4, 'E3', 40)
    P(B(13), 3.5, 'A1', 50)
    P(B(13), 3.5, 'A2', 44)
    for k in range(14):
        P(B(12) + k * 0.5, 0.22, 'A5', 38 + k * 1.6, tight=True)
        if k % 2 == 0:
            P(B(12) + k * 0.5, 0.22, 'E5', 30 + k * 1.2, tight=True)
    piano_arp(14, 18, 50)
    # 第 18 小節：五校全景的大和弦（滾奏）
    for i, n in enumerate(['G1', 'G2', 'D3', 'A3', 'B3', 'D4', 'G4', 'B4', 'D5']):
        P(B(18) + i * 0.045, 4, n, 70 - i * 2, tight=(i == 0))
    piano_arp(19, 20, 54)
    # 3. 每一天
    piano_arp(20, 28, 54)
    piano_arp(28, 34, 60, bass_oct=True)
    # 4. 發光：34 收回、35 拉起
    piano_arp(34, 35, 40, 'quarter')
    piano_arp(35, 36, 52)
    piano_arp(36, 42, 66, bass_oct=True)
    # 第 42 小節：最寬的和弦
    for i, n in enumerate(['A1', 'A2', 'E3', 'B3', 'C#4', 'E4', 'A4', 'B4', 'E5']):
        P(B(42) + i * 0.04, 4, n, 84 - i * 2, tight=(i == 0))
    piano_arp(42, 43, 60, octave_shift=12)
    piano_arp(43, 44, 62, bass_oct=True)
    # 5. 30：回到開場的動機，輕
    piano_arp(44, 50, 34, 'quarter')
    # 最後的和弦（第 50 小節）
    for i, n in enumerate(['D1', 'D2', 'A2', 'E3', 'F#3', 'A3', 'D4', 'F#4']):
        P(B(50) + max(0, i - 1) * 0.035, 12, n, (56 if i < 2 else 52 - i * 1.5), tight=(i < 2))
    P(B(50) + 0.6, 12, 'D5', 34)

    # 踏板：和弦換的時候放、0.15 拍後再踩（第 12–13 小節不踩，讓滴答聲清楚）
    changes = [s for s, _ in HARMONY]
    for i, s in enumerate(changes):
        e = changes[i + 1] if i + 1 < len(changes) else B(TOTAL_BARS)
        if B(12) <= s < B(14):
            continue
        down = s + 0.15
        up = e + 0.06
        if s >= B(50):
            up = B(TOTAL_BARS) + 4
        pedal.append((down, up))


# ── 弦樂 ────────────────────────────────────────────────────────────────
def voice_lead(segs, ranges, prev=None, extra=None):
    """依序為每個和弦挑上三聲部的音，讓移動最小、三音一定在。回傳 [(s, e, [p...])]。"""
    import itertools
    out = []
    for s, e, ch in segs:
        tones = chord_tones(ch)
        root, q, _ = CHORDS[ch]
        third = (PC[root] + QUAL[q][1]) % 12
        cands = [[p for p in range(lo, hi + 1) if p % 12 in tones] for lo, hi in ranges]
        best, best_cost = None, 1e9
        for combo in itertools.product(*cands):
            if any(combo[i] >= combo[i + 1] for i in range(len(combo) - 1)):
                continue
            cost = 0.0
            if prev:
                cost += sum(abs(a - b) for a, b in zip(combo, prev))
            else:
                cost += sum(abs(c - (lo + hi) / 2) for c, (lo, hi) in zip(combo, ranges)) * 0.5
            pcs = [c % 12 for c in combo]
            if third not in pcs and q != 'sus4':
                cost += 20
            cost += (len(pcs) - len(set(pcs))) * 2.5
            for i in range(len(combo) - 1):
                if combo[i + 1] - combo[i] > 12:
                    cost += 6
            if cost < best_cost:
                best, best_cost = combo, cost
        prev = list(best)
        out.append((s, e, prev))
    return out


def lay_pad(tracks: list[str], voiced, vel, overlap=0.06):
    """把 voiced 的各聲部寫進對應軌；同一聲部同音的兩個和弦連成一個長音（不重新起奏）。"""
    for vi, name in enumerate(tracks):
        cur = None
        for s, e, pitches in voiced:
            p = pitches[vi]
            if cur and cur[2] == p and abs(cur[1] - s) < 1e-6:
                cur[1] = e
            else:
                if cur:
                    T[name].add(cur[0], cur[1] - cur[0] + overlap, cur[2], cur[3], is_tight(cur[0]))
                cur = [s, e, p, vel]
        if cur:
            T[name].add(cur[0], cur[1] - cur[0] + overlap, cur[2], cur[3], is_tight(cur[0]))


def bass_line(name, b0, b1, lo, vel, octave_double=None):
    segs = chord_segments(B(b0), B(b1))
    cur = None
    for s, e, ch in segs:
        p = bass_low(ch, lo)
        if cur and cur[2] == p and abs(cur[1] - s) < 1e-6:
            cur[1] = e
            continue
        if cur:
            T[name].add(cur[0], cur[1] - cur[0] + 0.05, cur[2], vel, is_tight(cur[0]))
        cur = [s, e, p]
    if cur:
        T[name].add(cur[0], cur[1] - cur[0] + 0.05, cur[2], vel, is_tight(cur[0]))


def strings_part():
    UP = [(50, 64), (57, 72), (62, 79)]          # 中提琴、二部、一部
    # 主歌：中提琴＋二部的柔和長音、大提琴低音
    v = voice_lead(chord_segments(B(8), B(12)), UP[:2])
    lay_pad(['vla', 'vln2'], v, 72)
    v2 = voice_lead(chord_segments(B(12), B(14)), UP[:2], prev=v[-1][2])
    lay_pad(['vla', 'vln2'], v2, 74)
    v3 = voice_lead(chord_segments(B(14), B(20)), UP, prev=None)
    lay_pad(['vla', 'vln2', 'vln1'], v3, 76)
    bass_line('vc', 8, 20, 38, 74)
    bass_line('cb', 18, 20, 31, 80)
    # 每一天
    v4 = voice_lead(chord_segments(B(20), B(34)), UP, prev=v3[-1][2])
    lay_pad(['vla', 'vln2', 'vln1'], v4[:0] + v4, 80)
    bass_line('vc', 20, 34, 38, 80)
    bass_line('cb', 20, 34, 31, 82)
    # 第一部小提琴在 24–27 高八度唱旋律、28–33 同度
    for beat, dur, p in melody_notes(24, 28):
        T['vln1mel'].add(beat, dur + 0.04, p + 12, 84)
    for beat, dur, p in melody_notes(28, 34):
        T['vln1mel'].add(beat, dur + 0.04, p, 88)
    # 34：只剩長音；35 拉起
    v5 = voice_lead(chord_segments(B(34), B(36)), UP[:2], prev=v4[-1][2][:2])
    lay_pad(['vla', 'vln2'], v5, 70)
    bass_line('vc', 34, 36, 38, 70)
    # 36–43：E 大調高潮
    v6 = voice_lead(chord_segments(B(36), B(44)), [(52, 66), (59, 74), (64, 81)])
    lay_pad(['vla', 'vln2', 'vln1'], v6, 92)
    for beat, dur, p in melody_notes(36, 44):
        T['vln1mel'].add(beat, dur + 0.04, p, 96)
        T['vln2'].add(beat, dur + 0.04, p - 12, 70)
    bass_line('vc', 36, 44, 38, 92)
    bass_line('cb', 36, 44, 31, 92)
    # 第 42 小節最寬：大提琴加五度、一部加高八度
    T['vc'].add(B(42), 4.05, 'E3', 86, True)
    T['vln1'].add(B(42), 4.05, 'A5', 86, True)
    # 44–53：只剩弦樂長音墊在鋼琴底下
    v7 = voice_lead(chord_segments(B(44), B(50)), UP[:2])
    lay_pad(['vla', 'vln2'], v7, 64)
    bass_line('vc', 44, 50, 38, 62)
    # 最後的和弦
    for name, p in [('cb', 'D2'), ('vc', 'D3'), ('vla', 'A3'), ('vln2', 'F#4'), ('vln1', 'E5')]:
        T[name].add(B(50), 12, p, 70, True)

    # 表情（CC11）
    pad_env = [(B(8), 0), (B(8, 2), 64), (B(11), 70), (B(12), 62), (B(13, 3.5), 84), (B(14), 74),
               (B(17, 2), 80), (B(18), 104), (B(18, 3), 98), (B(19, 3), 86), (B(20), 82), (B(27), 90),
               (B(28), 94), (B(33), 102), (B(33, 3.8), 106), (B(34), 60), (B(35), 64), (B(35, 3.9), 104),
               (B(36), 100), (B(39), 106), (B(39, 3.9), 127), (B(40), 127), (B(41, 3), 112), (B(42), 127),
               (B(43, 2), 108), (B(43, 3.8), 92), (B(44), 54), (B(46), 58), (B(47), 66), (B(48), 58),
               (B(50), 64), (B(51), 50), (B(53, 3.9), 0)]
    for name in ['vln1', 'vln2', 'vla', 'vc', 'cb']:
        T[name].expr = pad_env
    T['vln1mel'].expr = [(B(24), 70), (B(26), 84), (B(28), 88), (B(33), 100), (B(33, 3.5), 80), (B(36), 96),
                         (B(39, 3.9), 120), (B(40), 124), (B(42), 127), (B(43, 3.8), 80), (B(44), 0)]


def pizz_part():
    # 年份滾動：滴、答
    for k in range(14):
        hi, lo = ('B4', 'E4') if k < 8 else ('A4', 'E4')
        T['pizz'].add(B(12) + k * 0.5, 0.4, hi if k % 2 == 0 else lo, 58 + k * 2.2, tight=True)
    # 每一天：大提琴撥弦（低音、五度）
    for s, e, ch in chord_segments(B(20), B(34)):
        b = bass_low(ch, 38)
        r = root_low(ch, 38)
        t = s
        while t < e - 1e-6:
            pos = (t % 4)
            if pos in (0, 2):
                T['vcpizz'].add(t, 0.5, b if pos == 0 else r + 7, 70 if pos == 0 else 58)
            t += 1
    # 28–33、36–43：合奏撥弦八分音符
    for b0, b1, vel in [(28, 34, 52), (36, 44, 62)]:
        for s, e, ch in chord_segments(B(b0), B(b1)):
            r = root_low(ch, 50)
            root, q, _ = CHORDS[ch]
            pat = [12, 7, QUAL[q][1] + 12, 7]
            t = s
            while t < e - 1e-6:
                idx = int(round(t * 2)) % 4
                T['pizz'].add(t, 0.3, r + pat[idx], vel + (6 if idx == 0 else 0))
                t += 0.5


def harp_gliss(end_beat: float, length: float, ch, lo: int, hi: int, v0=40, v1=78):
    # ch 可以是和弦名，或直接給音級（跨兩個和弦的刷奏只用兩邊都和諧的音）
    tones = chord_tones(ch) if isinstance(ch, str) else [PC[x] for x in ch]
    pitches = [p for p in range(lo, hi + 1) if p % 12 in tones]
    n = len(pitches)
    for i, p in enumerate(pitches):
        t = end_beat - length + length * i / n
        T['harp'].add(t, 1.5, p, v0 + (v1 - v0) * i / max(1, n - 1))


def harp_part():
    harp_gliss(B(8), 1.0, 'A', 45, 81, 30, 64)
    harp_gliss(B(18), 1.0, ['G', 'A', 'B', 'E'], 43, 86, 36, 80)
    harp_gliss(B(20), 1.5, 'A', 45, 88, 30, 70)
    harp_gliss(B(36), 1.0, 'B', 47, 90, 40, 84)
    harp_gliss(B(42), 1.0, ['A', 'B', 'C#', 'F#'], 45, 93, 44, 92)
    # 28–33：輕輕的四分音符分解和弦
    for s, e, ch in chord_segments(B(28), B(34)):
        r = root_low(ch, 50)
        root, q, _ = CHORDS[ch]
        seq = [r, r + 7, r + QUAL[q][1] + 12, r + 19]
        t = s
        while t < e - 1e-6:
            idx = int(round(t)) % 4
            T['harp'].add(t, 1.2, seq[idx], 46)
            t += 1
    # 44、50：滾奏
    for i, n in enumerate(['D3', 'A3', 'D4', 'F#4', 'A4', 'D5']):
        T['harp'].add(B(44) + i * 0.12, 4, n, 44 - i)
    for i, n in enumerate(['D2', 'A2', 'D3', 'E3', 'F#3', 'A3', 'D4', 'F#4', 'A4', 'D5', 'F#5', 'A5']):
        T['harp'].add(B(50) + i * 0.09, 8, n, 52 - i, tight=(i == 0))


def keys_part():
    # 開場的鋼片琴回聲
    for bar, beat, n in [(1, 3.5, 'A6'), (3, 3, 'D7'), (5, 3, 'F#6'), (7, 2, 'E6')]:
        T['celesta'].add(B(bar, beat), 1.5, n, 40)
    # 28–33：鋼片琴高八度輕輕跟著旋律
    for beat, dur, p in melody_notes(28, 34):
        T['celesta'].add(beat, dur, p + 12, 42)
    # 每一所校園成立的那一拍：鋼片琴亮一下（2001、2005、2020、2021）
    for bar, n in [(8, 'F#6'), (10, 'D6'), (14, 'F#6'), (16, 'A6')]:
        T['celesta'].add(B(bar), 2.5, n, 58, True)
        T['celesta'].add(B(bar), 2.5, N(n) + 12, 40, True)
    # 第 18、40、42 小節：鐘琴點一下
    for bar, n, v in [(18, 'B6', 50), (40, 'E7', 62), (42, 'C#7', 58)]:
        T['glock'].add(B(bar), 2, n, v, True)
    # 星星：45.0、45.25、45.5、45.75、46.0（小節）
    stars = ['A5', 'D6', 'F#6', 'A6', 'D7']
    for i, n in enumerate(stars):
        t = B(45) + i
        T['celesta'].add(t, 2, n, 64 + i * 3, True)
        T['glock'].add(t, 2, n, 52 + i * 3, True)
    # 30th 緞帶：第 47 小節金色閃光（鐘琴快速上行）
    for i, n in enumerate(['D6', 'F#6', 'A6', 'D7', 'F#7', 'A7']):
        T['glock'].add(B(47) + i * 0.125, 3, n, 58 + i * 3, tight=(i == 0))
        T['celesta'].add(B(47) + i * 0.125, 3, n, 48 + i * 2, tight=(i == 0))
    # 最後的和弦
    for i, n in enumerate(['D6', 'F#6', 'A6']):
        T['celesta'].add(B(50) + 0.5 + i * 0.25, 6, n, 40)


def timp_roll(start, end, pitch, v0, v1, hit_vel=None):
    t = start
    n = int(round((end - start) / 0.125))
    for i in range(n):
        T['timp'].add(start + i * 0.125, 0.2, pitch, v0 + (v1 - v0) * i / max(1, n - 1) + rng.uniform(-4, 4))
    if hit_vel:
        T['timp'].add(end, 2.5, pitch, hit_vel, True)


def timp_part():
    timp_roll(B(17, 2), B(18), 'D2', 20, 70)
    T['timp'].add(B(18), 3, 'G2', 70, True)
    T['timp'].add(B(20), 2, 'D2', 66, True)
    timp_roll(B(35, 2), B(36), 'B2', 24, 80)
    T['timp'].add(B(36), 2, 'E2', 86, True)
    timp_roll(B(39), B(40), 'B2', 22, 104)
    T['timp'].add(B(40), 3, 'E2', 104, True)
    timp_roll(B(41, 2), B(42), 'E2', 30, 96)
    T['timp'].add(B(42), 3, 'A2', 112, True)
    T['timp'].add(B(44), 3, 'D2', 54, True)
    timp_roll(B(49, 3), B(50), 'A2', 14, 38)
    T['timp'].add(B(50), 4, 'D2', 48, True)


def horns_part():
    T['horns'].add(B(18), 4.2, 'G3', 64, True)
    T['horns'].add(B(18), 4.2, 'D4', 60, True)
    v = voice_lead(chord_segments(B(36), B(44)), [(52, 62), (57, 69)])
    for s, e, ps in v:
        for p in ps:
            T['horns'].add(s, e - s + 0.05, p, 72 if s < B(40) else 88, is_tight(s))
    T['horns'].expr = [(B(18), 90), (B(19), 70), (B(36), 72), (B(39, 3.9), 110), (B(40), 116), (B(42), 120),
                       (B(43, 3.5), 70), (B(44), 0)]


def perc_part():
    p = T['perc']
    BD, CY1, CY2, SHK, TMB, TRI = 36, 49, 57, 82, 54, 81
    p.add(B(18), 2, BD, 50, True)
    p.add(B(18), 4, CY1, 36, True)
    for bar in range(20, 34):
        p.add(B(bar), 1, BD, 54 if bar < 28 else 62, is_tight(B(bar)))
        p.add(B(bar, 2), 1, BD, 38 if bar < 28 else 46)
    for bar in range(22, 34):
        for k in range(8):
            if bar == 33 and k >= 6:
                break
            p.add(B(bar, k * 0.5), 0.25, SHK, (34 if k % 2 == 0 else 24) + rng.uniform(-4, 4))
    for bar in range(28, 34):
        for beat in (1, 3):
            p.add(B(bar, beat), 0.5, TMB, 30 + rng.uniform(-3, 3))
    p.add(B(28), 3, TRI, 34)
    for beat, v in [(2, 40), (3, 54), (3.5, 68)]:
        p.add(B(35, beat), 0.5, BD, v)
    for bar in range(36, 44):
        p.add(B(bar), 1, BD, 76 if bar not in (40, 42) else 92, is_tight(B(bar)))
        if bar not in (42, 43):
            p.add(B(bar, 2), 1, BD, 56)
        for k in range(8):
            if bar == 43 and k >= 4:
                break
            p.add(B(bar, k * 0.5), 0.25, SHK, (40 if k % 2 == 0 else 28) + rng.uniform(-4, 4))
        if bar < 43:
            for beat in (1, 3):
                p.add(B(bar, beat), 0.5, TMB, 36 + rng.uniform(-3, 3))
    p.add(B(40), 6, CY1, 112, True)
    p.add(B(42), 6, CY2, 100, True)
    p.add(B(44), 2, BD, 60, True)


# ── 人性化與輸出 ────────────────────────────────────────────────────────
def humanize(notes: list[Note], t_sd_ms=3.5, t_max_ms=8.0, v_sd=3.0):
    for n in notes:
        if n.tight:
            dt = rng.uniform(0, 2.0) / 1000
        else:
            dt = max(-t_max_ms, min(t_max_ms, rng.gauss(0, t_sd_ms))) / 1000
        n.beat = max(0.0, n.beat + dt / SPB)
        n.vel = max(1, min(127, n.vel + rng.gauss(0, v_sd)))


def write_midi(tr: Track, path: str, end_beat: float):
    tpb = 960
    mid = mido.MidiFile(ticks_per_beat=tpb)
    trk = mido.MidiTrack()
    mid.tracks.append(trk)
    ev = []  # (tick, order, msg)
    ch = tr.channel
    ev.append((0, 0, mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(BPM))))
    if ch != 9:
        ev.append((0, 1, mido.Message('control_change', channel=ch, control=0, value=tr.bank)))
        ev.append((0, 1, mido.Message('control_change', channel=ch, control=32, value=0)))
    ev.append((0, 2, mido.Message('program_change', channel=ch, program=tr.program)))
    ev.append((0, 3, mido.Message('control_change', channel=ch, control=7, value=100)))
    ev.append((0, 3, mido.Message('control_change', channel=ch, control=10, value=tr.pan)))
    ev.append((0, 3, mido.Message('control_change', channel=ch, control=91, value=0)))
    ev.append((0, 3, mido.Message('control_change', channel=ch, control=93, value=0)))
    # CC11：折線取樣，每 1/16 拍
    if tr.expr:
        pts = sorted(tr.expr)
        ev.append((0, 3, mido.Message('control_change', channel=ch, control=11, value=int(pts[0][1]))))
        last = None
        b = pts[0][0]
        while b <= pts[-1][0] + 1e-9:
            # 線性內插
            for i in range(len(pts) - 1):
                if pts[i][0] <= b <= pts[i + 1][0]:
                    a0, v0 = pts[i]
                    a1, v1 = pts[i + 1]
                    val = v0 if a1 == a0 else v0 + (v1 - v0) * (b - a0) / (a1 - a0)
                    break
            else:
                val = pts[-1][1]
            val = int(round(max(0, min(127, val))))
            if val != last:
                ev.append((int(round(b * tpb)), 3, mido.Message('control_change', channel=ch, control=11, value=val)))
                last = val
            b += 1 / 16
    else:
        ev.append((0, 3, mido.Message('control_change', channel=ch, control=11, value=127)))
    for n in tr.notes:
        on = int(round(n.beat * tpb))
        off = int(round((n.beat + n.dur) * tpb))
        ev.append((on, 5, mido.Message('note_on', channel=ch, note=int(n.pitch), velocity=int(round(n.vel)))))
        ev.append((max(on + 1, off), 4, mido.Message('note_off', channel=ch, note=int(n.pitch), velocity=0)))
    ev.append((int(end_beat * tpb), 9, mido.Message('control_change', channel=ch, control=7, value=100)))
    ev.sort(key=lambda x: (x[0], x[1]))
    t = 0
    for tick, _, msg in ev:
        msg.time = tick - t
        t = tick
        trk.append(msg)
    trk.append(mido.MetaMessage('end_of_track', time=0))
    mid.save(path)


def hits():
    h = [('開場鋼琴', 0, 0), ('2001 明華', 8, 0), ('2005 崇德', 10, 0)]
    for k in range(14):
        h.append((f'{2006 + k} 滴答', 12, k * 0.5))
    h += [('2020 國際', 14, 0), ('2021 仁武', 16, 0), ('五校全景大和弦', 18, 0), ('第三幕', 20, 0),
          ('第四幕：手牽手（收回）', 34, 0), ('升到 E 大調', 36, 0), ('高潮最高點（鈸）', 40, 0),
          ('片名句：最寬的和弦', 42, 0), ('收回：校徽', 44, 0)]
    for i in range(5):
        h.append((f'星星 {i + 1}', 45 + i // 4, (i % 4)))
    h += [('30th 緞帶金色閃光', 47, 0), ('最後的和弦', 50, 0), ('結束', 54, 0)]
    return [{'label': lab, 'bar': bar, 'beat': beat, 'time': round(sec(B(bar, beat)), 4),
             'frame30': round(sec(B(bar, beat)) * 30, 2)} for lab, bar, beat in h]


def main():
    piano_part()
    strings_part()
    pizz_part()
    harp_part()
    keys_part()
    timp_part()
    horns_part()
    perc_part()
    humanize(piano)
    for tr in T.values():
        humanize(tr.notes, t_sd_ms=4.0 if tr.name not in ('perc',) else 3.0)
    os.makedirs(f'{OUT}/midi', exist_ok=True)
    end_beat = B(TOTAL_BARS) + 6
    for tr in T.values():
        if tr.notes:
            write_midi(tr, f'{OUT}/midi/{tr.name}.mid', end_beat)
    with open(f'{OUT}/piano.json', 'w') as f:
        json.dump({'notes': [[sec(n.beat), sec(n.dur), n.pitch, n.vel] for n in piano],
                   'pedal': [[sec(a), sec(b)] for a, b in pedal]}, f)
    with open(f'{OUT}/hits.json', 'w') as f:
        json.dump({'bpm': BPM, 'bar_seconds': 8 / 3, 'total_seconds': 144.0, 'hits': hits()}, f, ensure_ascii=False, indent=1)
    counts = {k: len(v.notes) for k, v in T.items()}
    print('piano', len(piano), 'pedal', len(pedal), counts, file=sys.stderr)


if __name__ == '__main__':
    main()
