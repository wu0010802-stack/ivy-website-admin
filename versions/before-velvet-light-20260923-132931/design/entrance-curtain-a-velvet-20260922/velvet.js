// Generated from web/app/utils/entranceCurtain.ts
// web/app/utils/entranceCurtain.ts
import * as THREE from "../../web/node_modules/three/build/three.module.js";

// web/app/utils/entrance-timeline.ts
var LOGO_DURATION = 1500;
var COUNTDOWN_DURATION = 3e3;
var OPENING_DURATION = 3400;
var OPENING_START = LOGO_DURATION + COUNTDOWN_DURATION;
var ENTRANCE_DURATION = OPENING_START + OPENING_DURATION;
var smooth = (value) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
function entranceTimeline(elapsedMs) {
  const elapsed = Math.min(ENTRANCE_DURATION, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0));
  const complete = elapsed >= ENTRANCE_DURATION;
  const phase = elapsed < LOGO_DURATION ? "logo" : elapsed < OPENING_START ? "countdown" : complete ? "complete" : "opening";
  const countElapsed = Math.max(0, elapsed - LOGO_DURATION);
  const countdown = phase === "countdown" ? 3 - Math.floor(countElapsed / 1e3) : 0;
  const opening = Math.max(0, (elapsed - OPENING_START) / OPENING_DURATION);
  const logoOpacity = smooth(elapsed / 300) * smooth((LOGO_DURATION - elapsed) / 220);
  const leaderOpacity = elapsed < LOGO_DURATION ? 0 : smooth(countElapsed / 100) * (1 - smooth((elapsed - OPENING_START) / 180));
  const sweep = elapsed < OPENING_START ? countElapsed % 1e3 / 1e3 : 1;
  const projection = smooth(elapsed / 300) * (1 - smooth(opening / 0.24));
  const shadowOpacity = 0.18 * (1 - smooth(opening / 0.8));
  return { phase, countdown, opening, projection, logoOpacity, leaderOpacity, sweep, filmFrame: Math.floor(countElapsed / (1e3 / 12)), shadowOpacity, complete };
}

