import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// app/ 引用 shared/ 一律寫 #shared/…（Nuxt 內建別名）：寫相對路徑的話，
// nuxt build 的 SSR bundle 會把 shared/ 外部化成以 dist/server 為基準的
// 相對路徑，放進 _nuxt/ 子目錄的 chunk 後就解析不到（B11 的 cta-analytics
// 曾讓 production build 失敗）。單元測試不經 Nuxt，這裡補同一個別名。
// 元件渲染測試（about-render.spec.ts）直接 import .vue：plugin-vue（Nuxt 自帶的那一份）編譯 SFC，
// ~ 同 Nuxt 指向 app/；Nuxt 的自動匯入（computed、NuxtLink…）由測試自己補。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url))
    }
  }
})
