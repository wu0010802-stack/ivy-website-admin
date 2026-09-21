(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const direction = ['a', 'b', 'c'].includes(params.get('direction')) ? params.get('direction') : 'a';
  const campuses = window.CAMPUS_DATA;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const native = CSS.supports('animation-timeline:view()') && CSS.supports('animation-range:contain 0% contain 100%') && !params.has('fallback');
  const body = document.body;
  body.classList.add(`direction-${direction}`);
  body.classList.toggle('native', native);
  document.title = `${direction.toUpperCase()} ${ {a:'全景換幕',b:'左右分景',c:'橫向校園長廊'}[direction] }｜分校捲動提案`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const icon = name => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}" /></svg>`;
  const number = i => String(i + 1).padStart(2, '0');
  const english = campus => `${campus.key.toUpperCase()} CAMPUS`;
  const details = campus => `<dl class="contact"><div><dt>${icon('map-pin')}校園位置</dt><dd><a class="address-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(campus.address)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(campus.address)}，在 Google 地圖開啟（另開分頁）"><span>${esc(campus.address)}</span>${icon('arrow-up-right')}</a></dd></div><div><dt>${icon('phone')}參觀專線</dt><dd><a class="phone-link" href="tel:${esc(campus.phone)}">${esc(campus.phone)}</a></dd></div></dl>`;
  const socials = campus => `<div class="socials">${campus.line ? `<a href="${esc(campus.line)}" target="_blank" rel="noopener noreferrer">${icon('line')}LINE 好友</a>` : `<span>${icon('line')}LINE <small>待補</small></span>`}${campus.facebook ? `<a href="${esc(campus.facebook)}" target="_blank" rel="noopener noreferrer">${icon('facebook')}Facebook</a>` : `<span>${icon('facebook')}Facebook <small>待補</small></span>`}</div>`;
  const booking = () => `<span class="booking-status" role="note">${icon('calendar-check')}目前暫停參觀預約</span>`;
  const photo = campus => `<img src="../../assets/${esc(campus.image)}.webp" alt="${esc(campus.name)}校園外觀" style="--photo-pos:${esc(campus.panoramaPos || 'center 55%')}" decoding="async">`;
  const name = campus => `<span class="eyebrow">高雄 · ${esc(campus.district)}</span><h2>${esc(campus.name)}</h2><span class="name-en" lang="en">${english(campus)}</span>`;
  const templates = {
    a: (c, i) => `<figure class="a-photo">${photo(c)}<figcaption class="a-photo-label"><span>${number(i)}</span>五所校園，同一份用心</figcaption></figure><div class="a-info"><div class="a-name">${name(c)}</div><div class="a-contact">${details(c)}${socials(c)}</div><div class="a-action">${booking()}<p class="status-note">歡迎關注校園最新消息</p></div></div>`,
    b: (c, i) => `<div class="b-photo-window"><figure class="b-photo">${photo(c)}<figcaption class="b-photo-caption"><span>${number(i)}</span>${esc(c.name)} · 校園一隅</figcaption></figure></div><div class="b-copy">${name(c)}${details(c)}${socials(c)}${booking()}</div>`,
    c: (c, i) => `<div class="c-copy"><span class="campus-number" aria-hidden="true">${number(i)}</span>${name(c)}${details(c)}${socials(c)}${booking()}</div><figure class="c-photo">${photo(c)}<figcaption class="c-photo-caption"><span>${esc(c.name)} · ${esc(c.district)}</span>${icon('arrow-right')}</figcaption></figure>`
  };
  const scenesRoot = document.querySelector('#scenes');
  scenesRoot.innerHTML = campuses.map((c, i) => `<article class="scene" id="campus-${c.key}" aria-label="${esc(c.name)}" data-index="${i}" style="--start:${(i - .45) / 4 * 100}%;--end:${i / 4 * 100}%">${templates[direction](c, i)}</article>`).join('');
  const nav = document.querySelector('.campus-nav');
  nav.innerHTML = campuses.map((c, i) => `<button type="button" data-campus="${i}" aria-controls="campus-${c.key}"><span>${number(i)}</span>${esc(c.name)}</button>`).join('');
  const scenes = [...scenesRoot.children];
  const buttons = [...nav.children];
  const journey = document.querySelector('.journey');
  const stage = document.querySelector('.stage');
  const cue = document.querySelector('.cue-label');
  const counter = document.querySelector('.counter');
  const live = document.querySelector('#campus-live');
  const clamp = n => Math.max(0, Math.min(1, n));
  let active = -1;
  let raf = 0;
  let viewportHeight = 0;
  let start = 0;
  let distance = 0;
  let observer;

  function setActive(index) {
    if (active === index) return;
    active = index;
    body.dataset.activeCampus = campuses[index].key;
    scenes.forEach((scene, i) => {
      scene.classList.toggle('is-current', i === index);
      scene.inert = !media.matches && i !== index;
      if (media.matches || i === index) scene.removeAttribute('aria-hidden');
      else scene.setAttribute('aria-hidden', 'true');
    });
    buttons.forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
    counter.textContent = `${number(index)} / 05`;
    cue.textContent = index === 4 ? '繼續往下，看看最新消息' : direction === 'c' ? '向下捲動，橫向走訪校園' : '往下探索五所校園';
    live.textContent = `${campuses[index].name}，第 ${index + 1} 所，共五所校園`;
  }

  function update() {
    raf = 0;
    if (media.matches) return;
    const progress = clamp((scrollY - start) / distance);
    const position = progress * 4;
    setActive(Math.min(4, Math.floor(position + .225)));
    stage.style.setProperty('--progress', String((position + 1) / 5));
    if (!native) {
      if (direction === 'c') {
        const step = Math.floor(position);
        const advance = step + clamp((position - step - .55) / .45);
        scenesRoot.style.transform = `translateX(${-advance * 20}%)`;
      } else {
        scenes.forEach((scene, i) => {
          if (!i) return;
          const element = direction === 'a' ? scene : scene.querySelector('.b-photo');
          element.style.transform = `translateY(${(1 - clamp((position - (i - .45)) / .45)) * 100}%)`;
        });
      }
    }
    parent.postMessage({type:'campus-demo-progress', direction, index:active, progress}, location.origin);
  }
  function queue() { if (!raf) raf = requestAnimationFrame(update); }
  function measure() {
    viewportHeight = Math.max(innerHeight, innerWidth <= 760 ? 700 : 680);
    stage.style.setProperty('--vh', `${viewportHeight}px`);
    journey.style.height = `${viewportHeight * 5.5}px`;
    start = journey.getBoundingClientRect().top + scrollY;
    distance = journey.offsetHeight - viewportHeight;
    queue();
  }
  function jumpTo(index) {
    const target = media.matches ? scenes[index].getBoundingClientRect().top + scrollY : start + distance * index / 4;
    window.scrollTo({top:target, behavior:media.matches ? 'instant' : 'smooth'});
  }
  buttons.forEach((button, i) => button.addEventListener('click', () => jumpTo(i)));
  nav.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === 'ArrowRight' ? Math.min(4, index + 1) : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? 4 : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus();
    jumpTo(next);
  });
  document.querySelector('.restart').addEventListener('click', () => jumpTo(0));
  function reducedChanged() {
    body.classList.toggle('reduced', media.matches);
    if (observer) observer.disconnect();
    active = -1;
    if (media.matches) {
      scenes.forEach(scene => {scene.inert = false; scene.removeAttribute('aria-hidden');});
      observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(Number(visible.target.dataset.index));
      }, {threshold:[.3,.6]});
      scenes.forEach(scene => observer.observe(scene));
    }
    measure();
    if (!media.matches) update();
  }
  window.addEventListener('scroll', queue, {passive:true});
  window.addEventListener('resize', measure, {passive:true});
  media.addEventListener('change', reducedChanged);
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type === 'campus-demo-jump') jumpTo(Math.max(0, Math.min(4, Number(event.data.index) || 0)));
  });
  reducedChanged();
})();
