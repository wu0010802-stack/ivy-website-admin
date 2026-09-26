import { ABOUT, MOMENTS, SCHEDULE } from './data.js'

const ASSETS = '../../web/public/assets/'
const DEFAULTS = { day: 'next', en: 'b', about: 'b' }
const params = new URLSearchParams(location.search)
const state = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, params.get(key) || DEFAULTS[key]]))

const esc = text => text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const lines = text => text.split('\n').map(esc).join('<br>')

// 一日流程時刻表：提案寫進拍立得的時刻標金色
const USED = new Set(['08:30', '09:10', '11:40', '12:30', '14:20', '15:30', '16:00', '16:10'])
function renderSchedule() {
  document.querySelector('.schedule-list').innerHTML = SCHEDULE.map(([time, label, mark]) => `
    <li class="${state.day === 'next' && USED.has(time) ? 'is-used' : ''} ${mark === 'en' ? 'is-en' : ''}">
      <time>${time}</time><span>${esc(label)}</span>
    </li>`).join('')
}

function renderPrints() {
  const showVoice = state.day === 'next' && state.en !== 'a'
  document.querySelector('.prints').innerHTML = MOMENTS.map((moment, i) => {
    const copy = moment[state.day]
    const no = String(i + 1).padStart(2, '0')
    const voice = showVoice && copy.voice ? `<p class="voice voice-${state.en}" lang="en">“${esc(copy.voice)}”</p>` : ''
    return `
    <li class="pair tint-${moment.tint}">
      <article class="print print-front" aria-label="${no} 正面">
        <span class="tape" aria-hidden="true"></span>
        <figure>
          <img src="${ASSETS}${moment.photo}.webp" alt="${esc(moment.alt)}">
          ${state.en === 'c' ? voice : ''}
          <time class="stamp">${copy.time}</time>
        </figure>
        <div class="foot">
          <p class="print-kicker">${no} / ${esc(copy.label)}</p>
          <h3>${lines(copy.title)}</h3>
          ${state.en === 'b' ? voice : ''}
        </div>
      </article>
      <article class="print print-back" aria-label="${no} 背面">
        <p class="print-kicker">${no} / ${esc(copy.label)}</p>
        <p class="story">${esc(copy.story)}</p>
        <div class="ask">
          <p class="question">${esc(copy.question)}</p>
          <p class="answer">${esc(copy.answer)}</p>
        </div>
        ${copy.src ? `<p class="src">出處：${copy.src.map(esc).join('、')}</p>` : ''}
      </article>
    </li>`
  }).join('')
}

function renderAbout() {
  const a = ABOUT
  const photo = `
    <figure class="about-photo">
      <img src="${ASSETS}${a.photo}.webp" alt="${esc(a.alt)}">
      <figcaption>${esc(a.caption)}</figcaption>
    </figure>`
  const head = `<p class="since" lang="en">${a.since}</p><h2 id="about-title">${esc(a.title)}</h2>`
  const promises = `
    <ol class="promises">
      ${a.promises.map(p => `<li><span class="promise-no" lang="en">${p.no}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`).join('')}
    </ol>`
  const inner = document.querySelector('.about-inner')
  inner.dataset.layout = state.about
  if (state.about === 'now') {
    inner.innerHTML = `<div class="about-main">${head}<p class="about-text">${esc(a.body)}</p></div>${photo}`
  } else if (state.about === 'a') {
    inner.innerHTML = `
      <div class="about-main">${head}<p class="about-text">${esc(a.lead)}</p></div>${photo}
      ${promises}
      <p class="closing">${esc(a.closing)}</p>`
  } else {
    inner.innerHTML = `
      <div class="about-main">${head}<p class="about-text">${esc(a.lead)}</p>${promises}<p class="closing">${esc(a.closing)}</p></div>${photo}`
  }
}

function syncControls() {
  document.querySelectorAll('.control').forEach(group => {
    const key = group.dataset.param
    group.toggleAttribute('data-muted', key === 'en' && state.day === 'now')
    group.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === state[key])))
  })
}

function render() {
  document.body.dataset.day = state.day
  renderSchedule()
  renderPrints()
  renderAbout()
  syncControls()
}

document.querySelector('.controls').addEventListener('click', event => {
  const button = event.target.closest('button[data-value]')
  if (!button) return
  state[button.closest('.control').dataset.param] = button.dataset.value
  const next = new URLSearchParams(state)
  history.replaceState(null, '', `?${next}`)
  render()
})

render()
