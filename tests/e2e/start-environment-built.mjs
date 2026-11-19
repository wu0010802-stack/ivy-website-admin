import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WebKit 不會在 HTTP 上寫入正式版的 Secure cookie；用每次新建的本機測試憑證。
// 憑證與測試用私鑰不進版控、不接正式 API，讀入記憶體後就移除暫存檔。
const dir = mkdtempSync(join(tmpdir(), 'ivy-environment-tls-'))
try {
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', key, '-out', cert], { stdio: 'pipe' })
  Object.assign(process.env, {
    HOST: '127.0.0.1', PORT: '3233',
    NUXT_WEBSITE_ENV: 'test', NUXT_PUBLIC_CONTENT_MODE: 'fixture', NUXT_PUBLIC_TELEMETRY_ENABLED: 'false',
    NITRO_SSL_KEY: readFileSync(key, 'utf8'), NITRO_SSL_CERT: readFileSync(cert, 'utf8'),
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
await import('../../web/.output/server/index.mjs')
