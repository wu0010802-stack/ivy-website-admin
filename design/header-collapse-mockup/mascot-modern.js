window.IvyModernMascot = (() => {
  const designs = [
    {id:'duo',code:'01',name:'雙欄膠囊',english:'DUO RAIL',width:148,height:82,logo:54,lines:24,pick:'首選',note:'人物與選單並列，共用一個外框。',detail:'像一個完整的導覽控制鈕，簡潔、好辨認。'},
    {id:'tab',code:'02',name:'直向書籤',english:'VERTICAL TAB',width:80,height:118,logo:56,lines:24,note:'人物在上，三條線收在下方。',detail:'輪廓窄而修長，適合安靜地留在畫面側邊。'},
    {id:'halo',code:'03',name:'開口光環',english:'OPEN HALO',width:116,height:106,logo:60,lines:24,pick:'最輕盈',note:'透明留白，三條線接在圓弧缺口。',detail:'讓頁面背景透出來，人物與線條自然連成一組。'},
    {id:'rise',code:'04',name:'浮出徽章',english:'FLOATING CREST',width:148,height:84,logo:60,lines:24,note:'人物輕輕越過底座，三條線留在右側。',detail:'深綠短條穩住輪廓，保留一點活潑的層次。'}
  ];
  function crest(design,asset,key,left,top){
    const id=`modern-cutout-${key}`;
    return `<svg class="modern-crest" width="${design.logo}" height="${design.logo*132/124}" viewBox="30 26 124 132" style="left:${left}px;top:${top}px" focusable="false"><defs><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -4.252 -14.304 -1.444 20 0"/></filter></defs><image href="${asset}" width="552" height="192" filter="url(#${id})"/></svg>`;
  }
  function lines(left,top){return `<svg class="modern-lines" width="24" height="24" viewBox="0 0 24 24" style="left:${left}px;top:${top}px" focusable="false"><path d="M0 5h24"/><path class="middle-line" d="M0 12h24"/><path d="M0 19h24"/></svg>`;}
  function markup(design,asset,key){
    let content='';
    if(design.id==='duo')content=`<i class="modern-surface"></i><i class="modern-divider"></i>${crest(design,asset,key,15,12)}${lines(104,29)}`;
    if(design.id==='tab')content=`<i class="modern-surface"></i><i class="modern-divider"></i>${crest(design,asset,key,12,11)}${lines(28,84)}`;
    if(design.id==='halo')content=`<svg class="modern-halo" width="100" height="100" viewBox="0 0 100 100" focusable="false"><circle cx="50" cy="50" r="47"/></svg>${crest(design,asset,key,20,17)}${lines(82,73)}`;
    if(design.id==='rise')content=`<i class="modern-surface"></i>${crest(design,asset,key,18,0)}${lines(105,42)}`;
    return `<span class="modern-emblem modern-${design.id}" style="width:${design.width}px;height:${design.height}px" aria-hidden="true">${content}</span>`;
  }
  return {designs,markup};
})();
