import { onMounted, ref } from 'vue'
import { api } from '../api/client'

/**
 * 官網發布中的「網站標題與電話」是否關掉了最新消息（site_meta.news_enabled === false，2026-11-11）。
 * 消息編輯頁用它提醒：照常可以新增、修改、發布，但官網目前不顯示。
 * 讀不到（官網還沒發布過、連線失敗）一律當成沒關：這只是提醒，不擋編輯、也不另外報錯。
 */
export function usePublishedNewsHidden() {
  const hidden = ref(false)
  onMounted(async () => {
    try {
      const site = await api.get<{ content?: { site_meta?: { news_enabled?: boolean } } }>('/public/site')
      hidden.value = site?.content?.site_meta?.news_enabled === false
    } catch {
      hidden.value = false
    }
  })
  return hidden
}
