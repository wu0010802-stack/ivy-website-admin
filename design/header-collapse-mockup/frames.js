// Shared vector specimens for the comparison sheet and the live drawer trigger.
window.IvyFineFrames = {
  frames: [
    {id:'viewfinder',code:'D',name:'四角取景',note:'四個角各留一小段，方正、俐落。',shape:'<path d="M18 3H8a5 5 0 0 0-5 5v10M38 3h10a5 5 0 0 1 5 5v10M53 38v10a5 5 0 0 1-5 5H38M18 53H8a5 5 0 0 1-5-5V38"/>'},
    {id:'side-arcs',code:'E',name:'雙側圓弧',note:'上下留白，只用兩道弧線輕輕包住。',pick:'最輕盈',shape:'<path d="M12 7C1 17 1 39 12 49M44 7c11 10 11 32 0 42"/>'},
    {id:'open-square',code:'F',name:'開口方框',note:'右下留一道出口，線條往抽屜延伸。',shape:'<path d="M53 33V11a8 8 0 0 0-8-8H11a8 8 0 0 0-8 8v34a8 8 0 0 0 8 8h22"/>'},
    {id:'chamfer',code:'G',name:'斜切八角',note:'四角輕輕削去，帶一點建築的秩序。',shape:'<path d="M13 3h30l10 10v30L43 53H13L3 43V13Z"/>'},
    {id:'arch',code:'H',name:'拱門細框',note:'像一扇打開校園的小門，柔和又有記憶點。',pick:'推薦',shape:'<path d="M7 53V24a21 21 0 0 1 42 0v29Z"/>'},
    {id:'oval',code:'I',name:'直向橢圓',note:'把圓拉長一點，安靜、修長。',shape:'<ellipse cx="28" cy="28" rx="20" ry="25"/>'},
    {id:'soft-square',code:'J',name:'柔角軟框',note:'圓角一大一小，像一顆磨圓的小石子。',shape:'<path d="M25 3h20q8 0 8 8v20q0 22-22 22H11q-8 0-8-8V25Q3 3 25 3Z"/>'},
    {id:'orbit-dot',code:'K',name:'圓框微點',note:'圓框留一個缺口，用小點收尾。',shape:'<path d="M42 7a25 25 0 1 0 9 11"/><circle cx="48" cy="10" r="1.7" fill="currentColor" stroke="none"/>'},
    {round:3,id:'open-book',code:'L',name:'書頁留白',note:'像翻開的小書，書脊只留一筆。',pick:'書頁感',shape:'<path d="M24 8C17 4 10 4 4 7v41c8-4 15-4 24 1 9-5 16-5 24-1V7c-6-3-13-3-20 1M28 45v5"/>'},
    {round:3,id:'suspended-arcs',code:'M',name:'曲角懸框',note:'兩段圓弧錯開，留出呼吸的空間。',shape:'<path d="M4 34V24C4 11 13 4 27 4h7M52 22v10c0 13-9 20-23 20h-7"/>'},
    {round:3,id:'window-sides',code:'N',name:'窗扉兩側',note:'兩側像微開的窗，上下完全留白。',shape:'<path d="m12 5-7 4v38l7 4M44 5l7 4v38l-7 4"/>'},
    {round:3,id:'folded-corner',code:'O',name:'折頁小角',note:'右上折起一角，帶一點紙張感。',shape:'<path d="M11 3h27l15 15v27a8 8 0 0 1-8 8H11a8 8 0 0 1-8-8V11a8 8 0 0 1 8-8ZM38 3v15h15"/>'},
    {round:3,id:'paper-layers',code:'P',name:'雙層薄頁',note:'側邊多一條線，像兩張輕疊的紙。',shape:'<path d="M12 9h29a7 7 0 0 1 7 7v30a7 7 0 0 1-7 7H10a7 7 0 0 1-7-7V18a9 9 0 0 1 9-9ZM13 3h32a8 8 0 0 1 8 8v29"/>'},
    {round:3,id:'smile-bowl',code:'Q',name:'微笑托底',note:'只留一段向上的弧，輕輕托住三條線。',pick:'最輕盈',shape:'<path d="M5 20v9a23 23 0 0 0 46 0v-9"/>'},
    {round:3,id:'soft-diamond',code:'R',name:'柔菱細框',note:'轉一點角度，四個尖角全部磨圓。',shape:'<path d="M24 5q4-4 8 0l19 19q4 4 0 8L32 51q-4 4-8 0L5 32q-4-4 0-8Z"/>'},
    {round:3,id:'leaf-tip',code:'S',name:'葉尖圓框',note:'圓弧收成一個葉尖，保留自然的線條。',pick:'自然感',shape:'<path d="M50 4C31 2 9 10 5 29 1 47 14 55 30 51 48 47 53 23 50 4Z"/>'},
    {round:3,id:'twin-canopy',code:'T',name:'上下弧簷',note:'上下一對淺弧，像屋簷與地平線。',shape:'<path d="M6 15Q28-7 50 15M6 41q22 22 44 0"/>'},
    {round:3,id:'quiet-bubble',code:'U',name:'對話小尾',note:'圓角外框留一個小尾巴，親切、柔和。',shape:'<path d="M14 4h28q10 0 10 10v24q0 10-10 10H20l-9 5v-7q-7-2-7-10V14Q4 4 14 4Z"/>'},
    {round:3,id:'wide-capsule',code:'V',name:'橫向膠囊',note:'橫向拉開一點，圓潤而安定。',shape:'<rect x="2" y="9" width="52" height="38" rx="19"/>'},
    {round:3,id:'corner-glint',code:'W',name:'角落微光',note:'缺口旁留一顆小星，細節點到為止。',shape:'<path d="M33 4H12a8 8 0 0 0-8 8v32a8 8 0 0 0 8 8h32a8 8 0 0 0 8-8V23"/><path d="m45 2 2.4 5.6L53 10l-5.6 2.4L45 18l-2.4-5.6L37 10l5.6-2.4Z"/>'}
  ],
  border(id) {
    const frame = this.frames.find(frame => frame.id === id);
    return frame ? `<svg class="fine-frame-art" aria-hidden="true" focusable="false" viewBox="0 0 56 56">${frame.shape}</svg>` : '';
  },
  specimen(id) {
    return `<span class="fine-specimen" aria-hidden="true">${this.border(id)}<svg class="fine-menu-lines" viewBox="0 0 56 56"><path d="M15 21h26M15 28h26M15 35h26"/></svg></span>`;
  }
};
