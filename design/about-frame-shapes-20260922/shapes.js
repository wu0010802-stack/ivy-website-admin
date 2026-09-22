'use strict';

const shapes = {
  a: { name: '大圓角', description: '四角一起放柔，保留完整照片感，也呼應官網校園照片的圓角。', short: '溫柔、俐落，最容易融入現有官網。' },
  b: { name: '拱形窗', description: '上方拱起、下方安定，像一扇看見孩子日常的窗；搭配膠囊形小照片。', short: '辨識度更高，有一點建築的安定感。' },
  c: { name: '對角圓弧', description: '只放大對角兩道弧線，保留方與圓的對比；小照片反向呼應。', short: '有設計感，也保留照片的舒展空間。' },
  d: { name: '鵝卵石', description: '用不對稱的圓潤輪廓，讓照片像兩顆自然靠近的石頭。', short: '自然、親切，輪廓最有個性。' },
};

const query = new URLSearchParams(location.search);
const shape = Object.hasOwn(shapes, query.get('shape')) ? query.get('shape') : null;
const view = query.get('view') === 'photo' ? 'photo' : 'section';
const embed = query.get('embed') === '1';
const content = document.querySelector('#content');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

document.documentElement.classList.toggle('embed', embed);
document.querySelector(`[data-direction="${shape || 'all'}"]`).setAttribute('aria-current', 'page');
document.querySelectorAll('[data-direction]').forEach(link => {
  if (link.dataset.direction !== 'all') link.href = `?shape=${link.dataset.direction}&view=${view}`;
});

function photos(about) {
  const image = (photo, kind) => `<div class="photo ${kind}"><img src="../../web/public/assets/${escapeHtml(photo.image)}.webp" width="${kind === 'portrait' ? 760 : 1000}" height="${kind === 'portrait' ? 570 : 402}" alt="${escapeHtml(photo.alt)}" decoding="async"></div>`;
  const caption = about.caption.split('，');
  return `<figure class="photo-layout">${image(about.photos[0], 'portrait')}${image(about.photos[1], 'moment')}<figcaption class="photo-caption"><span>${escapeHtml(caption[0])}，</span><span>${escapeHtml(caption.slice(1).join('，'))}</span></figcaption></figure>`;
}

function overview() {
  content.innerHTML = `<section class="overview" aria-labelledby="overview-title">
    <div class="overview-intro"><h1 id="overview-title">換一種輪廓，看見同樣的溫暖。</h1><p>四種外框，同樣的照片、尺寸與交疊位置。</p></div>
    <div class="comparison">${Object.entries(shapes).map(([key, item]) => `<article class="proposal">
      <div class="proposal-heading"><span class="proposal-letter" aria-hidden="true">${key.toUpperCase()}</span><h2>${item.name}</h2></div>
      <iframe class="proposal-frame" src="?shape=${key}&view=photo&embed=1" title="${key.toUpperCase()} ${item.name}外框預覽" tabindex="-1"></iframe>
      <div class="proposal-caption"><p>${item.short}</p><a href="?shape=${key}">看完整區塊 ↗</a></div>
    </article>`).join('')}</div>
    <p class="review-footnote">本機外框比稿，尚未套用官網。<a href="../about-photo-three-20260922/">回到上一輪構圖比較 ↗</a></p>
  </section>`;
  document.documentElement.dataset.ready = 'true';
}

async function detail() {
  const response = await fetch('../about-photo-three-20260922/about.json');
  if (!response.ok) throw new Error('無法讀取比稿文案');
  const about = await response.json();
  const item = shapes[shape];
  const stop = about.bodyText.search(/[。！？]/) + 1;
  document.title = `${shape.toUpperCase()} ${item.name}｜常春藤外框探索`;
  document.body.classList.add(`shape-${shape}`, `view-${view}`);
  content.innerHTML = `<div class="direction-info"><div><h1>${shape.toUpperCase()} · ${item.name}</h1><p>${item.description}</p></div>
      <nav class="view-nav" aria-label="預覽範圍"><a href="?shape=${shape}&view=section" ${view === 'section' ? 'aria-current="page"' : ''}>完整區塊</a><a href="?shape=${shape}&view=photo" ${view === 'photo' ? 'aria-current="page"' : ''}>照片細節</a></nav></div>
    <section class="belief" aria-label="關於常春藤外框設計預覽">
      <div class="watermark" aria-hidden="true">${escapeHtml(about.watermark.top)}<br>${escapeHtml(about.watermark.bottom)}</div>
      <div class="belief-layout"><div class="belief-copy">
        <p class="since" lang="en">${escapeHtml(about.sinceLabel)}</p>
        <h2>${about.title.split('，').map((line, i) => `<span>${escapeHtml(line)}${i === 0 ? '，' : ''}</span>`).join('')}</h2>
        <p class="body-copy desktop-copy">${escapeHtml(about.bodyText)}</p>
        <div class="body-copy mobile-copy"><p>${escapeHtml(about.bodyText.slice(0, stop))}</p><details><summary>閱讀完整介紹</summary><p>${escapeHtml(about.bodyText.slice(stop))}</p></details></div>
      </div><div class="composition">${photos(about)}</div></div>
    </section>`;
  document.documentElement.dataset.ready = 'true';
}

if (shape) {
  detail().catch(error => { content.textContent = `${error.message}。請透過本機預覽網址開啟。`; console.error(error); });
} else {
  overview();
}
