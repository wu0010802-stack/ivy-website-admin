import { mkdirSync } from 'node:fs'
import { test as setup } from '@playwright/test'
import { adminApi, taipeiDate, type AdminApi, type SlotOut } from './api'
import { AUTH_DIR, INQUIRY_CAMPUS, SLOTS_CAMPUS, USERS, storageStatePath, type StackRole } from './stack-env'

// 每次執行前 start-api.sh 已重建資料庫（migration、五校、initialize-content、總管理者）。
// 這裡補上：三個分校角色帳號、各角色的登入狀態，以及兩校的預約方式與場次。

async function createSlots(api: AdminApi, campus: string, days: number[]): Promise<SlotOut[]> {
  const slots: SlotOut[] = []
  for (const day of days) {
    slots.push(
      await api.send<SlotOut>('POST', `/admin/slots?campus_key=${campus}`, {
        slot_date: taipeiDate(day),
        start_time: '10:00:00',
        end_time: '11:00:00',
        capacity: 3,
      }),
    )
  }
  return slots
}

async function setMode(api: AdminApi, campus: string, config: Record<string, unknown>): Promise<void> {
  const current = await api.get<{ version: number }>(`/admin/booking-config/${campus}`)
  await api.send('PATCH', `/admin/booking-config/${campus}`, { expected_version: current.version, ...config })
}

setup('角色帳號、登入狀態與兩校預約設定', async () => {
  mkdirSync(AUTH_DIR, { recursive: true })
  const admin = await adminApi('super_admin')

  const roles: Exclude<StackRole, 'super_admin'>[] = ['campus_admin', 'reception', 'editor']
  for (const role of roles) {
    await admin.send('POST', '/admin/users', {
      email: USERS[role].email,
      password: USERS[role].password,
      role,
      campus_keys: USERS[role].campusKeys,
    })
  }
  for (const role of ['super_admin', ...roles] as StackRole[]) {
    const api = role === 'super_admin' ? admin : await adminApi(role)
    await api.context.storageState({ path: storageStatePath(role) })
    if (api !== admin) await api.dispose()
  }

  // 發布個資使用說明：預約表單與頁尾才會出現「閱讀個資使用說明」對話框（鍵盤測試要用）。
  const booking = await admin.get<{ latest_version: number; latest_revision: { payload: Record<string, unknown> } }>(
    '/admin/content-items/booking_content',
  )
  const saved = await admin.send<{ latest_revision: { id: string } }>('POST', '/admin/content-items/booking_content/revisions', {
    expected_version: booking.latest_version,
    payload: {
      ...booking.latest_revision.payload,
      privacy_title: '個資使用說明',
      privacy_sections: [
        { heading: '蒐集目的', body: '園方只用這些資料聯絡你、安排參觀。' },
        { heading: '保存期間', body: '參觀結束後依園方的保存政策刪除或去識別化。' },
      ],
    },
  })
  await admin.send('POST', '/admin/content-items/booking_content/publish', { revision_id: saved.latest_revision.id })

  // 場次放在一週後：避開最短提前 24 小時與家長線上異動期限（預設參觀前 24 小時）。
  await createSlots(admin, SLOTS_CAMPUS, [7, 8, 9])
  await setMode(admin, SLOTS_CAMPUS, { mode: 'slots', slots_auto_confirm: false })
  await createSlots(admin, INQUIRY_CAMPUS, [7, 8])
  await setMode(admin, INQUIRY_CAMPUS, { mode: 'inquiry' })
  await admin.dispose()
})