// web/app/utils/entranceCurtain.ts
var velvetPalette = {
  fabric: "#67182b",
  sheen: "#a64b59",
  trim: "#977546",
  sky: "#f4d8ca",
  ground: "#280f1b",
  key: "#fff0dd",
  fill: "#eab6bc",
  projection: "#efce92"
};
var clothDeformation = (
  /* glsl */
  `
uniform float curtainProgress;
uniform float curtainAspect;
uniform float curtainSide;
uniform float curtainTime;
varying vec2 clothUv;
varying vec3 clothPosition;
const float C_PI = 3.14159265359;
vec3 curtainPoint(vec2 uv) {
  float u = uv.x;
  float v = uv.y;
  float seed = curtainSide * 1.7;
  // Quintic easing starts and stops with zero velocity and acceleration.
  float rail = clamp((curtainProgress-0.08)/0.87,0.0,1.0);
  float travel = rail*rail*rail*(rail*(rail*6.0-15.0)+10.0);
  float lag = 0.090 * pow(1.0-v, 1.5) * sin(travel * C_PI);
  float pull = max(0.0, travel - lag);
  float wind = sin(curtainTime * 3.6 - v * 4.6 + u * 2.3 + seed) * sin(travel * C_PI);
  float width = 1.0 - pull * 0.87;
  float foldCount = clamp(curtainAspect * 4.8, 3.2, 7.5);
  float phase = u * C_PI * 2.0 * foldCount + 0.48*sin(u*17.0 + seed) + 0.23*sin(u*39.0 + seed);
  phase += (1.0-v) * (0.22*sin(u*13.0 + v*3.0 + seed) + wind*0.2);
  float amplitude = (0.066 + 0.019*sin(u*19.0 + seed) + 0.012*sin(u*37.0)) * (1.0 + pull*0.25);
  amplitude *= min(1.0, curtainAspect / 0.9);
  float fold = sin(phase) + 0.16*sin(phase*2.0 + 0.45);
  float x = curtainSide * (curtainAspect * (1.035 - 1.054*u*width) + pow(travel,5.0)*curtainAspect*0.26);
  x += curtainSide * wind * 0.013 * sin(v*C_PI) * u;
  float hem = (0.010*sin(u*33.0+seed) + 0.005*sin(u*65.0)) * pow(1.0-v,5.0);
  // Continue above the viewport so the exposed upper edge cannot cast clipped
  // rectangular shadows across the visible velvet.
  float y = -1.025 + v*2.35 + hem + pull*u*pow(1.0-v,2.0)*0.12;
  float z = amplitude * fold + 0.018*sin(u*10.0+v*4.0+seed)*sin(v*C_PI);
  z += wind * 0.018 * sin(v*C_PI);
  // Finer tension creases near the trailing seam and weighted lower hem.
  z += 0.006*sin(u*104.0+v*19.0+seed)*pow(1.0-v,3.0);
  z += 0.008*sin(v*25.0+u*30.0)*pow(u,8.0)*sin(travel*C_PI);
  return vec3(x,y,z + (curtainSide > 0.0 ? 0.006 : 0.0));
}
`
);
var projectionShader = (
  /* glsl */
  `
varying vec2 clothUv;
varying vec3 clothPosition;
uniform sampler2D logoMap;
uniform sampler2D colourLogoMap;
uniform sampler2D digitMap;
uniform vec3 digitOffsets;
uniform float cinemaProjection;
uniform vec2 logoSize;
uniform vec3 projectionColor;
uniform float projectionStrength;
uniform float countdownDigit;
uniform float logoOpacity;
uniform float countdownSweep;
uniform float filmFrame;
uniform float projectorTime;
uniform float countdownOpacity;
float insideProjection(vec2 uv) {
  return step(0.0, uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
}
float digitTransmission(vec2 uv) {
  vec2 atlasUv = vec2((uv.x+3.0-max(1.0,countdownDigit))/3.0,uv.y);
  return texture2D(digitMap,atlasUv).a*insideProjection(uv);
}
vec3 logoSource(vec2 uv) {
  // Crop only the sampling window; the supplied 1254px PNG stays unmodified.
  vec2 sourceUv = vec2(229.0, 176.0)/1254.0 + uv*vec2(795.0,964.0)/1254.0;
  return texture2D(logoMap, sourceUv).rgb;
}
float goldLogoTransmission(vec2 uv) {
  // Reuse the earlier warm-gold projection for the anniversary ribbon only.
  float density = 1.0-dot(logoSource(uv),vec3(0.2126,0.7152,0.0722));
  return pow(smoothstep(0.065,0.88,density),0.72)*insideProjection(uv);
}
vec4 logoTransmission(vec2 uv) {
  vec2 sourceUv = vec2(229.0,176.0)/1254.0 + uv*vec2(795.0,964.0)/1254.0;
  // Premultiplied linear colour: transparent paper never enters the mipmaps.
  return texture2D(colourLogoMap,sourceUv)*insideProjection(uv);
}
`
);
function deformMaterial(material, uniforms, projection) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = clothDeformation + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "vec3 transformed = curtainPoint(uv); clothUv = uv; clothPosition = transformed;");
    shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", `
      vec3 alongU = curtainPoint(uv + vec2(0.0003,0.0)) - curtainPoint(uv - vec2(0.0003,0.0));
      vec3 alongV = curtainPoint(uv + vec2(0.0,0.0003)) - curtainPoint(uv - vec2(0.0,0.0003));
      vec3 objectNormal = normalize(cross(alongU, alongV)) * -curtainSide;
    `);
    if (projection) {
      Object.assign(shader.uniforms, projection);
      shader.fragmentShader = projectionShader + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
        #include <color_fragment>
        float nap = sin(clothUv.x*93.0 + sin(clothUv.y*17.0))*sin(clothUv.y*137.0);
        float dye = 0.96 + 0.035*sin(clothUv.x*37.0+clothUv.y*9.0) + nap*0.014;
        diffuseColor.rgb *= dye;
      `);
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `
        #include <lights_fragment_end>
        float perspective = 3.2 / (3.2-clothPosition.z);
        vec2 projected = clothPosition.xy * perspective;
        // Centre the visible crest (crown through IVY KIDS, source y=114..876).
        // The anniversary ribbon hangs below it instead of pulling the crest up.
        // UVs run upwards: (1254 - 495 - 176) / 964 is the crest's source centre.
        vec2 center = vec2(0.0);
        vec2 logoUv = (projected-center)/logoSize + vec2(0.5,583.0/964.0);
        vec4 logoLight = logoTransmission(logoUv);
        float logoFocus = 0.0016+abs(clothPosition.z)*0.018;
        vec4 tapLeft = logoTransmission(logoUv-vec2(logoFocus,0.0));
        vec4 tapRight = logoTransmission(logoUv+vec2(logoFocus,0.0));
        vec4 tapTop = logoTransmission(logoUv+vec2(0.0,logoFocus));
        vec4 tapBottom = logoTransmission(logoUv-vec2(0.0,logoFocus));
        vec4 halo = (tapLeft+tapRight+tapTop+tapBottom)*0.25;
        // The original artwork has a clear gap at rows 876\u2013878 between IVY
        // KIDS and the lower anniversary ribbon; blend within that empty gap.
        float goldRibbon = 1.0-smoothstep(200.0/964.0,202.0/964.0,logoUv.y);
        float ribbonLight = 0.0;
        if (goldRibbon > 0.0 && logoOpacity > 0.0 && logoUv.y > -0.01 && logoUv.x > -0.01 && logoUv.x < 1.01) {
          float gold = goldLogoTransmission(logoUv);
          float goldHalo = (goldLogoTransmission(logoUv+vec2(0.0025,0.0))
                         + goldLogoTransmission(logoUv-vec2(0.0025,0.0))
                         + goldLogoTransmission(logoUv+vec2(0.0,0.0025))
                         + goldLogoTransmission(logoUv-vec2(0.0,0.0025)))*0.25;
          ribbonLight = (gold*0.80+goldHalo*0.20)*1.35*goldRibbon*logoOpacity;
        }
        logoLight *= 1.0-goldRibbon;
        halo *= 1.0-goldRibbon;
        vec2 leader = (projected-center)/logoSize.y;
        float radius = length(leader);
        float aa = max(fwidth(radius),0.001);
        float disc = 1.0-smoothstep(0.492-aa,0.492+aa,radius);
        float rings = (1.0-smoothstep(0.002,0.002+aa,abs(radius-0.49)))
                    + (1.0-smoothstep(0.0015,0.0015+aa,abs(radius-0.425)));
        float crosshair = (1.0-smoothstep(0.0008,0.0008+aa,min(abs(leader.x),abs(leader.y))))*disc;
        // Classic clockwise film-leader sweep, restarting for every number.
        float angle = mod(atan(leader.x,leader.y)+6.28318530718,6.28318530718);
        float sweepAngle = countdownSweep*6.28318530718;
        float sector = (1.0-smoothstep(sweepAngle-0.012,sweepAngle+0.012,angle))*disc;
        float rayDistance = abs(atan(sin(angle-sweepAngle),cos(angle-sweepAngle)))*radius;
        float ray = (1.0-smoothstep(0.001,0.001+aa,rayDistance))*disc;
        vec2 digitUv = leader/0.80 + 0.5;
        // Keep the desktop numerals optically centred without the film frame.
        float offsetX = countdownDigit > 2.5 ? digitOffsets.x : countdownDigit > 1.5 ? digitOffsets.y : digitOffsets.z;
        digitUv.x += offsetX*cinemaProjection;
        float digit = digitTransmission(digitUv);
        // Low-contrast 12 fps grain, never a whole-frame brightness flash.
        vec2 grainCell = floor((leader+0.5)*520.0);
        float grain = fract(sin(dot(grainCell+filmFrame,vec2(12.9898,78.233)))*43758.5453);
        float filmLight = (disc*(0.34+sector*0.18)+rings*0.75+crosshair*0.095+ray*0.17);
        filmLight *= 0.975+grain*0.05;
        filmLight *= 1.0-digit*0.97;
        float cinemaLight = 0.0;
        if (cinemaProjection > 0.5 && radius < 0.72) {
          // A lens falls slightly out of focus on the deeper folds. Preserve a
          // readable core, with a small optical penumbra instead of a neon rim.
          float focus = 0.002 + abs(clothPosition.z)*0.027;
          float softDigit = (digitTransmission(digitUv+vec2(focus,0.0))
                           + digitTransmission(digitUv-vec2(focus,0.0))
                           + digitTransmission(digitUv+vec2(0.0,focus))
                           + digitTransmission(digitUv-vec2(0.0,focus)))*0.25;
          float ringDistance = abs(radius-0.49);
          float ringCore = 1.0-smoothstep(0.003,0.003+aa+focus*0.35,ringDistance);
          float ringGlow = exp(-pow(ringDistance/0.018,2.0));
          // The red velvet remains visible inside the ring; only a faint
          // rotating light spill and sweep hand suggest a film leader.
          float pool = exp(-pow(radius/0.50,4.0));
          float sweepLight = sector*0.025 + ray*0.070;
          float glyphLight = digit*0.88 + softDigit*0.25;
          cinemaLight = glyphLight + ringCore*0.53 + ringGlow*0.085;
          cinemaLight += pool*0.018 + sweepLight*(1.0-digit)*0.75;
          float foldReception = 0.84+0.16*smoothstep(-0.085,0.065,clothPosition.z);
          float filmGrain = 0.985+grain*0.03;
          // Subtle lamp breathing affects the projection only, never the whole
          // viewport. Nothing jitters away from the established centre.
          float lamp = 1.0+0.006*sin(projectorTime*23.0)+0.004*sin(projectorTime*41.0);
          cinemaLight *= foldReception*filmGrain*lamp;
        }
        vec3 lightDirection = normalize(vec3(center,3.2)-clothPosition);
        float incidence = pow(max(0.0,dot(normal,lightDirection)),0.85);
        vec2 spotPosition = (projected-center)/vec2(logoSize.x*1.2,1.05);
        float spot = exp(-1.65*dot(spotPosition,spotPosition));
        // Softer side lighting gives the crest priority without a DOM overlay.
        float stageFalloff = 0.72 + 0.28*spot;
        reflectedLight.directDiffuse *= stageFalloff;
        reflectedLight.indirectDiffuse *= stageFalloff;
        // Locally soften the red spill so blue, pink, green and navy stay
        // recognisable. Incidence and the coloured penumbra still follow cloth.
        float crestCoverage = logoLight.a*logoOpacity*projectionStrength;
        float clothUnderLogo = 1.0-crestCoverage*0.82;
        reflectedLight.directDiffuse *= clothUnderLogo;
        reflectedLight.indirectDiffuse *= clothUnderLogo;
        float crestFold = 0.74+0.26*smoothstep(-0.085,0.065,clothPosition.z);
        float crestGrain = 0.99+grain*0.02;
        vec3 crestLight = (logoLight.rgb*0.84+halo.rgb*0.16)*logoOpacity*crestFold*crestGrain;
        float light = ribbonLight + mix(filmLight,cinemaLight,cinemaProjection)*countdownOpacity;
        reflectedLight.directDiffuse += (crestLight*0.95 + projectionColor*(light + spot*0.075*(1.0-crestCoverage))) * incidence * projectionStrength;
      `);
    }
  };
  material.customProgramCacheKey = () => `ivy-velvet-a-${projection ? "projection" : "trim"}-12`;
}
function colourProjectionTexture(source) {
  const canvas = document.createElement("canvas");
  const width = canvas.width = source.naturalWidth;
  const height = canvas.height = source.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const { data } = context.getImageData(0, 0, width, height);
  const alpha = new Float32Array(width * height);
  const bytes = new Uint8Array(data.length);
  const linear = Float32Array.from({ length: 256 }, (_, i) => {
    const c = i / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  for (let p = 0; p < alpha.length; p++) {
    const i = p * 4;
    const pigment = 1 - Math.min(data[i], data[i + 1], data[i + 2]) / 255;
    const t = Math.min(1, Math.max(0, (pigment - 0.045) / 0.06));
    alpha[p] = t * t * (3 - 2 * t) * data[i + 3] / 255;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    let coverage = alpha[p];
    if (!coverage) continue;
    const i = p * 4;
    const edge = coverage < 0.99 || x > 0 && alpha[p - 1] < 0.05 || x < width - 1 && alpha[p + 1] < 0.05 || y > 0 && alpha[p - width] < 0.05 || y < height - 1 && alpha[p + width] < 0.05;
    if (edge) {
      let reference = i;
      let contrast = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const n = ((y + dy) * width + x + dx) * 4;
        const difference = (255 - data[n]) ** 2 + (255 - data[n + 1]) ** 2 + (255 - data[n + 2]) ** 2;
        if (alpha[n / 4] > 0.99 && difference > contrast) {
          contrast = difference;
          reference = n;
        }
      }
      if (contrast) {
        const dot = (255 - data[i]) * (255 - data[reference]) + (255 - data[i + 1]) * (255 - data[reference + 1]) + (255 - data[i + 2]) * (255 - data[reference + 2]);
        coverage = Math.min(coverage, Math.max(0, dot / contrast));
      }
    }
    if (coverage < 1e-3) continue;
    const target = ((height - 1 - y) * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const ink = Math.round(Math.min(255, Math.max(0, (data[i + channel] - (1 - coverage) * 255) / coverage)));
      const light = linear[ink] * coverage;
      bytes[target + channel] = Math.round(255 * (light <= 31308e-7 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055));
    }
    bytes[target + 3] = Math.round(coverage * 255);
  }
  const texture = new THREE.DataTexture(bytes, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
function countdownTexture() {
  const atlas = document.createElement("canvas");
  atlas.width = 768;
  atlas.height = 256;
  const context = atlas.getContext("2d");
  context.fillStyle = "#fff";
  context.font = '700 300px "Helvetica Neue", Arial, sans-serif';
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  for (let i = 0; i < 3; i++) {
    const digit = String(3 - i);
    const metrics = context.measureText(digit);
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    context.fillText(
      digit,
      i * 256 + 128 - (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2,
      128 + height / 2 - metrics.actualBoundingBoxDescent
    );
  }
  const texture = new THREE.CanvasTexture(atlas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}
function fiberTexture() {
  const size = 256;
  const bytes = new Uint8Array(size * size * 4);
  let seed = 7321;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = seed * 1664525 + 1013904223 >>> 0;
      const fiber = (seed / 4294967296 - 0.5) * 34;
      const warp = Math.sin(x * Math.PI) * 5 + Math.cos(y * Math.PI) * 9;
      const value = Math.round(166 + fiber + warp);
      const i = (y * size + x) * 4;
      bytes[i] = bytes[i + 1] = bytes[i + 2] = value;
      bytes[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 7);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
function createEntranceCurtain(canvas, host, logoUrl = "/assets/ivy-30th-anniversary-projection.png") {
  const mobile = host.clientWidth < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 15);
  camera.position.z = 5;
  scene.add(new THREE.HemisphereLight(velvetPalette.sky, velvetPalette.ground, 1.15));
  const key = new THREE.DirectionalLight(velvetPalette.key, 2.65);
  key.position.set(-2.8, 3.5, 3);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(mobile ? 512 : 1024);
  key.shadow.bias = -15e-5;
  key.shadow.normalBias = 7e-3;
  key.shadow.radius = 3;
  key.shadow.blurSamples = 6;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 12;
  scene.add(key);
  const fill = new THREE.DirectionalLight(velvetPalette.fill, 0.8);
  fill.position.set(2, 0.6, 3);
  scene.add(fill);
  const texture = fiberTexture();
  const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const colourPlaceholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  colourPlaceholder.needsUpdate = true;
  const digits = countdownTexture();
  const digitAtlas = digits.image;
  const digitContext = digitAtlas.getContext("2d");
  const cellWidth = digitAtlas.width / 3;
  const digitOffsets = [0, 1, 2].map((index) => {
    const { data } = digitContext.getImageData(index * cellWidth, 0, cellWidth, digitAtlas.height);
    let mass = 0;
    let weightedX = 0;
    for (let pixel = 0; pixel < data.length / 4; pixel++) {
      const alpha = data[pixel * 4 + 3];
      mass += alpha;
      weightedX += (pixel % cellWidth + 0.5) * alpha;
    }
    return mass ? weightedX / mass / cellWidth - 0.5 : 0;
  });
  let logo;
  let colourLogo;
  const projection = {
    logoMap: { value: placeholder },
    colourLogoMap: { value: colourPlaceholder },
    digitMap: { value: digits },
    digitOffsets: { value: new THREE.Vector3(...digitOffsets) },
    cinemaProjection: { value: 0 },
    logoSize: { value: new THREE.Vector2(0.86, 1.04) },
    projectionColor: { value: new THREE.Color(velvetPalette.projection) },
    projectionStrength: { value: 0 },
    countdownDigit: { value: 3 },
    logoOpacity: { value: 0 },
    countdownSweep: { value: 0 },
    filmFrame: { value: 0 },
    projectorTime: { value: 0 },
    countdownOpacity: { value: 0 }
  };
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const geometry = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 216, mobile ? 64 : 96);
  const trimGeometry = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 216, 3);
  const trimUV = trimGeometry.attributes.uv;
  for (let i = 0; i < trimUV.count; i++) trimUV.setY(i, 0.013 + trimUV.getY(i) * 7e-3);
  function mirrored(source) {
    const copy = source.clone();
    const indices = copy.index;
    for (let i = 0; i < indices.count; i += 3) {
      const b = indices.getX(i + 1);
      indices.setX(i + 1, indices.getX(i + 2));
      indices.setX(i + 2, b);
    }
    return copy;
  }
  const rightGeometry = mirrored(geometry);
  const rightTrimGeometry = mirrored(trimGeometry);
  const materials = [];
  const clothUniforms = [];
  for (const side of [-1, 1]) {
    const uniforms = {
      curtainProgress: { value: 0 },
      curtainAspect: { value: 1 },
      curtainSide: { value: side },
      curtainTime: { value: 0 }
    };
    clothUniforms.push(uniforms);
    const cloth = new THREE.MeshPhysicalMaterial({
      color: velvetPalette.fabric,
      roughness: 0.96,
      metalness: 0,
      sheen: 0.72,
      sheenColor: velvetPalette.sheen,
      sheenRoughness: 0.92,
      specularIntensity: 0.18,
      bumpMap: texture,
      bumpScale: 23e-4,
      side: THREE.DoubleSide
    });
    deformMaterial(cloth, uniforms, projection);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    deformMaterial(depth, uniforms);
    const panel = new THREE.Mesh(side === 1 ? rightGeometry : geometry, cloth);
    panel.frustumCulled = false;
    panel.castShadow = panel.receiveShadow = true;
    panel.customDepthMaterial = depth;
    scene.add(panel);
    const trim = new THREE.MeshStandardMaterial({
      color: velvetPalette.trim,
      metalness: 0.45,
      roughness: 0.62,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    deformMaterial(trim, uniforms);
    const seam = new THREE.Mesh(side === 1 ? rightTrimGeometry : trimGeometry, trim);
    seam.frustumCulled = false;
    seam.receiveShadow = true;
    scene.add(seam);
    materials.push(cloth, depth, trim);
  }
  const shadowGeometry = new THREE.PlaneGeometry(2, 2);
  const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.18, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.position.z = -0.25;
  shadow.receiveShadow = true;
  scene.add(shadow);
  let disposed = false;
  let current = 0;
  let previousOpening = -1;
  function draw(progress) {
    if (disposed) return;
    current = Math.min(1, Math.max(0, progress));
    const state = entranceTimeline(current * ENTRANCE_DURATION);
    projection.projectionStrength.value = state.projection;
    projection.countdownDigit.value = state.countdown || 1;
    projection.logoOpacity.value = state.logoOpacity;
    projection.countdownSweep.value = state.sweep;
    projection.filmFrame.value = state.filmFrame;
    projection.projectorTime.value = current * ENTRANCE_DURATION / 1e3;
    projection.countdownOpacity.value = state.leaderOpacity;
    shadowMaterial.opacity = state.shadowOpacity;
    shadow.visible = state.shadowOpacity > 0;
    if (state.opening !== previousOpening) renderer.shadowMap.needsUpdate = true;
    previousOpening = state.opening;
    for (const uniforms of clothUniforms) {
      uniforms.curtainProgress.value = state.opening;
      uniforms.curtainTime.value = current * ENTRANCE_DURATION / 1e3;
    }
    renderer.render(scene, camera);
  }
  function resize() {
    if (disposed) return;
    const { width, height } = host.getBoundingClientRect();
    const aspect = width / Math.max(1, height);
    camera.left = -aspect;
    camera.right = aspect;
    camera.updateProjectionMatrix();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(45e5 / Math.max(1, width * height)));
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    const desktop = width > 900;
    projection.cinemaProjection.value = desktop ? 1 : 0;
    const compositionWidth = Math.min(width * 0.64, 880, height * 1.2);
    const compositionHeight = compositionWidth * 9 / 16;
    const aperture = desktop ? compositionHeight * 0.76 * 2 / height : Math.min(1.04, aspect * 1.5);
    projection.logoSize.value.set(aperture * 795 / 964, aperture);
    clothUniforms.forEach((uniforms) => {
      uniforms.curtainAspect.value = aspect;
    });
    shadow.scale.x = aspect;
    const extent = Math.max(2, aspect * 1.6);
    Object.assign(key.shadow.camera, { left: -extent, right: extent, top: 2.5, bottom: -2.5 });
    key.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    draw(current);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const ready = new THREE.TextureLoader().loadAsync(logoUrl).then((loaded) => {
    if (disposed) {
      loaded.dispose();
      return;
    }
    logo = loaded;
    logo.colorSpace = THREE.NoColorSpace;
    logo.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    projection.logoMap.value = logo;
    colourLogo = colourProjectionTexture(loaded.image);
    colourLogo.anisotropy = logo.anisotropy;
    projection.colourLogoMap.value = colourLogo;
    draw(current);
  });
  return {
    draw,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      geometry.dispose();
      trimGeometry.dispose();
      rightGeometry.dispose();
      rightTrimGeometry.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      texture.dispose();
      placeholder.dispose();
      colourPlaceholder.dispose();
      digits.dispose();
      logo?.dispose();
      colourLogo?.dispose();
      materials.forEach((material) => material.dispose());
      key.shadow.dispose();
      scene.clear();
      renderer.dispose();
    }
  };
}
export {
  ENTRANCE_DURATION,
  createEntranceCurtain,
  entranceTimeline
};
