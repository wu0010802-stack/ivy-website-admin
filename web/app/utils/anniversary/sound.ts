// 30 週年分頁的聲音：全部用 Web Audio 現場合成，不載音檔。
// 預設關閉，使用者按了「開聲音」才建立 AudioContext（瀏覽器要求在使用者手勢裡開始）；不存進任何 storage。
// - puff：蠟燭被吹熄的「噗」（低通雜訊）
// - spark：蠟燭點著的小「嚓」
// - birthdaySong：音樂盒版生日快樂歌（旋律已是公有領域）
// - scratch：蠟筆在紙上的沙沙聲，音量與音色跟著畫的速度

import { readonly, ref } from 'vue'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let reverb: ConvolverNode | null = null
let noise: AudioBuffer | null = null
const enabled = ref(false)

function ensure(): AudioContext | null {
  if (!enabled.value || typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.8
    master.connect(ctx.destination)
    // 白噪音（puff、scratch 共用）
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    // 小房間殘響：指數衰減的雜訊當脈衝響應
    reverb = ctx.createConvolver()
    const len = Math.round(ctx.sampleRate * 1.6)
    const ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c)
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    reverb.buffer = ir
    const wet = ctx.createGain()
    wet.gain.value = 0.28
    reverb.connect(wet).connect(master)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

export function useAnniSound() {
  return {
    enabled: readonly(enabled),
    toggle() {
      enabled.value = !enabled.value
      if (enabled.value) ensure()
      else { stopScratch(); ctx?.suspend().catch(() => {}) }
    }
  }
}

let lastPuff = 0
export function puff(strength = 1) {
  const c = ensure()
  if (!c || !noise || !master) return
  const now = c.currentTime
  if (now - lastPuff < 0.035) return
  lastPuff = now
  const src = c.createBufferSource()
  src.buffer = noise
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(1600, now)
  lp.frequency.exponentialRampToValueAtTime(380, now + 0.16)
  const g = c.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.16 * strength, now + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0008, now + 0.2)
  src.connect(lp).connect(g).connect(master)
  src.start(now, Math.random() * 1.5, 0.25)
}

export function spark() {
  const c = ensure()
  if (!c || !noise || !master) return
  const now = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noise
  const hp = c.createBiquadFilter()
  hp.type = 'bandpass'
  hp.frequency.value = 3200 + Math.random() * 1500
  hp.Q.value = 1.4
  const g = c.createGain()
  g.gain.setValueAtTime(0.09, now)
  g.gain.exponentialRampToValueAtTime(0.0005, now + 0.07)
  src.connect(hp).connect(g).connect(master)
  src.start(now, Math.random(), 0.08)
}

// 生日快樂歌：[音名, 拍數]，C 大調，弱起拍
const SONG: Array<[string, number]> = [
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
  ['G4', 0.75], ['G4', 0.25], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 2],
  ['F5', 0.75], ['F5', 0.25], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 3]
]
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
export function noteHz(name: string): number {
  const n = NOTE[name[0]!]! + (Number(name.slice(1)) + 1) * 12
  return 440 * Math.pow(2, (n - 69) / 12)
}
/** 歌的總長（秒） */
export const SONG_BEAT = 0.4
export const SONG_SECONDS = SONG.reduce((s, [, b]) => s + b, 0) * SONG_BEAT

let songNodes: OscillatorNode[] = []
export function birthdaySong() {
  const c = ensure()
  if (!c || !master || !reverb) return
  stopSong()
  let t = c.currentTime + 0.08
  for (const [name, beats] of SONG) {
    const f = noteHz(name)
    // 音樂盒：基音＋兩個泛音，敲下去很快衰減
    for (const [mul, amp, detune] of [[1, 0.13, 0], [2, 0.045, 3], [3.01, 0.02, -4]] as const) {
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = f * mul
      o.detune.value = detune
      const g = c.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(amp, t + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0004, t + Math.max(0.5, beats * SONG_BEAT * 2.2))
      o.connect(g)
      g.connect(master)
      g.connect(reverb)
      o.start(t)
      o.stop(t + beats * SONG_BEAT * 2.4 + 0.1)
      songNodes.push(o)
    }
    t += beats * SONG_BEAT
  }
}
export function stopSong() {
  for (const o of songNodes) { try { o.stop() } catch { /* 已經停了 */ } }
  songNodes = []
}

// ── 蠟筆沙沙聲 ──
let scr: { src: AudioBufferSourceNode; bp: BiquadFilterNode; g: GainNode } | null = null
export function scratch(speed: number) {
  const c = ensure()
  if (!c || !noise || !master) return
  if (!scr) {
    const src = c.createBufferSource()
    src.buffer = noise
    src.loop = true
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.9
    const hp = c.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 700
    const g = c.createGain()
    g.gain.value = 0
    src.connect(bp).connect(hp).connect(g).connect(master)
    src.start()
    scr = { src, bp, g }
  }
  const now = c.currentTime
  const v = Math.min(1, speed)
  // 紙紋顆粒：音量帶一點隨機起伏
  scr.g.gain.setTargetAtTime((0.05 + 0.2 * v) * (0.8 + Math.random() * 0.4), now, 0.03)
  scr.bp.frequency.setTargetAtTime(1500 + 2600 * v, now, 0.05)
}
export function stopScratch() {
  if (!scr || !ctx) return
  const s = scr
  scr = null
  s.g.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
  setTimeout(() => { try { s.src.stop() } catch { /* 已經停了 */ } }, 200)
}
