// 截圖：node shoot.cjs [a b c]（需先在 repo 根目錄啟動 python3 -m http.server 8886 --bind 127.0.0.1）
const path=require('path'),fs=require('fs');
const pwPath=fs.readdirSync(path.join(process.env.HOME,'.npm/_npx')).map(d=>path.join(process.env.HOME,'.npm/_npx',d,'node_modules/playwright-core')).find(p=>fs.existsSync(p));
const {chromium}=require(pwPath);
const BASE='http://127.0.0.1:8886/index.html';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const variants=process.argv.slice(2).length?process.argv.slice(2):['a','b','c'];
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const devices={desktop:{width:1440,height:900,scale:1},phone:{width:390,height:844,isMobile:true,hasTouch:true,scale:2}};
 for(const [dev,vp] of Object.entries(devices)){
  for(const v of variants){
   const ctx=await browser.newContext({viewport:{width:vp.width,height:vp.height},isMobile:!!vp.isMobile,hasTouch:!!vp.hasTouch,deviceScaleFactor:vp.scale,locale:'zh-TW'});
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.goto(`${BASE}?campus=${v}#/home`,{waitUntil:'networkidle'});
   await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(()=>{document.querySelectorAll('video').forEach(x=>{x.pause();});});
   const geo=await page.evaluate(()=>{const s=document.querySelector('.campus-scroll');const r=s.getBoundingClientRect();return {start:r.top+scrollY,height:r.height,screen:innerHeight,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};});
   const dist=geo.height-geo.screen;
   const stops=dev==='desktop'?[0,1,1.5,2,4]:[0,2,4];
   for(const t of stops){
    await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),Math.round(geo.start+dist*(t/4))+1);
    await wait(t%1?150:1100);
    await page.screenshot({path:`shots/${v}-${dev}-t${String(t).replace('.','_')}.png`});
   }
   // 簾幕掀開一半時的接縫
   if(dev==='desktop'){await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),Math.round(geo.start-geo.screen*.35));await wait(600);await page.screenshot({path:`shots/${v}-${dev}-curtain.png`});}
   const state=await page.evaluate(()=>({t:getComputedStyle(document.querySelector('.campus-scroll')).getPropertyValue('--t'),active:document.querySelector('.cs-panel.is-active')?.dataset.campus,live:document.querySelector('#campus-live').textContent}));
   console.log(v,dev,JSON.stringify({...geo,dist,...state}),errors.length?errors:'');
   await ctx.close();
  }
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
