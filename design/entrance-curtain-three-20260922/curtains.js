// A shared renderer with parameterized, genuinely displaced cloth meshes.
// The deformation is art-directed, not a mass-spring cloth simulation.
import * as THREE from '../../web/node_modules/three/build/three.module.js';

const vertexShader = /* glsl */`
  uniform float uProgress;
  uniform float uTime;
  uniform float uAspect;
  uniform float uMode;
  uniform float uSide;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vFold;
  const float PI = 3.14159265359;
  void main() {
    vUv = uv;
    float u = uv.x;
    float v = uv.y;
    float p = smoothstep(0.12, 0.97, uProgress);
    float sway = sin(uTime * 3.4 + v * 4.0) * sin(p * PI);
    float folds = uMode < 1.5 ? 11.0 : 8.0;
    float phase = u * folds * 2.0 * PI + 0.24 * sin(v * 4.7 + uTime * 0.6) * (0.25 + p);
    float fold = sin(phase) + 0.18 * sin(phase * 2.0 + 0.6);
    float x;
    float y;
    float z;
    if (uMode < 0.5) {
      // Traveler curtain: top rings lead, the heavy middle lags slightly.
      float pull = p * (0.87 + 0.13 * v) + 0.025 * sway * sin(v * PI);
      float width = 1.0 - pull * 0.9;
      x = uSide * (uAspect * (1.025 - u * 1.03 * width) + pow(p, 5.0) * uAspect * 0.23);
      y = -1.045 + v * 2.10 + p * u * (1.0 - v) * 0.11;
      z = fold * (0.056 + p * 0.026) + 0.018 * sway * sin(v * PI);
    } else if (uMode < 1.5) {
      // Austrian-inspired lift: lower scallops rise and gather beneath the rail.
      float scallop = pow(abs(sin(u * PI * 5.0)), 0.85);
      float bottom = -1.05 + p * 2.52 + scallop * (0.045 + p * 0.18);
      float top = 1.07 + p * 0.40;
      x = (u * 2.0 - 1.0) * uAspect * 1.035;
      y = mix(bottom, top, v);
      z = fold * 0.053 + sin(v * PI * 7.0) * p * 0.045 + scallop * sin(v * PI) * 0.05;
    } else {
      // Butterfly gather: a curved sweep into both upper corners, then fully away.
      float sweep = p * (0.18 + 0.93 * pow(1.0 - v, 0.55));
      float exitLift = pow(p, 6.0);
      x = uSide * (uAspect * (1.025 - u * 1.03 + u * sweep) + exitLift * uAspect * 0.48);
      y = -1.04 + v * 2.09 + p * u * (1.0 - v) * 0.80 + exitLift * 1.85;
      z = fold * 0.044 + sin(u * PI) * sin(v * PI) * p * 0.17 + sway * 0.012;
    }
    vFold = fold;
    vWorld = vec3(x, y, z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vWorld, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uColor;
  uniform float uMode;
  uniform float uSide;
  uniform float uProgress;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vFold;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (N.z < 0.0) N = -N;
    vec3 key = normalize(vec3(-0.55, 0.6, 1.2));
    float diffuse = max(dot(N, key), 0.0);
    float fill = max(dot(N, normalize(vec3(0.75, -0.1, 0.5))), 0.0);
    float velvet = pow(1.0 - abs(N.z), 2.0);
    float cavity = 0.64 + 0.36 * smoothstep(-1.10, 0.65, vFold);
    float weave = hash(gl_FragCoord.xy) * 0.027 + sin(vUv.y * 2700.0) * 0.008;
    float topLight = 0.87 + 0.13 * vUv.y;
    vec3 color = uColor * (0.28 + diffuse * 0.78 + fill * 0.11) * cavity * topLight;
    color += uColor * velvet * (uMode > 1.5 ? 0.33 : 0.16);
    color += vec3(0.22, 0.075, 0.04) * pow(max(dot(N, normalize(vec3(-0.4, 0.7, 1.8))), 0.0), 20.0) * (uMode > 1.5 ? 0.18 : 0.04);
    color += weave * uColor;
    // A narrow woven gold hem; it follows the geometry, including the scallops.
    float hem = 1.0 - smoothstep(0.008, 0.015, vUv.y);
    float stitch = 1.0 - smoothstep(0.001, 0.0025, abs(vUv.y - 0.019));
    vec3 gold = vec3(0.59, 0.35, 0.105) * (0.40 + diffuse * 0.68);
    color = mix(color, gold, max(hem, stitch * 0.55));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCurtains(canvas, stage) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 4;
  const geometry = new THREE.PlaneGeometry(2, 2, 176, 92);
  const panels = [-1, 1].map(side => {
    const material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0 }, uTime: { value: 0 },
        uAspect: { value: 1 }, uMode: { value: 0 }, uSide: { value: side },
        uColor: { value: new THREE.Color('#a92335') }
      }
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  });
  let mode = 'a';
  let progress = 0;
  let time = 0;
  function draw(p = progress, t = time) {
    progress = p; time = t;
    panels.forEach(panel => {
      panel.material.uniforms.uProgress.value = p;
      panel.material.uniforms.uTime.value = t;
    });
    renderer.render(scene, camera);
  }
  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    const aspect = width / Math.max(height, 1);
    camera.left = -aspect; camera.right = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    panels.forEach(panel => { panel.material.uniforms.uAspect.value = aspect; });
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();
  return {
    draw,
    select(view) {
      mode = view;
      panels[1].visible = view !== 'b';
      panels.forEach(panel => {
        panel.material.uniforms.uMode.value = { a: 0, b: 1, c: 2 }[mode];
        panel.material.uniforms.uColor.value.set({ a: '#ac2638', b: '#981e2e', c: '#c23740' }[mode]);
      });
    },
    dispose() {
      observer.disconnect();
      geometry.dispose();
      panels.forEach(panel => panel.material.dispose());
      renderer.dispose();
    }
  };
}
