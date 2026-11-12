// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createError, getHeader, setResponseHeader } from 'h3'

// 暫時的訪客 IP 診斷端點（2026-11-12）：沒設 token 或 token 不對一律 404，對了只回自己這個請求的 header。

function event(headers: Record<string, string>) {
  return { node: { req: { headers, socket: { remoteAddress: '10.0.0.5' } }, res: { setHeader() {}, getHeader() {} } } } as never
}

async function load(token: string) {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('useRuntimeConfig', () => ({ ipDiagToken: token, trustedProxyHops: 1 }))
  vi.stubGlobal('getHeader', getHeader)
  vi.stubGlobal('setResponseHeader', setResponseHeader)
  vi.stubGlobal('createError', createError)
  return (await import('../server/api/client-errors/ip-diag.get')).default as (e: never) => Record<string, unknown>
}

const TOKEN = 'a'.repeat(40)
afterEach(() => vi.unstubAllGlobals())

describe('ip-diag', () => {
  it('沒設 token：404', async () => {
    const handler = await load('')
    expect(() => handler(event({ 'x-ip-diag-token': '' }))).toThrow()
  })

  it('token 不對：404', async () => {
    const handler = await load(TOKEN)
    expect(() => handler(event({ 'x-ip-diag-token': 'b'.repeat(40) }))).toThrow()
  })

  it('token 對：回 header 與目前採信的 IP', async () => {
    const handler = await load(TOKEN)
    const body = handler(event({ 'x-ip-diag-token': TOKEN, 'x-forwarded-for': '198.51.100.7, 203.0.113.9', 'x-real-ip': '198.51.100.7' }))
    expect(body.trusted_client_ip).toBe('203.0.113.9')
    expect((body.headers as Record<string, string>)['x-real-ip']).toBe('198.51.100.7')
  })
})
