export const ENTRANCE_SESSION_KEY = 'ivy-entrance-a-seen'

// Stills of the WebGL curtain's first frame (progress 0), one per valance swag
// count: the engine uses max(2, floor(aspect*2.4 + 0.5)). Folds and tie points
// are fractions of the viewport, so a poster stretched across its aspect band
// keeps the valance, tassels and hem where the live frame draws them. First
// match wins. Regenerate with design/entrance-curtain-a-velvet-20260922/render-posters.cjs
// whenever the curtain's look changes, or the cover shows an outdated curtain.
export const ENTRANCE_POSTERS: ReadonlyArray<readonly [media: string, src: string]> = [
  ['(min-aspect-ratio: 15/8)', '/assets/entrance-poster-wide.webp?v=04d5da0f'],
  ['(max-aspect-ratio: 2/3)', '/assets/entrance-poster-phone.webp?v=4b1ce1a4'],
  ['(max-aspect-ratio: 25/24)', '/assets/entrance-poster-portrait.webp?v=48bc69e7'],
  ['(max-aspect-ratio: 35/24)', '/assets/entrance-poster-landscape.webp?v=aa84c846'],
  ['all', '/assets/entrance-poster-desktop.webp?v=e0ccbd68']
]

// The renderer's own assets. The projection is the original PNG losslessly
// re-encoded, with every pixel the paper key makes fully transparent flattened
// to white (keyed output is byte-identical; 1.41 MB → 462 KB). Rebuild with
// scripts/optimize-entrance-projection.py --write and update the version.
export const ENTRANCE_PROJECTION = '/assets/ivy-30th-anniversary-projection.webp?v=bd2d47dc'
export const ENTRANCE_DIGIT_FONT = '/assets/fonts/oswald-700-leader.woff2'
// Both loaders fetch in CORS mode (three's ImageLoader and FontFace), so the
// preloads must too or the browser downloads each file twice.
const ENTRANCE_ASSETS = [[ENTRANCE_PROJECTION, 'image'], [ENTRANCE_DIGIT_FONT, 'font', 'font/woff2']]

// Runs before the first homepage paint. Failure is deliberately fail-open:
// without this marker neither the temporary cover nor the WebGL layer appears.
export const entranceBootstrap = `(()=>{
  try {
    if(location.pathname!=='/'||location.hash||window.__ivyEntranceSeen)return;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||matchMedia('(forced-colors: active)').matches)return;
    const c=navigator.connection;
    if(c&&(c.saveData||/^(slow-2g|2g|3g)$/.test(c.effectiveType||'')))return;
    try{if(sessionStorage.getItem('${ENTRANCE_SESSION_KEY}')==='1')return;sessionStorage.setItem('${ENTRANCE_SESSION_KEY}','1')}catch{}
    window.__ivyEntranceSeen=true;
    document.documentElement.dataset.ivyEntrance='pending';
    document.documentElement.dataset.ivyEntranceStarted=String(Date.now());
    // Fetch the cover's poster during head parsing, not after the first style pass.
    const p=${JSON.stringify(ENTRANCE_POSTERS)}.find(([m])=>matchMedia(m).matches);
    const l=document.createElement('link');
    l.rel='preload';l.as='image';l.href=p[1];l.fetchPriority='high';
    document.head.append(l);
    // Left to the renderer, these start only after hydration and the three.js
    // chunk: about 2.9 s on a 9 Mbps phone, past the 2.8 s load limit. Waiting
    // for DOMContentLoaded keeps them off the hydration scripts' bandwidth. A
    // late one means a slow link: EntranceCurtain gives up on mounts after
    // 1.8 s, so the download would only be wasted.
    const s=Date.now();
    document.addEventListener('DOMContentLoaded',()=>{
      if(Date.now()-s>1500)return;
      for(const [h,a,t] of ${JSON.stringify(ENTRANCE_ASSETS)}){
        const e=document.createElement('link');
        e.rel='preload';e.as=a;e.href=h;e.crossOrigin='anonymous';if(t)e.type=t;
        document.head.append(e);
      }
    },{once:true});
  }catch{}
})()`

// CSS applies the last matching rule, so the first-match list is emitted in reverse.
const posterRules = [...ENTRANCE_POSTERS].reverse()
  .map(([media, src]) => media === 'all' ? `:root{--entrance-poster:url(${src})}` : `@media${media}{:root{--entrance-poster:url(${src})}}`)
  .join('\n')

// This small first-paint cover must not depend on Nuxt hydration. If the app
// never mounts, CSS releases it after 5.5 seconds and cannot intercept input.
// The stripes, in the velvet's own shades, only show until the poster decodes.
export const entranceCoverStyles = `
${posterRules}
:root{--entrance-cover:var(--entrance-poster) 0 0/100% 100% no-repeat,repeating-linear-gradient(90deg,#2c0006 0,#420112 2.2%,#7c0e1f 3.5%,#420112 5.3%,#2c0006 7%)}
html[data-ivy-entrance="pending"]::before{content:"";position:fixed;inset:0;z-index:10000;pointer-events:none;background:var(--entrance-cover);animation:entrance-cover-release 0s 5.5s forwards}
@keyframes entrance-cover-release{to{visibility:hidden}}
@media(prefers-reduced-motion:reduce),(forced-colors:active){html[data-ivy-entrance="pending"]::before{display:none}}
`
