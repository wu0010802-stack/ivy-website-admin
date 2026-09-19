(() => {
  'use strict';
  const track = document.querySelector('.hc-track');
  if (!track) return;
  const pin = track.querySelector('.hc-pin');
  const art = track.querySelector('.hc-art');
  const range = track.querySelector('input[type=range]');
  const play = track.querySelector('.hc-play');
  const phase = track.querySelector('.hc-phase');
  const status = track.querySelector('.hc-status');
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const mobile = matchMedia('(max-width:800px)');
  const fallbackRequested = new URLSearchParams(location.search).has('fallback');
  const svgNS = 'http://www.w3.org/2000/svg';
  const clamp = v => Math.max(0, Math.min(1, v));
  const segment = (p, a, b) => clamp((p - a) / (b - a));
  const smooth = v => v * v * (3 - 2 * v);
  const lerp = (a,b,t) => a + (b-a)*t;
  const path = (a,b,c,t) => (1-t)*(1-t)*a+2*(1-t)*t*b+t*t*c;
  const translate = (x,y,s=1,r=0) => `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
  const photos = [
    ['hello','08:00','早安入園'],['discover','09:10','好奇探索'],['lunch','11:40','午餐時光'],
    ['rest','12:30','安靜片刻'],['outside','14:20','午後玩耍'],['home','16:30','帶故事回家']
  ];
  photos.forEach(([key,time,title],i) => {
    const g=document.createElementNS(svgNS,'g');g.classList.add('hc-photo');
    const src=key==='rest'?'../../assets/classroom.webp':`../day-stories-demo/media/${key}.webp`;
    g.innerHTML=`<rect class="hc-photo-frame" x="-65" y="-74" width="130" height="154" rx="1"/><image href="${src}" x="-56" y="-65" width="112" height="108" preserveAspectRatio="xMidYMid slice"/><text class="hc-time" x="-53" y="60">${time}</text><text x="-53" y="73">${title}</text>`;
    track.querySelector('.hc-photos').append(g);
  });
  let motions=[], animations=[], style=null, start=0, distance=1, frame=0, autoFrame=0, running=false, progress=0, layoutMobile=mobile.matches;
  const stages=['01 / 收好今天','02 / 背上故事','03 / 一起回家'];
  function buildMotions(){
    const m=mobile.matches;layoutMobile=m;
    art.setAttribute('viewBox',m?'0 0 720 680':'0 0 1200 630');
    const childStart=m?10:260, childEnd=m?135:470, parentX=m?369:704;
    const bagStart=m?[300,365]:[550,335];
    function walk(p){return smooth(segment(p,.70,.94));}
    function childX(p){return lerp(childStart,childEnd,walk(p));}
    function bob(p){const t=segment(p,.70,.94);return -Math.sin(t*Math.PI*6)*2.5*Math.sin(t*Math.PI);}
    function bag(p){
      const t=smooth(segment(p,.56,.70));
      return translate(lerp(bagStart[0],childX(p)+91,t),lerp(bagStart[1],357+bob(p),t),lerp(.9,.36,t),lerp(-3,-12,t));
    }
    motions=[];
    const add=(selector,fn)=>{const el=track.querySelector(selector);el.classList.add('hc-motion');motions.push({el,fn});};
    add('.hc-backdrop',p=>({opacity:1-smooth(segment(p,0,.15))}));
    add('.hc-copy',p=>({opacity:1-smooth(segment(p,.62,.77)),transform:translate(0,-12*smooth(segment(p,.62,.77)))}));
    add('.hc-final-copy',p=>({opacity:smooth(segment(p,.80,.94)),transform:translate(0,14*(1-smooth(segment(p,.80,.94))))}));
    add('.hc-landscape',p=>({opacity:smooth(segment(p,.57,.85)),transform:m?'translate(-338px, 0px)':'translate(0px, 0px)'}));
    add('.hc-parent',p=>({opacity:smooth(segment(p,.59,.73)),transform:translate(parentX,120)}));
    add('.hc-child',p=>({opacity:smooth(segment(p,.47,.61)),transform:translate(childX(p),120+bob(p),1,0)}));
    ['.hc-bag-back','.hc-bag-front','.hc-flap-wrap'].forEach(s=>add(s,p=>({transform:bag(p)})));
    add('.hc-flap',p=>({opacity:segment(p,.48,.5),transform:`translate(0px,44px) scaleY(${smooth(segment(p,.48,.57)).toFixed(3)}) translate(0px,-44px)`}));
    add('.hc-hold',p=>({opacity:smooth(segment(p,.93,.97)),transform:translate(childEnd+298,335)}));
    const origins=m?[[70,120,-12],[245,92,7],[415,110,-7],[575,160,12],[110,280,-8],[542,309,8]]:[[460,88,-12],[650,60,8],[825,115,-8],[1000,225,11],[350,300,-8],[970,390,7]];
    [...track.querySelectorAll('.hc-photo')].forEach((el,i)=>{
      el.classList.add('hc-motion');
      motions.push({el,fn:p=>{
        const t=smooth(segment(p,.07+i*.052,.21+i*.052));
        const [x,y,r]=origins[i];
        const targetX=bagStart[0]+95, targetY=bagStart[1]+118;
        return {transform:translate(path(x,targetX+(i%2?90:-90),targetX,t),path(y,Math.min(y,bagStart[1])-80,targetY,t),lerp(m?.78:.98,.27,t),lerp(r,i%2?5:-5,t)),opacity:1-smooth(segment(t,.83,1))};
      }});
    });
    motions.forEach(({el})=>{el.style.animationName='none';el.style.transform='';el.style.opacity='';});
    animations.forEach(a=>a.cancel());animations=[];style?.remove();
    if(reduce.matches){track.dataset.renderer='static';renderStatic();return;}
    const native=!fallbackRequested&&CSS.supports('animation-timeline: view()')&&CSS.supports('animation-range: contain 0% contain 100%');
    track.dataset.renderer=native?'native':'fallback';
    if(native){
      style=document.createElement('style');
      style.textContent=motions.map(({el,fn},i)=>{
        el.style.animationName=`hc-sequence-${i}`;
        return `@keyframes hc-sequence-${i}{${Array.from({length:101},(_,n)=>`${n}%{${Object.entries(fn(n/100)).map(([k,v])=>`${k}:${v}`).join(';')}}`).join('')}}`;
      }).join('\n');document.head.append(style);
    }else{
      animations=motions.map(({el,fn})=>{const a=el.animate(Array.from({length:101},(_,i)=>({...fn(i/100),offset:i/100})),{duration:1000,fill:'both',easing:'linear'});a.pause();return a;});
    }
  }
  function renderStatic(){motions.forEach(({el,fn})=>Object.assign(el.style,fn(1)));range.value='1000';phase.textContent=stages[2];}
  function measure(){const h=Number.parseFloat(getComputedStyle(pin).top)||0;start=track.getBoundingClientRect().top+scrollY-h;distance=Math.max(1,track.offsetHeight-pin.offsetHeight);}
  function update(){frame=0;if(reduce.matches)return;progress=clamp((scrollY-start)/distance);range.value=String(Math.round(progress*1000));phase.textContent=stages[progress<.53?0:progress<.74?1:2];range.setAttribute('aria-valuetext',`${Math.round(progress*100)}%，${phase.textContent.slice(5)}`);animations.forEach(a=>{a.currentTime=progress*1000;});}
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  function setProgress(p){if(reduce.matches)return;window.scrollTo({top:start+clamp(p)*distance,behavior:'instant'});update();}
  function stop(){running=false;cancelAnimationFrame(autoFrame);autoFrame=0;play.querySelector('[aria-hidden]').textContent='▶';play.querySelector('.hc-play-label').textContent='播放動畫';play.setAttribute('aria-label','播放回家動畫');}
  function togglePlay(){
    if(running){stop();status.textContent='動畫已暫停';return;}
    if(reduce.matches)return;
    if(progress>.985)setProgress(0);
    const from=progress,began=performance.now(),duration=(1-from)*12500;
    running=true;play.querySelector('[aria-hidden]').textContent='Ⅱ';play.querySelector('.hc-play-label').textContent='暫停';play.setAttribute('aria-label','暫停回家動畫');status.textContent='播放回家動畫';
    function tick(now){if(!running)return;const t=clamp((now-began)/duration);setProgress(lerp(from,1,t));if(t<1)autoFrame=requestAnimationFrame(tick);else{stop();status.textContent='今天的故事，已經帶回家了';}}
    autoFrame=requestAnimationFrame(tick);
  }
  play.addEventListener('click',togglePlay);
  range.addEventListener('input',()=>{stop();setProgress(Number(range.value)/1000);});
  track.querySelector('.hc-replay').addEventListener('click',()=>{stop();setProgress(0);status.textContent='已回到動畫開頭';});
  addEventListener('wheel',stop,{passive:true});addEventListener('touchstart',stop,{passive:true});
  addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key)&&e.target!==play)stop();});
  addEventListener('scroll',schedule,{passive:true});
  addEventListener('resize',()=>{if(mobile.matches!==layoutMobile){stop();buildMotions();}measure();schedule();},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  reduce.addEventListener('change',()=>{stop();buildMotions();measure();schedule();});
  buildMotions();measure();update();
  document.fonts.ready.then(()=>{measure();schedule();});
  addEventListener('load',()=>{measure();schedule();},{once:true});
})();
