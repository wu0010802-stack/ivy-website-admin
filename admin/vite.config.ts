import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

const apiInternalBase = process.env.ADMIN_API_INTERNAL_BASE ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  base: '/admin/',
  plugins: [
    vue(),
    // Element Plus 元件 JS 按需引入：模板裡的 <el-*> 元件與 v-loading 指令由 resolver 自動 import。
    // 樣式不跟著元件走（importStyle: false），整包 CSS 由 main.ts 在 style.css 之前載入。
    Components({
      // 只處理 Element Plus；自家元件照舊在各檔明確 import，不掃 src/components 變成全域
      dirs: [],
      resolvers: [ElementPlusResolver({ importStyle: false })],
      // 不產生 components.d.ts：<el-*> 在型別上維持按需引入前的狀態（未宣告）。產生的話
      // vue-tsc 會開始嚴格檢查表格 slot 等型別，既有程式要另外整批修。
      dts: false,
    }),
  ],
  server: {
    proxy: {
      '/api/website/v1/': {
        target: apiInternalBase,
        changeOrigin: true,
      },
    },
  },
})
