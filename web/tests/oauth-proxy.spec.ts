// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, createError, defineEventHandler, getHeader, proxyRequest, toNodeListener } from 'h3'
import { trustedClientIp } from '../server/utils/client-ip'

const servers: Server[] = []
async function listen(server: Server) {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

it.each([302, 303])('OAuth %i、兩個 Set-Cookie 與隱私標頭原樣交給瀏覽器，代理不跟隨轉址', async (status) => {
  let providerHits = 0
  let forwardedIp = ''
  const upstream = await listen(createServer((req, res) => {
    if (req.url === '/provider') { providerHits++; res.end('provider'); return }
    forwardedIp = String(req.headers['x-website-client-ip'])
    res.writeHead(status, {
      Location: '/provider',
      'Set-Cookie': ['ivy_google_oauth=test; HttpOnly; Path=/api/website/v1/auth/google; SameSite=Lax', 'ivy_admin_session=test; HttpOnly; Path=/; SameSite=Lax'],
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    })
    res.end()
  }))
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('getHeader', getHeader)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('trustedClientIp', trustedClientIp)
  vi.stubGlobal('proxyRequest', proxyRequest)
  vi.stubGlobal('useRuntimeConfig', () => ({ websiteApiInternalBase: upstream, trustedProxyHops: 1 }))
  const { default: handler } = await import('../server/routes/api/website/v1/[...]')
  const proxy = await listen(createServer(toNodeListener(createApp().use(handler))))
  const response = await fetch(`${proxy}/api/website/v1/auth/google/login`, {
    redirect: 'manual', headers: {
      'x-website-client-ip': 'spoofed',
      'x-forwarded-for': '198.51.100.66, 203.0.113.9',
    },
  })
  expect(response.status).toBe(status)
  expect(response.headers.get('location')).toBe('/provider')
  expect(response.headers.getSetCookie()).toHaveLength(2)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(providerHits).toBe(0)
  expect(forwardedIp).toBe('203.0.113.9')
})
