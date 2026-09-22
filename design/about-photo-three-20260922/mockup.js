'use strict';

const variants = {
  a: { name: '輕盈交疊', description: '放鬆主圖裁切，縮小探索照片，留下更輕巧的交疊。', short: '延續熟悉的溫暖，更輕、更有主次。' },
  b: { name: '錯位雙景', description: '拿掉相框與遮擋，讓兩張照片之間多一道呼吸的空間。', short: '清爽、安定，讓兩個片刻各自說話。' },
  c: { name: '一頁童年', description: '用一張米白相紙串起表情、探索與圖說，像翻開一本相簿。', short: '把兩個片刻，收藏在同一頁。' },
};

const query = new URLSearchParams(location.search);
const variant = Object.hasOwn(variants, query.get('variant')) ? query.get('variant') : null;
const view = query.get('view') === 'photo' ? 'photo' : 'section';
const embed = query.get('embed') === '1';
const content = document.querySelector('#content');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

document.documentElement.classList.toggle('embed', embed);
document.querySelector(`[data-direction="${variant || 'all'}"]`).setAttribute('aria-current', 'page');
if (variant) {
  document.querySelectorAll('[data-direction]').forEach(link => {
    const key = link.dataset.direction;
    if (key !== 'all') link.href = `?variant=${key}&view=${view}`;
  });
}

function photoMarkup(about) {
  const [portrait, moment] = about.photos;
  const img = (photo, kind) => `<div class="photo ${kind}"><img src="../../web/public/assets/${escapeHtml(photo.image)}.webp" width="${kind === 'portrait' ? 760 : 1000}" height="${kind === 'portrait' ? 570 : 402}" alt="${escapeHtml(photo.alt)}" decoding="async"></div>`;
  const captionParts = about.caption.split('，');
  const caption = `<figcaption class="photo-caption"><span>${escapeHtml(captionParts[0])}，</span><span>${escapeHtml(captionParts.slice(1).join('，'))}</span></figcaption>`;
  return `<figure class="photo-layout">${img(portrait, 'portrait')}${variant === 'c' ? `<div class="photo-bottom">${img(moment, 'moment')}${caption}</div>` : `${img(moment, 'moment')}${caption}`}</figure>`;
}

function overview() {
  content.innerHTML = `<section class="overview" aria-labelledby="overview-title">
    <div class="overview-intro"><h1 id="overview-title">同樣的童年，三種觀看方式。</h1><p>相同照片與底色，直接比較構圖。點進去看完整區塊。</p></div>
    <div class="comparison">${Object.entries(variants).map(([key, item]) => `<article class="proposal">
      <div class="proposal-heading"><span class="proposal-letter" aria-hidden="true">${key.toUpperCase()}</span><h2>${item.name}</h2></div>
      <iframe class="proposal-frame" src="?variant=${key}&view=photo&embed=1" title="${key.toUpperCase()} ${item.name}的照片構圖" tabindex="-1"></iframe>
      <div class="proposal-caption"><p>${item.short}</p><a href="?variant=${key}">看完整區塊 ↗</a></div>
    </article>`).join('')}</div>
    <p class="review-footnote">本機設計比稿，尚未套用官網。照片使用現有原始素材；本次僅比較排版。</p>
  </section>`;
}

async function detail() {
  const response = await fetch('about.json');
  if (!response.ok) throw new Error('無法讀取 mock-up 文案');
  const about = await response.json();
  const item = variants[variant];
  const firstStop = about.bodyText.search(/[。！？]/) + 1;
  const lead = about.bodyText.slice(0, firstStop);
  const rest = about.bodyText.slice(firstStop);
  const heading = about.title.split('，').map((line, i) => `<span>${escapeHtml(line)}${i === 0 ? '，' : ''}</span>`).join('');
  document.title = `${variant.toUpperCase()} ${item.name}｜常春藤照片構圖`;
  document.body.classList.add(`variant-${variant}`, `view-${view}`);
  content.innerHTML = `<div class="direction-info"><div><h1>${variant.toUpperCase()} · ${item.name}</h1><p>${item.description}</p></div>
      <nav class="view-nav" aria-label="預覽範圍"><a href="?variant=${variant}&view=section" ${view === 'section' ? 'aria-current="page"' : ''}>完整區塊</a><a href="?variant=${variant}&view=photo" ${view === 'photo' ? 'aria-current="page"' : ''}>照片細節</a></nav></div>
    <section class="belief" aria-label="關於常春藤區塊設計預覽">
      <div class="watermark" aria-hidden="true">${escapeHtml(about.watermark.top)}<br>${escapeHtml(about.watermark.bottom)}</div>
      <div class="belief-layout"><div class="belief-copy">
        <p class="since" lang="en">${escapeHtml(about.sinceLabel)}</p><h2>${heading}</h2>
        <p class="body-copy desktop-copy">${escapeHtml(about.bodyText)}</p>
        <div class="body-copy mobile-copy"><p>${escapeHtml(lead)}</p><details><summary>閱讀完整介紹</summary><p>${escapeHtml(rest)}</p></details></div>
      </div><div class="composition">${photoMarkup(about)}</div></div>
    </section>`;
  document.documentElement.dataset.ready = 'true';
}

if (variant) {
  detail().catch(error => {
    content.textContent = `${error.message}。請透過本機預覽網址開啟。`;
    console.error(error);
  });
} else {
  overview();
  document.documentElement.dataset.ready = 'true';
}
