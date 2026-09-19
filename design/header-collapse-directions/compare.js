(() => {
  const options = {
    a: ['同組收合', '離開首屏時四個導覽項目滑進三條線，和「預約參觀」併成同一組；頁首縮成 72px 米白底。點三條線開右上下拉小卡。最接近現有主站。'],
    b: ['浮動膠囊', '整條頁首讓位，改由置頂居中的米白膠囊接手（校徽＋校名、選單、預約）。點「選單」時卡片直接從膠囊下緣長出來。'],
    c: ['極簡列＋全幕選單', '頁首壓到 64px 毛玻璃，只留校徽、綠底預約膠囊與一顆圓漢堡。點開是深綠全幕選單，從漢堡位置擴散，四個大字項目依序浮出。'],
  };
  const hash = location.hash.slice(1);
  let direction = Object.hasOwn(options, hash) ? hash : 'b';
  let device = 'desktop';
  let reduced = false;
  const frame = document.querySelector('#preview');
  const status = document.querySelector('#status');
  let size = 'm', tone = 'deep';
  const src = () => `view.html?direction=${direction}${direction === 'b' ? `&size=${size}&tone=${tone}` : ''}${reduced ? '&reduced=1' : ''}`;

  function update() {
    const [title, note] = options[direction];
    document.querySelectorAll('[data-direction]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.direction === direction)));
    document.querySelectorAll('[data-device]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.device === device)));
    document.querySelector('#direction-title').textContent = `${direction.toUpperCase()}／${title}`;
    document.querySelector('#direction-note').textContent = note;
    if (frame.getAttribute('src') !== src()) { frame.src = src(); status.textContent = '目前：首屏'; }
    frame.classList.toggle('mobile', device === 'mobile');
    frame.title = `${direction.toUpperCase()} ${title} ${device === 'mobile' ? '手機' : '桌面'} mock-up`;
    document.querySelector('#standalone').href = src();
    document.querySelector('#b-controls').hidden = direction !== 'b';
    history.replaceState(null, '', `#${direction}`);
  }
  const send = action => frame.contentWindow && frame.contentWindow.postMessage({ type: 'ivy-header', action }, '*');

  document.querySelectorAll('[data-direction]').forEach(b => b.addEventListener('click', () => { direction = b.dataset.direction; update(); }));
  document.querySelectorAll('[data-device]').forEach(b => b.addEventListener('click', () => { device = b.dataset.device; update(); }));
  document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => send(b.dataset.action)));
  document.querySelector('#reduced').addEventListener('change', e => { reduced = e.target.checked; update(); });
  document.querySelector('#b-size').addEventListener('change', e => { size = e.target.value; update(); });
  document.querySelector('#b-tone').addEventListener('change', e => { tone = e.target.value; update(); });
  addEventListener('message', e => {
    const d = e.data;
    if (!d || d.type !== 'ivy-header-state') return;
    status.textContent = `目前：${d.state === 'hero' ? '首屏' : '已收合'}${d.menu ? '・選單開啟' : ''}`;
  });
  // 發佈成 Artifact 時沒有主站可回，藏起回首頁連結。
  if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) { document.querySelectorAll('.review-home').forEach(a => a.remove()); document.querySelector('.review-brand').removeAttribute('href'); }
  update();
})();
