// Q: pointer tilt and glare on each print; click anywhere on the print to flip.
// round4.js owns the flip state (aria-expanded, inert); this only drives the button.
(() => {
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('.polaroid-wrap').forEach(wrap => {
    const card = wrap.querySelector('.polaroid');
    const button = wrap.querySelector('.flip');
    let frame = 0, last = null;
    const apply = () => {
      frame = 0;
      if (!last) return;
      const r = wrap.getBoundingClientRect();
      const x = (last.x - r.left) / r.width, y = (last.y - r.top) / r.height;
      card.style.setProperty('--ry', `${((x - .5) * 14).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${((.5 - y) * 10).toFixed(2)}deg`);
      card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
      card.style.setProperty('--glare', '1');
    };
    wrap.addEventListener('pointermove', event => {
      if (!fine.matches || reduce.matches || wrap.classList.contains('is-dragging')) return;
      last = { x: event.clientX, y: event.clientY };
      wrap.classList.add('is-tilting');
      if (!frame) frame = requestAnimationFrame(apply);
    });
    wrap.addEventListener('pointerleave', () => {
      last = null;
      wrap.classList.remove('is-tilting');
      ['--rx', '--ry', '--glare'].forEach(name => card.style.removeProperty(name));
    });
    // The whole print flips, except its own controls and links.
    wrap.addEventListener('click', event => {
      if (event.target.closest('a, button')) return;
      button.click();
    });
    button.addEventListener('click', () => {
      if (reduce.matches) return;
      wrap.classList.remove('is-flipping');
      void wrap.offsetWidth;
      wrap.classList.add('is-flipping');
      wrap.addEventListener('animationend', () => wrap.classList.remove('is-flipping'), { once: true });
    });
  });
})();
