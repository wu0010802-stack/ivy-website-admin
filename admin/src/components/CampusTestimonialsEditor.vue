<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import type { TestimonialPayload } from '../api/types'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { revealListItem } from '../composables/newsContent'
import {
  TESTIMONIALS_MAX,
  builtinTestimonialPoster,
  campusTestimonialsDraft,
  newTestimonial,
  testimonialUrlError,
} from '../composables/campusTestimonialsDraft'
import { youtubeIdOf } from '../composables/homeFilms'
import LengthHint from './LengthHint.vue'
import PagePhotoField from './PagePhotoField.vue'

/**
 * 分校資料的「家長分享影片」（campus_profile.testimonials，關於頁第四章「家長怎麼說」）。
 * null＝沿用官網內建清單（目前只有義華 4 支）；打開「改成自訂」就把內建清單帶進來當起點，
 * 之後以這裡的清單為準（可以清空成 []＝這校不放，最多 TESTIMONIALS_MAX 支）；「恢復內建」設回 null。
 * 封面沒選時官網先用內建的同一支影片封面，沒有再用 YouTube 縮圖（後台 CSP 不放外部圖，這裡不預覽縮圖）。
 */
const props = defineProps<{
  testimonials: TestimonialPayload[] | null | undefined
  campusKey: string
  readOnly?: boolean
}>()

const emit = defineEmits<{ 'update:testimonials': [value: TestimonialPayload[] | null] }>()

const root = ref<HTMLElement | null>(null)

const builtinCount = computed(() => campusTestimonialsDraft(props.campusKey).length)
const customized = computed(() => Array.isArray(props.testimonials))
const full = computed(() => (props.testimonials?.length ?? 0) >= TESTIMONIALS_MAX)

function customize() {
  emit('update:testimonials', campusTestimonialsDraft(props.campusKey))
}

// 自訂內容會不見，所以先確認（取消就維持原樣）。
async function restore() {
  try {
    await ElMessageBox.confirm('恢復內建後，這裡自訂的影片清單會全部拿掉，官網改用內建的影片；要再自訂只能重新設定。', '恢復官網內建的家長影片？', {
      confirmButtonText: '恢復內建',
      cancelButtonText: '先不要',
      type: 'warning',
    })
  } catch {
    return
  }
  emit('update:testimonials', null)
}

// 新的一支加在最後，加完捲過去並聚焦影片網址。
function add() {
  const list = props.testimonials
  if (!list || list.length >= TESTIMONIALS_MAX) return
  list.push(newTestimonial())
  void revealListItem(root.value, `[data-list-item="${list.length - 1}"]`)
}

function remove(index: number) {
  props.testimonials?.splice(index, 1)
}

function move(index: number, delta: number) {
  if (props.testimonials) void moveKeepingFocus(props.testimonials, index, delta, root.value)
}

function builtinPoster(item: TestimonialPayload): string {
  return builtinTestimonialPoster(youtubeIdOf(item.youtube_url))
}

const POSTER_PREVIEWS = [{ label: '官網裁切（16:9）', ratio: '16 / 9' }] as const
</script>

<template>
  <div ref="root" class="voices">
    <template v-if="!customized">
      <p class="voices__state">{{ builtinCount ? `目前沿用官網內建 ${builtinCount} 支` : '目前沿用官網內建：沒有影片' }}</p>
      <span class="field-help">官網關於頁用內建的影片。改成自訂後以這裡的清單為準，內建的就不再使用。</span>
      <el-button :disabled="readOnly" @click="customize">{{ builtinCount ? `改成自訂（帶入目前的 ${builtinCount} 支）` : '改成自訂' }}</el-button>
    </template>
    <template v-else>
      <span v-if="!testimonials!.length" class="field-help voices__empty">
        官網關於頁不會出現這校的影片。五校都沒有影片時，關於頁整個第四章「家長怎麼說」都不會出現。
      </span>
      <div data-list="testimonials" class="voices__list">
        <div v-for="(item, index) in testimonials" :key="index" class="repeat-item" :data-list-item="index">
          <div class="repeat-item__head">
            <span class="repeat-item__index"><b>{{ index + 1 }}</b> {{ item.speaker.trim() || '還沒填稱呼' }}</span>
            <span class="voices__actions">
              <el-button text size="small" :disabled="readOnly || index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移第 ${index + 1} 支影片`" @click="move(index, -1)">上移</el-button>
              <el-button text size="small" :disabled="readOnly || index === testimonials!.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移第 ${index + 1} 支影片`" @click="move(index, 1)">下移</el-button>
              <el-button text size="small" type="danger" :icon="Delete" :disabled="readOnly" :aria-label="`移除第 ${index + 1} 支影片`" @click="remove(index)">移除</el-button>
            </span>
          </div>
          <el-form-item label="YouTube 影片網址" :error="testimonialUrlError(item.youtube_url)">
            <el-input v-model="item.youtube_url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" />
            <span class="field-help">貼影片網址（youtu.be、watch?v=、shorts 都可以）。官網先顯示封面，家長點了才載入 YouTube。</span>
          </el-form-item>
          <div class="field-row">
            <el-form-item label="家長說的話">
              <el-input v-model="item.quote" placeholder="例如：老師把孩子放第一，不是把父母放第一。" />
              <LengthHint :value="item.quote" rule="voiceQuote" />
            </el-form-item>
            <el-form-item label="稱呼">
              <el-input v-model="item.speaker" placeholder="例如：樂樂媽咪" />
              <LengthHint :value="item.speaker" rule="voiceSpeaker" />
            </el-form-item>
          </div>
          <PagePhotoField
            v-model:photo="item.poster"
            v-model:alt="item.poster_alt"
            label="封面"
            :builtin="builtinPoster(item) ? '官網內建的這支影片封面' : 'YouTube 的影片縮圖'"
            :builtin-src="builtinPoster(item)"
            :campus-key="campusKey"
            :previews="POSTER_PREVIEWS"
            help="沒選就用內建封面或 YouTube 縮圖。官網裁成橫式 16:9，重點放中間，或在下面點選焦點。"
            :disabled="readOnly"
          />
        </div>
      </div>
      <div class="voices__foot">
        <el-button :icon="Plus" :disabled="readOnly || full" @click="add">新增一支影片</el-button>
        <span class="field-help">{{ testimonials!.length }} / {{ TESTIMONIALS_MAX }} 支<template v-if="full">。最多 {{ TESTIMONIALS_MAX }} 支，要再加請先移除一支。</template></span>
        <el-button text type="danger" :disabled="readOnly" @click="restore">恢復內建</el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.voices { display: grid; gap: 12px; justify-items: start; }
.voices__state { margin: 0; font-weight: 600; color: var(--ink-2); }
.voices__list { display: grid; justify-self: stretch; }
.voices__actions { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.voices__actions .el-button + .el-button { margin-left: 0; }
.voices__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.voices__foot .el-button + .el-button { margin-left: 0; }
</style>
