import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const apiInternalBase = process.env.ADMIN_API_INTERNAL_BASE ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  base: '/admin/',
  plugins: [vue()],
  server: {
    proxy: {
      '/api/website/v1/': {
        target: apiInternalBase,
        changeOrigin: true,
      },
    },
  },
})
