export const LOGO_DURATION = 1500
export const COUNTDOWN_DURATION = 3000
export const OPENING_DURATION = 3400
export const OPENING_START = LOGO_DURATION + COUNTDOWN_DURATION
export const ENTRANCE_DURATION = OPENING_START + OPENING_DURATION

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

/** Logo first, then three full seconds of film leader, then the curtain opens. */
export function entranceTimeline(elapsedMs: number) {
  const elapsed = Math.min(ENTRANCE_DURATION, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0))
  const complete = elapsed >= ENTRANCE_DURATION
  const phase = elapsed < LOGO_DURATION ? 'logo' : elapsed < OPENING_START ? 'countdown' : complete ? 'complete' : 'opening'
  const countElapsed = Math.max(0, elapsed - LOGO_DURATION)
  const countdown = phase === 'countdown' ? 3 - Math.floor(countElapsed / 1000) : 0
  const opening = Math.max(0, (elapsed - OPENING_START) / OPENING_DURATION)
  // Extinguish the emblem before the leader appears in the same projection box.
  const logoOpacity = smooth(elapsed / 300) * smooth((LOGO_DURATION - elapsed) / 220)
  const leaderOpacity = elapsed < LOGO_DURATION ? 0 : smooth(countElapsed / 100) * (1 - smooth((elapsed - OPENING_START) / 180))
  const sweep = elapsed < OPENING_START ? (countElapsed % 1000) / 1000 : 1
  const projection = smooth(elapsed / 300) * (1 - smooth(opening / 0.24))
  const shadowOpacity = 0.18 * (1 - smooth(opening / 0.8))
  return { phase, countdown, opening, projection, logoOpacity, leaderOpacity, sweep, filmFrame: Math.floor(countElapsed / (1000 / 12)), shadowOpacity, complete }
}
