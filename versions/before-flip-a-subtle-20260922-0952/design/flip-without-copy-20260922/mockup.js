const directions = [
  { key: 'a', title: '掀起一角', subtitle: '把「背面」直接露出來', tag: '推薦', description: '<strong>用紙張本身邀請點擊。</strong><br>放大真切角、露出橫線紙；首次入鏡輕掀一次，移入再抬起。' },
  { key: 'b', title: '正反雙面', subtitle: '用圖形說明兩種狀態', description: '<strong>照片與故事，一眼看見兩面。</strong><br>相紙上直接印雙面小圖，弧形箭頭串起正反；移入時兩面微轉。' },
  { key: 'c', title: '側邊露背', subtitle: '像一張正被拿起的相片', description: '<strong>讓整段紙邊帶出可翻的感覺。</strong><br>右側捲起，常駐露出背面紋理；移入再輕彎，點擊後展開故事。' },
];
const arrow = '<svg class="icon" aria-hidden="true"><use href="#turn-arrow"/></svg>';
function cue(key) {
  if (key === 'a') return `<span class="cue curl" aria-hidden="true"><svg viewBox="0 0 100 100"><defs><linearGradient id="curl-light" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--reverse)" stop-opacity="0"/><stop offset=".6" stop-color="var(--fold-tone)" stop-opacity=".18"/><stop offset="1" stop-color="var(--fold-tone)" stop-opacity=".9"/></linearGradient><clipPath id="curl-shape"><path d="M0 0Q41 11 100 0L0 100Q11 43 0 0Z"/></clipPath></defs><path class="curl-paper" d="M0 0Q41 11 100 0L0 100Q11 43 0 0Z"/><g clip-path="url(#curl-shape)"><path class="curl-line" d="M0 18H100M0 34H100M0 50H100M0 66H100M0 82H100"/><path class="curl-shade" d="M0 0H100V100H0Z"/></g><path class="curl-edge" d="M100 0Q48 43 0 100"/></svg></span>`;
  if (key === 'b') return `<span class="cue duplex" aria-hidden="true">${arrow}<span class="mini-card mini-photo"></span><span class="mini-card mini-back"></span><svg class="icon lower"><use href="#turn-arrow"/></svg></span>`;
  return `<span class="cue edge-curl" aria-hidden="true">${arrow}</span>`;
}
document.querySelector('.directions').innerHTML = directions.map(d => `
  <article class="direction" data-direction="${d.key}" aria-labelledby="heading-${d.key}">
    <div class="direction-head"><span class="letter" aria-hidden="true">${d.key.toUpperCase()}</span><div><h2 id="heading-${d.key}">${d.title}</h2><p>${d.subtitle}</p></div>${d.tag ? `<span class="recommend">${d.tag}</span>` : ''}</div>
    <div class="photo-stage"><div class="card variant-${d.key}">
      <div class="rotator">
        <div class="face front"><figure class="photo"><img src="../../web/public/assets/day-hello.webp" width="810" height="600" alt="孩子在熟悉的環境裡，與身旁的人互動"><figcaption>陪伴互動 · 入園情境示意</figcaption><time datetime="08:00">08:00</time></figure><p class="kicker">01 / 早安入園</p><h3>早安，今天的我<br>準備好了。</h3></div>
        <div class="face back" id="story-${d.key}" inert><p class="kicker">01 / 早安入園</p><p class="story">和家人說聲再見，走進熟悉的校園。從整理小書包開始，一點一點，找到自己的步調。</p><p class="question">孩子第一次上學，如何陪伴適應？</p><p class="answer">參觀時可以與園所聊聊：初次入園的陪伴方式、家長如何與老師聯繫，以及可以事先做哪些準備。</p></div>
      </div>
      ${cue(d.key)}
      <button class="turn" type="button" aria-label="${d.key.toUpperCase()} 版：查看早安入園的背面故事" aria-expanded="false" aria-controls="story-${d.key}"></button>
    </div></div>
    <div class="description"><span class="index" aria-hidden="true">0${directions.indexOf(d) + 1}</span><p>${d.description}</p></div>
  </article>`).join('');

const selected = new URLSearchParams(location.search).get('view');
const view = ['a', 'b', 'c'].includes(selected) ? selected : 'all';
document.body.dataset.view = view;
document.querySelector(`.intro-aside [data-view="${view}"]`).setAttribute('aria-current', 'page');
document.querySelectorAll('.direction').forEach(el => { el.hidden = view !== 'all' && el.dataset.direction !== view; });
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const cards = [...document.querySelectorAll('.card')];
for (const card of cards) {
  card.querySelector('.turn').addEventListener('click', () => {
    card.classList.remove('is-intro');
    const flipped = card.classList.toggle('is-flipped');
    card.querySelector('.front').inert = flipped;
    card.querySelector('.back').inert = !flipped;
    const button = card.querySelector('.turn');
    button.setAttribute('aria-expanded', String(flipped));
    button.setAttribute('aria-label', `${card.closest('.direction').dataset.direction.toUpperCase()} 版：${flipped ? '回到早安入園照片' : '查看早安入園的背面故事'}`);
  });
  card.addEventListener('animationend', () => card.classList.remove('is-intro'));
}
function showCue(card) {
  if (reduced.matches || card.classList.contains('is-flipped')) return;
  card.classList.remove('is-intro');
  void card.offsetWidth;
  card.classList.add('is-intro');
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    showCue(entry.target);
    observer.unobserve(entry.target);
  }
}, { threshold: .7 });
cards.forEach(card => observer.observe(card));
document.querySelector('.replay').addEventListener('click', () => cards.forEach(showCue));
function applyMotionPreference() {
  document.querySelector('.replay').disabled = reduced.matches;
  if (reduced.matches) cards.forEach(card => card.classList.remove('is-intro'));
}
reduced.addEventListener('change', applyMotionPreference);
applyMotionPreference();
