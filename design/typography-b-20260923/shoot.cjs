// 字體審查 B 批預覽：不改 web/ 原始碼，在執行中的 Nuxt 頁面注入改後樣式，拍改前／改後截圖。
// 用法：BASE=http://127.0.0.1:3162 node design/typography-b-20260923/shoot.cjs
const {chromium}=require(process.env.PW||'/Users/yilunwu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const fs=require('node:fs');
const path=require('node:path');
const BASE=process.env.BASE||'http://127.0.0.1:3162';
const OUT=path.join(__dirname,'shots');
fs.mkdirSync(OUT,{recursive:true});
const VISIT_WOFF=fs.readFileSync(path.join(__dirname,"../../web/public/assets/fonts/noto-serif-tc-500-visit.woff"));

const FONTFACE=`
@font-face{font-family:'Ivy Campus Serif';src:url('/assets/fonts/noto-serif-tc-500-campus.woff') format('woff');font-weight:500;font-display:block;unicode-range:U+4EC1,U+5206,U+570B,U+5D07,U+5FB7,U+660E,U+6821,U+6B66,U+7FA9,U+83EF,U+8A0A,U+8CC7,U+969B}
@font-face{font-family:'Ivy Campus Serif';src:url('/__typeb/visit.woff') format('woff');font-weight:500;font-display:block;unicode-range:U+3002,U+4F86,U+5712,U+5947,U+597D,U+5E36,U+8457,U+8D70,U+FF0C}`;
const CSS={
  // B-1 預約頁大標：系統 Songti TC → 自託管思源宋體 500（與首頁分校資訊同一套）
  visit:FONTFACE+`.visit-story h1{font-family:'Ivy Campus Serif','Noto Serif TC','Songti TC','PMingLiU',serif!important}`, // 預約頁是 scoped 樣式，預覽直接蓋 h1
  // B-2 分校頁校名：LINE Seed 800 → 思源宋體 500
  campus:FONTFACE+`.campus-hero h1{font-family:'Ivy Campus Serif','Noto Serif TC','Songti TC',serif;font-weight:500;letter-spacing:.065em}`,
  // B-3 標點「輕收」：只靠字型 halt。Chrome 預設 normal 已收相鄰標點（」，），trim-start 再把段首的開括號收半格
  lite:`h1,h2,h3{text-spacing-trim:trim-start}`,
  // B-3 標點「全收」：輕收＋逗號／頓號／句號兩側各收 0.2em／0.14em（LINE Seed TW 的「，。」墨色置中）
  full:`h1,h2,h3{text-spacing-trim:trim-start}.tp-comma{margin-inline:-.2em}.tp-stop{margin-inline:-.14em}`,
  // 順帶：分校頁 h2 只在標點後換行（同 A 批消息卡做法）
  phrase:`.section-title{word-break:keep-all;overflow-wrap:anywhere;text-wrap:balance}`,
};
const wrapPunct=()=>{
  for(const h of document.querySelectorAll('main h1,main h2,main h3')){
    if(h.closest('.studio-hero'))continue; // 首屏主標已有自己的 .punct 負邊距
    const walker=document.createTreeWalker(h,NodeFilter.SHOW_TEXT);const nodes=[];
    for(let n=walker.nextNode();n;n=walker.nextNode())if(/[，、。]/.test(n.data)&&!n.parentElement.closest('.punct,.tp-comma,.tp-stop'))nodes.push(n);
    for(const n of nodes){
      const frag=document.createDocumentFragment();
      for(const part of n.data.split(/([，、。])/)){
        if(!part)continue;
        if(/[，、。]/.test(part)){const s=document.createElement('span');s.className=part==='。'?'tp-stop':'tp-comma';s.textContent=part;frag.append(s)}
        else frag.append(part);
      }
      n.replaceWith(frag);
    }
  }
};

async function shot(page,loc,file,pad=28,maxW=Infinity){
  await loc.scrollIntoViewIfNeeded();await page.waitForTimeout(300);
  const b=await loc.boundingBox();const vp=page.viewportSize();
  const x=Math.max(0,b.x-pad),y=Math.max(0,b.y-pad);
  await page.screenshot({path:path.join(OUT,file),clip:{x,y,width:Math.min(vp.width-x,b.width+pad*2,maxW),height:Math.min(vp.height-y,b.height+pad*2)}});
}
async function open(browser,vp,mobile,url,variant){
  const ctx=await browser.newContext({viewport:vp,deviceScaleFactor:2,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce',locale:'zh-TW'});
  await ctx.route('**/__typeb/visit.woff',r=>r.fulfill({body:VISIT_WOFF,contentType:'font/woff'}));
  const page=await ctx.newPage();
  await page.goto(BASE+url,{waitUntil:'networkidle'});await page.waitForTimeout(700);
  if(variant&&CSS[variant])await page.addStyleTag({content:CSS[variant]});
  if(variant==='full')await page.evaluate(wrapPunct);
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(400);
  return {ctx,page};
}
const D={width:1440,height:900},M={width:390,height:844};

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const log=[];
  // B-1
  for(const v of ['now','visit']){
    const {ctx,page}=await open(browser,D,false,'/visit/yihua',v==='now'?null:v);
    const h=page.locator('.visit-story h1');
    await shot(page,h,`b1-visit-${v}.png`,10);
    log.push(`b1 ${v}: ${await h.evaluate(e=>getComputedStyle(e).fontFamily)}`);
    await ctx.close();
  }
  // B-2（含首頁分校資訊校名當對照）
  for(const [vp,mob,tag] of [[D,false,'desktop'],[M,true,'mobile']]){
    for(const v of ['now','campus']){
      const {ctx,page}=await open(browser,vp,mob,'/campuses/yihua',v==='now'?null:v);
      await shot(page,page.locator('.campus-hero').first(),`b2-campus-${tag}-${v}.png`,0,tag==='desktop'?720:Infinity); // 桌機只裁左側文字區
      await ctx.close();
    }
  }
  {
    const {ctx,page}=await open(browser,D,false,'/',null);
    await page.evaluate(()=>{const el=[...document.querySelectorAll('#campuses *')].find(e=>e.children.length===0&&e.textContent.trim()==='義華校'&&getComputedStyle(e).fontFamily.includes('Ivy Campus Serif'));el?.setAttribute('data-typeb-ref','')});
    await shot(page,page.locator('[data-typeb-ref]'),'b2-home-reference.png',40);
    await ctx.close();
  }
  // B-3
  const targets=[
    ['/', D,false,'.belief-main h2',0,'belief'],
    ['/', D,false,'.print-front h3',1,'print-why'],
    ['/', D,false,'.print-front h3',2,'print-self'],
    ['/', D,false,'.hn-card h3',1,'news'],
    ['/campuses/yihua', D,false,'.section-title',0,'campus-h2-desktop'],
    ['/campuses/yihua', M,true,'.section-title',0,'campus-h2-mobile'],
  ];
  for(const v of ['now','lite','full']){
    for(const [url,vp,mob,sel,idx,name] of targets){
      const {ctx,page}=await open(browser,vp,mob,url,v==='now'?null:v);
      const loc=page.locator(sel).nth(idx);
      await shot(page,loc,`b3-${name}-${v}.png`,20);
      if(name==='print-why')log.push(`b3 ${v} text-spacing-trim=${await loc.evaluate(e=>getComputedStyle(e).textSpacingTrim)}`);
      await ctx.close();
    }
  }
  for(const [vp,mob,tag] of [[D,false,'desktop'],[M,true,'mobile']]){
    const {ctx,page}=await open(browser,vp,mob,'/campuses/yihua','phrase');
    await shot(page,page.locator('.section-title').nth(0),`b3-campus-h2-${tag}-phrase.png`,20);
    await ctx.close();
  }
  await browser.close();
  console.log(log.join('\n'));
  console.log(fs.readdirSync(OUT).length,'shots');
})().catch(e=>{console.error(e);process.exit(1)});
