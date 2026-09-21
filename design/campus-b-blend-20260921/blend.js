(() => {
  document.body.classList.add('art-blend');
  document.querySelectorAll('.scene').forEach((scene, index) => {
    const campus = window.CAMPUS_DATA[index];
    const photo = scene.querySelector('.b-photo');
    photo.querySelector('img').classList.add('blend-photo-main');
    const sketch = document.createElement('img');
    sketch.className = 'blend-sketch';
    sketch.src = `../../assets/campus-line-art-${campus.key}.webp`;
    sketch.alt = '';
    sketch.setAttribute('aria-hidden', 'true');
    sketch.decoding = 'async';
    photo.prepend(sketch);
  });
})();
