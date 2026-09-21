(() => {
  const params = new URLSearchParams(location.search);
  const variant = ['1','2','3'].includes(params.get('art')) ? params.get('art') : '1';
  const titles = {1:'左欄底景',2:'校名標記',3:'照片下緣圖帶'};
  document.body.classList.add(`art-${variant}`);
  document.title = `B${variant} ${titles[variant]}｜常春藤建築線稿提案`;
  const link = document.querySelector('.preview-return');
  link.textContent = '比較線稿位置 ↗';
  document.querySelectorAll('.scene').forEach((scene, index) => {
    const campus = window.CAMPUS_DATA[index];
    const figure = document.createElement('figure');
    figure.className = 'campus-art';
    figure.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.src = `../../assets/campus-line-art-${campus.key}.webp`;
    image.alt = '';
    image.decoding = 'async';
    figure.append(image);
    if (variant === '3') {
      const caption = document.createElement('figcaption');
      const label = document.createElement('span');
      label.textContent = '校園輪廓';
      const name = document.createElement('strong');
      name.textContent = campus.name;
      const en = document.createElement('small');
      en.lang = 'en';
      en.textContent = `${campus.key.toUpperCase()} CAMPUS`;
      caption.append(label, name, en);
      figure.append(caption);
    }
    if (variant === '2') scene.querySelector('.b-copy').prepend(figure);
    else scene.append(figure);
  });
})();
