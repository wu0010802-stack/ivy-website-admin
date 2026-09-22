(() => {
  const data = window.BRIDGE_DATA;
  const params = new URLSearchParams(location.search);
  const variant = ['a', 'b', 'c'].includes(params.get('v')) ? params.get('v') : 'a';
  const assets = '../../web/public/assets/';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bridge = `<p class="bridge-copy"><span>想像孩子的這一天，</span><span>從認識一所校園開始。</span></p>`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const m = data.moment;
  document.body.className = 'variant-' + variant;
  document.getElementById('mock').innerHTML = `
    <section class="day-tail" aria-label="孩子的一天，最後一個片刻">
      <div class="film" aria-hidden="true"><img src="${assets}day-poster.webp" alt=""><video id="film" muted loop playsinline preload="metadata" poster="${assets}day-poster.webp"></video></div>
      <div class="tail-inner">
        <div class="watermark" aria-hidden="true">常春藤的一天</div>
        ${variant === 'b' ? `<div class="bridge bridge-b" id="bridge">${bridge}<p class="bridge-small">把今天的故事帶回家，再一起看看孩子的明天。</p></div>` : ''}
        <article class="last-card"><span class="tape" aria-hidden="true"></span>
          <button class="paper-button" id="paper" type="button" aria-label="翻看帶故事回家的背面" aria-expanded="false" aria-controls="print-back">
            <span id="print-front"><span class="print-photo"><img src="${assets}${m.photo}.webp" alt="${escape(m.alt)}"><span class="photo-caption">收拾物品・離園情境示意</span><span class="time">${m.time}</span></span><span class="print-foot"><small>06 / ${escape(m.label)}</small><strong>${escape(m.title)}</strong></span></span>
            <span class="print-back" id="print-back" hidden><strong>${escape(m.title)}</strong><span>${escape(m.story)}</span><br><br><span>${escape(m.question)}</span><br><span>${escape(m.answer)}</span></span>
          </button>
        </article>
      </div>
      <p class="source-note">${escape(data.note)}</p>
      <span class="day-label">義華校 · 遊藝表演</span><button class="film-control" id="film-toggle" type="button" aria-pressed="false">播放背景</button>
    </section>
    ${variant === 'a' ? `<section class="bridge bridge-a" id="bridge" aria-label="從孩子的日常走進校園">${bridge}</section>` : ''}
    ${variant === 'c' ? `<div class="bridge bridge-c" id="bridge">${bridge}</div>` : ''}
    <section class="campus-gallery" id="campuses" aria-labelledby="campus-title">
      <header class="gallery-heading"><div class="gallery-title"><h2 id="campus-title">分校資訊</h2><span lang="en">Campuses</span></div>
        <div class="campus-tabs" role="tablist" aria-label="選擇校區">${data.campuses.map((c,i)=>`<button type="button" role="tab" id="tab-${c.key}" aria-controls="campus-panel" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-campus="${i}"><img src="${assets}campus-line-art-${c.key}.webp" alt=""><span>${escape(c.name)}</span></button>`).join('')}</div>
      </header>
      <div id="campus-panel" role="tabpanel" aria-labelledby="tab-yihua">
        <div class="gallery-stage"><div class="gallery-track">${data.campuses.map((c,i)=>`<button type="button" class="campus-photo" data-photo="${i}" aria-label="選擇${escape(c.name)}"><img src="${assets}${c.image}.webp" alt="${escape(c.name)}校園圖像" style="object-position:${escape(c.panoramaPos||'center 55%')}"></button>`).join('')}</div></div>
        <div class="controls"><div class="dots" aria-label="選擇校區">${data.campuses.map((c,i)=>`<button type="button" class="dot" data-campus="${i}" aria-label="${escape(c.name)}" aria-pressed="${i===0}"></button>`).join('')}</div><button type="button" class="play-campus" id="play-campus" aria-label="開始自動播放校區" aria-pressed="false"></button></div>
        <div class="campus-details"><div><small id="district"></small><h3 id="campus-name"></h3><span class="english" lang="en" id="english"></span></div><div class="contact"><a id="address" target="_blank" rel="noopener"></a><a class="phone" id="phone"></a></div><a class="book" id="book" target="_blank" rel="noopener"></a></div>
      </div>
      <p class="campus-live" id="campus-live" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)"></p>
    </section>
    <p class="mock-end">承接段落 mock · 僅重現最後一張拍立得與分校區，尚未套用至官網。</p>`;
  const video = document.getElementById('film');
  video.src = assets + (matchMedia('(max-width:700px)').matches ? 'day-film-mobile.mp4' : 'day-film.mp4');
  const filmToggle = document.getElementById('film-toggle');
  let filmWanted = !reduced.matches;
  function filmState() {
    filmToggle.textContent = video.paused ? '播放背景' : '暫停背景';
    filmToggle.setAttribute('aria-pressed', String(!video.paused));
  }
  video.addEventListener('playing',()=>{video.classList.add('ready');filmState();});
  video.addEventListener('pause',filmState);
  video.addEventListener('error',()=>{filmToggle.hidden=true;video.classList.remove('ready');});
  filmToggle.addEventListener('click',()=>{filmWanted=video.paused;filmWanted?video.play().catch(filmState):video.pause();});
  let filmVisible=true;
  function syncFilm(){if(filmWanted&&filmVisible&&!document.hidden)video.play().catch(filmState);else video.pause();}
  new IntersectionObserver(entries=>{filmVisible=entries.at(-1).isIntersecting;syncFilm();},{threshold:0}).observe(document.querySelector('.day-tail'));
  document.addEventListener('visibilitychange',syncFilm);
  reduced.addEventListener('change',()=>{if(reduced.matches){filmWanted=false;syncFilm();playing=false;clearTimeout(timer);renderPlay();}});
  document.getElementById('paper').addEventListener('click',e=>{
    const b=e.currentTarget, flipped=b.getAttribute('aria-expanded')!=='true';
    // Keep the card's footprint stable while reading the mock back side.
    if(flipped)b.style.minHeight=b.getBoundingClientRect().height+'px';
    b.setAttribute('aria-expanded',String(flipped));b.setAttribute('aria-label',flipped?'回到帶故事回家的照片':'翻看帶故事回家的背面');
    document.getElementById('print-front').hidden=flipped;document.getElementById('print-back').hidden=!flipped;
  });
  let selected=0, playing=false, timer, campusVisible=false;
  const playButton=document.getElementById('play-campus');
  // Phosphor Regular play/pause paths, matching the existing site's icon family.
  function renderPlay(){playButton.innerHTML=playing?'<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z"/></svg>':'<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M232,114.34,88,26.26A16,16,0,0,0,64,39.92V216.08a16,16,0,0,0,24,13.66l144-88.08a16,16,0,0,0,0-27.32ZM80,216V40l144,88Z"/></svg>';playButton.setAttribute('aria-label',playing?'暫停自動播放校區':'開始自動播放校區');playButton.setAttribute('aria-pressed',String(playing));}
  function schedule(){clearTimeout(timer);if(playing&&campusVisible&&!document.hidden)timer=setTimeout(()=>{select(selected+1);schedule();},4000);}
  function select(index,announce=false){selected=(index+data.campuses.length)%data.campuses.length;const c=data.campuses[selected];document.querySelectorAll('[role=tab]').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===selected));b.tabIndex=i===selected?0:-1;});document.querySelectorAll('.dot').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selected)));document.querySelectorAll('[data-photo]').forEach((b,i)=>{let d=(i-selected+data.campuses.length)%data.campuses.length;if(d>2)d-=data.campuses.length;b.style.setProperty('--offset',d);b.classList.toggle('current',d===0);b.tabIndex=Math.abs(d)<=1?0:-1;b.setAttribute('aria-hidden',String(Math.abs(d)>1));});document.getElementById('campus-panel').setAttribute('aria-labelledby','tab-'+c.key);document.getElementById('district').textContent='高雄 · '+c.district;document.getElementById('campus-name').textContent=c.name;document.getElementById('english').textContent=c.key.toUpperCase()+' CAMPUS';const a=document.getElementById('address');a.textContent=c.address+' ↗';a.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(c.address);const p=document.getElementById('phone');p.textContent=c.phone;p.href='tel:'+c.phone;const book=document.getElementById('book');book.textContent='預約參觀'+c.name;book.href='http://127.0.0.1:3016/visit/'+c.key;if(announce)document.getElementById('campus-live').textContent=c.name;schedule();}
  document.querySelectorAll('[data-campus]').forEach(b=>b.addEventListener('click',()=>select(Number(b.dataset.campus),true)));
  document.querySelectorAll('[data-photo]').forEach(b=>b.addEventListener('click',()=>select(Number(b.dataset.photo),true)));
  document.querySelector('.campus-tabs').addEventListener('keydown',e=>{const next=e.key==='ArrowRight'?selected+1:e.key==='ArrowLeft'?selected-1:e.key==='Home'?0:e.key==='End'?data.campuses.length-1:null;if(next===null)return;e.preventDefault();select(next,true);document.querySelector('[role=tab][aria-selected=true]').focus();});
  playButton.addEventListener('click',()=>{playing=!playing;renderPlay();schedule();});
  new IntersectionObserver(entries=>{campusVisible=entries.at(-1).isIntersecting;schedule();},{threshold:.1}).observe(document.querySelector('.gallery-stage'));
  document.addEventListener('visibilitychange',schedule);
  document.querySelector('.campus-gallery').addEventListener('focusin',e=>{if(e.target!==playButton){playing=false;clearTimeout(timer);renderPlay();}});
  window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==='bridge-replay')window.scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});});
  select(0);renderPlay();
  if(params.get('start')==='seam')Promise.all([document.fonts.ready,...[...document.querySelectorAll('.last-card img')].map(img=>img.decode().catch(()=>{}))]).then(()=>requestAnimationFrame(()=>{const y=variant==='b'?100:document.getElementById('bridge').offsetTop-(innerWidth<700?240:260);window.scrollTo({top:Math.max(0,y),behavior:'instant'});}));
})();
