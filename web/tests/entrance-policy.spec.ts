import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { entranceBootstrap, entranceCoverStyles, ENTRANCE_POSTERS, ENTRANCE_SESSION_KEY } from '../app/utils/entrance-policy'

// Evaluates the aspect-ratio queries ENTRANCE_POSTERS uses against a viewport.
function aspectMatches(query: string, aspect: number) {
  if (query === 'all') return true
  const match = /\((min|max)-aspect-ratio: (\d+)\/(\d+)\)/.exec(query)
  if (!match) throw new Error(`unexpected media query ${query}`)
  const ratio = Number(match[2]) / Number(match[3])
  return match[1] === 'min' ? aspect >= ratio : aspect <= ratio
}

function run(options: { path?: string; hash?: string; reduced?: boolean; colors?: boolean; seen?: boolean; blockedStorage?: boolean; connection?: object; runtimeSeen?: boolean; aspect?: number } = {}) {
  const dataset: Record<string, string> = {}
  const writes: string[][] = []
  const preloads: Record<string, string>[] = []
  const sandbox = {
    location: { pathname: options.path ?? '/', hash: options.hash ?? '' },
    window: { __ivyEntranceSeen: options.runtimeSeen ?? false },
    document: {
      documentElement: { dataset },
      createElement: () => ({}),
      head: { append: (link: Record<string, string>) => { preloads.push({ ...link }) } }
    },
    navigator: { connection: options.connection },
    matchMedia: (query: string) => ({ matches: query.includes('reduced-motion') ? !!options.reduced : query.includes('forced-colors') ? !!options.colors : aspectMatches(query, options.aspect ?? 1.6) }),
    sessionStorage: {
      getItem: () => { if (options.blockedStorage) throw new Error('blocked'); return options.seen ? '1' : null },
      setItem: (key: string, value: string) => { writes.push([key, value]) }
    }
  }
  runInNewContext(entranceBootstrap, sandbox)
  return { dataset, writes, preloads, sandbox }
}

describe('first entrance eligibility', () => {
  it('marks a first homepage visit before paint and remembers it in the session', () => {
    const result = run()
    expect(result.dataset.ivyEntrance).toBe('pending')
    expect(Number(result.dataset.ivyEntranceStarted)).toBeGreaterThan(0)
    expect(result.writes).toEqual([[ENTRANCE_SESSION_KEY, '1']])
    expect(result.sandbox.window.__ivyEntranceSeen).toBe(true)
  })
  it.each([
    { path: '/visit' }, { hash: '#campuses' }, { reduced: true }, { colors: true },
    { seen: true }, { runtimeSeen: true }, { connection: { saveData: true } },
    { connection: { effectiveType: '3g' } }, { connection: { effectiveType: '2g' } }
  ])('does not cover content for an ineligible visit: %j', options => {
    const result = run(options)
    expect(result.dataset.ivyEntrance).toBeUndefined()
    expect(result.preloads).toEqual([])
  })
  it('continues when session storage is unavailable but avoids SPA repeats', () => {
    const { sandbox, dataset } = run({ blockedStorage: true })
    expect(dataset.ivyEntrance).toBe('pending')
    delete dataset.ivyEntrance
    runInNewContext(entranceBootstrap, sandbox)
    expect(dataset.ivyEntrance).toBeUndefined()
  })
})

describe('first-paint curtain poster', () => {
  const poster = (name: string) => ENTRANCE_POSTERS.find(([, src]) => src.includes(`entrance-poster-${name}.webp`))![1]
  // Aspect bands follow the engine's valance swag count, max(2, floor(aspect*2.4 + 0.5)).
  it.each([
    [390 / 844, 'phone'], [0.75, 'portrait'], [1, 'portrait'], [1.33, 'landscape'],
    [1.6, 'desktop'], [16 / 9, 'desktop'], [2.2, 'wide'], [21 / 9, 'wide']
  ])('preloads the poster drawn for aspect %f (%s) while the marker is set', (aspect, name) => {
    const { preloads } = run({ aspect })
    expect(preloads).toEqual([{ rel: 'preload', as: 'image', href: poster(name), fetchPriority: 'high' }])
  })
  it('lists the same posters in the cover CSS, last match winning like the script\'s first match', () => {
    const rules = [...entranceCoverStyles.matchAll(/(?:@media(\([^)]*\)))?\{?:root\{--entrance-poster:url\(([^)]+)\)\}/g)].map(m => [m[1] ?? 'all', m[2]])
    expect(rules).toEqual([...ENTRANCE_POSTERS].reverse())
    expect(entranceCoverStyles).toContain('background:var(--entrance-cover)')
  })
  it('versions every poster by its content so a re-render is not served from a stale cache', () => {
    for (const [, src] of ENTRANCE_POSTERS) {
      const [, file, version] = /^\/assets\/(entrance-poster-[a-z]+\.webp)\?v=([0-9a-f]{8})$/.exec(src) ?? []
      expect(file, src).toBeDefined()
      const bytes = readFileSync(fileURLToPath(new URL(`../public/assets/${file}`, import.meta.url)))
      expect(createHash('sha256').update(bytes).digest('hex').slice(0, 8), src).toBe(version)
    }
  })
})
