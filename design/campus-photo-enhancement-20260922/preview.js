const campuses = {
  'yihua-exterior': { name: '義華校', before: [590, 388], after: [1546, 1017] },
  minghua: { name: '明華校', before: [1000, 522], after: [1737, 906] },
  chongde: { name: '崇德校', before: [1000, 522], after: [1736, 906] },
  international: { name: '國際校', before: [1000, 522], after: [1736, 906] },
  renwu: { name: '仁武校', before: [1000, 522], after: [1737, 906] }
};
const viewer = document.getElementById('viewer');
const range = document.getElementById('split');
function split(value) {
  range.value = String(value);
  viewer.style.setProperty('--split', `${value}%`);
  viewer.dataset.mode = value === 0 ? 'after' : value === 100 ? 'before' : 'split';
  range.setAttribute('aria-valuetext', `原圖 ${value}%，修復版 ${100 - value}%`);
  document.querySelectorAll('[data-split]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.split) === value)));
}
function select(key) {
  const campus = campuses[key];
  if (!campus) return;
  for (const kind of ['before', 'after']) {
    const img = document.getElementById(kind);
    img.width = campus[kind][0]; img.height = campus[kind][1];
    img.src = `images/${key}-${kind === 'before' ? 'original' : 'enhanced-v1'}.webp`;
    img.alt = `${campus.name}${kind === 'before' ? '原圖' : ' AI 質感修復版'}`;
  }
  viewer.dataset.campus = key;
  document.getElementById('campus-name').textContent = campus.name;
  document.getElementById('dimensions').textContent = `${campus.before.join(' × ')} → ${campus.after.join(' × ')}`;
  document.querySelectorAll('[data-key]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.key === key)));
  document.getElementById('download').href = `images/${key}-enhanced-v1.png`;
  document.getElementById('webp').href = `images/${key}-enhanced-v1.webp`;
  history.replaceState(null, '', `#${key}`);
}
document.querySelectorAll('[data-key]').forEach(button => button.addEventListener('click', () => select(button.dataset.key)));
document.querySelectorAll('[data-split]').forEach(button => button.addEventListener('click', () => split(Number(button.dataset.split))));
range.addEventListener('input', () => split(Number(range.value)));
select(Object.hasOwn(campuses, location.hash.slice(1)) ? location.hash.slice(1) : 'yihua-exterior');
split(50);
