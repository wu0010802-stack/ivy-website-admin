import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    // labelCoverage／publishingWorkflow 以 import.meta.glob('…?raw') 直接讀後端原始碼
    // 比對。Vite 6 起 ?raw 也受 server.fs 限制，admin/ 以外的檔案會被拒絕
    // （Denied ID）；只放行測試要讀的 backend/app，這個設定只給測試用。
    // web/shared：errorReport.test.ts 動態載入官網那份錯誤回報規則，確認兩邊的遮蔽與忽略規則一致。
    server: {
      fs: {
        allow: [
          fileURLToPath(new URL('.', import.meta.url)),
          fileURLToPath(new URL('../backend/app', import.meta.url)),
          fileURLToPath(new URL('../web/shared', import.meta.url)),
        ],
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  }),
)
