export const COUNTDOWN_DURATION = 3000
export const OPENING_DURATION = 3400
export const ENTRANCE_DURATION = COUNTDOWN_DURATION + OPENING_DURATION

/** All consumers use elapsed time so each countdown number gets a full second. */
export function entranceTimeline(elapsedMs: number) {
  const elapsed = Math.min(ENTRANCE_DURATION, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0))
  const countdown = elapsed < COUNTDOWN_DURATION ? 3 - Math.floor(elapsed / 1000) : 0
  const opening = Math.max(0, (elapsed - COUNTDOWN_DURATION) / OPENING_DURATION)
  const fadeIn = Math.min(1, elapsed / 260)
  const fadeOut = Math.max(0, 1 - opening / 0.34)
  // A quick soft pulse marks each second without a strobe or black interval.
  const pulse = 0.82 + 0.18 * Math.sin(Math.min(1, (elapsed % 1000) / 350) * Math.PI / 2)
  return { countdown, opening, projection: fadeIn * fadeOut, pulse, complete: elapsed >= ENTRANCE_DURATION }
}
