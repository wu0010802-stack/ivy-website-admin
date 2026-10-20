/**
 * 布幕引擎（entranceCurtain.ts）與日常紙張（paperPrints.ts）實際用到的 three 成員。
 * 兩邊都改從這裡 import：paperPrints 原本 `import('three')` 拿整個命名空間，
 * 打包器無法搖樹，連帶讓共用的 three chunk 收進整套（2026-10-20 量測見 README）。
 * 新用到 three 的類別要在這裡補上，否則型別檢查會報錯。
 */
export {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  ImageLoader,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  MathUtils,
  Mesh,
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RGBADepthPacking,
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  SrcAlphaFactor,
  Texture,
  VSMShadowMap,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
