// 產生「五校入口重排」mock-up 的 artboards（.dc.html）與 canvas.json。
// 只改這個檔，然後 `node build.mjs`；照片由 ../../assets 裁成 4:3 的 *.jpg（見 README）。
import fs from 'node:fs';

const T = {
  paper:'oklch(99% .008 95)', cream:'oklch(96% .018 95)', green:'oklch(37% .057 157)', leaf:'oklch(48% .075 155)',
  deep:'oklch(28% .04 162)', text:'oklch(31% .025 160)', muted:'oklch(47% .025 155)', line:'oklch(86% .018 145)',
  mint:'oklch(88% .022 150)', yellow:'oklch(87% .13 88)', sage:'oklch(94% .024 140)', orange:'oklch(69% .13 43)',
  mapBg:'oklch(97.5% .008 105)', mapOther:'oklch(98.5% .006 100)',
};
const BODY = "'PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const HEAD = "'LINE Seed TW','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const fontB64 = fs.readFileSync('../../assets/fonts/lineseed-bd.woff').toString('base64');

const campuses = [
  {key:'yihua', intro:'在義華路上，走進孩子的日常。', name:'義華校', district:'三民區', address:'高雄市三民區義華路68號', phone:'07-392-8366', img:'campus.jpg', line:'https://lin.ee/gwl8fnA', facebook:'https://www.facebook.com/ivy.kids.fb/'},
  {key:'minghua', intro:'在明華一路，認識我們的校園。', name:'明華校', district:'左營區', address:'高雄市左營區明華一路176號', phone:'07-556-6796', img:'minghua.jpg'},
  {key:'chongde', intro:'從崇德路，開始一段校園探索。', name:'崇德校', district:'左營區', address:'高雄市左營區崇德路87號', phone:'07-341-6286', img:'chongde.jpg'},
  {key:'international', intro:'走進鳥松，認識國際校。', name:'國際校', district:'鳥松區', address:'高雄市鳥松區球場路59號', phone:'07-370-8001', img:'international.jpg'},
  {key:'renwu', intro:'在仁武，遇見下一段成長。', name:'仁武校', district:'仁武區', address:'高雄市仁武區京吉一路102號', phone:'07-375-7081', img:'renwu.jpg'},
];

// Phosphor Regular（站內 sprite 同款）＋ Simple Icons 的 LINE／Facebook（站內例外）。
const PATHS = {
  'arrow-up-right':'M200 64v104a8 8 0 0 1-16 0V83.31L69.66 197.66a8 8 0 0 1-11.32-11.32L172.69 72H88a8 8 0 0 1 0-16h104a8 8 0 0 1 8 8',
  plus:'M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8',
  minus:'M224 128a8 8 0 0 1-8 8H40a8 8 0 0 1 0-16h176a8 8 0 0 1 8 8',
  phone:'m222.37 158.46l-47.11-21.11l-.13-.06a16 16 0 0 0-15.17 1.4a8 8 0 0 0-.75.56L134.87 160c-15.42-7.49-31.34-23.29-38.83-38.51l20.78-24.71c.2-.25.39-.5.57-.77a16 16 0 0 0 1.32-15.06v-.12L97.54 33.64a16 16 0 0 0-16.62-9.52A56.26 56.26 0 0 0 32 80c0 79.4 64.6 144 144 144a56.26 56.26 0 0 0 55.88-48.92a16 16 0 0 0-9.51-16.62M176 208A128.14 128.14 0 0 1 48 80a40.2 40.2 0 0 1 34.87-40a.6.6 0 0 0 0 .12l21 47l-20.67 24.74a6 6 0 0 0-.57.77a16 16 0 0 0-1 15.7c9.06 18.53 27.73 37.06 46.46 46.11a16 16 0 0 0 15.75-1.14a8 8 0 0 0 .74-.56L168.89 152l47 21.05h.11A40.21 40.21 0 0 1 176 208',
  'map-pin':'M128 64a40 40 0 1 0 40 40a40 40 0 0 0-40-40m0 64a24 24 0 1 1 24-24a24 24 0 0 1-24 24m0-112a88.1 88.1 0 0 0-88 88c0 31.4 14.51 64.68 42 96.25a254.2 254.2 0 0 0 41.45 38.3a8 8 0 0 0 9.18 0a254.2 254.2 0 0 0 41.37-38.3c27.45-31.57 42-64.85 42-96.25a88.1 88.1 0 0 0-88-88m0 206c-16.53-13-72-60.75-72-118a72 72 0 0 1 144 0c0 57.23-55.47 105-72 118',
  'navigation-arrow':'M237.33 106.21L61.41 41l-.16-.05a16 16 0 0 0-20.35 20.3a1 1 0 0 0 .05.16l65.26 175.92A15.77 15.77 0 0 0 121.28 248h.3a15.77 15.77 0 0 0 15-11.29l.06-.2l21.84-78l78-21.84l.2-.06a16 16 0 0 0 .62-30.38Zm-87.49 38.09a8 8 0 0 0-5.54 5.54l-23 82.16l-.06-.17L56 56l175.82 65.22l.16.06Z',
  line:'M19.365 9.863a.631.631 0 0 1 0 1.261H17.61v1.125h1.755a.63.63 0 1 1 0 1.259h-2.386a.63.63 0 0 1-.627-.629V8.108c0-.345.282-.63.63-.63h2.386a.63.63 0 0 1-.003 1.26H17.61v1.125zm-3.855 3.016a.63.63 0 0 1-.631.627a.62.62 0 0 1-.51-.25l-2.443-3.317v2.94a.63.63 0 0 1-1.257 0V8.108a.627.627 0 0 1 .624-.628c.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63c.345 0 .63.285.63.63zm-5.741 0a.63.63 0 0 1-.631.629a.63.63 0 0 1-.627-.629V8.108c0-.345.282-.63.63-.63c.346 0 .628.285.628.63zm-2.466.629H4.917a.634.634 0 0 1-.63-.629V8.108c0-.345.285-.63.63-.63c.348 0 .63.285.63.63v4.141h1.756a.63.63 0 0 1 0 1.259M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608c.391.082.923.258 1.058.59c.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645c1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314',
  facebook:'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978c.401 0 .955.042 1.468.103a9 9 0 0 1 1.141.195v3.325a9 9 0 0 0-.653-.036a27 27 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.7 1.7 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103l-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647',
};
// 站內 index.html 的 Phosphor sprite（含 Simple Icons 的 LINE／Facebook）優先，手抄表當備援。
for (const m of fs.readFileSync('../../index.html','utf8').matchAll(/<symbol id="i-([\w-]+)" viewBox="([^"]+)"><path fill="currentColor" d="([^"]+)"\/>/g)) PATHS[m[1]] = m[3];
const icon = (name, size=18, color='currentColor') => {
  const vb = (name==='line'||name==='facebook') ? '0 0 24 24' : '0 0 256 256';
  return `<svg width="${size}" height="${size}" viewBox="${vb}" aria-hidden="true" focusable="false" style="flex-shrink: 0; color: ${color};"><path fill="currentColor" d="${PATHS[name]}"></path></svg>`;
};

