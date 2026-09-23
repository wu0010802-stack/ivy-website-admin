import { describe, expect, it } from 'vitest'
import { entranceTimeline, ENTRANCE_DURATION } from '../app/utils/entrance-timeline'

describe('anniversary entrance timeline', () => {
  it('holds the curtains closed for three complete one-second numbers', () => {
    for (const [elapsed, number] of [[0, 3], [999, 3], [1000, 2], [1999, 2], [2000, 1], [2999, 1]]) {
      expect(entranceTimeline(elapsed!)).toMatchObject({ countdown: number, opening: 0, complete: false })
    }
  })
  it('opens only after the countdown, then completes and extinguishes the projection', () => {
    expect(entranceTimeline(3000)).toMatchObject({ countdown: 0, opening: 0, complete: false })
    expect(entranceTimeline(4700).opening).toBeCloseTo(0.5)
    expect(entranceTimeline(ENTRANCE_DURATION)).toMatchObject({ countdown: 0, opening: 1, projection: 0, complete: true })
  })
  it('clamps seek and invalid inputs to a valid frame', () => {
    expect(entranceTimeline(-10)).toEqual(entranceTimeline(0))
    expect(entranceTimeline(NaN)).toEqual(entranceTimeline(0))
    expect(entranceTimeline(99999)).toEqual(entranceTimeline(ENTRANCE_DURATION))
  })
})
