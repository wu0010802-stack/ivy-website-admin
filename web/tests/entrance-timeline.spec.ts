import { describe, expect, it } from 'vitest'
import { entranceTimeline, LOGO_DURATION, OPENING_START, ENTRANCE_DURATION } from '../app/utils/entrance-timeline'

describe('anniversary entrance timeline', () => {
  it('shows the logo alone before the three-second countdown', () => {
    for (const elapsed of [0, 300, 1000, LOGO_DURATION - 1]) {
      expect(entranceTimeline(elapsed)).toMatchObject({ phase: 'logo', countdown: 0, opening: 0, leaderOpacity: 0 })
    }
    expect(entranceTimeline(600).logoOpacity).toBe(1)
    expect(entranceTimeline(LOGO_DURATION)).toMatchObject({ phase: 'countdown', countdown: 3, logoOpacity: 0 })
  })
  it('holds the curtains closed for three complete one-second numbers with no logo overlap', () => {
    for (const [elapsed, number] of [[0, 3], [999, 3], [1000, 2], [1999, 2], [2000, 1], [2999, 1]]) {
      expect(entranceTimeline(LOGO_DURATION + elapsed!)).toMatchObject({ countdown: number, opening: 0, logoOpacity: 0, complete: false })
    }
  })
  it('restarts the film-leader sweep once per number', () => {
    for (const second of [0, 1, 2]) {
      expect(entranceTimeline(LOGO_DURATION + second * 1000).sweep).toBe(0)
      expect(entranceTimeline(LOGO_DURATION + second * 1000 + 500).sweep).toBe(0.5)
      expect(entranceTimeline(LOGO_DURATION + second * 1000 + 999).sweep).toBeCloseTo(0.999)
    }
  })
  it('opens only after the countdown, then completes and extinguishes the projection', () => {
    expect(entranceTimeline(OPENING_START)).toMatchObject({ phase: 'opening', countdown: 0, opening: 0, complete: false })
    expect(entranceTimeline(OPENING_START + 1700).opening).toBeCloseTo(0.5)
    expect(entranceTimeline(ENTRANCE_DURATION)).toMatchObject({ phase: 'complete', countdown: 0, opening: 1, projection: 0, logoOpacity: 0, leaderOpacity: 0, complete: true })
  })
  it('clamps seek and invalid inputs to a valid frame', () => {
    expect(entranceTimeline(-10)).toEqual(entranceTimeline(0))
    expect(entranceTimeline(NaN)).toEqual(entranceTimeline(0))
    expect(entranceTimeline(99999)).toEqual(entranceTimeline(ENTRANCE_DURATION))
  })
  it('keeps the final number for its whole second, then dissolves the leader before the cloth moves', () => {
    expect(entranceTimeline(OPENING_START - 1)).toMatchObject({ countdown: 1, leaderOpacity: 1, opening: 0 })
    expect(entranceTimeline(OPENING_START)).toMatchObject({ countdown: 0, leaderOpacity: 1, sweep: 1 })
    expect(entranceTimeline(OPENING_START + 90).leaderOpacity).toBeCloseTo(0.5)
    expect(entranceTimeline(OPENING_START + 180).leaderOpacity).toBe(0)
    expect(entranceTimeline(OPENING_START + 180).opening).toBeLessThan(0.08)
  })
  it('releases the backdrop shadow before the overlay is removed', () => {
    expect(entranceTimeline(OPENING_START).shadowOpacity).toBe(0.18)
    expect(entranceTimeline(OPENING_START + 1000).shadowOpacity).toBeGreaterThan(entranceTimeline(OPENING_START + 2000).shadowOpacity)
    expect(entranceTimeline(ENTRANCE_DURATION - 400)).toMatchObject({ shadowOpacity: 0, complete: false })
  })
})