// ---------- 共用樣式 ----------
const baseCss = `
@font-face { font-family: 'LINE Seed TW'; font-weight: 700; font-display: swap; src: url(data:font/woff;base64,${fontB64}) format('woff'); }
* { box-sizing: border-box; }
body { margin: 0; background: ${T.cream}; color: ${T.text}; font: 16px/1.8 ${BODY}; -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration: none; }
a:hover { color: ${T.leaf}; }
button { font: inherit; color: inherit; cursor: pointer; }
h2, h3, p, dl, dd { margin: 0; }
img { display: block; max-width: 100%; height: auto; object-fit: cover; }
.entry:hover .entry-title { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 6px; text-decoration-color: ${T.green}; }
.entry:hover, .row:hover { color: inherit; }
.entry:focus-visible, .row:focus-visible, .bar:focus-visible, .tab:focus-visible, .button:focus-visible, .soc:focus-visible, .route:focus-visible { outline: 3px solid ${T.leaf}; outline-offset: 5px; }
.row:hover .entry-title { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: ${T.green}; }
.bar:hover .bar-action { color: ${T.leaf}; }
.tab:hover { color: ${T.leaf}; }
.button:hover { background: ${T.deep}; color: ${T.paper}; }
.soc:hover, .route:hover { color: ${T.leaf}; }
`;

