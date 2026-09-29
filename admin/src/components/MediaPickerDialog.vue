<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, mediaPreviewUrl } from '../api/client'
import type { MediaAssetOut, MediaUploadLimitsOut } from '../api/types'
import { campusLabel, contentItemLabel } from '../api/labels'
import { loadUploadLimits, uploadKindHint, useMediaUploadQueue } from '../composables/mediaUpload'
import { useRequestSequence } from '../composables/useRequestSequence'
import MediaUploadList from './MediaUploadList.vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  campusKey?: string
  /** 要選照片還是影片（影片版位用 video） */
  kind?: 'image' | 'video'
}>(), { kind: 'image' })

const noun = computed(() => (props.kind === 'video' ? '影片' : '照片'))
const unit = computed(() => (props.kind === 'video' ? '支' : '張'))
const altNoun = computed(() => (props.kind === 'video' ? '影片說明' : '圖片說明'))

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [asset: MediaAssetOut]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const assets = ref<MediaAssetOut[]>([])
const loading = ref(false)
const query = ref('')
const error = ref<string | null>(null)
const limits = ref<MediaUploadLimitsOut | null>(null)
// 選圖器裡上傳的照片一律標記為目前這一校（沒有校區時為共用），可一次選多張。
const queue = useMediaUploadQueue({ campusKey: () => props.campusKey ?? null, allowed: props.kind })

const visibleAssets = computed(() =>
  assets.value.filter(
    (a) =>
      a.kind === props.kind &&
      a.status === 'ready' &&
      (a.campus_key === null || a.campus_key === props.campusKey) &&
      (!query.value || a.original_filename.toLowerCase().includes(query.value.toLowerCase()) || (a.alt_text ?? '').includes(query.value) || (a.caption ?? '').includes(query.value) || (a.tags ?? []).some((t) => t.includes(query.value))),
  ),
)

// 沒有說明的素材選用後，官網（頁面也沒另外填說明時）就沒有圖片說明：在格子上先標出來。
const missingAlt = computed(() => visibleAssets.value.some((a) => !a.alt_text))

/** 最新草稿用到這張照片的內容（素材庫可看完整清單）。 */
function usedInText(asset: MediaAssetOut): string {
  return (asset.used_in ?? []).map((u) => contentItemLabel(u.kind, u.campus_key)).join('、')
}

// 開窗時的讀取比上傳後的重新讀取晚回來時，不能蓋掉比較新的清單。
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    // 只列一般素材：已封存與待清理的不出現在選圖器。
    const loaded = await api.get<MediaAssetOut[]>('/admin/media')
    if (requests.isCurrent(request)) assets.value = loaded
  } catch {
    if (requests.isCurrent(request)) error.value = `無法讀取${noun.value}，請重新載入。`
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(visible, (v) => {
  if (v) {
    query.value = ''
    queue.reset()
    load()
    void loadUploadLimits().then((value) => { limits.value = value })
  }
})

function choose(asset: MediaAssetOut) {
  emit('select', asset)
  visible.value = false
}

async function onUploadChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  queue.reset()
  await queue.add(files)
  const uploaded = await queue.start()
  const failed = queue.counts.value.failed
  // 只傳一張而且成功：跟以前一樣直接選用。多張時留在選圖器，讓人自己挑。
  if (files.length === 1 && uploaded.length === 1) {
    const [picked] = uploaded
    if (picked!.alt_text) ElMessage.success('已上傳並選用')
    else ElMessage.warning(`已上傳並選用。這${unit.value}${noun.value}還沒有${altNoun.value}，沒補上的話官網會沒有${altNoun.value}，可以到素材庫按「編輯」補上。`)
    choose(picked!)
    return
  }
  if (uploaded.length) await load()
  if (failed) ElMessage.warning(`${uploaded.length} 張上傳完成、${failed} 張失敗`)
  else if (uploaded.length) ElMessage.success(`已上傳 ${uploaded.length} 張，請點選要用的照片`)
}
</script>

