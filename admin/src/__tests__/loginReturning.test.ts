// 登入頁 2026-11-19 改版（方向 1）：回訪者一鍵登入、上次使用的方式、LINE 內建瀏覽器、
// 主動登出就忘掉是誰。記錄放在 localStorage／sessionStorage（composables/lastSignIn.ts）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import LoginView from '../views/LoginView.vue'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { notePendingMethod, readLastMethod, readLastUser, rememberSignedIn } from '../composables/lastSignIn'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
const realUserAgent = navigator.userAgent

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'userAgent', { value: realUserAgent, configurable: true })
})

const lin = () => testUser('campus_admin', { email: 'lin@ivy.example', display_name: '林老師', campus_keys: ['yihua'] })

async function mountLogin(path = '/login', providers = { google: true, line: true }) {
  vi.spyOn(api, 'get').mockResolvedValue(providers)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const pinia = createPinia()
  const wrapper = mount(LoginView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, auth: useAuthStore(pinia) }
}

describe('記住上次登入的人（composables/lastSignIn）', () => {
  it('記下側欄同一套的名字與「角色・校區」，總管理者不帶校區', () => {
    rememberSignedIn(lin(), 'password')
    expect(readLastUser()).toEqual({ email: 'lin@ivy.example', name: '林老師', line: '校區管理者・義華' })
    expect(readLastMethod()).toBe('password')
    rememberSignedIn(testUser('super_admin', { email: 'boss@ivy.example', display_name: null }))
    expect(readLastUser()).toEqual({ email: 'boss@ivy.example', name: 'boss', line: '總管理者' })
  })

  it('按了 Google／LINE 要等恢復登入成功才算上次使用的方式', () => {
    rememberSignedIn(lin(), 'password')
    notePendingMethod('line')
    expect(readLastMethod()).toBe('password')
    rememberSignedIn(lin())
    expect(readLastMethod()).toBe('line')
    // 收進來之後就清掉：之後一般的恢復登入不會再把方式改掉。
    expect(sessionStorage.getItem('ivy-admin-pending-method')).toBeNull()
  })

  it('讀到壞掉的紀錄當作沒有', () => {
    localStorage.setItem('ivy-admin-last-user', '{not json')
    localStorage.setItem('ivy-admin-last-method', 'fax')
    expect(readLastUser()).toBeNull()
    expect(readLastMethod()).toBeNull()
  })

  it('主動登出忘掉是誰，方式留著', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
      if (path === '/auth/login') return { user: lin(), csrf_token: 'csrf', features: { admissions: false, password_reset_email: false } }
      return {}
    })
    await auth.login('lin@ivy.example', 'secret-password')
    expect(readLastUser()?.name).toBe('林老師')
    await auth.logout()
    expect(readLastUser()).toBeNull()
    expect(readLastMethod()).toBe('password')
  })

  it('逾時被登出（expireSession）不忘：同一個人回來可以一鍵接著用', () => {
    setActivePinia(createPinia())
    rememberSignedIn(lin(), 'password')
    useAuthStore().expireSession()
    expect(readLastUser()?.email).toBe('lin@ivy.example')
  })
})

