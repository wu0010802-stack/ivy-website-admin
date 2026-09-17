(() => {
  const moments = [...document.querySelectorAll('.direction-d .moment')];
  if (!moments.length) return;

  // The shared scroll controller is the single source of reading progress.
  // Reflect that progress without adding another scroll listener or live region.
  function syncReadingState() {
    moments.forEach((moment, index) => {
      const link = moment.querySelector('.time-marker');
      const current = moment.classList.contains('is-active');
      const past = moment.classList.contains('is-past');
      const position = `${String(index + 1).padStart(2, '0')} / ${String(moments.length).padStart(2, '0')}`;
      const state = current ? '正在看' : past ? '已走過' : '尚未瀏覽';
      const text = current ? '正在看' : past ? '已走過' : position;
      const status = link.querySelector('.marker-status');
      if (status.textContent !== text) status.textContent = text;
      if (current) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
      link.setAttribute('aria-label', `第 ${index + 1} 個片刻，共 ${moments.length} 個，${link.querySelector('time').textContent}，${link.querySelector('.marker-title').textContent}，${state}。回到此片刻`);
    });
  }

  const observer = new MutationObserver(syncReadingState);
  moments.forEach(moment => {
    observer.observe(moment, { attributes: true, attributeFilter: ['class'] });
    const link = moment.querySelector('.time-marker');
    link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (location.hash !== link.hash) history.pushState(null, '', link.hash);
      moment.scrollIntoView({ behavior: 'instant', block: 'start' });
      // Native fragment targeting can drop focus on the non-focusable list item.
      // Keep the chosen node focused so Tab continues to the next moment.
      link.focus({ preventScroll: true });
    });
  });
  syncReadingState();
})();