<template>
  <!-- 上傳中 Esc、X、點背景都關不掉，進度要看得到。 -->
  <el-dialog
    v-model="visible"
    :title="`選擇${noun}`"
    width="min(720px, 100%)"
    :close-on-click-modal="!queue.running.value"
    :close-on-press-escape="!queue.running.value"
    :show-close="!queue.running.value"
  >
    <div class="picker__bar">
      <el-input v-model="query" :aria-label="`搜尋${noun}`" placeholder="搜尋檔名或說明" clearable class="picker__search" />
      <label class="el-button" :class="{ 'is-disabled': queue.running.value }">
        <input type="file" multiple :accept="kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'" class="picker__file" :disabled="queue.running.value" @change="onUploadChange" />
        {{ queue.running.value ? `上傳中（${queue.counts.value.done + queue.counts.value.failed}／${queue.items.value.length}）` : `上傳新${noun}` }}
      </label>
    </div>
    <MediaUploadList :items="queue.items.value" :running="queue.running.value" @remove="queue.remove" />
    <p class="hint picker__hint">
      顯示跨校共用{{ campusKey ? `與${campusLabel(campusKey)}校` : '' }}的{{ noun }}；這裡上傳的會自動標記為{{ campusKey ? `${campusLabel(campusKey)}校` : '跨校共用' }}素材。<span class="picker__formats">可上傳 {{ uploadKindHint(limits, kind) }}。</span>
    </p>
    <p v-if="missingAlt" class="picker__alt-note">標示「未填{{ altNoun }}」的{{ noun }}選用後，官網會沒有{{ altNoun }}（頁面上另外填了說明的除外），可以先到素材庫按「編輯」補上。</p>

    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false"><el-button @click="load">重新載入</el-button></el-alert>
    <div v-else v-loading="loading" class="picker__grid">
      <button v-for="asset in visibleAssets" :key="asset.id" type="button" class="picker__item" @click="choose(asset)">
        <img v-if="mediaPreviewUrl(asset)" :src="mediaPreviewUrl(asset)" :alt="asset.alt_text ?? ''" loading="lazy" />
        <span v-else class="picker__placeholder">影片</span>
        <span class="picker__name">{{ asset.original_filename }}</span>
        <span class="picker__campus">{{ asset.campus_key ? campusLabel(asset.campus_key) : '跨校共用' }}</span>
        <span v-if="!asset.alt_text" class="picker__warn">未填{{ altNoun }}</span>
        <span v-if="usedInText(asset)" class="picker__usage" :title="`用在：${usedInText(asset)}`">用在：{{ usedInText(asset) }}</span>
      </button>
      <el-empty
        v-if="!loading && visibleAssets.length === 0"
        :description="query ? `沒有符合的${noun}` : `目前沒有可用的${noun}，先上傳一${unit}`"
        class="picker__empty"
      ><el-button v-if="query" @click="query = ''">清除搜尋</el-button></el-empty>
    </div>
  </el-dialog>
</template>

<style scoped>
.picker__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.picker__search {
  flex: 1 1 200px;
}
.picker__bar label:focus-within { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }

.picker__file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.picker__hint {
  margin-bottom: 12px;
}

/* 格式與大小整段換行，不會把「（15 MB 內）」拆開。 */
.picker__formats {
  display: inline-block;
}

.picker__alt-note {
  margin: -6px 0 12px;
  color: var(--brand-gold-ink);
  font-size: 13px;
  line-height: 1.5;
}

.picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  min-height: 160px;
  max-height: 60vh;
  overflow-y: auto;
}

.picker__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 150ms var(--ease-out), box-shadow 150ms var(--ease-out);
}

.picker__item:hover,
.picker__item:focus-visible {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.picker__item img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
}

.picker__placeholder {
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  background: var(--surface-2, var(--line));
  color: var(--ink-3);
  font-size: 12px;
}

.picker__name {
  padding: 0 8px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-2);
}

.picker__campus {
  padding: 0 8px;
  font-size: 11px;
  color: var(--ink-3);
}

.picker__warn {
  padding: 0 8px;
  color: var(--brand-gold-ink);
  font-size: 11px;
}

.picker__usage {
  padding: 0 8px;
  overflow: hidden;
  color: var(--ink-3);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker__empty {
  grid-column: 1 / -1;
}

@media (max-width: 720px) {
  .picker__alt-note {
    font-size: 14px;
  }
}
</style>
