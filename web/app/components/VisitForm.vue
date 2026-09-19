<script setup lang="ts">
import type { BookingContent, Campus } from '~/types/site-content'

const props = defineProps<{
  booking: BookingContent
  campuses: Campus[]
  initialCampus?: string
}>()

const form = reactive({
  campus: props.initialCampus || props.campuses[0]?.key || '',
  parentName: '',
  phone: '',
  age: '',
  time: '',
  questions: '',
  consent: false
})

const submitted = ref(false)

function onSubmit() {
  submitted.value = true
}

function reset() {
  submitted.value = false
}

const selectedCampus = computed(() => props.campuses.find((c) => c.key === form.campus))
</script>

<template>
  <section class="visit-page">
    <div class="container">
      <p class="demo-note">{{ booking.demoNote }}</p>

      <form v-if="!submitted" class="booking-form" @submit.prevent="onSubmit">
        <fieldset class="campus-options">
          <legend>{{ booking.fields.find((f) => f.name === 'campus')?.label }}</legend>
          <label v-for="c in campuses" :key="c.key" class="campus-option">
            <input type="radio" name="campus" :value="c.key" v-model="form.campus" required>
            <span><strong>{{ c.name }}</strong><small>{{ c.address }}</small></span>
            <span class="district">{{ c.district }}</span>
          </label>
        </fieldset>

        <div class="field-grid">
          <div class="field">
            <label for="parent-name">家長稱呼<span class="required">必填</span></label>
            <input id="parent-name" v-model="form.parentName" maxlength="40" required placeholder="例如：陳媽媽">
          </div>
          <div class="field">
            <label for="parent-phone">手機號碼<span class="required">必填</span></label>
            <input
              id="parent-phone"
              v-model="form.phone"
              type="tel"
              inputmode="tel"
              maxlength="16"
              required
              pattern="09[0-9]{8}"
              placeholder="09xxxxxxxx"
              aria-describedby="phone-hint"
            >
            <small id="phone-hint">請填寫 09 開頭的 10 碼手機號碼。</small>
          </div>
          <div class="field">
            <label for="child-age">孩子年齡</label>
            <select id="child-age" v-model="form.age">
              <option v-for="opt in booking.fields.find((f) => f.name === 'age')?.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </div>
          <div class="field">
            <label for="contact-time">方便聯絡的時段</label>
            <select id="contact-time" v-model="form.time">
              <option v-for="opt in booking.fields.find((f) => f.name === 'time')?.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </div>
          <div class="field full">
            <label for="questions">有沒有想先了解的事？<span class="required">選填</span></label>
            <textarea id="questions" v-model="form.questions" maxlength="500" placeholder="例如：課程安排、生活照顧、入學準備……" />
          </div>
        </div>

        <label class="consent">
          <input type="checkbox" v-model="form.consent" required>
          <span>{{ booking.consentText }}</span>
        </label>

        <div class="form-buttons">
          <button type="submit" class="button primary">預覽填寫結果</button>
        </div>
      </form>

      <section v-else id="booking-result">
        <div class="result-mark" aria-hidden="true">
          <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-check" /></svg>
        </div>
        <span class="eyebrow">示範結果</span>
        <h2>{{ booking.steps.find((s) => s.id === 'booking-result')?.title }}</h2>
        <p>{{ booking.steps.find((s) => s.id === 'booking-result')?.description }}</p>
        <dl class="result-list">
          <div><dt>想參觀的校區</dt><dd>{{ selectedCampus?.name }}</dd></div>
          <div><dt>家長稱呼</dt><dd>{{ form.parentName }}</dd></div>
          <div><dt>手機號碼</dt><dd>{{ form.phone }}</dd></div>
          <div><dt>孩子年齡</dt><dd>{{ form.age || '未填寫' }}</dd></div>
          <div><dt>方便聯絡時段</dt><dd>{{ form.time || '未填寫' }}</dd></div>
          <div><dt>想了解的事</dt><dd>{{ form.questions.trim() || '未填寫' }}</dd></div>
        </dl>
        <div class="form-buttons">
          <button class="button outline" type="button" @click="reset">修改內容</button>
          <a class="button primary" :href="`tel:${selectedCampus?.phone}`">
            <svg class="icon" aria-hidden="true" focusable="false"><use href="#i-phone" /></svg>致電園所
          </a>
        </div>
        <NuxtLink class="text-link" style="margin-top: 24px" to="/">回到首頁</NuxtLink>
      </section>
    </div>
  </section>
</template>
