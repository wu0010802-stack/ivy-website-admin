export const ENTRANCE_SESSION_KEY = 'ivy-entrance-a-seen'

// Stills of the WebGL curtain's first frame (progress 0), one per valance swag
// count: the engine uses max(2, floor(aspect*2.4 + 0.5)). Folds and tie points
// are fractions of the viewport, so a poster stretched across its aspect band
// keeps the valance, tassels and hem where the live frame draws them. First
// match wins. Regenerate with design/entrance-curtain-a-velvet-20260922/render-posters.cjs
// whenever the curtain's look changes, or the cover shows an outdated curtain.
export const ENTRANCE_POSTERS: ReadonlyArray<readonly [media: string, src: string]> = [
  ['(min-aspect-ratio: 15/8)', '/assets/entrance-poster-wide.webp?v=284d0e3b'],
  ['(max-aspect-ratio: 2/3)', '/assets/entrance-poster-phone.webp?v=0c426b53'],
  ['(max-aspect-ratio: 25/24)', '/assets/entrance-poster-portrait.webp?v=7b04cd78'],
  ['(max-aspect-ratio: 35/24)', '/assets/entrance-poster-landscape.webp?v=6a5f77f4'],
  ['all', '/assets/entrance-poster-desktop.webp?v=35a6d775']
]

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
