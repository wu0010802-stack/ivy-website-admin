const icon = '<svg class="flip-icon" aria-hidden="true" viewBox="0 0 256 256"><use href="#flip"></use></svg>';
const directions = [
  { id: 'p1', name: '獎勵花花貼', emotion: '孩子的成就感', type: 'reward', asset: 'p1-reward.png', label: '我做到了', memory: '孩子一出校門，就拉著你看今天拿到的小花。', why: '借用乖寶寶貼紙的熟悉感，把小小的進步變成孩子想主動分享的故事。', ux: '花形是四款中最醒目的入口；把「我做到了」留在花心，翻面圖示放在下方。', size: '94 × 94', short: '獎勵貼' },
  { id: 'p2', name: '入園姓名貼', emotion: '被準備、被記掛', type: 'name', asset: 'p2-name.png', label: '我的小日常', memory: '開學前，一張張幫孩子貼好水壺和小書包。', why: '熟悉的紅框、手寫字與留白，想喚起家長替孩子準備每件小物的心情。', ux: '保留姓名貼的辨識度，用「我的小日常」取代人名，讓每個家庭都能代入。', size: '140 × 76', short: '姓名貼' },
  { id: 'p3', name: '老師留言貼', emotion: '孩子被細心看見', type: 'note', asset: 'p3-note.png', label: '想跟你說', memory: '翻開聯絡簿，讀到老師記下孩子今天的小發現。', why: '紙膠帶、撕邊便條與手寫短句，邀請家長讀一段關於孩子的日常。', ux: '「想跟你說」吸引閱讀，固定提示清楚說明點下去會翻到故事背面。', size: '143 × 80', short: '留言貼' },
  { id: 'p4', name: '作品收藏貼', emotion: '想留下成長的痕跡', type: 'keepsake', asset: 'p4-keepsake.png', label: '小小回憶', memory: '冰箱門上的第一張畫，過了好久還捨不得拿下。', why: '蠟筆線、紙纖維與一小段膠帶，讓照片像家裡珍藏的成長片段。', ux: '文字像一個回憶標籤，點擊後可讀照片背後的故事；操作提示保持可見。', size: '143 × 76', short: '收藏貼' },
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
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => filter(button.dataset.filter)));
filter(new URLSearchParams(location.search).get('view'));
