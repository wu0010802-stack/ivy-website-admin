// R: each print is a real sheet of paper in WebGL (three.js). The DOM card stays for
// layout, keyboard and assistive tech; the canvas is a visual layer over it.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const DPR = Math.min(devicePixelRatio || 1, 2);
const MARGIN = 70; // room for the bend and lift

const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const loadImage = src => new Promise((resolve, reject) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

function wrapLines(ctx, text, max) {
  const out = [];
  for (const raw of text.split('\n')) {
    let line = '';
    for (const ch of raw) {
      if (ctx.measureText(line + ch).width > max && line) { out.push(line); line = ch; } else line += ch;
    }
    out.push(line);
  }
  return out;
}

function drawFront(ctx, W, H, data, develop) {
  const s = DPR;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fffdf7'); g.addColorStop(1, '#fbf4e4');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const pad = W * .08, pw = W - pad * 2;
  ctx.fillStyle = '#e8e2d2'; ctx.fillRect(pad, pad, pw, pw);
  // Photograph, developing: blurred and washed until `develop` reaches 1.
  const img = data.image;
  const cover = Math.max(pw / img.naturalWidth, pw / img.naturalHeight);
  const dw = img.naturalWidth * cover, dh = img.naturalHeight * cover;
  ctx.save(); ctx.beginPath(); ctx.rect(pad, pad, pw, pw); ctx.clip();
  const d = develop;
  ctx.filter = d >= 1 ? 'none' : `sepia(${(1 - d) * .55}) contrast(${.28 + .72 * d}) brightness(${1.55 - .55 * d}) saturate(${.35 + .65 * d}) blur(${(1 - d) * 2.5}px)`;
  ctx.globalAlpha = .28 + .72 * d;
  ctx.drawImage(img, pad + (pw - dw) / 2, pad + (pw - dh) * .4, dw, dh);
  ctx.filter = 'none'; ctx.globalAlpha = 1;
  if (d < 1) { ctx.fillStyle = `rgba(226,233,231,${(1 - d) * .8})`; ctx.fillRect(pad, pad, pw, pw); }
  // gloss + inner edge
  const gl = ctx.createLinearGradient(pad, pad, pad + pw * .6, pad + pw); gl.addColorStop(0, 'rgba(255,255,255,.18)'); gl.addColorStop(.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl; ctx.fillRect(pad, pad, pw, pw);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1; ctx.strokeRect(pad + .5, pad + .5, pw - 1, pw - 1);
  // Film date stamp
  const stampAlpha = Math.max(0, (d - .6) / .4);
  if (stampAlpha > 0) {
    ctx.save(); ctx.globalAlpha = stampAlpha * .9; ctx.font = `400 ${Math.round(W * .05)}px 'Source Sans 3', sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#ffb347'; ctx.shadowColor = 'rgba(255,138,0,.85)'; ctx.shadowBlur = 8;
    ctx.transform(1, 0, -.1, 1, 0, 0); ctx.fillText(data.time, pad + pw - 10 + (pad + pw) * .1, pad + pw - 12); ctx.restore();
  }
  const r = 0;
  // Kicker and handwritten line
  let y = pad + pw + W * .085;
  ctx.fillStyle = '#7a8570'; ctx.font = `500 ${Math.round(W * .024)}px 'PingFang TC', sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(data.kicker, pad, y);
  y += W * .075;
  ctx.save(); ctx.translate(pad, y); ctx.rotate(-.014);
  ctx.fillStyle = '#203f32'; ctx.font = `700 ${Math.round(W * .055)}px DaySeed, LineSeed, 'PingFang TC', sans-serif`;
  for (const line of data.caption.split('\n')) { ctx.fillText(line, 0, 0); ctx.translate(0, W * .075); }
  ctx.restore();
}

function drawBack(ctx, W, H, data) {
  const s = DPR;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = '#fff6df'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(32,64,47,.08)'; ctx.lineWidth = 1;
  for (let y = 31.5; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const pad = W * .085, max = W - pad * 2;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#6e7c5b'; ctx.font = `500 ${Math.round(W * .024)}px 'PingFang TC', sans-serif`;
  const bodySize = Math.round(W * .036), lh = bodySize * 2.05;
  ctx.font = `400 ${bodySize}px 'PingFang TC', sans-serif`;
  const lines = wrapLines(ctx, data.story, max);
  const total = W * .06 + lines.length * lh + W * .11;
  let y = (H - total) / 2 + W * .03;
  ctx.fillStyle = '#6e7c5b'; ctx.font = `500 ${Math.round(W * .024)}px 'PingFang TC', sans-serif`; ctx.fillText(data.kicker, pad, y); y += W * .07;
  ctx.fillStyle = '#3f5045'; ctx.font = `400 ${bodySize}px 'PingFang TC', sans-serif`;
  for (const line of lines) { ctx.fillText(line, pad, y); y += lh; }
  y += W * .02; ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(32,63,50,.25)'; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); ctx.setLineDash([]);
  y += W * .06; ctx.fillStyle = '#6b7654'; ctx.font = `400 ${Math.round(W * .026)}px 'PingFang TC', sans-serif`; ctx.fillText(data.note, pad, y);
  ctx.textAlign = 'right'; ctx.font = `400 ${Math.round(W * .045)}px 'Source Sans 3', sans-serif`; ctx.fillText(data.icon, W - pad, y + 2);
}

async function build(wrap) {
  const moment = wrap.closest('.moment');
  const front = wrap.querySelector('.polaroid-front');
  const button = wrap.querySelector('.flip');
  const img = front.querySelector('img');
  const image = await loadImage(img.currentSrc || img.src);
  const data = {
    image, colour: getComputedStyle(moment).getPropertyValue('--card').trim() || '#ffd75e',
    number: front.querySelector('.sticker').textContent.trim(),
    kicker: front.querySelector('.card-kicker span').textContent.trim(),
    caption: front.querySelector('.caption').innerHTML.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').trim(),
    time: front.querySelector('time').textContent.trim(),
    story: wrap.querySelector('.polaroid-back p:not(.card-kicker)').innerHTML.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').trim(),
    note: wrap.querySelector('.polaroid-back .card-note').firstChild.textContent.trim(),
    icon: wrap.querySelector('.polaroid-back .card-note i').textContent.trim()
  };
  const rect = front.getBoundingClientRect();
  const W = Math.round(rect.width), H = Math.round(rect.height);

  const frontCanvas = document.createElement('canvas'); frontCanvas.width = W * DPR; frontCanvas.height = H * DPR;
  const backCanvas = document.createElement('canvas'); backCanvas.width = W * DPR; backCanvas.height = H * DPR;
  const fctx = frontCanvas.getContext('2d'), bctx = backCanvas.getContext('2d');
  let develop = reduce.matches ? 1 : 0;
  drawFront(fctx, W, H, data, develop); drawBack(bctx, W, H, data);
  const frontTex = new THREE.CanvasTexture(frontCanvas), backTex = new THREE.CanvasTexture(backCanvas);
  frontTex.colorSpace = backTex.colorSpace = THREE.SRGBColorSpace;
  frontTex.anisotropy = backTex.anisotropy = 4;

  const view = document.createElement('canvas');
  view.className = 'paper-view'; view.setAttribute('aria-hidden', 'true');
  const VW = W + MARGIN * 2, VH = H + MARGIN * 2;
  view.style.width = `${VW}px`; view.style.height = `${VH}px`; view.style.left = `${-MARGIN}px`; view.style.top = `${-MARGIN}px`;
  wrap.append(view);
  const renderer = new THREE.WebGLRenderer({ canvas: view, alpha: true, antialias: true });
  renderer.setPixelRatio(DPR); renderer.setSize(VW, VH, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const fov = 24, dist = (VH / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const camera = new THREE.PerspectiveCamera(fov, VW / VH, 10, dist * 3); camera.position.z = dist;

  const SEG = 28;
  const geoF = new THREE.PlaneGeometry(W, H, SEG, SEG), geoB = new THREE.PlaneGeometry(W, H, SEG, SEG);
  const matF = new THREE.MeshStandardMaterial({ map: frontTex, roughness: .62, metalness: 0 });
  const matB = new THREE.MeshStandardMaterial({ map: backTex, roughness: .8, metalness: 0 });
  const meshF = new THREE.Mesh(geoF, matF), meshB = new THREE.Mesh(geoB, matB);
  meshB.rotation.y = Math.PI; meshF.castShadow = meshB.castShadow = true;
  const paper = new THREE.Group(); paper.add(meshF, meshB); scene.add(paper);
  // A floor catches the paper's shadow so the lift reads as depth.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(VW * 2, VH * 2), new THREE.ShadowMaterial({ opacity: .28 }));
  floor.position.z = -26; floor.receiveShadow = true; scene.add(floor);
  scene.add(new THREE.AmbientLight(0xffffff, 1.35));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.6); key.position.set(W * .6, H * .9, dist * .7); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -VW; key.shadow.camera.right = VW; key.shadow.camera.top = VH; key.shadow.camera.bottom = -VH; key.shadow.camera.far = dist * 2; key.shadow.radius = 6;
  scene.add(key);
  const glare = new THREE.PointLight(0xffffff, 0, dist * 1.5, 1.4); glare.position.z = dist * .35; scene.add(glare);

  const base = geoF.attributes.position.array.slice();
  const halfW = W / 2;
  function bend(amount) {
    const pf = geoF.attributes.position, pb = geoB.attributes.position;
    for (let i = 0; i < pf.count; i++) {
      const x = base[i * 3];
      const z = amount * (x * x) / halfW * .55;
      pf.array[i * 3 + 2] = z; pb.array[i * 3 + 2] = -z;
    }
    pf.needsUpdate = pb.needsUpdate = true; geoF.computeVertexNormals(); geoB.computeVertexNormals();
  }

  let flip = 0, flipTarget = 0, flipStart = 0, flipFrom = 0, tiltX = 0, tiltY = 0, aimX = 0, aimY = 0, glareAim = 0, lift = 0, liftAim = 0;
  let frame = 0, developStart = 0;
  const DURATION = reduce.matches ? 1 : 1100;
  function render() {
    frame = 0;
    const now = performance.now();
    let busy = false;
    if (flip !== flipTarget) {
      const t = Math.min(1, (now - flipStart) / DURATION); const e = ease(t);
      flip = flipFrom + (flipTarget - flipFrom) * e;
      bend(Math.sin(t * Math.PI) * .6 * (reduce.matches ? 0 : 1));
      lift = Math.sin(t * Math.PI) * 34;
      if (t >= 1) { flip = flipTarget; bend(0); lift = 0; }
      busy = true;
    }
    tiltX += (aimX - tiltX) * .18; tiltY += (aimY - tiltY) * .18;
    if (Math.abs(aimX - tiltX) > .0005 || Math.abs(aimY - tiltY) > .0005) busy = true;
    glare.intensity += (glareAim - glare.intensity) * .15;
    if (Math.abs(glareAim - glare.intensity) > .01) busy = true;
    const liftNow = lift + liftAim;
    paper.rotation.set(tiltX, tiltY + flip * Math.PI, 0);
    paper.position.z = liftNow;
    if (developStart) {
      const d = Math.min(1, (now - developStart) / 3200);
      develop = ease(d); drawFront(fctx, W, H, data, develop); frontTex.needsUpdate = true;
      if (d >= 1) developStart = 0; else busy = true;
    }
    renderer.render(scene, camera);
    if (busy) frame = requestAnimationFrame(render);
  }
  const kick = () => { if (!frame) frame = requestAnimationFrame(render); };

  // State from the DOM: round4.js toggles .is-flipped; mockup.js adds .is-revealed.
  new MutationObserver(() => {
    const target = wrap.classList.contains('is-flipped') ? 1 : 0;
    if (target !== flipTarget) { flipFrom = flip; flipTarget = target; flipStart = performance.now(); kick(); }
  }).observe(wrap, { attributes: true, attributeFilter: ['class'] });
  const reveal = () => { if (moment.classList.contains('is-revealed') && develop < 1 && !developStart) { developStart = performance.now(); kick(); } };
  new MutationObserver(reveal).observe(moment, { attributes: true, attributeFilter: ['class'] });
  reveal();

  wrap.addEventListener('pointermove', event => {
    if (!fine.matches || reduce.matches) return;
    const r = wrap.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width - .5, y = (event.clientY - r.top) / r.height - .5;
    aimY = x * .28; aimX = -y * .2; glareAim = 3.2; liftAim = 10;
    glare.position.x = x * W * 1.2; glare.position.y = -y * H * 1.2; kick();
  });
  wrap.addEventListener('pointerleave', () => { aimX = aimY = 0; glareAim = 0; liftAim = 0; kick(); });
  wrap.addEventListener('click', event => { if (event.target.closest('a, button')) return; button.click(); });
  wrap.classList.add('webgl-ready');
  render();
}

(async () => {
  if (!window.WebGLRenderingContext) return;
  await document.fonts.ready;
  try { await Promise.all(['DaySeed', 'LineSeed'].map(f => document.fonts.load(`700 24px ${f}`))); } catch {}
  for (const wrap of document.querySelectorAll('.polaroid-wrap')) {
    try { await build(wrap); } catch (error) { console.warn('paper fallback', error); }
  }
})();
