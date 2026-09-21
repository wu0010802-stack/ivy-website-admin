const icon = '<svg class="flip-icon" aria-hidden="true" viewBox="0 0 256 256"><use href="#flip"></use></svg>';
const directions = [
  {
    "id": "p5",
    "name": "聯絡簿印章",
    "emotion": "有人留意著今天",
    "type": "stamp",
    "asset": "p5-stamp.png",
    "label": "小發現",
    "memory": "聯絡簿上小小的紅印，記著今天被看見的一件事。",
    "why": "帶一點舊式印泥與紙張的熟悉感，像家長每天翻開聯絡簿時會看到的記號。",
    "ux": "用單一完整印章承載文字和翻面 icon，縮小後仍維持明確輪廓。",
    "size": "110 × 82",
    "short": "印章"
  },
  {
    "id": "p6",
    "name": "鉛筆姓名貼",
    "emotion": "第一筆，陪著寫",
    "type": "pencil",
    "asset": "p6-pencil.png",
    "label": "我的今天",
    "memory": "握著小手，陪孩子慢慢寫下自己的第一筆。",
    "why": "黃色鉛筆與小小橡皮擦，把按鈕變成家長熟悉的學習小物。",
    "ux": "橫向輪廓適合卡片底邊；筆身留給短文字與翻面 icon，整支都能點。",
    "size": "160 × 60",
    "short": "鉛筆"
  },
  {
    "id": "p7",
    "name": "小書包吊牌",
    "emotion": "第一次自己出發",
    "type": "bag",
    "asset": "p7-bag-tag.png",
    "label": "出發囉",
    "memory": "替孩子背好小書包，再揮揮手，讓他自己走進校門。",
    "why": "織帶、帆布與綠色包邊，把入園的準備和小小的獨立放進一張吊牌。",
    "ux": "文字與 icon 上下排列，形狀較方正，適合放在拍立得右下角。",
    "size": "110 × 96",
    "short": "吊牌"
  },
  {
    "id": "p8",
    "name": "衣物布標",
    "emotion": "不知不覺，又長大了",
    "type": "cloth",
    "asset": "p8-cloth.png",
    "label": "慢慢長大",
    "memory": "才剛洗好收進衣櫃的衣服，袖口好像又短了一點。",
    "why": "細細的縫線與棉布紋理，想留下家長照顧孩子生活起居的溫柔痕跡。",
    "ux": "材質有存在感，色彩保持安靜；字與 icon 維持深綠，方便辨識。",
    "size": "140 × 70",
    "short": "布標"
  },
  {
    "id": "p9",
    "name": "成長集點貼",
    "emotion": "一點點累積的勇氣",
    "type": "growth",
    "asset": "p9-growth.png",
    "label": "又長大了",
    "memory": "第一次自己穿鞋、第一次主動說早安，都值得記下來。",
    "why": "小花記號與量尺刻度，讓成長像可以慢慢累積、好好保存的日常。",
    "ux": "裝飾集中在上下邊緣，中間保留清楚的文字與翻面 icon。",
    "size": "140 × 84",
    "short": "集點貼"
  },
  {
    "id": "p10",
    "name": "孩子的撕紙拼貼",
    "emotion": "這是做給你的",
    "type": "collage",
    "asset": "p10-collage.png",
    "label": "送給你",
    "memory": "孩子把做好的小作品放進你手裡，說：這個送給你。",
    "why": "不太整齊的紙邊、一小顆愛心，保留孩子親手做禮物的真誠。",
    "ux": "彩紙只露出邊緣，中心保持素淨；按一次，翻開這份小心意的故事。",
    "size": "145 × 78",
    "short": "拼貼"
  }
];

function sticker(item, decorative = false) {
  const tag = decorative ? 'span' : 'button';
  const attributes = decorative ? 'aria-hidden="true"' : `type="button" data-flip="${item.id}" aria-label="${item.label}：翻到背面看故事（${item.id.toUpperCase()}）" aria-controls="content-${item.id}" aria-describedby="hint-${item.id}"`;
  return `<${tag} class="sticker sticker--${item.type}" ${attributes}><img class="sticker-art" src="assets/${item.asset}" alt="" draggable="false"><span class="sticker-content"><span class="sticker-word">${item.label}</span>${icon}</span></${tag}>`;
}

document.getElementById('directions').innerHTML = directions.map(item => `
  <article class="proposal" id="${item.id}">
    <header class="proposal-heading"><span class="number">${item.id.toUpperCase()}</span><h2>${item.name}</h2><span class="emotion">${item.emotion}</span></header>
    <div class="proposal-body">
      <div class="scene">
        <div class="card-stage" data-card="${item.id}">
          <div class="flipper" id="content-${item.id}">
            <div class="face front"><img class="photo" src="../../web/public/assets/day-hello.webp" width="600" height="600" alt="孩子在熟悉的環境裡，與身旁的人互動"><p class="source">陪伴互動 · 入園情境示意</p><div class="card-caption"><span class="time">08:00 ／ 早安入園</span><p class="card-title">早安，今天的我<br>準備好了。</p></div></div>
            <div class="face back" aria-hidden="true" inert><span class="time">08:00 ／ 早安入園</span><h3>早安，今天的我<br>準備好了。</h3><p class="story">和家人說聲再見，走進熟悉的校園。從整理小書包開始，一點一點，找到自己的步調。</p><p class="question">孩子第一次上學，如何陪伴適應？</p><p class="answer">參觀時可以與園所聊聊：初次入園的陪伴方式、家長如何與老師聯繫，以及可以事先做哪些準備。</p></div>
          </div>
          <div class="sticker-anchor">${sticker(item)}<span class="tooltip" aria-hidden="true">翻到背面，看看故事</span></div>
        </div>
        <p class="hint" id="hint-${item.id}">點貼紙，看看這一刻的故事</p>
      </div>
      <div class="notes"><div class="closeup">${sticker(item, true)}</div><p class="note-label">想喚起的日常畫面</p><p class="memory-line">${item.memory}</p><p class="why">${item.why}</p><p class="ux-note"><strong>操作上的考量</strong><br>${item.ux}</p><p class="size-note">卡片上的點擊範圍 ${item.size} px</p></div>
    </div>
  </article>`).join('');

