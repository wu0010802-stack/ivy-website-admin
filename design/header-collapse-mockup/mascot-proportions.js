// Shared dimensions keep the study and the real drawer trigger identical.
window.IvyMascotProportions = (() => {
  const presets = [
    {id:'portrait',code:'01',name:'人物主角',logo:72,lines:14,backing:100,shape:'none',note:'人物最大，三條線只作提示。'},
    {id:'balanced',code:'02',name:'均衡辨識',logo:64,lines:20,backing:100,shape:'none',note:'人物清楚，也容易辨認是選單。',pick:'推薦'},
    {id:'menu',code:'03',name:'選單更明顯',logo:56,lines:26,backing:100,shape:'none',note:'縮小人物，增加三條線的存在感。'},
    {id:'snug',code:'04',name:'背景少一點',logo:64,lines:20,backing:88,shape:'circle',note:'人物佔底板寬度 73%，較緊湊。'},
    {id:'airy',code:'05',name:'背景剛剛好',logo:64,lines:20,backing:100,shape:'circle',note:'人物佔底板寬度 64%，有呼吸感。',pick:'推薦'},
    {id:'spacious',code:'06',name:'背景多一點',logo:64,lines:20,backing:116,shape:'circle',note:'人物佔底板寬度 55%，更像一枚徽章。'}
  ];
  const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== null ? Math.min(max,Math.max(min,Number(value))) : fallback;
  function normalize(input = {}) {
    const seed = presets.find(item => item.id === input.ratio) || presets[1];
    return {ratio:seed.id,logo:bounded(input.logo,seed.logo,48,84),lines:bounded(input.lines,seed.lines,12,30),backing:bounded(input.backing,seed.backing,80,124),shape:['none','circle','soft'].includes(input.shape)?input.shape:seed.shape};
  }
  function geometry(value) {
    const logoH = value.logo * 132 / 124;
    const mark = value.lines + 16;
    const field = Math.max(logoH + 10, value.shape === 'none' ? 0 : value.backing);
    const extension = Math.max(0, value.logo / 2 + mark - 8 - field / 2);
    return {logoH,mark,field,width:field+extension,height:field,left:(field-value.logo)/2,top:(field-logoH)/2,markLeft:field/2+value.logo/2-8,markTop:field/2+logoH/2-mark+4};
  }
  function markup(value, asset, key) {
    const d = geometry(value);
    const filter = `ratio-cutout-${key}`;
    const gap = value.lines / 4;
    const c = d.mark/2, start = (d.mark-value.lines)/2;
    return `<span class="proportion-emblem" data-shape="${value.shape}" style="width:${d.width}px;height:${d.height}px" aria-hidden="true">
      <i class="proportion-surface" style="width:${value.backing}px;height:${value.backing}px;left:${(d.field-value.backing)/2}px;top:${(d.field-value.backing)/2}px"></i>
      <svg class="proportion-crest" viewBox="30 26 124 132" width="${value.logo}" height="${d.logoH}" style="left:${d.left}px;top:${d.top}px" focusable="false"><defs><filter id="${filter}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -4.252 -14.304 -1.444 20 0"/></filter></defs><image href="${asset}" width="552" height="192" filter="url(#${filter})"/></svg>
      <svg class="proportion-mark" viewBox="0 0 ${d.mark} ${d.mark}" width="${d.mark}" height="${d.mark}" style="left:${d.markLeft}px;top:${d.markTop}px" focusable="false"><circle cx="${c}" cy="${c}" r="${c-.75}"/><path d="M${start} ${c-gap}h${value.lines}M${start} ${c}h${value.lines}M${start} ${c+gap}h${value.lines}"/></svg>
    </span>`;
  }
  function query(value) { return new URLSearchParams({variant:'menu-only',frame:'mascot',ratio:value.ratio,logo:value.logo,lines:value.lines,backing:value.backing,shape:value.shape}).toString(); }
  return {presets,normalize,geometry,markup,query};
})();
