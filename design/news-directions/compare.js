(() => {
  const options = {
    a:['活動＋新聞','最接近你提供的 UC San Diego 參考。左邊看活動日期，右邊看三則消息，兼顧家長查資訊與認識校園。'],
    b:['編輯選讀','一張主打照片搭配三則短消息，再加一條活動提醒。照片更有存在感，適合接續官網的校園故事。'],
    c:['五校動態','用六個分校篩選按鈕整理消息，家長可直接找到自己的校園。可以實際點選五校，看看資料量不同時的版面。'],
    d:['簡潔公告','以日期、分類和標題為主，深綠底讓這一段有明確節奏。照片少、行政通知多時也容易維護。'],
    e:['校園手札','三篇生活故事排成小刊物，用照片、留白與紙張色呈現溫度。適合經常累積校園日常與學習紀錄。'],
  };
  let direction=Object.hasOwn(options,location.hash.slice(1))?location.hash.slice(1):'a';
  let device='desktop';
  const frame=document.querySelector('#preview');
  function update() {
    const [title,note]=options[direction];
    document.querySelectorAll('[data-direction]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.direction===direction)));
    document.querySelectorAll('[data-device]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.device===device)));
    document.querySelector('#direction-title').textContent=`${direction.toUpperCase()}／${title}`;
    document.querySelector('#direction-note').textContent=note;
    const url=`${document.querySelector('#show-context').checked?'home':'view'}.html?direction=${direction}`;
    if(frame.getAttribute('src')!==url)frame.src=url;
    frame.classList.toggle('mobile',device==='mobile');
    frame.title=`${direction.toUpperCase()} ${title} ${device==='mobile'?'手機':'桌面'} mock-up`;
    document.querySelector('#standalone').href=url;
    history.replaceState(null,'',`#${direction}`);
  }
  document.querySelectorAll('[data-direction]').forEach(b=>b.addEventListener('click',()=>{direction=b.dataset.direction;update();}));
  document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>{device=b.dataset.device;update();}));
  document.querySelector('#show-context').addEventListener('change',update);
  update();
})();
