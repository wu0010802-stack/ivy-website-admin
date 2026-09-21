import { resolveLegacyHash } from '../utils/legacy-hash'

export default defineNuxtPlugin(async () => {
  const router = useRouter()
  const target = resolveLegacyHash(window.location.hash)
  if (!target) return

  // 等初始（SSR hydration）導覽解析完成，避免 replace 被判定為
  // 重複導覽而被忽略，導致網址列仍留著舊 hash。
  await router.isReady()
  await router.replace(target)
})
