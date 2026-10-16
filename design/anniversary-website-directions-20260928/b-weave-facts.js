// 比稿 B：日期連結、顯示差異開關、註記展開、320px 小標實測。
// 切換日期是一般連結（重新載入頁面、直接重畫），沒有任何動畫。
(function () {
  var root = document.documentElement
  var v = root.dataset.v

  // 320px 實測精簡模式：只量小標是不是一行，其他都不做
  if (root.dataset.frame === 'eyebrow') {
    var measure = function () {
      document.querySelectorAll('.fv-row').forEach(function (row) {
        var eb = row.querySelector('.fv-eb')
        var out = row.querySelector('.fv-result')
        var lh = parseFloat(getComputedStyle(eb).lineHeight)
        var lines = Math.round(eb.getBoundingClientRect().height / lh)
        var range = document.createRange()
        range.selectNodeContents(eb)
        var textW = Math.round(range.getBoundingClientRect().width)
        var boxW = Math.round(eb.clientWidth)
        out.className = 'fv-result ' + (lines <= 1 ? 'ok' : 'bad')
        out.textContent = (lines <= 1 ? '一行 ✓' : '換成 ' + lines + ' 行 ✗') + '　字寬 ' + textW + '／可用 ' + boxW + ' px（視窗 ' + window.innerWidth + '）'
      })
    }
    ;(document.fonts ? document.fonts.ready : Promise.resolve()).then(measure)
    window.addEventListener('resize', measure)
    return
  }

  // 日期連結：標出目前日期，並帶上差異開關的狀態
  var dateLinks = document.querySelectorAll('.dates a')
  function syncLinks() {
    var diff = root.dataset.diff === 'on'
    dateLinks.forEach(function (a) {
      var d = a.getAttribute('data-date')
      a.setAttribute('href', '?v=' + d + (diff ? '&diff=1' : ''))
      if (d === v) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
  }
  syncLinks()

  // 顯示差異：aria-pressed 開關，網址同步 ?diff=1，重新整理後保留
  var toggle = document.querySelector('.diff-toggle')
  function syncToggle() { toggle.setAttribute('aria-pressed', root.dataset.diff === 'on' ? 'true' : 'false') }
  syncToggle()
  toggle.addEventListener('click', function () {
    if (root.dataset.diff === 'on') delete root.dataset.diff
    else root.dataset.diff = 'on'
    syncToggle()
    syncLinks()
    var q = new URLSearchParams(location.search)
    q.set('v', v)
    if (root.dataset.diff === 'on') q.set('diff', '1')
    else q.delete('diff')
    history.replaceState(null, '', '?' + q.toString())
  })

  // 註記：桌機預設展開成左欄，手機收成「改了什麼」
  var wide = window.matchMedia('(min-width: 901px)')
  function syncNotes() { document.querySelectorAll('details.notes, details.more').forEach(function (d) { d.open = wide.matches }) }
  syncNotes()
  if (wide.addEventListener) wide.addEventListener('change', syncNotes)

  // 320px 實測 iframe 跟著目前日期
  var frame = document.querySelector('.check-frame')
  var want = '?v=' + v + '&frame=eyebrow'
  if (frame && frame.getAttribute('src') !== want) frame.setAttribute('src', want)

  // 片段裡的按鈕、連結只是畫面示意，點了不跳頁
  document.querySelectorAll('.snip a[href="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault() })
  })
})()
