/* 比稿 C：方案切換列標目前方案；首頁消息的暫停鍵只切換狀態（這張 mock 不自動換組，也沒有動畫）。 */
(function () {
  var v = document.documentElement.dataset.v
  document.querySelectorAll('.switcher a').forEach(function (a) {
    if (a.getAttribute('data-v') === v) a.setAttribute('aria-current', 'page')
  })

  // 手機只看網站畫面：說明（註記、營運卡、待裁定）預設收起，點開仍可讀
  if (window.matchMedia('(max-width: 760px)').matches) {
    document.querySelectorAll('details.m-fold').forEach(function (d) { d.removeAttribute('open') })
  }

  var btn = document.querySelector('[data-pause]')
  if (!btn) return
  var label = btn.querySelector('[data-pause-label]')
  var use = btn.querySelector('use')
  var progress = document.querySelector('.hn-progress')
  btn.addEventListener('click', function () {
    var paused = btn.getAttribute('data-state') !== 'paused'
    btn.setAttribute('data-state', paused ? 'paused' : 'playing')
    use.setAttribute('href', paused ? '#i-play' : '#i-pause')
    label.textContent = paused ? '繼續播放消息輪播' : '暫停消息輪播'
    if (progress) progress.toggleAttribute('data-paused', paused)
  })
})()
