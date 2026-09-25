<script setup lang="ts">
import { ref } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import type { HomeFilmPayload } from '../api/types'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { HOME_FILMS_MAX, filmClipError, filmYoutubeError, newHomeFilm } from '../composables/homeFilms'
import MediaSlotField from './MediaSlotField.vue'

/**
 * 首頁手機版「活動影片」清單（home_news.films）。null＝官網沿用內建的四支影片
 * 片段；打開「自訂」才改用這裡的清單（至少一支、最多 HOME_FILMS_MAX 支）。
 * 素材庫影片可以只播其中一段（開始～結束秒數），YouTube 貼影片網址即可。
 */
const props = defineProps<{
  films: HomeFilmPayload[] | null | undefined
  readOnly?: boolean
}>()

const emit = defineEmits<{ 'update:films': [value: HomeFilmPayload[] | null] }>()

const root = ref<HTMLElement | null>(null)

function toggle(on: boolean) {
  emit('update:films', on ? [newHomeFilm()] : null)
}

function add() {
  props.films?.push(newHomeFilm())
}

function remove(index: number) {
  props.films?.splice(index, 1)
}

function move(index: number, delta: number) {
  if (props.films) void moveKeepingFocus(props.films, index, delta, root.value)
}
</script>

<template>
  <div ref="root" class="films">
    <el-switch
      :model-value="Array.isArray(films)"
      :disabled="readOnly"
      active-text="自訂影片清單（關閉時官網沿用內建的四支活動影片片段）"
      @update:model-value="toggle(Boolean($event))"
    />
    <template v-if="films">
      <div v-for="(film, index) in films" :key="index" class="repeat-item">
        <div class="repeat-item__head">
          <span class="repeat-item__index"><b>{{ index + 1 }}</b> {{ film.title || '未命名影片' }}</span>
          <span class="films__actions">
            <el-button text size="small" :disabled="readOnly || index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移「${film.title || `第 ${index + 1} 支`}」`" @click="move(index, -1)">上移</el-button>
            <el-button text size="small" :disabled="readOnly || index === films.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移「${film.title || `第 ${index + 1} 支`}」`" @click="move(index, 1)">下移</el-button>
            <el-button text size="small" type="danger" :icon="Delete" :disabled="readOnly || films.length <= 1" @click="remove(index)">移除</el-button>
          </span>
        </div>
        <div class="field-row">
          <el-form-item label="影片名稱（不顯示，給螢幕閱讀器念）">
            <el-input v-model="film.title" maxlength="40" show-word-limit placeholder="例如：一起跑向前" />
          </el-form-item>
          <el-form-item label="來源">
            <el-radio-group v-model="film.source">
              <el-radio-button value="file">素材庫影片</el-radio-button>
              <el-radio-button value="youtube">YouTube</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </div>
        <template v-if="film.source === 'file'">
          <el-form-item label="影片">
            <MediaSlotField v-model="film.video" kind="video" builtin="（請選一支影片）" :focus="false" :disabled="readOnly" />
          </el-form-item>
          <div class="field-row">
            <el-form-item label="從第幾秒開始">
              <el-input-number v-model="film.start" :min="0" :max="3600" :step="0.1" :precision="1" controls-position="right" />
            </el-form-item>
            <el-form-item label="播到第幾秒（留空＝播到結尾）" :error="filmClipError(film)">
              <el-input-number v-model="film.end" :min="0.1" :max="3600" :step="0.1" :precision="1" :value-on-clear="null" controls-position="right" />
            </el-form-item>
          </div>
        </template>
        <el-form-item v-else label="YouTube 影片網址" :error="filmYoutubeError(film)">
          <el-input v-model="film.youtube_url" placeholder="https://youtu.be/…" />
          <span class="field-help">官網先顯示縮圖，家長點了才載入 YouTube。</span>
        </el-form-item>
        <el-form-item label="封面照片（選填）">
          <MediaSlotField
            v-model="film.poster"
            :builtin="film.source === 'youtube' ? 'YouTube 的縮圖' : '影片自動擷取的畫面'"
            :focus="false"
            :disabled="readOnly"
          />
        </el-form-item>
      </div>
      <el-button :icon="Plus" :disabled="readOnly || films.length >= HOME_FILMS_MAX" @click="add">新增一支影片</el-button>
      <span class="field-help">{{ films.length }} / {{ HOME_FILMS_MAX }} 支</span>
    </template>
  </div>
</template>

<style scoped>
.films { display: grid; gap: 12px; justify-items: start; }
.films > .repeat-item { justify-self: stretch; }
.films__actions { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.films__actions .el-button + .el-button { margin-left: 0; }
</style>
