import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { entranceBootstrap, ENTRANCE_SESSION_KEY } from '../app/utils/entrance-policy'

function run(options: { path?: string; hash?: string; reduced?: boolean; colors?: boolean; seen?: boolean; blockedStorage?: boolean; connection?: object; runtimeSeen?: boolean } = {}) {
  const dataset: Record<string, string> = {}
  const writes: string[][] = []
  const sandbox = {
    location: { pathname: options.path ?? '/', hash: options.hash ?? '' },
    window: { __ivyEntranceSeen: options.runtimeSeen ?? false },
    document: { documentElement: { dataset } },
    navigator: { connection: options.connection },
    matchMedia: (query: string) => ({ matches: query.includes('reduced-motion') ? !!options.reduced : !!options.colors }),
    sessionStorage: {
      getItem: () => { if (options.blockedStorage) throw new Error('blocked'); return options.seen ? '1' : null },
      setItem: (key: string, value: string) => { writes.push([key, value]) }
    }
  }
  runInNewContext(entranceBootstrap, sandbox)
  return { dataset, writes, sandbox }
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
    expect(run(options).dataset.ivyEntrance).toBeUndefined()
  })
  it('continues when session storage is unavailable but avoids SPA repeats', () => {
    const { sandbox, dataset } = run({ blockedStorage: true })
    expect(dataset.ivyEntrance).toBe('pending')
    delete dataset.ivyEntrance
    runInNewContext(entranceBootstrap, sandbox)
    expect(dataset.ivyEntrance).toBeUndefined()
  })
})
