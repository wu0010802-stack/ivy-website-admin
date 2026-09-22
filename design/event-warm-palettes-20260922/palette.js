const palettes = [
  { id: 'a', name: '蜜糖日光', caption: '金黃 · 蜂蜜 · 燕麥', note: '明亮、親切', description: 'A｜明亮的金黃系，延續官網原有的暖黃。', colors: ['#F6CD68', '#EABC74', '#F5DDA3'] },
  { id: 'b', name: '杏桃果茶', caption: '杏桃 · 果茶 · 蜜柚', note: '柔和、有朝氣', description: 'B｜推薦先看。橘與蜜桃的差異清楚，和霧藍相襯。', colors: ['#F5B18D', '#F4C392', '#EEA79B'] },
  { id: 'c', name: '珊瑚花園', caption: '珊瑚 · 花瓣 · 淡粉', note: '活潑、溫暖', description: 'C｜偏紅的珊瑚色，滑過時更有存在感。', colors: ['#EFA18C', '#E6B19D', '#EDBEAE'] },
  { id: 'd', name: '玫瑰奶茶', caption: '玫瑰 · 豆沙 · 奶茶', note: '安靜、細緻', description: 'D｜玫瑰與豆沙粉，色彩柔和，氣氛更安靜。', colors: ['#E7B5B3', '#DDB1B6', '#E4C2B7'] },
  { id: 'e', name: '陶土午後', caption: '陶土 · 焦糖 · 沙杏', note: '自然、沉穩', description: 'E｜降低彩度的陶土與焦糖，帶一點自然材質的感覺。', colors: ['#DDA58A', '#D6AD91', '#E0BC9F'] },
  { id: 'f', name: '奶油烘焙', caption: '奶油 · 餅乾 · 燕麥奶', note: '輕盈、低彩度', description: 'F｜最淡的一組，像奶油與餅乾，換色較含蓄。', colors: ['#F5DFB9', '#E9D0AF', '#EFD8C9'] },
];
const events = [
  { day: '26', month: 'SEP', campus: '全校', title: '秋季校園開放日' },
  { day: '03', month: 'OCT', campus: '義華校', title: '親子共讀・故事的午後' },
  { day: '17', month: 'OCT', campus: '全校', title: '一起出發！親子探索日' },
];
const picker = document.querySelector('.palette-picker');
const comparison = document.querySelector('.comparison');
const showAll = document.querySelector('#show-all');
let timers = [];

picker.innerHTML = palettes.map(p => `<button type="button" class="palette-option" data-palette="${p.id}" aria-pressed="false"><span class="option-label"><span class="option-letter">${p.id.toUpperCase()}</span>${p.name}</span><span class="option-note">${p.note}</span><span class="swatches" aria-hidden="true">${p.colors.map(c => `<span class="swatch" style="--swatch:${c}"></span>`).join('')}</span></button>`).join('');

for (const stack of document.querySelectorAll('.event-stack')) {
  stack.innerHTML = events.map(e => `<button type="button" class="sample-event" aria-pressed="false" aria-label="${e.title}，保持換色"><span class="sample-date"><b>${e.day}</b><span lang="en">${e.month}</span></span><span class="event-copy"><small>${e.campus}</small><strong>${e.title}</strong></span></button>`).join('');
  stack.addEventListener('click', event => {
    const card = event.target.closest('.sample-event');
    if (!card) return;
    stopReplay();
    if (comparison.classList.contains('is-filled')) {
      comparison.classList.remove('is-filled');
      document.querySelectorAll('.sample-event').forEach(item => {
        item.classList.add('is-pinned');
        item.setAttribute('aria-pressed', 'true');
      });
      showAll.setAttribute('aria-pressed', 'false');
      showAll.textContent = '全部顯示換色';
    }
    const pinned = card.classList.toggle('is-pinned');
    card.setAttribute('aria-pressed', String(pinned));
  });
}

function setColors(id, colors) {
  const panel = document.getElementById(id);
  panel.querySelectorAll('.sample-event').forEach((card, i) => card.style.setProperty('--fill', colors[i]));
  panel.querySelector('.color-values').innerHTML = colors.map(c => `<span class="color-value"><i style="--swatch:${c}" aria-hidden="true"></i>${c}</span>`).join('');
}
function stopReplay() {
  timers.forEach(clearTimeout);
  timers = [];
  comparison.classList.remove('is-demo');
}
function resetCards() {
  document.querySelectorAll('.sample-event').forEach(card => {
    card.classList.remove('is-pinned');
    card.setAttribute('aria-pressed', 'false');
  });
}
function selectPalette(id) {
  const p = palettes.find(p => p.id === id) || palettes[1];
  stopReplay();
  resetCards();
  picker.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.palette === p.id)));
  document.querySelector('#candidate-heading').textContent = `${p.id.toUpperCase()} ${p.name}`;
  document.querySelector('#candidate-caption').textContent = p.caption;
  document.querySelector('#direction-note').textContent = p.description;
  setColors('candidate', p.colors);
  const url = new URL(location.href);
  url.searchParams.set('palette', p.id);
  history.replaceState(null, '', url);
}
picker.addEventListener('click', event => {
  const button = event.target.closest('[data-palette]');
  if (button) selectPalette(button.dataset.palette);
});
showAll.addEventListener('click', () => {
  stopReplay(); resetCards();
  const filled = comparison.classList.toggle('is-filled');
  showAll.setAttribute('aria-pressed', String(filled));
  showAll.textContent = filled ? '全部回到原色' : '全部顯示換色';
});
document.querySelector('#replay').addEventListener('click', () => {
  stopReplay(); resetCards();
  comparison.classList.remove('is-filled');
  showAll.setAttribute('aria-pressed', 'false');
  showAll.textContent = '全部顯示換色';
  timers.push(setTimeout(() => comparison.classList.add('is-demo'), 600));
  timers.push(setTimeout(stopReplay, 2000));
});
setColors('current', ['#F2B592', '#F0C56F', '#E8B1A4']);
selectPalette(new URLSearchParams(location.search).get('palette'));
