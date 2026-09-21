import videos from '../generated/video-manifest.json'

export interface ConnectionInfo { saveData?: boolean; effectiveType?: string }

export function mayAutoplay(reducedMotion: boolean, connection?: ConnectionInfo): boolean {
  return !reducedMotion && !connection?.saveData && !/^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '')
}

export function backgroundVideoSrc(source: string, mobile: boolean): string {
  if (source === 'assets/hero-campus.mp4') return mobile ? videos['hero-mobile'] : videos['hero-desktop']
  if (source === 'assets/day-film.mp4') return videos['day-desktop']
  if (source === 'assets/day-film-mobile.mp4') return videos['day-mobile']
  return `/${source.replace(/^\//, '')}`
}
