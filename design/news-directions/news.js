(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const direction = /^[a-e]$/.test(params.get('direction')) ? params.get('direction') : 'a';
  const inContext = document.body.classList.contains('news-in-context');
  const assetBase = inContext ? 'assets/' : '../../assets/';
  const arrow = '<span aria-hidden="true">↗</span>';
  // Dates, categories and copy are design samples. Existing images are contextual assets.
  const articles = [
    { id:'garden', date:'2026.09.16', campus:'義華校', category:'校園日常', title:'小小園丁，把好奇心種進生活裡。', desc:'從翻土、澆水到觀察新芽，陪孩子發現一片葉子裡的大世界。', image:'garden', alt:'既有校園果樹情境照片' },
    { id:'learning', date:'2026.09.12', campus:'義華校', category:'學習紀錄', title:'動手試試看，讓每個想法都有形狀。', desc:'在創作與探索之間，看見孩子專注的眼神，也聽見他們自己的答案。', image:'learning', alt:'既有義華校學習活動情境照片' },
    { id:'renwu', date:'2026.09.10', campus:'仁武校', category:'分校消息', title:'走進仁武校，認識孩子的成長空間。', desc:'透過校園圖像，先認識孩子每天生活與探索的地方。', image:'renwu', alt:'仁武校既有校園外觀示意圖' },
    { id:'minghua', date:'2026.09.08', campus:'明華校', category:'分校消息', title:'在明華，打開新學期的日常。', desc:'新學期的相遇，從認識教室、老師與身邊的朋友開始。', image:'minghua', alt:'明華校既有校園照片' },
    { id:'chongde', date:'2026.09.05', campus:'崇德校', category:'分校消息', title:'一起認識崇德校的每個小角落。', desc:'從一扇窗、一條走廊開始，慢慢熟悉每天探索的校園。', image:'chongde', alt:'崇德校既有校園照片' },
    { id:'international', date:'2026.09.03', campus:'國際校', category:'分校消息', title:'新朋友、新發現，校園生活開始了。', desc:'帶著好奇走進校園，在一起生活的過程中，找到自己的步調。', image:'international', alt:'國際校既有校園照片' },
  ];
  const journalStory = {id:'play',image:'hero',title:'玩在一起，也慢慢學會一起。',date:'2026.09.09',campus:'義華校',category:'校園日常',desc:'從遊戲裡認識朋友，練習輪流、分享，也一起開懷大笑。',alt:'既有義華校戶外活動情境照片'};
  const events = [
    {id:'visit', day:'26', month:'SEP', date:'09.26', campus:'全校', title:'秋季校園開放日', desc:'和孩子一起，來看看未來的日常。'},
    {id:'family', day:'03', month:'OCT', date:'10.03', campus:'義華校', title:'親子共讀・故事的午後', desc:'一本繪本，開啟一段親子對話。'},
    {id:'outdoor', day:'17', month:'OCT', date:'10.17', campus:'全校', title:'一起出發！親子探索日', desc:'在戶外發現身邊的小驚喜。'},
  ];
  const photo = (item, cls='') => `<img class="${cls}" src="${assetBase}${item.image}.webp" width="720" height="480" alt="${item.alt}" loading="lazy">`;
  const meta = item => `<div class="n-meta"><span>${item.campus}</span><time datetime="${item.date.replaceAll('.','-')}">${item.date}</time></div>`;
  const more = (label='所有最新消息', kind='news') => `<button class="n-more" data-all="${kind}">${label} ${arrow}</button>`;
  const card = item => `<article class="n-card"><button class="n-story" data-article="${item.id}">${photo(item)}<div class="n-card-copy">${meta(item)}<h3>${item.title}</h3><p>${item.desc}</p><span class="n-read">閱讀故事 ${arrow}</span></div></button></article>`;
  const row = item => `<article class="n-row"><button data-article="${item.id}">${photo(item)}<div>${meta(item)}<h3>${item.title}</h3><span class="n-category">${item.category}</span></div>${arrow}</button></article>`;
  const event = item => `<button class="n-event" data-event="${item.id}"><span class="n-event-date"><b>${item.day}</b><small>${item.month}</small></span><span class="n-event-copy"><small>${item.campus}</small><strong>${item.title}</strong></span>${arrow}</button>`;
  const note = '<p class="n-sample-note">設計示意｜消息與活動日期均為範例，照片取自既有校園素材，非上述消息實拍。</p>';
  const head = (title='最新消息', subtitle='校園裡的新鮮事，與你分享。') => `<div class="n-heading"><div><span class="n-kicker" lang="en">NEWS &amp; STORIES</span><h2 id="latest-news-title">${title}</h2><p>${subtitle}</p></div>${more()}</div>`;
  const renderers = {
    a: () => `<div class="n-split"><aside class="n-events"><div class="n-column-head"><span class="n-kicker" lang="en">UPCOMING EVENTS</span><h2>近期活動</h2></div><div class="n-event-stack">${events.map(event).join('')}</div>${more('所有活動','events')}</aside><div class="n-news"><div class="n-column-head n-column-head-main"><div><span class="n-kicker" lang="en">LATEST NEWS</span><h2 id="latest-news-title">最新消息</h2></div>${more()}</div><div class="n-three">${articles.slice(0,3).map(card).join('')}</div></div></div>`,
    b: () => `${head('每一天，都有值得分享的新發現。','最新消息 · 從一則故事，認識常春藤的日常。')}<div class="n-editorial"><article class="n-feature"><button class="n-story" data-article="garden">${photo(articles[0])}<div class="n-feature-copy">${meta(articles[0])}<h3>${articles[0].title}</h3><p>${articles[0].desc}</p><span class="n-read">閱讀這則故事 ${arrow}</span></div></button></article><div class="n-editorial-list"><p class="n-list-label">更多校園消息</p>${articles.slice(1,4).map(row).join('')}</div></div><div class="n-event-ribbon"><span>UP NEXT<br><b>近期活動</b></span><strong>09.26 <i>／</i> 秋季校園開放日</strong><p>和孩子一起，來看看未來的日常。</p><button data-event="visit">活動詳情 ${arrow}</button></div>`,
    c: () => `${head('五所校園，一起更新。','最新消息 · 選擇分校，看看你關心的校園動態。')}<div class="n-filter" role="group" aria-label="依分校篩選最新消息">${['所有分校','義華校','明華校','崇德校','國際校','仁武校'].map((name,i)=>`<button data-campus="${name}" aria-pressed="${i===0}">${name}</button>`).join('')}</div><p id="filter-status" class="n-sr" role="status"></p><div class="n-three n-filter-results" id="filtered-news">${articles.slice(0,3).map(card).join('')}</div><div class="n-filter-foot"><span id="filter-count">所有分校 · 精選 3 則</span><span>每一所校園，都有自己的精彩。</span></div>`,
    d: () => `<div class="n-bulletin"><div class="n-bulletin-intro"><span class="n-kicker" lang="en">LATEST UPDATES</span><h2 id="latest-news-title">最新消息</h2><p>重要的消息，<br>在這裡一起掌握。</p><span class="n-issue">09 <small>／ 2026</small></span>${more()}</div><div class="n-notice-list">${[articles[2],articles[0],articles[1],articles[3]].map((item,i)=>`<button class="n-notice" data-article="${item.id}"><time datetime="${item.date.replaceAll('.','-')}"><b>${item.date.slice(-2)}</b><span>2026.09</span></time><div><span class="n-notice-tag">${i===0?'置頂 · ':''}${item.category}</span><h3>${item.title}</h3><span class="n-notice-campus">${item.campus}</span></div>${arrow}</button>`).join('')}</div></div>`,
    e: () => `<div class="n-journal-heading"><span class="n-kicker" lang="en">THE IVY JOURNAL</span><h2 id="latest-news-title">校園小日子，成長大故事。</h2><p>最新消息 · 收藏孩子每一次認真、勇敢與快樂的瞬間。</p>${more('更多校園故事')}</div><div class="n-journal-grid">${[articles[0],articles[1],journalStory].map((item,i)=>`<article class="n-journal-card"><button class="n-story" data-article="${item.id}"><div class="n-journal-image">${photo(item)}<span class="n-number">0${i+1}</span></div><div class="n-card-copy">${meta(item)}<h3>${item.title}</h3><p>${item.desc}</p><span class="n-read">看看這一天 ${arrow}</span></div></button></article>`).join('')}</div><div class="n-journal-notice"><span>給家長的一則提醒</span><strong>秋季校園開放日・歡迎來走走</strong><button data-event="visit">09.26 活動詳情 ${arrow}</button></div>`,
  };
  function mount() {
    const existing = document.querySelector('#latest-news');
    // The main homepage now includes A. Replace it only inside this comparison copy.
    if (existing && (!inContext || !existing.classList.contains('home-news'))) return;
    const target = inContext ? document.querySelector('#campuses') : document.querySelector('#news-preview');
    if (!target) return;
    const html = `<section id="latest-news" class="n-section n-${direction}" aria-labelledby="latest-news-title"><div class="n-container">${renderers[direction]()}${note}</div></section>`;
    if (inContext && existing) existing.outerHTML = html;
    else if (inContext) target.insertAdjacentHTML('afterend',html);
    else target.innerHTML = html;
    if (inContext) {
      requestAnimationFrame(() => {
        const news = document.querySelector('#latest-news');
        window.scrollTo({top:news.getBoundingClientRect().top+scrollY-250,behavior:'instant'});
      });
    }
  }
  mount();
  if (inContext) new MutationObserver(mount).observe(document.querySelector('#main'),{childList:true});

  const dialog = document.createElement('dialog');
  dialog.className = 'n-dialog'; dialog.setAttribute('aria-labelledby','n-dialog-title');
  dialog.innerHTML = '<div class="n-dialog-top"><span>常春藤 · 消息預覽</span><button data-close aria-label="關閉消息">關閉 ×</button></div><div id="n-dialog-body"></div>';
  document.body.append(dialog);
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  function show(html) {dialog.querySelector('#n-dialog-body').innerHTML=html;if(!dialog.open)dialog.showModal();}
  document.addEventListener('click',e=>{
    const article = e.target.closest('[data-article]');
    const eventButton = e.target.closest('[data-event]');
    const all = e.target.closest('[data-all]');
    const filter = e.target.closest('[data-campus]');
    if(article) {
      const item=[...articles,journalStory].find(a=>a.id===article.dataset.article);if(!item)return;
      show(`<span class="n-kicker">${item.campus} · ${item.category}</span><h2 id="n-dialog-title">${item.title}</h2>${meta(item)}${photo(item)}<p>${item.desc}</p><p class="n-dialog-demo">此為版面與閱讀互動示範，尚未對應正式消息。標題、日期與內容皆為範例。</p>`);
    } else if(eventButton) {
      const item=events.find(a=>a.id===eventButton.dataset.event);
      show(`<span class="n-kicker">${item.campus} · 活動示意</span><h2 id="n-dialog-title">${item.title}</h2><p class="n-dialog-date">${item.date} · ${item.month}</p><p>${item.desc}</p><p class="n-dialog-demo">這是示意活動，並非已公告的活動或開放報名。正式內容將由園方提供。</p>`);
    } else if(all) {
      const isEvent=all.dataset.all==='events';
      show(`<h2 id="n-dialog-title">${isEvent?'近期活動':'所有最新消息'}</h2><p class="n-dialog-demo">以下為設計示意內容。</p>${isEvent?events.map(event).join(''):(direction==='e'?[...articles,journalStory].sort((a,b)=>b.date.localeCompare(a.date)):articles).map(row).join('')}`);
    } else if(filter) {
      const campus=filter.dataset.campus;
      document.querySelectorAll('[data-campus]').forEach(b=>b.setAttribute('aria-pressed',String(b===filter)));
      const matching=campus==='所有分校'?articles.slice(0,3):articles.filter(a=>a.campus===campus);
      document.querySelector('#filtered-news').innerHTML=matching.map(card).join('');
      document.querySelector('#filter-status').textContent=`${campus}，顯示 ${matching.length} 則消息`;
      document.querySelector('#filter-count').textContent=`${campus} · ${campus==='所有分校'?'精選 ':''}${matching.length} 則`;
    }
  });
})();
