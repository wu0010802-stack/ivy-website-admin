export const ENTRANCE_SESSION_KEY = 'ivy-entrance-a-seen'

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
  }catch{}
})()`

// This small first-paint cover must not depend on Nuxt hydration. If the app
// never mounts, CSS releases it after 5.5 seconds and cannot intercept input.
export const entranceCoverStyles = `
:root{--entrance-red:#790b20;--entrance-shade:#3c0816;--entrance-highlight:#a32c3f}
html[data-ivy-entrance="pending"]::before{content:"";position:fixed;inset:0;z-index:10000;pointer-events:none;background:repeating-linear-gradient(90deg,var(--entrance-shade) 0,var(--entrance-red) 2.2%,var(--entrance-highlight) 3.5%,var(--entrance-red) 5.3%,var(--entrance-shade) 7%);animation:entrance-cover-release 0s 5.5s forwards}
@keyframes entrance-cover-release{to{visibility:hidden}}
@media(prefers-reduced-motion:reduce),(forced-colors:active){html[data-ivy-entrance="pending"]::before{display:none}}
`