describe('登入頁：回訪者', () => {
  it('上次用 LINE：問候帶名字，一顆「用 LINE 繼續」，沒有 Email 欄', async () => {
    rememberSignedIn(lin(), 'line')
    const { wrapper } = await mountLogin('/login?redirect=%2Fvisit-requests')
    expect(wrapper.get('h1').text()).toContain('林老師')
    expect(wrapper.get('[data-test="login-returning"]').text()).toContain('校區管理者・義華')
    const go = wrapper.get('[data-test="login-continue"]')
    expect(go.text()).toContain('用 LINE 繼續')
    expect(go.attributes('href')).toContain('/auth/line/login?redirect=%2Fvisit-requests')
    expect(wrapper.find('#admin-email').exists()).toBe(false)
  })

  it('按「用 LINE 繼續」先記著方式，導回來恢復登入才收', async () => {
    rememberSignedIn(lin(), 'password')
    localStorage.setItem('ivy-admin-last-method', 'line')
    const { wrapper } = await mountLogin()
    await wrapper.get('[data-test="login-continue"]').trigger('click')
    expect(sessionStorage.getItem('ivy-admin-pending-method')).toBe('line')
  })

  it('改用密碼登入：只問密碼，送出時用記住的 Email', async () => {
    rememberSignedIn(lin(), 'google')
    const { wrapper, auth } = await mountLogin()
    const login = vi.spyOn(auth, 'login').mockResolvedValue()
    await wrapper.get('[data-test="login-use-password"]').trigger('click')
    expect(wrapper.find('#admin-email').exists()).toBe(false)
    await wrapper.get('#current-password').setValue('secret-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(login).toHaveBeenCalledWith('lin@ivy.example', 'secret-password', false)
  })

  it('換帳號：忘掉是誰、回到完整的表單', async () => {
    rememberSignedIn(lin(), 'password')
    const { wrapper } = await mountLogin()
    expect(wrapper.find('#admin-email').exists()).toBe(false)
    await wrapper.get('[data-test="login-switch"]').trigger('click')
    expect(wrapper.find('#admin-email').exists()).toBe(true)
    expect(wrapper.find('[data-test="login-returning"]').exists()).toBe(false)
    expect(readLastUser()).toBeNull()
  })

  it('上次的方式這次沒開放：退回密碼欄', async () => {
    rememberSignedIn(lin(), 'line')
    const { wrapper } = await mountLogin('/login', { google: true, line: false })
    expect(wrapper.find('[data-test="login-continue"]').exists()).toBe(false)
    expect(wrapper.find('#current-password').exists()).toBe(true)
  })

  it('LINE 登入失敗導回來：直接給密碼欄，並顯示原因；沒綁定不給再試', async () => {
    rememberSignedIn(lin(), 'line')
    const { wrapper } = await mountLogin('/login?oauth_error=line_not_allowed')
    expect(wrapper.find('#current-password').exists()).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain('尚未綁定後台帳號')
    expect(wrapper.find('[data-test="login-retry-oauth"]').exists()).toBe(false)
  })

  it('LINE 結果開到別的瀏覽器：密碼欄下面留「使用 LINE 登入」原地再試', async () => {
    rememberSignedIn(lin(), 'line')
    const { wrapper } = await mountLogin('/login?oauth_error=line_other_browser&redirect=%2Fmedia')
    expect(wrapper.get('[role="alert"]').text()).toContain('使用 LINE 登入')
    const retry = wrapper.get('[data-test="login-retry-oauth"]')
    expect(retry.text()).toBe('使用 LINE 登入')
    expect(retry.attributes('href')).toContain('/auth/line/login?redirect=%2Fmedia')
    await retry.trigger('click')
    expect(sessionStorage.getItem('ivy-admin-pending-method')).toBe('line')
  })

  it('用 LINE 繼續也有「記住這台裝置」，勾了網址帶 remember=1', async () => {
    rememberSignedIn(lin(), 'line')
    const { wrapper } = await mountLogin('/login?redirect=%2Fvisit-requests')
    const box = wrapper.get('[data-test="login-remember"] input[type="checkbox"]')
    expect((box.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('[data-test="login-continue"]').attributes('href')).not.toContain('remember')
    await box.setValue(true)
    expect(wrapper.get('[data-test="login-continue"]').attributes('href')).toContain('/auth/line/login?redirect=%2Fvisit-requests&remember=1')
  })

  it('回訪者只問密碼：勾了記住這台裝置，送出時帶上', async () => {
    rememberSignedIn(lin(), 'password')
    const { wrapper, auth } = await mountLogin()
    const login = vi.spyOn(auth, 'login').mockResolvedValue()
    await wrapper.get('[data-test="login-remember"] input[type="checkbox"]').setValue(true)
    await wrapper.get('#current-password').setValue('secret-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(login).toHaveBeenCalledWith('lin@ivy.example', 'secret-password', true)
  })

  it('密碼重設完導回來不帶回訪者', async () => {
    rememberSignedIn(lin(), 'password')
    const { wrapper } = await mountLogin('/login?reason=password_reset')
    expect(wrapper.find('[data-test="login-returning"]').exists()).toBe(false)
    expect(wrapper.find('#admin-email').exists()).toBe(true)
  })
})

describe('登入頁：上次使用與 LINE 內建瀏覽器', () => {
  it('沒記住人時標出上次使用的方式並排前面', async () => {
    localStorage.setItem('ivy-admin-last-method', 'line')
    const { wrapper } = await mountLogin()
    const line = wrapper.get('a[href*="/auth/line/login"]')
    expect(line.text()).toContain('上次使用')
    expect(wrapper.get('.login__oauth').classes()).toContain('is-line-first')
    expect(wrapper.get('a[href*="/auth/google/login"]').text()).not.toContain('上次使用')
  })

  it('在 LINE 裡開啟：Google 改成用瀏覽器開啟這一頁', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone) Mobile/15E148 Safari Line/14.19.0', configurable: true })
    const { wrapper } = await mountLogin()
    expect(wrapper.find('a[href*="/auth/google/login"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="login-open-browser"]').attributes('href')).toContain('openExternalBrowser=1')
    expect(wrapper.get('.login__oauth').classes()).toEqual(expect.arrayContaining(['is-single', 'is-line-first']))
  })
})

describe('登入頁：密碼欄', () => {
  it('顯示密碼是有名字、有狀態的按鈕', async () => {
    const { wrapper } = await mountLogin()
    const eye = wrapper.get('.login__eye')
    expect(eye.attributes('aria-label')).toBe('顯示密碼')
    expect(eye.attributes('aria-pressed')).toBe('false')
    await eye.trigger('click')
    expect(wrapper.get('#current-password').attributes('type')).toBe('text')
    expect(eye.attributes('aria-label')).toBe('隱藏密碼')
  })

  it('大寫鎖定開著時提醒', async () => {
    const { wrapper } = await mountLogin()
    const input = wrapper.get('#current-password')
    const event = new KeyboardEvent('keydown', { key: 'A' })
    Object.defineProperty(event, 'getModifierState', { value: (key: string) => key === 'CapsLock' })
    input.element.dispatchEvent(event)
    await flushPromises()
    expect(wrapper.find('[data-test="login-caps"]').exists()).toBe(true)
  })

  it('忘記密碼點開才說明', async () => {
    const { wrapper } = await mountLogin()
    const forgot = wrapper.get('.login__forgot')
    expect(wrapper.get('#login-forgot').isVisible()).toBe(false)
    await forgot.trigger('click')
    expect(forgot.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('#login-forgot').text()).toContain('聯絡總管理者')
  })
})
