export const LOGO_DURATION = 1500
export const COUNTDOWN_DURATION = 3000
export const OPENING_DURATION = 3400
export const OPENING_START = LOGO_DURATION + COUNTDOWN_DURATION
export const ENTRANCE_DURATION = OPENING_START + OPENING_DURATION

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}
const easeOut = (value: number) => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3

/** Logo first, then three full seconds of film leader, then the curtain opens. */
export function entranceTimeline(elapsedMs: number) {
  const elapsed = Math.min(ENTRANCE_DURATION, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0))
  const complete = elapsed >= ENTRANCE_DURATION
  const phase = elapsed < LOGO_DURATION ? 'logo' : elapsed < OPENING_START ? 'countdown' : complete ? 'complete' : 'opening'
  const countElapsed = Math.max(0, elapsed - LOGO_DURATION)
  const countdown = phase === 'countdown' ? 3 - Math.floor(countElapsed / 1000) : 0
  const opening = Math.max(0, (elapsed - OPENING_START) / OPENING_DURATION)
  // A follow-spot iris opens on the emblem, then closes to a point before the leader.
  const iris = elapsed < LOGO_DURATION ? easeOut(elapsed / 480) * (1 - smooth((elapsed - LOGO_DURATION + 340) / 340)) : 0
  const logoOpacity = smooth(elapsed / 160) * smooth((LOGO_DURATION - elapsed) / 100)
  const leaderOpacity = elapsed < LOGO_DURATION ? 0 : smooth(countElapsed / 100) * (1 - smooth((elapsed - OPENING_START) / 180))
  // The leader's gate irises open where the emblem closed, like a classic cut.
  const leaderIris = elapsed < LOGO_DURATION ? 0 : easeOut(countElapsed / 260)
  // Classic clockwise wipe, restarting with every number.
  const sweep = phase === 'countdown' ? (countElapsed % 1000) / 1000 : elapsed >= OPENING_START ? 1 : 0
  // Each number lands slightly soft and bright, like a projector frame change.
  const flash = phase === 'countdown' ? Math.exp(-(countElapsed % 1000) / 90) : 0
  // The lamp swells at the end of 1 and goes out as the rail starts moving.
  const flare = leaderOpacity > 0 ? smooth((elapsed - OPENING_START + 140) / 140) : 0
  const projection = smooth(elapsed / 300) * (1 - smooth(opening / 0.24))
  const shadowOpacity = 0.18 * (1 - smooth(opening / 0.8))
  return { phase, countdown, opening, projection, iris, logoOpacity, leaderOpacity, leaderIris, sweep, flash, flare, filmFrame: Math.floor(countElapsed / (1000 / 12)), shadowOpacity, complete }
}
