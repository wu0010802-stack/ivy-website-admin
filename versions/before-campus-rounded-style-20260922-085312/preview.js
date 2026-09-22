const root = document.querySelector('.campus-gallery');
const media = matchMedia('(prefers-reduced-motion: reduce)');
const slideDuration = 4000;
const icons = {
  line: '<path fill="currentColor" d="M19.365 9.863a.631.631 0 0 1 0 1.261H17.61v1.125h1.755a.63.63 0 1 1 0 1.259h-2.386a.63.63 0 0 1-.627-.629V8.108c0-.345.282-.63.63-.63h2.386a.63.63 0 0 1-.003 1.26H17.61v1.125zm-3.855 3.016a.63.63 0 0 1-.631.627a.62.62 0 0 1-.51-.25l-2.443-3.317v2.94a.63.63 0 0 1-1.257 0V8.108a.627.627 0 0 1 .624-.628c.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63c.345 0 .63.285.63.63zm-5.741 0a.63.63 0 0 1-.631.629a.63.63 0 0 1-.627-.629V8.108c0-.345.282-.63.63-.63c.346 0 .628.285.628.63zm-2.466.629H4.917a.634.634 0 0 1-.63-.629V8.108c0-.345.285-.63.63-.63c.348 0 .63.285.63.63v4.141h1.756a.63.63 0 0 1 0 1.259M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608c.391.082.923.258 1.058.59c.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645c1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>',
  facebook: '<path fill="currentColor" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978c.401 0 .955.042 1.468.103a9 9 0 0 1 1.141.195v3.325a9 9 0 0 0-.653-.036a27 27 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.7 1.7 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103l-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647"/>',
  arrow: '<path d="m221.66 133.66-72 72a8 8 0 0 1-11.32-11.32L196.69 136H40a8 8 0 0 1 0-16h156.69l-58.35-58.34a8 8 0 0 1 11.32-11.32l72 72a8 8 0 0 1 0 11.32Z"/>',
  pause: '<path d="M96 32H64a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h32a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16Zm0 176H64V48h32ZM192 32h-32a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h32a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16Zm0 176h-32V48h32Z"/>',
  play: '<path d="m232.3 114.27-144-88A16 16 0 0 0 64 40v176a16 16 0 0 0 24.3 13.65l144-88a16 16 0 0 0 0-27.3ZM80 216V40l144 88Z"/>',
  pin: '<path d="M128 16a88.1 88.1 0 0 0-88 88c0 75.3 80 132.18 83.41 134.56a8 8 0 0 0 9.18 0C136 236.18 216 179.3 216 104a88.1 88.1 0 0 0-88-88Zm0 206c-17.57-13.67-72-60.54-72-118a72 72 0 0 1 144 0c0 57.46-54.43 104.33-72 118Zm0-158a40 40 0 1 0 40 40 40 40 0 0 0-40-40Zm0 64a24 24 0 1 1 24-24 24 24 0 0 1-24 24Z"/>',
  phone: '<path d="m222.37 158.46-47.11-21.11a16 16 0 0 0-15.18 1.4l-22.92 15.28a112.58 112.58 0 0 1-35.28-35.28l15.28-22.92a16 16 0 0 0 1.4-15.18L97.45 33.54a16 16 0 0 0-16.64-9.4A64.27 64.27 0 0 0 24 88c0 79.4 64.6 144 144 144a64.27 64.27 0 0 0 63.86-56.81 16 16 0 0 0-9.49-16.73ZM168 216A128.14 128.14 0 0 1 40 88a48.27 48.27 0 0 1 42.87-47.91L104 87.2l-15.28 22.91a16 16 0 0 0-.54 16.88 128.42 128.42 0 0 0 40.83 40.83 16 16 0 0 0 16.88-.54L168.8 152l47.11 21.13A48.27 48.27 0 0 1 168 216Z"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 ${name === 'line' || name === 'facebook' ? '24 24' : '256 256'}" aria-hidden="true">${icons[name]}</svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function init() {
  const response = await fetch('../../web/server/data/site-fixture.json');
  if (!response.ok) throw new Error('無法讀取校園預覽資料');
  const data = await response.json();
  const campuses = data.home.campusBoard.campusOrder.map(key => data.campuses.find(c => c.key === key)).filter(Boolean);
  const tabs = root.querySelector('.campus-tabs');
  const track = root.querySelector('.gallery-track');
  const pagination = root.querySelector('.pagination');
  const playback = root.querySelector('.playback');
  const details = root.querySelector('#campus-details');
  let index = 0, paused = media.matches, hover = false, focused = false, visible = true, elapsed = 0, previousTime = 0, pointerStart = null;

  campuses.forEach((c, i) => {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.id = `campus-tab-${c.key}`; tab.role = 'tab';
    tab.setAttribute('aria-controls', 'campus-details'); tab.textContent = c.name;
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? campuses.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); select(next); tabs.children[index].focus();
    });
    tabs.append(tab);
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'photo-card'; card.setAttribute('aria-label', `選擇${c.name}`);
    card.innerHTML = `<img src="../../web/public/assets/${escapeHtml(c.image)}.webp" alt="${escapeHtml(c.name)}校園外觀" style="object-position:${escapeHtml(c.panoramaPos || 'center 55%')}" decoding="async" draggable="false">`;
    card.addEventListener('click', () => { if (card.dataset.dragged !== 'true') select(i); });
    track.append(card);
    const dot = document.createElement('button'); dot.type = 'button'; dot.className = 'page-dot';
    dot.setAttribute('aria-label', `切換至${c.name}`); dot.setAttribute('aria-controls', 'campus-details');
    dot.innerHTML = '<span class="progress-track" aria-hidden="true"><i></i></span>';
    dot.addEventListener('click', () => select(i)); pagination.append(dot);
  });

  function select(next, automatic = false) {
    index = (next + campuses.length) % campuses.length; elapsed = 0;
    const c = campuses[index]; root.dataset.campus = c.key;
    [...track.children].forEach((card, i) => {
      let offset = (i - index + campuses.length) % campuses.length;
      if (offset > Math.floor(campuses.length / 2)) offset -= campuses.length;
      const oldOffset = Number(card.style.getPropertyValue('--offset'));
      card.classList.toggle('is-repositioning', Math.abs(offset - oldOffset) > 1);
      card.style.setProperty('--offset', offset); card.classList.toggle('is-current', i === index);
      card.tabIndex = i === index ? 0 : -1;
      card.setAttribute('aria-label', i === index ? `${c.name}校園照片` : `選擇${campuses[i].name}`);
      card.setAttribute('aria-hidden', String(Math.abs(offset) > 1));
      tabs.children[i].setAttribute('aria-selected', String(i === index)); tabs.children[i].tabIndex = i === index ? 0 : -1;
      pagination.children[i].setAttribute('aria-pressed', String(i === index));
      pagination.children[i].querySelector('i').style.transform = 'scaleX(0)';
    });
    details.setAttribute('aria-labelledby', `campus-tab-${c.key}`);
    const campusUrl = `http://127.0.0.1:3010/campuses/${encodeURIComponent(c.key)}`;
    details.innerHTML = `<div class="campus-identity"><small>高雄 · ${escapeHtml(c.district)}</small><h2><a href="${campusUrl}">${escapeHtml(c.name)}</a></h2><span lang="en">${escapeHtml(c.key.toUpperCase())} CAMPUS</span></div>
      <div class="campus-contact"><div class="contact-row">${icon('pin')}<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.address)} ↗</a></div><div class="contact-row">${icon('phone')}<a class="phone" href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></div><div class="social-row">${c.line ? `<a href="${escapeHtml(c.line)}" target="_blank" rel="noopener noreferrer">${icon('line')}LINE 好友</a>` : `<span>${icon('line')}LINE · 待園方提供</span>`}${c.key === 'yihua' && c.facebook ? `<a href="${escapeHtml(c.facebook)}" target="_blank" rel="noopener noreferrer">${icon('facebook')}Facebook</a>` : ''}</div></div>
      <div class="campus-actions"><a class="booking-link" href="http://127.0.0.1:3010/visit/${encodeURIComponent(c.key)}">預約參觀${escapeHtml(c.name)} ${icon('arrow')}</a></div>`;
    if (!automatic) root.querySelector('#campus-live').textContent = `目前顯示${c.name}，${c.district}`;
  }
  function renderPlayback() {
    playback.innerHTML = icon(paused ? 'play' : 'pause');
    playback.setAttribute('aria-label', paused ? '開始自動播放' : '暫停自動播放');
    playback.title = paused ? '開始自動播放' : '暫停自動播放';
    root.dataset.paused = String(paused);
  }
  playback.addEventListener('click', () => { paused = !paused; renderPlayback(); });
  media.addEventListener('change', () => { paused = media.matches; renderPlayback(); });
  root.addEventListener('pointerover', event => { if(event.pointerType === 'mouse') hover = !event.target.closest('.playback-controls'); });
  root.addEventListener('pointerleave', () => { hover = false; });
  root.addEventListener('focusin', event => { focused = event.target.matches(':focus-visible') && !event.target.closest('.playback'); });
  root.addEventListener('focusout', event => { focused = event.relatedTarget instanceof Element && root.contains(event.relatedTarget) && event.relatedTarget.matches(':focus-visible') && !event.relatedTarget.closest('.playback'); });
  const viewport = root.querySelector('.gallery-viewport');
  viewport.addEventListener('pointerdown', event => {
    pointerStart = {x:event.clientX, y:event.clientY};
    [...track.children].forEach(c => { c.dataset.dragged = 'false'; });
  });
  viewport.addEventListener('pointerup', event => {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      [...track.children].forEach(c => { c.dataset.dragged = 'true'; });
      select(index + (dx < 0 ? 1 : -1));
    }
    pointerStart = null;
  });
  viewport.addEventListener('pointercancel', () => { pointerStart = null; });
  new IntersectionObserver(entries => { const entry = entries.at(-1); visible = entry.isIntersecting && entry.intersectionRatio >= .35; }, {threshold:.35}).observe(root);
  function tick(time) {
    const delta = previousTime ? Math.min(time - previousTime, 100) : 0; previousTime = time;
    const playing = !paused && !document.hidden && visible && !hover && !focused;
    root.dataset.playing = String(playing);
    if (playing) { elapsed += delta; if (elapsed >= slideDuration) select(index + 1, true); }
    pagination.children[index].querySelector('i').style.transform = `scaleX(${paused ? 1 : elapsed / slideDuration})`;
    requestAnimationFrame(tick);
  }
  select(0); renderPlayback(); requestAnimationFrame(tick);
}
init().catch(error => {
  document.querySelector('#campus-details').textContent = `${error.message}，請透過本機 HTTP 預覽開啟。`;
  console.error(error);
});
