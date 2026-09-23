// Generated from web/app/utils/entranceCurtain.ts
import * as THREE from "../../web/node_modules/three/build/three.module.js";
const ENTRANCE_DURATION = 3400;
const clothDeformation = (
  /* glsl */
  `
uniform float curtainProgress;
uniform float curtainAspect;
uniform float curtainSide;
uniform float curtainTime;
varying vec2 clothUv;
const float C_PI = 3.14159265359;
vec3 curtainPoint(vec2 uv) {
  float u = uv.x;
  float v = uv.y;
  float seed = curtainSide * 1.7;
  float travel = smoothstep(0.10, 0.97, curtainProgress);
  float lag = 0.065 * pow(1.0-v, 1.5) * sin(travel * C_PI);
  float pull = max(0.0, travel - lag);
  float wind = sin(curtainTime * 4.8 - v * 3.8 + u * 2.3 + seed) * sin(travel * C_PI);
  float width = 1.0 - pull * 0.87;
  float foldCount = clamp(curtainAspect * 5.5, 4.0, 9.0);
  float phase = u * C_PI * 2.0 * foldCount + 0.48*sin(u*17.0 + seed) + 0.23*sin(u*39.0 + seed);
  phase += (1.0-v) * (0.22*sin(u*13.0 + v*3.0 + seed) + wind*0.2);
  float amplitude = (0.066 + 0.019*sin(u*19.0 + seed) + 0.012*sin(u*37.0)) * (1.0 + pull*0.25);
  amplitude *= min(1.0, curtainAspect / 0.9);
  float fold = sin(phase) + 0.24*sin(phase*2.0 + 0.45);
  float x = curtainSide * (curtainAspect * (1.035 - 1.054*u*width) + pow(travel,5.0)*curtainAspect*0.26);
  x += curtainSide * wind * 0.013 * sin(v*C_PI) * u;
  float hem = (0.010*sin(u*33.0+seed) + 0.005*sin(u*65.0)) * pow(1.0-v,5.0);
  float y = -1.025 + v*2.075 + hem + pull*u*pow(1.0-v,2.0)*0.12;
  float z = amplitude * fold + 0.018*sin(u*10.0+v*4.0+seed)*sin(v*C_PI);
  z += wind * 0.018 * sin(v*C_PI);
  // Finer tension creases near the trailing seam and weighted lower hem.
  z += 0.006*sin(u*104.0+v*19.0+seed)*pow(1.0-v,3.0);
  z += 0.008*sin(v*25.0+u*30.0)*pow(u,8.0)*sin(travel*C_PI);
  return vec3(x,y,z + (curtainSide > 0.0 ? 0.006 : 0.0));
}
`
);
function deformMaterial(material, uniforms, textile = false) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = clothDeformation + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "vec3 transformed = curtainPoint(uv); clothUv = uv;");
    shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", `
      vec3 alongU = curtainPoint(uv + vec2(0.0003,0.0)) - curtainPoint(uv - vec2(0.0003,0.0));
      vec3 alongV = curtainPoint(uv + vec2(0.0,0.0003)) - curtainPoint(uv - vec2(0.0,0.0003));
      vec3 objectNormal = normalize(cross(alongU, alongV)) * -curtainSide;
    `);
    if (textile) {
      shader.fragmentShader = "varying vec2 clothUv;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
        #include <color_fragment>
        float nap = sin(clothUv.x*93.0 + sin(clothUv.y*17.0))*sin(clothUv.y*137.0);
        float dye = 0.96 + 0.035*sin(clothUv.x*37.0+clothUv.y*9.0) + nap*0.014;
        diffuseColor.rgb *= dye;
      `);
    }
  };
  material.customProgramCacheKey = () => `ivy-velvet-a-${textile ? "fabric" : "trim"}-1`;
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
function createEntranceCurtain(canvas, host) {
  const mobile = host.clientWidth < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.65));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 15);
  camera.position.z = 5;
  scene.add(new THREE.HemisphereLight("#ffe5dc", "#290a17", 1.4));
  const key = new THREE.DirectionalLight("#fff1db", 3.25);
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
  const fill = new THREE.DirectionalLight("#f6c4c8", 1);
  fill.position.set(2, 0.6, 3);
  scene.add(fill);
  const texture = fiberTexture();
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
      color: "#790b20",
      roughness: 0.96,
      metalness: 0,
      sheen: 0.8,
      sheenColor: "#ba4a58",
      sheenRoughness: 0.92,
      specularIntensity: 0.18,
      bumpMap: texture,
      bumpScale: 23e-4,
      side: THREE.DoubleSide
    });
    deformMaterial(cloth, uniforms, true);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    deformMaterial(depth, uniforms);
    const panel = new THREE.Mesh(side === 1 ? rightGeometry : geometry, cloth);
    panel.frustumCulled = false;
    panel.castShadow = panel.receiveShadow = true;
    panel.customDepthMaterial = depth;
    scene.add(panel);
    const trim = new THREE.MeshStandardMaterial({
      color: "#ba9656",
      metalness: 0.65,
      roughness: 0.46,
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
  function draw(progress) {
    if (disposed) return;
    current = Math.min(1, Math.max(0, progress));
    for (const uniforms of clothUniforms) {
      uniforms.curtainProgress.value = current;
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
    clothUniforms.forEach((uniforms) => {
      uniforms.curtainAspect.value = aspect;
    });
    shadow.scale.x = aspect;
    const extent = Math.max(2, aspect * 1.6);
    Object.assign(key.shadow.camera, { left: -extent, right: extent, top: 2.5, bottom: -2.5 });
    key.shadow.camera.updateProjectionMatrix();
    draw(current);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  return {
    draw,
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
      materials.forEach((material) => material.dispose());
      key.shadow.dispose();
      scene.clear();
      renderer.dispose();
    }
  };
}
export {
  ENTRANCE_DURATION,
  createEntranceCurtain
};