function visible() { return directions.filter(item => !document.getElementById(item.id).hidden); }
function updateAll() {
  const back = visible().every(item => document.querySelector(`[data-card="${item.id}"]`).classList.contains('is-flipped'));
  document.getElementById('flip-all').textContent = back ? '一起回到照片 ↗' : '一起看背面 ↗';
}
function flip(item, back, announce = true) {
  const card = document.querySelector(`[data-card="${item.id}"]`);
  card.classList.toggle('is-flipped', back);
  ['front', 'back'].forEach(side => {
    const face = card.querySelector(`.${side}`);
    const inactive = (side === 'front') === back;
    face.inert = inactive;
    face.setAttribute('aria-hidden', String(inactive));
  });
  const button = card.querySelector('[data-flip]');
  button.dataset.back = String(back);
  button.querySelector('.sticker-word').textContent = back ? '看照片' : item.label;
  button.setAttribute('aria-label', back ? `看照片：回到正面（${item.id.toUpperCase()}）` : `${item.label}：翻到背面看故事（${item.id.toUpperCase()}）`);
  card.querySelector('.tooltip').textContent = back ? '回到剛才的照片' : '翻到背面，看看故事';
  document.getElementById(`hint-${item.id}`).textContent = back ? '再點一次，回到照片' : '點貼紙，看看這一刻的故事';
  if (announce) document.getElementById('announcement').textContent = `${item.name}，已顯示${back ? '故事' : '照片'}。`;
  updateAll();
}
document.querySelectorAll('[data-flip]').forEach(button => {
  button.addEventListener('click', () => flip(directions.find(item => item.id === button.dataset.flip), !button.closest('.card-stage').classList.contains('is-flipped')));
  button.addEventListener('keydown', event => { if (event.key === 'Escape') button.parentElement.classList.add('tooltip-dismissed'); });
  ['pointerleave', 'blur'].forEach(event => button.addEventListener(event, () => button.parentElement.classList.remove('tooltip-dismissed')));
});
document.getElementById('flip-all').addEventListener('click', () => {
  const back = !visible().every(item => document.querySelector(`[data-card="${item.id}"]`).classList.contains('is-flipped'));
  visible().forEach(item => flip(item, back, false));
  document.getElementById('announcement').textContent = `目前方案已切換到${back ? '故事' : '照片'}。`;
});
function filter(value) {
  const selected = directions.some(item => item.id === value) ? value : 'all';
  document.getElementById('directions').dataset.selected = selected;
  directions.forEach(item => { document.getElementById(item.id).hidden = selected !== 'all' && item.id !== selected; });
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === selected)));
  const url = new URL(location.href);
  if (selected === 'all') url.searchParams.delete('view'); else url.searchParams.set('view', selected);
  history.replaceState(null, '', url);
  updateAll();
}
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter(button.dataset.filter); setMode('cards'); }));
filter(new URLSearchParams(location.search).get('view'));

document.getElementById('gallery').innerHTML = directions.map(item => `<button type="button" class="gallery-choice" data-pick="${item.id}" aria-label="在拍立得上查看 ${item.id.toUpperCase()} ${item.name}"><span class="gallery-heading"><span class="number">${item.id.toUpperCase()}</span><span class="gallery-name">${item.name}</span></span><span class="gallery-art">${sticker(item, true)}</span><span class="gallery-emotion">${item.emotion}</span><span class="gallery-memory">${item.memory}</span></button>`).join('');

function setMode(mode) {
  const gallery = mode !== 'cards';
  document.getElementById('gallery').hidden = !gallery;
  document.getElementById('directions').hidden = gallery;
  document.getElementById('card-controls').hidden = gallery;
  document.getElementById('show-gallery').setAttribute('aria-pressed', String(gallery));
  document.getElementById('show-cards').setAttribute('aria-pressed', String(!gallery));
  const url = new URL(location.href);
  if (gallery) url.searchParams.delete('mode'); else url.searchParams.set('mode', 'cards');
  history.replaceState(null, '', url);
}
document.getElementById('show-gallery').addEventListener('click', () => { filter('all'); setMode('gallery'); });
document.getElementById('show-cards').addEventListener('click', () => setMode('cards'));
document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => {
  filter(button.dataset.pick);
  setMode('cards');
  document.querySelector(`[data-flip="${button.dataset.pick}"]`).focus();
}));
const params = new URLSearchParams(location.search);
setMode(params.get('mode') === 'cards' || params.get('view') ? 'cards' : 'gallery');
