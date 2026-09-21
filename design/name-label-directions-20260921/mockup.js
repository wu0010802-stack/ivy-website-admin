const icon = '<svg class="icon" viewBox="0 0 256 256" aria-hidden="true"><use href="#flip-arrow"></use></svg>';
const options = [
  { id: 'b1', number: 'B1', name: '經典綠框貼', subtitle: '最接近原本的 B，安靜又熟悉。', type: 'classic', material: '奶油白紙 × 墨綠細框', dimensions: '80 × 48', benefit: '照片仍是主角。', description: '小張綠框貼保留手貼的微歪與翹角，只留下翻面圖示，視覺最輕。', interaction: '滑過時紙角微微翹起；下方固定提示補足純圖示的意思。' },
  { id: 'b2', number: 'B2', name: '雙欄姓名貼', subtitle: '把熟悉的姓名欄，換成故事入口。', type: 'split', material: '雙欄印刷 × 深綠圖示格', dimensions: '125 × 50', benefit: '第一次來，也知道可以點。', description: '短短的「看故事」搭配圖示，翻面後變成「看照片」，每一步都有清楚的方向。', interaction: '整張姓名貼都是按鈕；左右兩欄不會分成兩個點擊區。', recommended: true },
  { id: 'b3', number: 'B3', name: '卡邊索引貼', subtitle: '像貼在繪本邊緣，等你翻開。', type: 'index', material: '鼠尾草綠 × 圓角索引耳', dimensions: '70 × 56', benefit: '把翻頁的直覺，放在卡片邊緣。', description: '姓名貼露出卡邊一小截，像幼兒園繪本的索引。留給照片與文字更多呼吸空間。', interaction: '整張貼紙點一下就能翻面，不需要拖曳或只點露出的紙角。' },
];

function sticker(option, decorative = false) {
  const tag = decorative ? 'span' : 'button';
  const attributes = decorative ? 'aria-hidden="true"' : `type="button" aria-label="${option.type === 'split' ? '看故事' : '查看照片背後的故事'}：早安入園（${option.number}）" aria-controls="${option.id}-content" aria-describedby="${option.id}-hint" data-flip="${option.id}"`;
  const content = option.type === 'split' ? `<span class="sticker-copy">看故事</span><span class="icon-cell">${icon}</span>` : icon;
  return `<${tag} class="sticker sticker--${option.type}" ${attributes}>${content}<span class="curl" aria-hidden="true"></span></${tag}>`;
}

document.querySelector('#directions').innerHTML = options.map(option => `
  <article class="direction direction--${option.id}" id="${option.id}">
    <header class="direction-heading"><span class="number">${option.number}</span><div><h2>${option.name}</h2><p>${option.subtitle}</p></div>${option.recommended ? '<span class="recommended">推薦先試</span>' : ''}</header>
    <div class="scene">
      <div class="card-stage" data-card="${option.id}">
        <div class="flipper" id="${option.id}-content">
          <div class="face front">
            <img src="../../web/public/assets/day-hello.webp" alt="孩子在熟悉的環境裡，與身旁的人互動" width="600" height="450">
            <p class="photo-caption">陪伴互動 · 入園情境示意</p>
            <span class="moment-time">08:00 ／ 早安入園</span>
            <p class="moment-title">早安，今天的我<br>準備好了。</p>
          </div>
          <div class="face back" aria-hidden="true" inert>
            <p class="back-eyebrow">08:00 ／ 早安入園</p>
            <h3>早安，今天的我<br>準備好了。</h3>
            <p class="story">和家人說聲再見，走進熟悉的校園。從整理小書包開始，一點一點，找到自己的步調。</p>
            <p class="question">孩子第一次上學，如何陪伴適應？</p>
            <p class="answer">參觀時可以與園所聊聊：初次入園的陪伴方式、家長如何與老師聯繫，以及可以事先做哪些準備。</p>
          </div>
        </div>
        <div class="sticker-anchor">${sticker(option)}<span class="tooltip" aria-hidden="true">看看照片背後的故事</span></div>
      </div>
      <p class="hint" id="${option.id}-hint">點姓名貼，看看照片背後的故事</p>
    </div>
    <div class="detail"><div class="detail-label"><strong>貼紙近看</strong>${option.material}</div><div class="detail-sample">${sticker(option, true)}</div></div>
    <p class="rationale"><strong>${option.benefit}</strong><br>${option.description}</p>
    <p class="microcopy">${option.interaction}</p>
  </article>`).join('');

const allFlip = document.querySelector('#all-flip');
const announcement = document.querySelector('#announcement');

function visibleOptions() {
  return options.filter(option => !document.getElementById(option.id).hidden);
}

function updateAllLabel() {
  const allBack = visibleOptions().every(option => document.querySelector(`[data-card="${option.id}"]`).classList.contains('is-flipped'));
  allFlip.innerHTML = `${allBack ? '一起看照片' : '一起看背面'} <span aria-hidden="true">↗</span>`;
}

function setFlipped(option, back, announce = true) {
  const card = document.querySelector(`[data-card="${option.id}"]`);
  const button = card.querySelector('[data-flip]');
  card.classList.toggle('is-flipped', back);
  for (const side of ['front', 'back']) {
    const face = card.querySelector(`.${side}`);
    const inactive = (side === 'front') === back;
    face.setAttribute('aria-hidden', String(inactive));
    face.inert = inactive;
  }
  button.dataset.back = String(back);
  const action = back ? '看照片' : option.type === 'split' ? '看故事' : '查看照片背後的故事';
  button.setAttribute('aria-label', `${action}：早安入園（${option.number}）`);
  const label = button.querySelector('.sticker-copy');
  if (label) label.textContent = back ? '看照片' : '看故事';
  card.querySelector('.tooltip').textContent = back ? '回到剛才的照片' : '看看照片背後的故事';
  document.getElementById(`${option.id}-hint`).textContent = back ? '再點一次姓名貼，回到照片' : '點姓名貼，看看照片背後的故事';
  if (announce) announcement.textContent = `${option.number} ${option.name}：已顯示${back ? '故事' : '照片'}。`;
  updateAllLabel();
}

document.querySelectorAll('[data-flip]').forEach(button => {
  button.addEventListener('click', () => {
    const option = options.find(item => item.id === button.dataset.flip);
    setFlipped(option, !button.closest('.card-stage').classList.contains('is-flipped'));
  });
  button.addEventListener('keydown', event => {
    if (event.key === 'Escape') button.closest('.sticker-anchor').classList.add('tooltip-dismissed');
  });
  for (const event of ['pointerleave', 'blur']) button.addEventListener(event, () => button.closest('.sticker-anchor').classList.remove('tooltip-dismissed'));
});

allFlip.addEventListener('click', () => {
  const visible = visibleOptions();
  const back = !visible.every(option => document.querySelector(`[data-card="${option.id}"]`).classList.contains('is-flipped'));
  visible.forEach(option => setFlipped(option, back, false));
  announcement.textContent = `目前顯示的方案已切換到${back ? '故事' : '照片'}。`;
});

function selectView(view) {
  const selected = options.some(option => option.id === view) ? view : 'all';
  document.querySelector('#directions').dataset.selected = selected;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === selected)));
  options.forEach(option => { document.getElementById(option.id).hidden = selected !== 'all' && option.id !== selected; });
  const url = new URL(location.href);
  if (selected === 'all') url.searchParams.delete('view'); else url.searchParams.set('view', selected);
  history.replaceState(null, '', url);
  updateAllLabel();
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
selectView(new URLSearchParams(location.search).get('view'));
