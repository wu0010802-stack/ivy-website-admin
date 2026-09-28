/* 比稿 D 的頁面互動（2026-09-28）：
   1. 做法切換鈕標出目前選的是哪一種（aria-current）。
   2. 註記在桌機預設展開、手機收合（使用者自己開合後不再改動）。
   3. 回憶牆的身分／校區篩選，只在頁面上切換顯示，不送出任何資料、不顯示則數。
   4. 示範用的 href="#" 連結不跳回頁頂。 */
(function () {
  var root = document.documentElement
  var v = root.dataset.v

  document.querySelectorAll('.switch a').forEach(function (a) {
    if (a.dataset.v === v) a.setAttribute('aria-current', 'page')
  })

  if (window.matchMedia('(min-width: 901px)').matches) {
    document.querySelectorAll('details.notes').forEach(function (d) { d.open = true })
  }

  var state = { role: 'all', campus: 'all' }
  var cards = document.querySelectorAll('.wcard')
  var empty = document.querySelector('.wall-empty')
  function apply() {
    var shown = 0
    cards.forEach(function (c) {
      var ok = (state.role === 'all' || c.dataset.role === state.role) &&
        (state.campus === 'all' || c.dataset.campus === state.campus)
      c.hidden = !ok
      if (ok) shown++
    })
    if (empty) empty.hidden = shown > 0
    document.querySelectorAll('.chips button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(state[b.dataset.f] === b.dataset.val))
    })
    document.querySelectorAll('.selects select').forEach(function (s) { s.value = state[s.dataset.f] })
  }
  document.querySelectorAll('.chips button').forEach(function (b) {
    b.addEventListener('click', function () { state[b.dataset.f] = b.dataset.val; apply() })
  })
  document.querySelectorAll('.selects select').forEach(function (s) {
    s.addEventListener('change', function () { state[s.dataset.f] = s.value; apply() })
  })

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#"]')
    if (a) e.preventDefault()
  })
})()
