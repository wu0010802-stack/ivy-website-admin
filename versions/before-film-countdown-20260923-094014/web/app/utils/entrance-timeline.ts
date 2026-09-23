export const COUNTDOWN_DURATION = 3000
export const OPENING_DURATION = 3400
export const ENTRANCE_DURATION = COUNTDOWN_DURATION + OPENING_DURATION

/** All consumers use elapsed time so each countdown number gets a full second. */
export function entranceTimeline(elapsedMs: number) {
  const elapsed = Math.min(ENTRANCE_DURATION, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0))
  const countdown = elapsed < COUNTDOWN_DURATION ? 3 - Math.floor(elapsed / 1000) : 0
  const opening = Math.max(0, (elapsed - COUNTDOWN_DURATION) / OPENING_DURATION)
  const fadeInProgress = Math.min(1, elapsed / 360)
  const fadeOutProgress = Math.max(0, 1 - opening / 0.24)
  const fadeIn = fadeInProgress * fadeInProgress * (3 - 2 * fadeInProgress)
  const fadeOut = fadeOutProgress * fadeOutProgress * (3 - 2 * fadeOutProgress)
  // A quick soft pulse marks each second without a strobe or black interval.
  const pulse = countdown ? 0.92 + 0.08 * Math.sin(Math.min(1, (elapsed % 1000) / 260) * Math.PI / 2) : 1
  const digitFade = Math.min(1, Math.max(0, (elapsed - COUNTDOWN_DURATION) / 180))
  const digitOpacity = 1 - digitFade * digitFade * (3 - 2 * digitFade)
  const shadowFade = Math.min(1, opening / 0.8)
  const shadowOpacity = 0.18 * (1 - shadowFade * shadowFade * (3 - 2 * shadowFade))
  return { countdown, opening, projection: fadeIn * fadeOut, pulse, digitOpacity, shadowOpacity, complete: elapsed >= ENTRANCE_DURATION }
}
