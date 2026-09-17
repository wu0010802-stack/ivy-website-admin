// Resolve incoming anchors after the shared curtain finishes measuring.
// Initial smooth scrolling otherwise exposes the intro's progress during a
// quick direction switch, causing that switch to choose the wrong chapter.
const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
Promise.all([loaded, document.fonts.ready]).then(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }));
});

// Keep the same story in view when comparing the three compositions.
document.querySelectorAll('[data-direction]').forEach(link => {
  link.addEventListener('click', () => {
    const day = document.querySelector('.day');
    const moment = document.querySelector('.moment.is-active');
    const anchor = day.getBoundingClientRect().top > innerHeight * .5 ? 'about' : moment?.id || 'life';
    link.hash = anchor;
  });
});