const doc = (body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${baseCss}</style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;

// ---------- 區塊零件 ----------
const eyebrow = (mb=18) => `<span style="display: block; font-size: 13px; font-weight: 500; letter-spacing: 0.1em; line-height: 1.8; color: ${T.leaf}; margin-bottom: ${mb}px;">五校介紹</span>`;
const title = (size) => `<h2 style="font-family: ${HEAD}; font-size: ${size}px; font-weight: 700; line-height: 1.55; letter-spacing: 0.01em; text-wrap: balance;">五所校園，等你來認識。</h2>`;
const lede = (size) => `<p style="max-width: 400px; color: ${T.muted}; font-size: ${size}px; line-height: 1.8;">從生活圈與接送路線出發，<br>找到適合你與孩子的常春藤。</p>`;

const headingDesktop = () => `<div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 32px; margin-bottom: 44px;">
  <div>${eyebrow()}${title(38.88)}</div>
  ${lede(16)}
</div>`;
const headingMobile = () => `<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 20px; margin-bottom: 20px;">
  <div>${eyebrow()}${title(28.8)}</div>
  ${lede(14)}
</div>`;

// 桌機校園入口：照片＋校名＋地區，三層，整塊是一個連結。
const entry = (c, extra='') => `<a class="entry" href="#/${c.key}" aria-label="認識${c.name}" style="display: flex; flex-direction: column; gap: 16px; border-radius: 2px; ${extra}">
  <img src="${c.img}" alt="" style="width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 2px;">
  <div style="display: flex; flex-direction: column; gap: 6px;">
    <span style="display: inline-flex; align-items: center; gap: 6px; font-family: ${HEAD}; font-size: 22px; font-weight: 700; line-height: 1.4; color: ${T.text};"><span class="entry-title">${c.name}</span>${icon('arrow-up-right', 18, T.green)}</span>
    <span style="font-size: 15px; line-height: 1.6; color: ${T.muted};">高雄 · ${c.district}</span>
  </div>
</a>`;
const gridDesktop = () => `<div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 24px;">
${campuses.map(c=>entry(c)).join('\n')}
</div>`;

// 展開列：同一列切換「展開 ＋」／「收合 －」。
const bar = (open, {mt=48, h=64, size=16}={}) => `<button type="button" class="bar" aria-expanded="${open}" aria-controls="campus-contact" style="display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 16px; min-height: ${h}px; margin-top: ${mt}px; padding: 0; border: 0; border-top: 1px solid ${T.line}; border-bottom: 1px solid ${T.line}; background: transparent; text-align: left; color: ${T.text};">
  <span style="font-size: ${size}px; font-weight: 600;">校區位置與聯絡資訊</span>
  <span class="bar-action" style="display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: ${T.green};">${open?'收合':'展開'}${icon(open?'minus':'plus', 18)}</span>
</button>`;

// 校區選單：已選＝粗體＋2px 底線，不只靠顏色。
const tabs = (selected, {size=15, gap=20}={}) => `<div role="tablist" aria-label="選擇校區" style="display: flex; flex-wrap: wrap; gap: 0 ${gap}px;">
${campuses.map(c=>{const on=c.key===selected;return `  <button type="button" role="tab" class="tab" aria-selected="${on}" style="min-height: 44px; padding: 0 2px; border: 0; border-bottom: 2px solid ${on?T.green:'transparent'}; background: transparent; font-size: ${size}px; font-weight: ${on?700:400}; color: ${on?T.green:T.text};">${c.name}</button>`;}).join('\n')}
</div>`;

const info = (c, {dd=16}={}) => `<dl style="display: flex; flex-direction: column; gap: 16px;">
  <div>
    <dt style="display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 1.8; color: ${T.muted};">${icon('map-pin', 14)}所在地</dt>
    <dd style="margin-top: 2px; font-size: ${dd}px; line-height: 1.8;">${c.address}</dd>
  </div>
  <div>
    <dt style="display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 1.8; color: ${T.muted};">${icon('phone', 14)}參觀專線</dt>
    <dd style="margin-top: 2px;"><a href="tel:${c.phone}" style="font-size: 18px; font-weight: 600; line-height: 1.8; color: ${T.text};">${c.phone}</a></dd>
  </div>
</dl>`;

const bookButton = (c, full=false) => `<a class="button" href="#/visit/${c.key}" style="display: inline-flex; ${full?'width: 100%; ':''}align-items: center; justify-content: center; gap: 10px; min-height: 52px; padding: 12px 28px; border: 1px solid transparent; border-radius: 2px; background: ${T.green}; color: ${T.paper}; font-weight: 600; line-height: 1.5; align-self: ${full?'stretch':'flex-start'};">預約參觀${c.name}</a>`;

const social = (c, {size=14, gap=24}={}) => {
  const lineEl = c.line
    ? `<a class="soc" href="${c.line}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: ${size}px; font-weight: 600; color: ${T.text};">${icon('line', 16, T.green)}加 LINE 好友${icon('arrow-up-right', 14, T.green)}</a>`
    : `<span style="display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: ${size}px; color: ${T.muted};">${icon('line', 16, T.muted)}LINE 官方帳號待補</span>`;
  const fb = `<a class="soc" href="${c.facebook||'https://www.facebook.com/ivykid'}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: ${size}px; font-weight: 600; color: ${T.text};">${icon('facebook', 16, T.green)}Facebook 粉絲專頁${icon('arrow-up-right', 14, T.green)}</a>`;
  return `<div style="display: flex; flex-wrap: wrap; gap: 0 ${gap}px;">${lineEl}${fb}</div>`;
};

// ---------- 五校位置示意圖（座標來自 design/campus-directions/map-data.js） ----------
const mapSrc = fs.readFileSync('../campus-directions/map-data.js','utf8').replace('window.CAMPUS_MAP','globalThis.CAMPUS_MAP');
(0, eval)(mapSrc);
const M = globalThis.CAMPUS_MAP;
const mapSvg = (selected, vb, {height, labelSize=13}) => {
  const [vx,vy,vw,vh] = vb;
  const core = M.districts.filter(d=>d.core), other = M.districts.filter(d=>!d.core);
  const pins = Object.entries(M.pins);
  const pinFor = ([key,p]) => {
    const name = campuses.find(c=>c.key===key).name;
    if (key===selected) {
      const s = 30/256, w = 30;
      return `<g><path transform="translate(${(p.x-w/2).toFixed(1)} ${(p.y-w+2).toFixed(1)}) scale(${s.toFixed(4)})" fill="${T.green}" d="${PATHS['map-pin']}"></path>
      <rect x="${(p.x+14).toFixed(1)}" y="${(p.y-24).toFixed(1)}" width="${labelSize*3+18}" height="${labelSize+14}" rx="2" fill="${T.paper}" stroke="${T.line}"></rect>
      <text x="${(p.x+23).toFixed(1)}" y="${(p.y-24+labelSize+3).toFixed(1)}" font-size="${labelSize}" font-weight="700" fill="${T.green}" font-family="${BODY}">${name}</text></g>`;
    }
    return `<g><circle cx="${p.x}" cy="${p.y}" r="5.5" fill="${T.green}" stroke="${T.paper}" stroke-width="2"></circle>
    <text x="${(p.x+10).toFixed(1)}" y="${(p.y+4.5).toFixed(1)}" font-size="${labelSize}" font-weight="600" fill="${T.text}" font-family="${BODY}">${name}</text></g>`;
  };
  return `<svg viewBox="${vx} ${vy} ${vw} ${vh}" width="100%" height="${height}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="五校位置示意圖，目前標示${campuses.find(c=>c.key===selected).name}" style="display: block; background: ${T.mapBg};">
  <g stroke="${T.line}" stroke-width="1" stroke-linejoin="round">
    ${other.map(d=>`<path d="${d.d}" fill="${T.mapOther}"></path>`).join('\n    ')}
    ${core.map(d=>`<path d="${d.d}" fill="${T.sage}"></path>`).join('\n    ')}
  </g>
  <g font-family="${BODY}" font-size="12" fill="${T.muted}" text-anchor="middle">
    ${core.map(d=>`<text x="${d.cx}" y="${d.cy}">${d.name}</text>`).join('\n    ')}
  </g>
  ${pins.filter(([k])=>k!==selected).map(pinFor).join('\n  ')}
  ${pins.filter(([k])=>k===selected).map(pinFor).join('\n  ')}
</svg>`;
};
const mapBlock = (selected, vb, opts) => `<div style="position: relative; border: 1px solid ${T.line}; border-radius: ${opts.radius||2}px; overflow: hidden; background: ${T.mapBg};">
  ${mapSvg(selected, vb, opts)}
  <a class="route" href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(campuses.find(c=>c.key===selected).address)}" target="_blank" rel="noopener" style="position: absolute; right: 12px; top: 12px; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 8px 12px; border: 1px solid ${T.line}; border-radius: 2px; background: ${T.paper}; font-size: 13px; font-weight: 600; color: ${T.text};">${icon('navigation-arrow', 14)}規劃路線${icon('arrow-up-right', 14)}</a>
</div>`;

// ---------- 桌機：目錄（收合） ----------
const yihua = campuses[0];
const desktopShell = (inner, minH) => `<section style="width: 1440px; min-height: ${minH}px; background: ${T.cream}; padding: 80px 80px;">
  <div style="width: 1280px; margin: 0 auto;">
${inner}
  </div>
</section>`;

const Main = doc(desktopShell(`${headingDesktop()}
${gridDesktop()}
${bar(false)}`, 700));

const DesktopExpanded = doc(desktopShell(`${headingDesktop()}
${gridDesktop()}
${bar(true)}
<div id="campus-contact" style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 48px; padding-top: 40px;">
  <div style="display: flex; flex-direction: column; gap: 28px; padding-right: 48px; border-right: 1px solid ${T.line};">
    ${tabs('yihua')}
    ${info(yihua)}
    ${bookButton(yihua)}
    ${social(yihua)}
  </div>
  ${mapBlock('yihua', [80,150,480,270], {height: 460})}
</div>`, 1200));

// ---------- 手機：五列目錄 ----------
const row = (c, i) => `<a class="row" href="#/${c.key}" aria-label="認識${c.name}" style="display: grid; grid-template-columns: 112px minmax(0, 1fr) auto; align-items: center; column-gap: 16px; padding: 16px 0; ${i?`border-top: 1px solid ${T.line};`:''}">
  <img src="${c.img}" alt="" style="width: 112px; height: 84px; object-fit: cover; border-radius: 2px;">
  <div style="display: flex; flex-direction: column; gap: 4px;">
    <span class="entry-title" style="font-family: ${HEAD}; font-size: 20px; font-weight: 700; line-height: 1.4; color: ${T.text};">${c.name}</span>
    <span style="font-size: 14px; line-height: 1.6; color: ${T.muted};">高雄 · ${c.district}</span>
  </div>
  ${icon('arrow-up-right', 20, T.green)}
</a>`;
const listMobile = () => `<div style="display: flex; flex-direction: column;">
${campuses.map(row).join('\n')}
</div>`;
const mobileShell = (inner, minH) => `<section style="width: 390px; min-height: ${minH}px; background: ${T.cream}; padding: 56px 20px;">
${inner}
</section>`;

const Mobile = doc(mobileShell(`${headingMobile()}
${listMobile()}
${bar(false, {mt:24, h:56, size:15})}`, 980));

const MobileExpanded = doc(mobileShell(`${headingMobile()}
${listMobile()}
${bar(true, {mt:24, h:56, size:15})}
<div id="campus-contact" style="display: flex; flex-direction: column; gap: 24px; padding-top: 24px;">
  ${tabs('yihua', {size:14, gap:16})}
  ${info(yihua, {dd:15})}
  ${bookButton(yihua, true)}
  ${social(yihua, {size:14, gap:20})}
  ${mapBlock('yihua', [110,160,360,267], {height: 260, labelSize: 12})}
</div>`, 1620));

// ---------- 互動狀態 ----------
const label = (t) => `<span style="display: block; font-size: 12px; line-height: 1.8; color: ${T.muted}; margin-bottom: 12px;">${t}</span>`;
const hoverEntry = entry(yihua).replace('class="entry-title"', `class="entry-title" style="text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 6px; text-decoration-color: ${T.green};"`);
const focusEntry = entry(yihua, `outline: 3px solid ${T.leaf}; outline-offset: 5px;`);
const States = doc(`<section style="width: 960px; min-height: 680px; background: ${T.cream}; padding: 48px;">
  <span style="display: block; font-size: 13px; font-weight: 500; letter-spacing: 0.1em; line-height: 1.8; color: ${T.leaf}; margin-bottom: 28px;">互動狀態</span>
  <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px; align-items: start;">
    <div>${label('校園入口 · 預設')}${entry(yihua)}</div>
    <div>${label('滑鼠移入：校名出現底線，不浮起、不放大')}${hoverEntry}</div>
    <div>${label('鍵盤焦點：3px 外框（沿用全站 focus 規則）')}${focusEntry}</div>
  </div>
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; margin-top: 48px; align-items: start;">
    <div>
      ${label('聯絡區校區選單：已選＝粗體＋底線；移入＝淺綠')}
      ${tabs('yihua').replace('>明華校</button>', ` style="min-height: 44px; padding: 0 2px; border: 0; border-bottom: 2px solid transparent; background: transparent; font-size: 15px; font-weight: 400; color: ${T.leaf};">明華校</button>`).replace(/(<button[^>]*>明華校<\/button>)/, (m)=>m.replace(/style="[^"]*"\s*style=/, 'style='))}
    </div>
    <div>
      ${label('展開列：同一列切換，不另放關閉叉叉')}
      ${bar(false, {mt:0, h:56})}
      ${bar(true, {mt:16, h:56})}
    </div>
  </div>
</section>`);


// ---------- 分校輪播（提案）：上排校名 chip 選校，左照片、右地圖＋分校資訊＋社群 ----------
const NUM = ['01','02','03','04','05'];
const headingCentered = (size, lede=true) => `<div style="display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0; margin-bottom: 32px;">
  <span style="display: block; font-size: 13px; font-weight: 500; letter-spacing: 0.1em; line-height: 1.8; color: ${T.leaf}; margin-bottom: 18px;">五校介紹</span>
  <h2 style="font-family: ${HEAD}; font-size: ${size}px; font-weight: 700; line-height: 1.55; letter-spacing: 0.01em;">五所校園，等你來認識。</h2>
  ${lede?`<p style="margin-top: 16px; max-width: 400px; color: ${T.muted}; font-size: 16px; line-height: 1.8;">從生活圈與接送路線出發，找到適合你與孩子的常春藤。</p>`:''}
</div>`;
const chip = (c, on, size=15) => `<button type="button" role="tab" aria-selected="${on}" class="chip" style="min-height: 44px; padding: 0 22px; border: 1px solid ${on?T.green:T.line}; border-radius: 999px; background: ${on?T.green:T.paper}; color: ${on?T.paper:T.text}; font-size: ${size}px; font-weight: ${on?700:500}; line-height: 1;">${c.name}</button>`;
const chips = (selected, {size=15, gap=12}={}) => `<div role="tablist" aria-label="選擇校區" style="display: flex; flex-wrap: wrap; justify-content: center; gap: ${gap}px;">
${campuses.map(c=>chip(c, c.key===selected, size)).join('\n')}
</div>`;
// 縮圖選擇器：五校長相一眼可見，選中的加 2px 綠框
const thumbs = (selected) => `<div role="tablist" aria-label="選擇校區" style="display: flex; justify-content: center; gap: 24px;">
${campuses.map(c=>{const on=c.key===selected;return `  <button type="button" role="tab" aria-selected="${on}" class="thumb" style="display: flex; flex-direction: column; align-items: center; gap: 10px; width: 132px; padding: 0; border: 0; background: transparent; color: ${on?T.green:T.muted}; font-size: 14px; font-weight: ${on?700:500};">
    <img src="${c.img}" alt="" style="width: 132px; height: 99px; object-fit: cover; border-radius: 2px; outline: ${on?`2px solid ${T.green}`:'0'}; outline-offset: 3px; opacity: ${on?1:.72};">
    <span>${c.name}</span>
  </button>`;}).join('\n')}
</div>`;
const navBtn = (name, label) => `<button type="button" aria-label="${label}" class="nav" style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 1px solid ${T.line}; border-radius: 50%; background: ${T.paper}; color: ${T.green}; padding: 0;">${icon(name, 18)}</button>`;
const progress = (i, c) => `<div style="display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 16px;">
  <span style="font-size: 13px; line-height: 1.8; color: ${T.muted};"><strong style="font-weight: 600; color: ${T.text};">${NUM[i]}</strong> / 05 · ${c.name}校園外觀</span>
  <div style="display: flex; gap: 8px;">${navBtn('arrow-left','上一校')}${navBtn('arrow-right','下一校')}</div>
</div>`;
const photoBlock = (c, i, h) => `<div>
  <img src="${c.img}" alt="${c.name}校園外觀" style="width: 100%; height: ${h}px; object-fit: cover; border-radius: 2px;">
  ${progress(i, c)}
</div>`;
const titleBlock = (c, size=22) => `<div>
  <h3 style="display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; font-family: ${HEAD}; font-size: ${size}px; font-weight: 700; line-height: 1.4;">${c.name}<span style="font-family: ${BODY}; font-size: 15px; font-weight: 400; color: ${T.muted};">高雄 · ${c.district}</span></h3>
  <p style="margin-top: 8px; font-size: 15px; line-height: 1.8; color: ${T.muted};">${c.intro}</p>
</div>`;
// 社群連結沿用站上 2026-09-16 定案的 36px 細框徽章
const badgeLink = (c) => {
  const item = (name, href, title, note, pending=false) => `<${pending?'span':'a'} class="soc" ${pending?'':`href="${href}" target="_blank" rel="noopener"`} style="display: inline-flex; align-items: center; gap: 12px; min-height: 44px; font-size: 14px; font-weight: 600; line-height: 1.5; color: ${pending?T.muted:T.text};">
    <span style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; border: 1px ${pending?'dashed':'solid'} ${T.line}; background: ${T.paper}; color: ${pending?T.muted:T.green}; flex-shrink: 0;">${icon(name, 18)}</span>
    <span><span style="display: inline-flex; align-items: center; gap: 6px;">${title}${pending?'':icon('arrow-up-right', 14, T.green)}</span><small style="display: block; font-size: 12px; font-weight: 400; color: ${T.muted};">${note}</small></span>
  </${pending?'span':'a'}>`;
  const line = c.line ? item('line', c.line, '加 LINE 好友', `${c.name}官方帳號`) : item('line', '', 'LINE 官方帳號', `${c.name}帳號待園方提供`, true);
  const fb = item('facebook', c.facebook||'https://www.facebook.com/ivykid', 'Facebook 粉絲專頁', c.facebook?`${c.name}粉絲專頁`:`常春藤機構粉絲專頁（${c.name}粉專待補）`);
  return `<div style="display: flex; flex-wrap: wrap; gap: 8px 28px;">${line}${fb}</div>`;
};
const carouselBody = (c, i, {photoH, mapH, mapVb}) => `<div style="display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 48px; align-items: start;">
  ${photoBlock(c, i, photoH)}
  <div style="display: flex; flex-direction: column; gap: 24px;">
    ${mapBlock(c.key, mapVb, {height: mapH})}
    ${titleBlock(c)}
    ${info(c)}
    <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 16px;">
      ${bookButton(c)}
      ${badgeLink(c)}
    </div>
  </div>
</div>`;
const carouselShell = (inner, minH) => `<section style="width: 1440px; min-height: ${minH}px; background: ${T.cream}; padding: 80px 80px;">
  <div style="width: 1280px; margin: 0 auto;">
${inner}
  </div>
</section>`;
const CarouselDesktop = doc(carouselShell(`${headingCentered(38.88)}
${chips('yihua')}
<div style="height: 40px;"></div>
${carouselBody(yihua, 0, {photoH: 560, mapH: 240, mapVb: [80,150,480,270]})}`, 1080));
const CarouselThumbs = doc(carouselShell(`${headingCentered(38.88, false)}
${thumbs('yihua')}
<div style="height: 40px;"></div>
${carouselBody(yihua, 0, {photoH: 560, mapH: 240, mapVb: [80,150,480,270]})}`, 1120));
const CarouselMobile = doc(mobileShell(`<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 20px; margin-bottom: 24px;">
  <div>${eyebrow()}${title(28.8)}</div>
  ${lede(14)}
</div>
${chips('yihua', {size:14, gap:10})}
<div style="height: 24px;"></div>
${photoBlock(yihua, 0, 263)}
<div style="display: flex; flex-direction: column; gap: 24px; margin-top: 24px;">
  ${titleBlock(yihua, 20)}
  ${info(yihua, {dd:15})}
  ${bookButton(yihua, true)}
  ${badgeLink(yihua)}
  ${mapBlock('yihua', [110,160,360,267], {height: 260, labelSize: 12})}
</div>`, 1460));
// 使用者 2026-09-16 15:09 在畫布裡把這張的上一／下一校箭頭改成 #92B7A2；預設不重寫，要重產請 REGEN_CAROUSEL=1 node build.mjs
if (process.env.REGEN_CAROUSEL || !fs.existsSync('CarouselDesktop.dc.html')) fs.writeFileSync('CarouselDesktop.dc.html', CarouselDesktop);
fs.writeFileSync('CarouselThumbs.dc.html', CarouselThumbs);
fs.writeFileSync('CarouselMobile.dc.html', CarouselMobile);


// ---------- 桌機 A・UI/UX 探索（第三頁） ----------
// 共同修正：加回「認識Ｘ校」的校區頁入口、chip 帶地區、導覽合併成一組、照片圖說改用校區介紹句、資訊優先。
const textLink = (label, href) => `<a class="tlink" href="${href}" style="display: inline-flex; align-items: center; min-height: 44px; border-bottom: 1px solid currentColor; font-size: 14px; font-weight: 600; line-height: 1.5; color: ${T.green};">${label}</a>`;
const chipD = (c, on, {district=true, size=15}={}) => `<button type="button" role="tab" aria-selected="${on}" class="chip" style="display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 20px; border: 1px solid ${on?T.green:T.line}; border-radius: 999px; background: ${on?T.green:T.paper}; color: ${on?T.paper:T.text}; font-size: ${size}px; font-weight: ${on?700:500}; line-height: 1;">${c.name}${district?`<span style="font-size: 13px; font-weight: 400; color: ${on?'oklch(90% .02 150)':T.muted};">· ${c.district}</span>`:''}</button>`;
const chipRow = (selected, {justify='flex-start', district=true, nav=false}={}) => `<div style="display: flex; align-items: center; justify-content: ${justify}; gap: 16px;">
  ${nav?navBtn('arrow-left','上一校'):''}
  <div role="tablist" aria-label="選擇校區" style="display: flex; flex-wrap: wrap; justify-content: ${justify}; gap: 10px;">
${campuses.map(c=>'    '+chipD(c, c.key===selected, {district})).join('\n')}
  </div>
  ${nav?navBtn('arrow-right','下一校'):''}
</div>`;
// A3：依地區分組的選擇器
const GROUPS = [['三民區',['yihua']],['左營區',['minghua','chongde']],['鳥松區',['international']],['仁武區',['renwu']]];
const groupedChips = (selected) => `<div role="tablist" aria-label="選擇校區（依地區）" style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px 36px;">
${GROUPS.map(([d,keys])=>`  <div style="display: flex; flex-direction: column; gap: 10px;">
    <span style="font-size: 12px; letter-spacing: 0.08em; line-height: 1.6; color: ${T.muted};">${d}</span>
    <div style="display: flex; gap: 8px;">${keys.map(k=>chipD(campuses.find(c=>c.key===k), k===selected, {district:false})).join('')}</div>
  </div>`).join('\n')}
</div>`;
const photoCol = (c, h, {nav=false, caption=true, radius=2}={}) => `<div>
  <img src="${c.img}" alt="${c.name}校園外觀" style="width: 100%; height: ${h}px; object-fit: cover; border-radius: ${radius}px;">
  <div style="display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-top: 16px;">
    ${caption?`<p style="font-size: 15px; line-height: 1.8; color: ${T.muted};">${c.intro}</p>`:'<span></span>'}
    ${nav?`<div style="display: flex; gap: 8px; flex-shrink: 0;">${navBtn('arrow-left','上一校')}${navBtn('arrow-right','下一校')}</div>`:''}
  </div>
</div>`;
const nameBlock = (c, size=28) => `<div>
  <h3 style="display: flex; align-items: baseline; flex-wrap: wrap; gap: 14px; font-family: ${HEAD}; font-size: ${size}px; font-weight: 700; line-height: 1.4;">${c.name}<span style="font-family: ${BODY}; font-size: 15px; font-weight: 400; color: ${T.muted};">高雄 · ${c.district}</span></h3>
</div>`;
const actions = (c) => `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px;">
  ${bookButton(c)}
  ${textLink(`認識${c.name}`, `#/${c.key}`)}
</div>`;
const infoCol = (c, {mapFirst=false, mapH=200, gap=24, radius=2}={}) => {
  // 200px 的小地圖用較扁的 viewBox，讓最南的義華校圖釘與校名牌不被裁掉
  const map = mapBlock(c.key, mapH<=200?[80,205,480,200]:[80,150,480,270], {height: mapH, labelSize: mapH<=200?12:13, radius});
  return `<div style="display: flex; flex-direction: column; gap: ${gap}px;">
  ${mapFirst?map:''}
  ${nameBlock(c)}
  ${info(c)}
  ${actions(c)}
  ${badgeLink(c)}
  ${mapFirst?'':map}
</div>`;
};
const twoCol = (left, right, ratio='1.3fr') => `<div style="display: grid; grid-template-columns: minmax(0, ${ratio}) minmax(0, 1fr); gap: 48px; align-items: start;">
  ${left}
  ${right}
</div>`;


// A3 定案：五校放在同一條長橢圓軌道裡（參考 Apple 的分段控制），地區小標對齊各組排在軌道上方，組與組之間一條細分隔線。
const TRACK = 'oklch(93% .014 100)';
const segmented = (selected, {segW=128, size=15, labels=true, seps=[1,3,4]}={}) => {
  // seps：在第 n 段之後放分隔線（義華｜明華 崇德｜國際｜仁武）；定案版不分地區 → labels:false, seps:[]
  const segs = campuses.map((c,i)=>{const on=c.key===selected;return `<button type="button" role="tab" aria-selected="${on}" class="seg" style="flex: 1 1 0; min-width: 0; min-height: 44px; padding: 0 16px; border: 0; border-radius: 999px; background: ${on?T.green:'transparent'}; color: ${on?T.paper:T.text}; font-size: ${size}px; font-weight: ${on?700:500}; line-height: 1;">${c.name}</button>`+(seps.includes(i+1)?`<span aria-hidden="true" style="width: 1px; height: 20px; background: ${T.line}; align-self: center; margin: 0 -0.5px;"></span>`:'');}).join('');
  const labelRow = labels ? GROUPS.map(([d,keys])=>{const i=campuses.findIndex(c=>c.key===keys[0])+1;return `<span style="grid-column: ${i} / span ${keys.length}; text-align: center; font-size: 12px; letter-spacing: 0.08em; line-height: 1.6; color: ${T.muted};">${d}</span>`;}).join('') : '';
  return `<div style="display: inline-grid; grid-template-columns: repeat(5, ${segW}px); gap: 8px 0;">
  ${labelRow}
  <div role="tablist" aria-label="${labels?'選擇校區（依地區）':'選擇校區'}" style="grid-column: 1 / -1; display: flex; align-items: center; padding: 6px; border-radius: 999px; background: ${TRACK};">${segs}</div>
</div>`;
};

// A1 資訊優先：標題靠左（全站標準）、chip 靠左帶地區、右欄先校名地址，地圖收在最後
const ExploreA1 = doc(carouselShell(`${headingDesktop()}
${chipRow('yihua', {justify:'flex-start', district:true})}
<div style="height: 36px;"></div>
${twoCol(photoCol(yihua, 560, {nav:true}), infoCol(yihua, {mapFirst:false, mapH:200}))}`, 1040));

// A2 草圖順序：標題置中、← chip →、右欄地圖在上
const segmentedNav = (selected) => `<div style="display: flex; align-items: center; justify-content: center; gap: 16px;">${navBtn('arrow-left','上一校')}${segmented(selected, {labels:false, seps:[]})}${navBtn('arrow-right','下一校')}</div>`;
const ExploreA2 = doc(carouselShell(`${headingCentered(38.88)}
${segmentedNav('yihua')}
<div style="height: 40px;"></div>
${twoCol(photoCol(yihua, 560, {nav:false, radius:24}), infoCol(yihua, {mapFirst:true, mapH:240, radius:16}))}`, 1120));

// A3 依地區選校：家長先看接送地區再挑校
const ExploreA3 = doc(carouselShell(`${headingDesktop()}
${segmented('yihua')}
<div style="height: 36px;"></div>
${twoCol(photoCol(yihua, 560, {nav:true, radius:24}), infoCol(yihua, {mapFirst:false, mapH:200, radius:16}))}`, 1080));

// 狀態板：chip 四態、上一／下一校、切換方式
const segState = (name, style) => `<button type="button" style="flex: 1 1 0; min-width: 0; min-height: 44px; padding: 0 16px; border: 0; border-radius: 999px; font-size: 15px; line-height: 1; ${style}">${name}</button>`;
const sep = `<span aria-hidden="true" style="width: 1px; height: 20px; background: ${T.line}; align-self: center;"></span>`;
const ExploreStates = doc(`<section style="width: 960px; min-height: 470px; background: ${T.cream}; padding: 48px;">
  <span style="display: block; font-size: 13px; font-weight: 500; letter-spacing: 0.1em; line-height: 1.8; color: ${T.leaf}; margin-bottom: 28px;">校區軌道與切換狀態</span>
  <div style="display: flex; flex-direction: column; gap: 10px; align-items: flex-start;">
    <span style="font-size: 12px; line-height: 1.8; color: ${T.muted};">由左至右：已選（實心綠）、滑鼠移入（字轉綠）、鍵盤焦點（3px 外框，縮在軌道內）、預設、預設</span>
    <div style="display: flex; align-items: center; width: 640px; padding: 6px; border-radius: 999px; background: ${TRACK};">
      ${segState('義華校', `background: ${T.green}; color: ${T.paper}; font-weight: 700;`)}
      ${segState('明華校', `background: transparent; color: ${T.green}; font-weight: 500;`)}
      ${segState('崇德校', `background: transparent; color: ${T.text}; font-weight: 500; outline: 3px solid ${T.leaf}; outline-offset: -3px;`)}
      ${segState('國際校', `background: transparent; color: ${T.text}; font-weight: 500;`)}
      ${segState('仁武校', `background: transparent; color: ${T.text}; font-weight: 500;`)}
    </div>
  </div>
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 40px; margin-top: 44px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 10px; align-items: flex-start;">
      <span style="font-size: 12px; line-height: 1.8; color: ${T.muted};">上一校／下一校：首尾循環，不停用</span>
      <div style="display: flex; gap: 8px;">${navBtn('arrow-left','上一校')}${navBtn('arrow-right','下一校')}</div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <span style="font-size: 12px; line-height: 1.8; color: ${T.muted};">切換行為</span>
      <ul style="margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.8; color: ${T.text};">
        <li>軌道是 tablist：←／→／Home／End 可切換，Tab 鍵只停一個點；選中的綠色膠囊 200ms 滑到新位置。</li>
        <li>照片、資訊、地圖圖釘 200ms 淡入淡出（ease-out-quint），不用滑入；減少動態時直接切換。</li>
        <li>切換後以 aria-live 播報「目前顯示 明華校，高雄左營區」；焦點停在軌道上，不跳走。</li>
        <li>不自動輪播；「預約參觀」與「認識Ｘ校」永遠跟著目前校區。</li>
      </ul>
    </div>
  </div>
</section>`);
fs.writeFileSync('ExploreA1.dc.html', ExploreA1);
fs.writeFileSync('ExploreA2.dc.html', ExploreA2);
fs.writeFileSync('ExploreA3.dc.html', ExploreA3);
fs.writeFileSync('ExploreStates.dc.html', ExploreStates);

fs.writeFileSync('Main.dc.html', Main);
fs.writeFileSync('DesktopExpanded.dc.html', DesktopExpanded);
fs.writeFileSync('Mobile.dc.html', Mobile);
fs.writeFileSync('MobileExpanded.dc.html', MobileExpanded);
fs.writeFileSync('States.dc.html', States);

const canvas = {
  pages: [
    { id:'page-1', name:'五校目錄（首版 mock-up，已依回饋上站）' },
    { id:'page-2', name:'分校輪播（提案）' },
    { id:'page-3', name:'桌機 A・UI/UX 探索' },
  ],
  artboards: [
    { file:'Main.dc.html', title:'桌機・五校目錄（收合）', x:0, y:0, w:1440, h:700 },
    { file:'DesktopExpanded.dc.html', title:'桌機・展開聯絡區', x:1540, y:0, w:1440, h:1200 },
    { file:'Mobile.dc.html', title:'手機・五列目錄', x:0, y:1330, w:390, h:980 },
    { file:'MobileExpanded.dc.html', title:'手機・展開聯絡區', x:480, y:1330, w:390, h:1620 },
    { file:'States.dc.html', title:'互動狀態', x:960, y:1330, w:960, h:680 },
    { file:'CarouselDesktop.dc.html', title:'桌機・分校輪播 A（校名 chip）', page:'page-2', x:0, y:0, w:1440, h:1080 },
    { file:'CarouselThumbs.dc.html', title:'桌機・分校輪播 B（縮圖選擇器）', page:'page-2', x:1540, y:0, w:1440, h:1120 },
    { file:'CarouselMobile.dc.html', title:'手機・分校輪播', page:'page-2', x:3060, y:0, w:390, h:1460 },
    { file:'ExploreA1.dc.html', title:'A1・資訊優先（標題靠左、地圖收尾）', page:'page-3', x:0, y:0, w:1440, h:1040 },
    { file:'ExploreA2.dc.html', title:'A2・定案（置中、← 五校同一軌道 →、不分地區、地圖在上、大圓角）', page:'page-3', x:1540, y:0, w:1440, h:1120 },
    { file:'ExploreA3.dc.html', title:'A3・依地區選校（15:15 曾定案，15:34 改走 A2）', page:'page-3', x:3080, y:0, w:1440, h:1080 },
    { file:'ExploreStates.dc.html', title:'軌道狀態與切換行為', page:'page-3', x:0, y:1260, w:960, h:470 },
  ],
  annotations: [
    { id:'assumptions', x:0, y:-250, w:600, text:'首版 mock-up 的假設（09-16 下午已上站的版本：拿掉展開列與校名箭頭）\n· 背景沿用 --cream 原值。\n· 五張照片統一 4:3，裁切位置逐張定：義華偏右 58%、國際偏左 48%、其餘置中。' },
    { id:'map-note', x:1540, y:-250, w:600, text:'地圖與社群\n· 五校位置示意（座標取自 design/campus-directions/map-data.js），選校後放大該校標記。\n· LINE 目前只有義華有；其他校顯示「待補」，Facebook 先指機構粉專。' },
    { id:'carousel-tradeoffs', page:'page-2', x:0, y:-330, w:640, text:'分校輪播：想法與取捨\n· 上排校名 chip 同時是選擇器與進度，五校名稱永遠可見，不會像純輪播把後面的學校藏起來；照片下方另有 01 / 05 與上一校／下一校。\n· 一次只看一校：照片可以放大、資訊集中，但家長要比較五校得點五次。建議不自動輪播、不做滑入動畫，切換只換內容。\n· 右欄地圖可用 Google 單校嵌入或站上現有的五校示意圖，這裡先畫示意圖。\n· 草圖的「球場校」＝國際校（在球場路），沿用站內名稱。' },
    { id:'carousel-variant', page:'page-2', x:1540, y:-250, w:600, text:'變體 B：縮圖當選擇器\n· 五校的長相一眼可見，比較接近前一版「五校同等曝光」的原則，也少了一排文字 chip。\n· 代價是上方多一列 99px 高的縮圖；手機版仍建議用文字 chip（縮圖列會太擠）。' },
    { id:'explore-why', page:'page-3', x:0, y:-360, w:700, text:'桌機 A 的 UI/UX 修正（三個變體共用）\n1. 加回校區頁入口：輪播版少了目錄版「點照片進校區頁」的路，補「認識Ｘ校」文字連結在預約鈕旁。\n2. chip 帶地區：家長多半先想接送地區再挑校（PRODUCT.md 的使用者輪廓），校名旁加「· 三民區」。\n3. 導覽合併：草圖版有 chip、01/05、上一下一校三組在講同一件事；改成 chip＋一組上一下一校，拿掉數字。\n4. 資訊優先：右欄先校名與地區、地址電話、預約，地圖收在最後（A2 保留草圖的地圖在上，供比較）。\n5. 照片圖說改用校區介紹句，不再重複「Ｘ校校園外觀」。\n6. 標題靠左＋右側引言是全站其他區塊的標準（A1／A3）；A2 保留草圖的置中。\n7. 切換只做 200ms 淡入淡出、不自動輪播、aria-live 播報；見狀態板。\n8. 素材：照片放到 700px 寬，現有 640px 原檔會軟，正式版每校至少 1400px 寬的 4:3 外觀照。' },
    { id:'explore-a3', page:'page-3', x:3080, y:-280, w:600, text:'A3・依地區選校（2026-09-16 15:15 定案）\n· 五校放在同一條長橢圓軌道裡：淡灰米底、選中的實心綠膠囊、字重 500／700；地區小標對齊各組排在軌道上方，組與組之間一條 20px 細線（左營區兩校之間不畫）。\n· 照片圓角 24px，右欄小地圖 16px 跟著收圓；社群徽章、預約鈕維持原樣。\n· 若之後增校，軌道會變寬；超過六校建議改回 chip 換行。' },
    { id:'explore-pick', page:'page-3', x:1540, y:-300, w:600, text:'定案（2026-09-16 15:40）：A2 版面＋單一長橢圓軌道，已上站\n· 標題置中、← 五校同一軌道 →（15:38 拿掉地區小標與分組線）、右欄地圖在上（240px、16px 圓角）、照片 24px 圓角。\n· 手機：軌道滿版、兩側箭頭改到照片圖說列右側；標題維持置中。\n· 先前建議 A1 的理由（標題靠左、資訊優先）保留在 A1 板供日後比較。' },
    { id:'carousel-mobile', page:'page-2', x:3060, y:-250, w:390, text:'手機\n· chip 折成兩行置中，照片 → 進度與上一／下一 → 資訊 → 預約 → 社群 → 地圖直排。\n· 若想再省高度，地圖可改成「在 Google 地圖開啟」一行連結。' },
  ],
  launch: { view:'canvas', page:'page-3' },
};
fs.writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
console.log('built', fs.readdirSync('.').filter(f=>f.endsWith('.dc.html')).join(', '));
