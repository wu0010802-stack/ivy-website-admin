<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import { useCampusContent } from '../composables/useCampusContent'
import type { CampusProfilePayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import CampusSelect from '../components/CampusSelect.vue'

const campus = ref('')
const editor = useContentItem<CampusProfilePayload>(
  'campus_profile',
  {
    name: '',
    district: '',
    address: '',
    phone: '',
    intro: '',
    description: '',
    facebook: '',
    fb_note: '',
    line: '',
  },
  campus,
)
const shell = useTemplateRef<InstanceType<typeof ContentEditor>>('shell')
const { visibleCampusKeys } = useCampusContent(editor, campus, shell)
</script>

<template>
  <ContentEditor
    ref="shell"
    :editor="editor"
    :placeholder="visibleCampusKeys.length === 0 ? '你的帳號沒有可編輯的校區。' : undefined"
  >
    <template #lead>各校在首頁五校區塊、分校頁與頁尾顯示的基本資料。留空的社群連結官網會顯示「待補」。</template>
    <template #toolbar>
      <CampusSelect v-model="campus" :keys="visibleCampusKeys" />
    </template>

    <el-form label-position="top" @submit.prevent>
      <div class="field-row">
        <el-form-item label="校名">
          <el-input v-model="editor.form.value.name" placeholder="例如：義華校" />
        </el-form-item>
        <el-form-item label="行政區">
          <el-input v-model="editor.form.value.district" placeholder="例如：鳳山區" />
        </el-form-item>
      </div>
      <el-form-item label="地址">
        <el-input v-model="editor.form.value.address" />
      </el-form-item>
      <el-form-item label="參觀專線">
        <el-input v-model="editor.form.value.phone" placeholder="07-000-0000" />
      </el-form-item>
      <el-form-item label="一句話簡介">
        <el-input v-model="editor.form.value.intro" maxlength="40" show-word-limit />
      </el-form-item>
      <el-form-item label="詳細介紹">
        <el-input v-model="editor.form.value.description" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }" />
      </el-form-item>

      <h3 class="form-section">社群</h3>
      <el-form-item label="Facebook 粉絲專頁網址">
        <el-input v-model="editor.form.value.facebook" placeholder="https://www.facebook.com/…" />
      </el-form-item>
      <el-form-item label="Facebook 備註">
        <el-input v-model="editor.form.value.fb_note" placeholder="例如：活動照片與公告" />
      </el-form-item>
      <el-form-item label="LINE 官方帳號網址">
        <el-input v-model="editor.form.value.line" placeholder="https://lin.ee/…" />
        <span class="field-help">留空代表這一校尚未提供，官網會顯示待補，不會帶入其他校的帳號。</span>
      </el-form-item>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.form-section {
  margin: 16px 0 12px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}
</style>
