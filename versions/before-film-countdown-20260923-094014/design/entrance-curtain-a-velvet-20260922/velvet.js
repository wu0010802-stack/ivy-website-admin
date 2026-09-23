// Generated from web/app/utils/entranceCurtain.ts
// web/app/utils/entranceCurtain.ts
import * as THREE from "../../web/node_modules/three/build/three.module.js";

// web/app/utils/entrance-timeline.ts
var COUNTDOWN_DURATION = 3e3;
var OPENING_DURATION = 3400;
var ENTRANCE_DURATION = COUNTDOWN_DURATION + OPENING_DURATION;
function entranceTimeline(elapsedMs) {
  const elapsed = Math.min(ENTRANCE_DURATION, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0));
  const countdown = elapsed < COUNTDOWN_DURATION ? 3 - Math.floor(elapsed / 1e3) : 0;
  const opening = Math.max(0, (elapsed - COUNTDOWN_DURATION) / OPENING_DURATION);
  const fadeInProgress = Math.min(1, elapsed / 360);
  const fadeOutProgress = Math.max(0, 1 - opening / 0.24);
  const fadeIn = fadeInProgress * fadeInProgress * (3 - 2 * fadeInProgress);
  const fadeOut = fadeOutProgress * fadeOutProgress * (3 - 2 * fadeOutProgress);
  const pulse = countdown ? 0.92 + 0.08 * Math.sin(Math.min(1, elapsed % 1e3 / 260) * Math.PI / 2) : 1;
  const digitFade = Math.min(1, Math.max(0, (elapsed - COUNTDOWN_DURATION) / 180));
  const digitOpacity = 1 - digitFade * digitFade * (3 - 2 * digitFade);
  const shadowFade = Math.min(1, opening / 0.8);
  const shadowOpacity = 0.18 * (1 - shadowFade * shadowFade * (3 - 2 * shadowFade));
  return { countdown, opening, projection: fadeIn * fadeOut, pulse, digitOpacity, shadowOpacity, complete: elapsed >= ENTRANCE_DURATION };
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
uniform sampler2D digitMap;
uniform vec2 logoSize;
uniform vec3 projectionColor;
uniform float projectionStrength;
uniform float countdownDigit;
uniform float countdownPulse;
uniform float countdownOpacity;
float insideProjection(vec2 uv) {
  return step(0.0, uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
}
float logoTransmission(vec2 uv) {
  // Crop only the sampling window; the supplied 1254px PNG stays unmodified.
  vec2 sourceUv = vec2(229.0, 176.0)/1254.0 + uv*vec2(795.0,964.0)/1254.0;
  vec3 ink = texture2D(logoMap, sourceUv).rgb;
  float density = 1.0 - dot(ink,vec3(0.2126,0.7152,0.0722));
  return pow(smoothstep(0.065,0.88,density),0.72)*insideProjection(uv);
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
        // Treat the emblem and the number as one optically centred composition.
        float digitSize = min(0.235,logoSize.x*0.42);
        float groupGap = 0.025;
        float logoCenterY = 0.04 + (digitSize+groupGap)*0.5;
        vec2 logoUv = (projected-vec2(0.0,logoCenterY))/logoSize + 0.5;
        float logoLight = logoTransmission(logoUv);
        // Small optical penumbra, while retaining the original fine lettering.
        float halo = (logoTransmission(logoUv+vec2(0.0025,0.0))
                    + logoTransmission(logoUv-vec2(0.0025,0.0))
                    + logoTransmission(logoUv+vec2(0.0,0.0025))
                    + logoTransmission(logoUv-vec2(0.0,0.0025)))*0.25;
        float digitY = logoCenterY-logoSize.y*0.5-groupGap-digitSize*0.5;
        vec2 digitUv = (projected-vec2(0.0,digitY))/digitSize + 0.5;
        vec2 atlasUv = vec2((digitUv.x + 3.0-max(1.0,countdownDigit))/3.0,digitUv.y);
        float digitLight = texture2D(digitMap,atlasUv).a * insideProjection(digitUv) * countdownOpacity;
        vec3 lightDirection = normalize(vec3(0.0,logoCenterY,3.2)-clothPosition);
        float incidence = pow(max(0.0,dot(normal,lightDirection)),0.85);
        vec2 spotPosition = (projected-vec2(0.0,0.04))/vec2(logoSize.x*1.2,1.05);
        float spot = exp(-1.65*dot(spotPosition,spotPosition));
        // Softer side lighting gives the crest priority without a DOM overlay.
        float stageFalloff = 0.72 + 0.28*spot;
        reflectedLight.directDiffuse *= stageFalloff;
        reflectedLight.indirectDiffuse *= stageFalloff;
        float light = (logoLight*0.80+halo*0.20)*1.35 + digitLight*1.20*countdownPulse;
        reflectedLight.directDiffuse += projectionColor * (light + spot*0.075) * incidence * projectionStrength;
      `);
    }
  };
  material.customProgramCacheKey = () => `ivy-velvet-a-${projection ? "projection" : "trim"}-4`;
}
function countdownTexture() {
  const atlas = document.createElement("canvas");
  atlas.width = 768;
  atlas.height = 256;
  const context = atlas.getContext("2d");
  context.fillStyle = "#fff";
  context.font = '600 176px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let i = 0; i < 3; i++) context.fillText(String(3 - i), i * 256 + 128, 136);
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.65));
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
  const digits = countdownTexture();
  let logo;
  const projection = {
    logoMap: { value: placeholder },
    digitMap: { value: digits },
    logoSize: { value: new THREE.Vector2(0.86, 1.04) },
    projectionColor: { value: new THREE.Color(velvetPalette.projection) },
    projectionStrength: { value: 0 },
    countdownDigit: { value: 3 },
    countdownPulse: { value: 1 },
    countdownOpacity: { value: 1 }
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
    projection.countdownPulse.value = state.pulse;
    projection.countdownOpacity.value = state.digitOpacity;
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
    renderer.setSize(width, height, false);
    const logoWidth = Math.min(0.86, aspect * 1.28);
    projection.logoSize.value.set(logoWidth, logoWidth * 964 / 795);
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
      digits.dispose();
      logo?.dispose();
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
