import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GRANT_LABELS, PERMISSION_GROUPS, UNLISTED_CAPABILITIES, allowedPermissions, indexPermissionRows, permissionAllowed, permissionState, type PermissionRow } from '../api/permissionLabels'
import { NAV_GROUPS } from '../router/nav'
import { ROLE_CAPABILITIES } from './fixtures'

// 後端權限表的 key（backend/app/auth/permissions.py 的 _CAPABILITY_ROLES，加上另外判斷的共用內容兩項）。
const backendDir = resolve(__dirname, '../../../backend/app/auth')
function backendCapabilities(): string[] {
  const permissions = readFileSync(resolve(backendDir, 'permissions.py'), 'utf8')
  const models = readFileSync(resolve(backendDir, 'models.py'), 'utf8')
  const constants = new Map([...(permissions + models).matchAll(/^([A-Z_]+) = "([a-z_.]+)"$/gm)].map(match => [match[1], match[2]]))
  const table = permissions.slice(permissions.indexOf('_CAPABILITY_ROLES: dict'), permissions.indexOf('\n}\n', permissions.indexOf('_CAPABILITY_ROLES: dict')))
  const keys = [...table.matchAll(/^    (?:"([a-z_.]+)"|([A-Z_]+)): \{/gm)].map(match => match[1] ?? constants.get(match[2]!)!)
  return [...keys, constants.get('SHARED_CONTENT')!, constants.get('SHARED_CONTENT_PUBLISH')!]
}

const listed = PERMISSION_GROUPS.flatMap(group => group.items.map(item => item.key))

describe('權限說明對得上後端權限表', () => {
  const backend = backendCapabilities()

  it('讀得到後端的表', () => {
    expect(backend.length).toBeGreaterThan(25)
    expect(backend).toContain('admissions.stats')
    expect(backend).toContain('content.shared_publish')
    expect(backend.every(key => typeof key === 'string')).toBe(true)
  })

  it('後端每一項不是列在對照表，就是明寫不列', () => {
    const known = new Set([...listed, ...UNLISTED_CAPABILITIES])
    expect(backend.filter(key => !known.has(key))).toEqual([])
  })

  it('對照表與不列清單沒有後端沒有的項目，也沒有重複', () => {
    const all = [...listed, ...UNLISTED_CAPABILITIES]
    expect(all.filter(key => !backend.includes(key))).toEqual([])
    expect(new Set(all).size).toBe(all.length)
  })

  it('側欄用到的每一項權限後端都有', () => {
    const used = NAV_GROUPS.flatMap(group => group.items.map(item => item.capability)).filter((key): key is string => Boolean(key))
    expect(used.filter(key => !backend.includes(key))).toEqual([])
  })

  it('測試用的總管理者擁有後端每一項（fixtures 沒有漏抄）', () => {
    expect([...ROLE_CAPABILITIES.super_admin].sort()).toEqual([...backend].sort())
  })

  it('可以授權的三項都有名稱', () => {
    expect(Object.keys(GRANT_LABELS).sort()).toEqual(['admissions.stats', 'booking.export', 'content.shared'])
  })
})

describe('權限狀態', () => {
  const stats: PermissionRow = { key: 'admissions.stats', roles: ['super_admin', 'campus_admin'], grant: 'admissions.stats' }
  const publish: PermissionRow = { key: 'content.shared_publish', roles: ['super_admin', 'campus_admin'], grant: 'content.shared' }

  it('總管理者不必授權；其他角色要授權；不在名單的角色沒有', () => {
    expect(permissionState(stats, 'super_admin')).toBe('yes')
    expect(permissionState(stats, 'campus_admin')).toBe('grant')
    expect(permissionState(stats, 'reception')).toBe('no')
    expect(permissionState(undefined, 'super_admin')).toBe('no')
  })

  it('勾了對應的授權才算有', () => {
    expect(permissionAllowed(stats, 'campus_admin', [])).toBe(false)
    expect(permissionAllowed(stats, 'campus_admin', ['admissions.stats'])).toBe(true)
    expect(permissionAllowed(publish, 'campus_admin', ['content.shared'])).toBe(true)
    expect(permissionAllowed(stats, 'reception', ['admissions.stats'])).toBe(false)
  })

  it('格式不對的回應整理成空表，預覽就不出現', () => {
    expect(indexPermissionRows([{ id: 'u1', email: 'a@b.c' }]).size).toBe(0)
    expect(indexPermissionRows(null).size).toBe(0)
    expect(allowedPermissions(new Map(), 'campus_admin', [])).toEqual([])
  })

  it('預覽照分組列出這樣設定可以做的事', () => {
    const rows = indexPermissionRows([stats, { key: 'booking.read', roles: ['super_admin', 'campus_admin', 'reception'], grant: null }])
    expect(allowedPermissions(rows, 'campus_admin', []).map(group => group.items.map(item => item.key))).toEqual([['booking.read']])
    expect(allowedPermissions(rows, 'campus_admin', ['admissions.stats']).flatMap(group => group.items.map(item => item.key))).toEqual(['booking.read', 'admissions.stats'])
  })
})
