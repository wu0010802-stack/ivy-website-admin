<script setup lang="ts">
import { onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { HomeAboutPayload, MediaAssetOut } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import LengthHint from '../components/LengthHint.vue'
import GlyphHint from '../components/GlyphHint.vue'
import MediaSlotField from '../components/MediaSlotField.vue'

const editor = useContentItem<HomeAboutPayload>('home_about', {
  title: '',
  since_label: '',
  body_text: '',
  caption: '',
  photo: null,
  photo_alt: '',
})

function onPickPhoto(asset: MediaAssetOut) {
  if (!editor.form.value.photo_alt && asset.alt_text) editor.form.value.photo_alt = asset.alt_text
}

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>首頁第二屏的理念介紹。標題會用大字顯示，內文分段請用空一行。</template>

    <el-form label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-form-item label="標題">
        <el-input v-model="editor.form.value.title" />
        <LengthHint :value="editor.form.value.title" rule="aboutTitle" />
        <GlyphHint :value="editor.form.value.title" />
      </el-form-item>
      <el-form-item label="創校標籤">
        <el-input v-model="editor.form.value.since_label" placeholder="例如：Since 1997" />
      </el-form-item>
      <el-form-item label="內文">
        <el-input v-model="editor.form.value.body_text" type="textarea" :autosize="{ minRows: 6, maxRows: 16 }" />
        <LengthHint :value="editor.form.value.body_text" rule="aboutBody" />
      </el-form-item>
      <el-form-item label="照片">
        <MediaSlotField
          v-model="editor.form.value.photo"
          builtin="官網內建的孩子與長輩合照"
          builtin-src="/assets/about-together.webp"
          :focus-previews="[{ label: '官網裁切（3:2）', ratio: '3 / 2' }]"
          :disabled="editor.readOnly.value"
          @picked="onPickPhoto"
        />
        <span class="field-help">這一區放一張圓角照片，官網裁成 3:2 橫式，建議寬 1200 以上。</span>
      </el-form-item>
      <el-form-item v-if="editor.form.value.photo" label="照片替代文字">
        <el-input v-model="editor.form.value.photo_alt" maxlength="200" placeholder="例如：孩子們笑著圍在長輩身邊" />
        <span class="field-help">給看不見照片的家長；留空時用素材庫裡這張照片的說明。</span>
      </el-form-item>
      <el-form-item label="照片說明">
        <el-input v-model="editor.form.value.caption" />
        <LengthHint :value="editor.form.value.caption" rule="aboutCaption" />
        <span class="field-help">顯示在孩子照片下方的一句話。</span>
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>
