// Q studies: paper colour and flip affordance, switched live from a small panel.
(() => {
  const body = document.body;
  const PAPERS = [['cream', '米白（現況）', '#fbf4e4'], ['white', '純白', '#ffffff'], ['ivory', '象牙', '#f2e6c8'], ['tint', '依時刻淡色', '#ffe9a8'], ['kraft', '牛皮紙', '#d5bd90'], ['black', '黑相紙', '#1a1918']];
  const FLIPS = [['button', '按鈕（現況）'], ['dogear', '摺角剝開'], ['tap', '點相片＋提示'], ['drag', '拖曳翻頁']];
  const saved = (() => { try { return JSON.parse(localStorage.getItem('q-study') || '{}'); } catch { return {}; } })();
  const state = { paper: saved.paper || 'tint', flip: saved.flip || 'button' };
  const apply = () => { body.dataset.paper = state.paper; body.dataset.flip = state.flip; try { localStorage.setItem('q-study', JSON.stringify(state)); } catch {} };
  apply();

  const panel = document.createElement('aside');
  panel.className = 'study-panel';
  panel.innerHTML = `<details open><summary>相紙與翻面探索</summary>
    <fieldset><legend>相紙顏色</legend>${PAPERS.map(([k, n, sw]) => `<label><input type="radio" name="paper" value="${k}"><span class="swatch" style="--sw:${sw}"></span>${n}</label>`).join('')}</fieldset>
    <fieldset><legend>翻到背面</legend>${FLIPS.map(([k, n]) => `<label><input type="radio" name="flip" value="${k}">${n}</label>`).join('')}</fieldset></details>`;
  document.body.append(panel);
  panel.querySelectorAll('input').forEach(input => {
    input.checked = state[input.name] === input.value;
    input.addEventListener('change', () => { state[input.name] = input.value; apply(); });
  });

  // Per-print affordances: dog-ear button, tap hint, drag hint + drag-to-flip.
  document.querySelectorAll('.polaroid-wrap').forEach(wrap => {
    const button = wrap.querySelector('.flip');
    const ear = document.createElement('button');
    ear.type = 'button'; ear.className = 'dogear'; ear.setAttribute('aria-label', '翻到背面'); ear.innerHTML = '<span aria-hidden="true">翻開</span>';
    ear.addEventListener('click', () => button.click());
    const tap = document.createElement('span'); tap.className = 'tap-hint'; tap.setAttribute('aria-hidden', 'true'); tap.textContent = '點一下，看背面的故事';
    const drag = document.createElement('span'); drag.className = 'drag-hint'; drag.setAttribute('aria-hidden', 'true'); drag.textContent = '往左拖，翻到背面';
    wrap.append(ear, tap, drag);

    const card = wrap.querySelector('.polaroid');
    let start = null, dx = 0, dragged = false;
    wrap.addEventListener('click', event => { if (dragged) { dragged = false; event.stopImmediatePropagation(); event.preventDefault(); } }, true);
    // Window-level move/up: no pointer capture, so a drag that leaves the print still ends cleanly.
    const move = event => {
      dx = event.clientX - start;
      const flipped = wrap.classList.contains('is-flipped');
      const deg = Math.max(-180, Math.min(180, dx / wrap.offsetWidth * 180));
      card.style.setProperty('--ry', `${flipped ? -deg : deg}deg`);
    };
    const release = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', release); removeEventListener('pointercancel', release);
      const width = wrap.offsetWidth;
      wrap.classList.remove('is-dragging'); card.style.removeProperty('--ry');
      if (Math.abs(dx) > width * .28) button.click();
      if (Math.abs(dx) > 4) dragged = true; // the trailing click must not toggle again
      start = null;
    };
    wrap.addEventListener('pointerdown', event => {
      if (body.dataset.flip !== 'drag' || event.target.closest('a, button') || event.button !== 0) return;
      event.preventDefault(); // stops the browser starting a native image drag
      start = event.clientX; dx = 0; wrap.classList.add('is-dragging');
      addEventListener('pointermove', move); addEventListener('pointerup', release); addEventListener('pointercancel', release);
    });
  });
})();
