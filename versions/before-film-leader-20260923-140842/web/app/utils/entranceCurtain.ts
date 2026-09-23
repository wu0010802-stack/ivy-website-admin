import * as THREE from 'three'
import { entranceTimeline, ENTRANCE_DURATION } from './entrance-timeline'

const velvetPalette = {
  fabric: '#561326', sheen: '#c46f7e', trim: '#c9a45c',
  sky: '#f4d8ca', ground: '#1e0a14', key: '#fff0dd', fill: '#eab6bc',
  projection: '#efce92', rim: '#d98794', footlight: '#ffb778', clothTint: '#ff8a99'
}

type EntranceCurtainOptions = {
  /** Comparison only: a festooned valance across the top that flies out last. */
  valance?: boolean
  /** Countdown numerals use the site's display face; the fallback sans stays drawn until it loads. */
  digitFontUrl?: string
}

// The upper rail leads the lower, heavier cloth. Broad, uneven folds are
// deformed in world space; the same function drives normals and shadow depth.
const clothDeformation = /* glsl */`
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
  // Gathered tight under the rail, the weight lets the folds open toward the hem.
  amplitude *= mix(1.18, 0.78, v);
  // Heavy velvet hangs in rounded bellies separated by narrow, deep valleys.
  float fold = 2.0*pow(0.515 + 0.5*sin(phase), 0.62) - 1.2236;
  float x = curtainSide * (curtainAspect * (1.035 - 1.054*u*width) + pow(travel,5.0)*curtainAspect*0.26);
  x += curtainSide * wind * 0.013 * sin(v*C_PI) * u;
  float z = amplitude * fold + 0.018*sin(u*10.0+v*4.0+seed)*sin(v*C_PI);
  // Bellies that swing forward hang lower, so the hem scallops with the folds.
  float hem = (0.004*sin(u*65.0+seed) - 0.06*amplitude*fold) * pow(1.0-v,6.0);
  // Continue above the viewport so the exposed upper edge cannot cast clipped
  // rectangular shadows across the visible velvet.
  float y = -1.025 + v*2.35 + hem + pull*u*pow(1.0-v,2.0)*0.12;
  z += wind * 0.018 * sin(v*C_PI);
  // Finer tension creases near the trailing seam and weighted lower hem.
  z += 0.006*sin(u*104.0+v*19.0+seed)*pow(1.0-v,3.0);
  z += 0.008*sin(v*25.0+u*30.0)*pow(u,8.0)*sin(travel*C_PI);
  // The weighted leading edges hang calmer, so the centre overlap barely steps
  // the projection where the two panels meet.
  z *= mix(0.45, 1.0, 1.0 - smoothstep(0.94, 1.0, u));
  return vec3(x,y,z + (curtainSide > 0.0 ? 0.006 : 0.0));
}
`

// A stationary pelmet: festoon swags droop between tie points and their folds
// follow each arc. It flies out after the drapes have cleared the stage.
const valanceDeformation = /* glsl */`
uniform float valanceAspect;
uniform float valanceLift;
varying vec2 clothUv;
varying vec3 clothPosition;
const float V_PI = 3.14159265359;
vec3 valancePoint(vec2 uv) {
  float swags = max(2.0, floor(valanceAspect*2.4 + 0.5));
  float droop = sin(fract(uv.x*swags)*V_PI);
  float bottom = 0.77 - 0.06*droop;
  float y = mix(bottom, 1.04, uv.y) + valanceLift*0.4;
  float x = (uv.x*2.0-1.0)*valanceAspect*1.02;
  // Hung just in front of the drapes so its shadow stays a tight band.
  float z = 0.10 + 0.034*droop*sin(uv.y*V_PI)
          + 0.009*sin((uv.y*5.5 + droop*0.9)*V_PI)*droop
          + 0.011*sin(uv.x*swags*V_PI*14.0)*pow(1.0-droop,3.0);
  return vec3(x,y,z);
}
`

// Stage light shared by drapes and valance: dark flies above, a warm
// footlight below, and velvet's pile glowing on the flanks that turn away.
const stageLightingPars = /* glsl */`
uniform vec3 rimColor;
uniform vec3 footColor;
float pileHash(float n) { return fract(sin(n)*43758.5453); }
float velvetPile(vec2 uv, float seed) {
  // Crushed pile runs with the drop: soft vertical streaks, not uniform noise.
  float coarse = uv.x*70.0;
  float fine = uv.x*230.0;
  float a = mix(pileHash(floor(coarse)+seed), pileHash(floor(coarse)+1.0+seed), smoothstep(0.0,1.0,fract(coarse)));
  float b = mix(pileHash(floor(fine)+seed*3.1), pileHash(floor(fine)+1.0+seed*3.1), smoothstep(0.0,1.0,fract(fine)));
  return (a*0.6+b*0.4)*(0.75+0.25*sin(uv.y*7.0+a*6.2832));
}
`
const stageLighting = (seed: string, flies: number) => /* glsl */`
  float stageHeight = clamp((clothPosition.y+1.0)*0.5,0.0,1.0);
  float flies = 1.0-${flies.toFixed(2)}*smoothstep(0.6,1.0,stageHeight);
  float facing = clamp(abs(normal.z),0.0,1.0);
  float rim = pow(1.0-facing,1.4);
  float pile = velvetPile(clothUv, ${seed});
  float velvetCore = mix(0.8,1.0,rim);
  reflectedLight.directDiffuse *= flies*velvetCore;
  reflectedLight.indirectDiffuse *= flies*velvetCore;
  float footlight = exp(-pow(stageHeight/0.16,2.0));
  reflectedLight.indirectDiffuse += diffuseColor.rgb*footColor*footlight*0.8;
  reflectedLight.indirectDiffuse += rimColor*rim*(0.65+0.7*pile)*flies*0.3;
`

// Gold braid: rounded across its width with a twisted cord along its length.
const braidPars = /* glsl */`
uniform float braidStart;
uniform float braidWidth;
uniform float braidCycles;
`
const braid = /* glsl */`
  float braidAcross = clamp((clothUv.y-braidStart)/braidWidth,0.0,1.0);
  float twist = 0.5+0.5*sin(clothUv.x*braidCycles*6.28318 + braidAcross*5.5);
  diffuseColor.rgb *= (0.6+0.4*sin(braidAcross*3.14159))*(0.72+0.4*twist*twist);
`

type ClothUniforms = {
  curtainProgress: { value: number }
  curtainAspect: { value: number }
  curtainSide: { value: number }
  curtainTime: { value: number }
}

type ValanceUniforms = {
  valanceAspect: { value: number }
  valanceLift: { value: number }
}

type StageUniforms = {
  rimColor: { value: THREE.Color }
  footColor: { value: THREE.Color }
}

type BraidUniforms = {
  braidStart: { value: number }
  braidWidth: { value: number }
  braidCycles: { value: number }
}

type ProjectionUniforms = {
  colourLogoMap: { value: THREE.Texture }
  digitMap: { value: THREE.Texture }
  digitOffsets: { value: THREE.Vector3 }
  logoSize: { value: THREE.Vector2 }
  projectionColor: { value: THREE.Color }
  clothTint: { value: THREE.Color }
  projectionStrength: { value: number }
  countdownDigit: { value: number }
  logoOpacity: { value: number }
  irisProgress: { value: number }
  leaderFlash: { value: number }
  leaderFlare: { value: number }
  filmFrame: { value: number }
  projectorTime: { value: number }
  countdownOpacity: { value: number }
}

// A stationary projector illuminates the moving mesh. Artwork coordinates are
// computed from the deformed surface, never from the flat cloth UVs.
const projectionShader = /* glsl */`
uniform sampler2D colourLogoMap;
uniform sampler2D digitMap;
uniform vec3 digitOffsets;
uniform vec2 logoSize;
uniform vec3 projectionColor;
uniform vec3 clothTint;
uniform float projectionStrength;
uniform float countdownDigit;
uniform float logoOpacity;
uniform float irisProgress;
uniform float leaderFlash;
uniform float leaderFlare;
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
vec4 logoTransmission(vec2 uv) {
  // Crop only the sampling window; the supplied 1254px PNG stays unmodified.
  vec2 sourceUv = vec2(229.0,176.0)/1254.0 + uv*vec2(795.0,964.0)/1254.0;
  // Premultiplied linear colour: transparent paper never enters the mipmaps.
  return texture2D(colourLogoMap,sourceUv)*insideProjection(uv);
}
`

const projectionLighting = /* glsl */`
  float perspective = 3.2 / (3.2-clothPosition.z);
  vec2 projected = clothPosition.xy * perspective;
  // Centre the visible crest (crown through IVY KIDS, source y=114..876).
  // The anniversary ribbon hangs below it instead of pulling the crest up.
  // UVs run upwards: (1254 - 495 - 176) / 964 is the crest's source centre.
  vec2 center = vec2(0.0);
  vec2 logoUv = (projected-center)/logoSize + vec2(0.5,583.0/964.0);
  vec2 leader = (projected-center)/logoSize.y;
  float radius = length(leader);
  float aa = max(fwidth(radius),0.001);
  // Low-contrast 12 fps grain, never a whole-frame brightness flash.
  vec2 grainCell = floor((leader+0.5)*520.0);
  float grain = fract(sin(dot(grainCell+filmFrame,vec2(12.9898,78.233)))*43758.5453);
  float foldReception = 0.8+0.2*smoothstep(-0.085,0.065,clothPosition.z);

  // Emblem: one slide, one light model. A soft follow-spot pool surrounds it,
  // dark ink blocks the lamp, coloured areas replace the cloth with their light.
  float logoFocus = 0.0016+abs(clothPosition.z)*0.018;
  vec4 slide = logoTransmission(logoUv)*0.84 + (logoTransmission(logoUv-vec2(logoFocus,0.0))
             + logoTransmission(logoUv+vec2(logoFocus,0.0)) + logoTransmission(logoUv+vec2(0.0,logoFocus))
             + logoTransmission(logoUv-vec2(0.0,logoFocus)))*0.04;
  float slideLuma = dot(slide.rgb,vec3(0.2126,0.7152,0.0722));
  // The anniversary ribbon stays a warm-gold monochrome slide. The original
  // artwork has a clear gap at rows 876–878 below IVY KIDS; blend within it.
  float goldRibbon = 1.0-smoothstep(200.0/964.0,202.0/964.0,logoUv.y);
  slide.rgb = mix(slide.rgb, projectionColor*min(1.15,slideLuma*1.7), goldRibbon);
  float ink = slide.a*(1.0-smoothstep(0.015,0.06,slideLuma/max(slide.a,0.001)));
  float coloured = max(0.0,slide.a-ink);
  vec2 poolOffset = leader - vec2(0.0,0.47-583.0/964.0);
  float poolRadius = 0.60*irisProgress;
  float iris = 1.0-smoothstep(poolRadius*0.78,poolRadius+0.002,length(poolOffset));
  float crestOn = iris*logoOpacity*projectionStrength;

  // Countdown: a single ring with the numeral, red velvet still inside it.
  vec2 digitUv = leader/0.80 + 0.5;
  // Keep the numerals optically centred on their ink, not their advance width.
  digitUv.x += countdownDigit > 2.5 ? digitOffsets.x : countdownDigit > 1.5 ? digitOffsets.y : digitOffsets.z;
  // Each number lands slightly out of focus and pulls sharp within ~150 ms.
  float focus = 0.002 + abs(clothPosition.z)*0.027 + leaderFlash*0.016;
  float digit = digitTransmission(digitUv);
  float softDigit = (digitTransmission(digitUv+vec2(focus,0.0))
                   + digitTransmission(digitUv-vec2(focus,0.0))
                   + digitTransmission(digitUv+vec2(0.0,focus))
                   + digitTransmission(digitUv-vec2(0.0,focus)))*0.25;
  float glyph = mix(digit, softDigit, min(1.0,leaderFlash*1.3));
  float ringDistance = abs(radius-0.49);
  float ringCore = 1.0-smoothstep(0.0045,0.0045+aa+focus*0.35,ringDistance);
  float ringPool = 1.0-smoothstep(0.46,0.49,radius);
  float leaderOn = countdownOpacity*projectionStrength;
  // Subtle lamp breathing affects the projection only, never the whole viewport.
  float lamp = (1.0+0.006*sin(projectorTime*23.0)+0.004*sin(projectorTime*41.0))
             * (1.0+0.30*leaderFlash+0.28*leaderFlare);
  float leaderLight = (glyph*0.66 + softDigit*0.14 + ringCore*0.5)*leaderOn*foldReception*(0.985+grain*0.03)*lamp;

  vec3 lightDirection = normalize(vec3(center,3.2)-clothPosition);
  float incidence = pow(max(0.0,dot(normal,lightDirection)),0.85);
  vec2 spotPosition = (projected-center)/vec2(logoSize.x*1.2,1.05);
  float spot = exp(-1.65*dot(spotPosition,spotPosition));
  // The stage wash narrows while the projector runs, then relaxes for the opening.
  float stageFalloff = 1.0 - mix(0.22,0.4,projectionStrength)*(1.0-spot);
  float projectorPool = max(crestOn, ringPool*leaderOn*0.8);
  float wash = stageFalloff*(1.0-0.36*projectorPool)*(1.0-0.82*coloured*crestOn);
  reflectedLight.directDiffuse *= wash;
  reflectedLight.indirectDiffuse *= wash;
  float crestFold = 0.74+0.26*smoothstep(-0.085,0.065,clothPosition.z);
  // A little of the dyed cloth tints every projected colour so it sits in the pile.
  vec3 slideLight = slide.rgb*mix(vec3(1.0),clothTint,0.12)*crestOn*crestFold*(0.99+grain*0.02)*1.05;
  // Pools brighten the velvet itself (light times dye) and catch its pile on the
  // turning flanks, so they read as light on cloth, never as a painted disc.
  vec3 poolLight = (diffuseColor.rgb*0.95 + rimColor*rim*0.12 + 0.01)*projectionColor
                 * (crestOn*(1.0-slide.a) + ringPool*leaderOn*0.3*lamp);
  vec3 numeralLight = projectionColor*mix(vec3(1.0),clothTint,0.18)*leaderLight*(0.9+0.2*pile);
  reflectedLight.directDiffuse += (slideLight + poolLight + numeralLight) * incidence;
`

function velvetUniforms(): StageUniforms {
  return { rimColor: { value: new THREE.Color(velvetPalette.rim) }, footColor: { value: new THREE.Color(velvetPalette.footlight) } }
}

function velvetMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: velvetPalette.fabric, roughness: 0.96, metalness: 0,
    sheen: 1, sheenColor: velvetPalette.sheen, sheenRoughness: 0.55,
    specularIntensity: 0.14, side: THREE.DoubleSide
  })
}

function trimMaterial() {
  return new THREE.MeshStandardMaterial({
    color: velvetPalette.trim, metalness: 0.25, roughness: 0.45,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  })
}

type Surface = { vertex: string, point: string, normalSign: string }
const drapeSurface: Surface = { vertex: clothDeformation, point: 'curtainPoint', normalSign: '-curtainSide' }
const valanceSurface: Surface = { vertex: valanceDeformation, point: 'valancePoint', normalSign: '1.0' }

type Shading = { stage?: StageUniforms & { seed: string, flies: number }, braid?: BraidUniforms, projection?: ProjectionUniforms }

function deformMaterial(material: THREE.Material, surface: Surface, uniforms: object, shading: Shading = {}) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = surface.vertex + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = ${surface.point}(uv); clothUv = uv; clothPosition = transformed;`)
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      vec3 alongU = ${surface.point}(uv + vec2(0.0003,0.0)) - ${surface.point}(uv - vec2(0.0003,0.0));
      vec3 alongV = ${surface.point}(uv + vec2(0.0,0.0003)) - ${surface.point}(uv - vec2(0.0,0.0003));
      vec3 objectNormal = normalize(cross(alongU, alongV)) * ${surface.normalSign};
    `)
    if (!shading.stage && !shading.braid) return
    // Three's stock fragment shader supplies physical diffuse, velvet sheen,
    // soft shadowing and colour conversion; we only add the stage around it.
    let pars = 'varying vec2 clothUv;\nvarying vec3 clothPosition;\n'
    let colour = ''
    let lights = ''
    if (shading.braid) {
      Object.assign(shader.uniforms, shading.braid)
      pars += braidPars
      colour += braid
    }
    if (shading.stage) {
      const { seed, flies, ...stage } = shading.stage
      Object.assign(shader.uniforms, stage)
      pars += stageLightingPars
      colour += `
        float nap = sin(clothUv.x*93.0 + sin(clothUv.y*17.0))*sin(clothUv.y*137.0);
        float dye = 0.95 + 0.035*sin(clothUv.x*37.0+clothUv.y*9.0) + nap*0.014 + 0.05*velvetPile(clothUv, ${seed});
        diffuseColor.rgb *= dye;
      `
      lights += stageLighting(seed, flies)
    }
    if (shading.projection) {
      Object.assign(shader.uniforms, shading.projection)
      pars += projectionShader
      lights += projectionLighting
    }
    shader.fragmentShader = pars + shader.fragmentShader
    if (colour) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${colour}`)
    if (lights) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${lights}`)
  }
  const key = `${surface.point}-${shading.projection ? 'projection' : shading.braid ? 'braid' : shading.stage ? 'velvet' : 'depth'}`
  material.customProgramCacheKey = () => `ivy-velvet-a-${key}-14`
}

function colourProjectionTexture(source: HTMLImageElement) {
  // Key the original paper BEFORE filtering. Keying an already-downsampled
  // opaque image turns its white background into a bright fringe around ink.
  const canvas = document.createElement('canvas')
  const width = canvas.width = source.naturalWidth
  const height = canvas.height = source.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(source,0,0)
  const { data } = context.getImageData(0,0,width,height)
  const alpha = new Float32Array(width*height)
  const bytes = new Uint8Array(data.length)
  const linear = Float32Array.from({ length: 256 },(_,i) => {
    const c = i/255
    return c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4
  })
  for (let p=0;p<alpha.length;p++) {
    const i = p*4
    const pigment = 1-Math.min(data[i]!,data[i+1]!,data[i+2]!)/255
    const t = Math.min(1,Math.max(0,(pigment-0.045)/0.060))
    alpha[p] = t*t*(3-2*t)*data[i+3]!/255
  }
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const p = y*width+x
    let coverage = alpha[p]!
    if (!coverage) continue
    const i = p*4
    // Only the outer edge needs unmatting. Cream faces fully inside the ink
    // silhouette keep their original colours rather than becoming transparent.
    const edge = coverage < 0.99 || (x>0 && alpha[p-1]!<0.05) || (x<width-1 && alpha[p+1]!<0.05)
      || (y>0 && alpha[p-width]!<0.05) || (y<height-1 && alpha[p+width]!<0.05)
    if (edge) {
      let reference = i
      let contrast = 0
      for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) {
        if (x+dx<0 || x+dx>=width || y+dy<0 || y+dy>=height) continue
        const n = ((y+dy)*width+x+dx)*4
        const difference = (255-data[n]!)**2+(255-data[n+1]!)**2+(255-data[n+2]!)**2
        if (alpha[n/4]!>0.99 && difference>contrast) { contrast=difference; reference=n }
      }
      if (contrast) {
        const dot = (255-data[i]!)*(255-data[reference]!)
          +(255-data[i+1]!)*(255-data[reference+1]!)+(255-data[i+2]!)*(255-data[reference+2]!)
        coverage = Math.min(coverage,Math.max(0,dot/contrast))
      }
    }
    if (coverage<0.001) continue
    // Reverse rows to match TextureLoader's UV orientation. Encode premultiplied
    // linear RGB as sRGB bytes; SRGB8_ALPHA8 decodes before GPU interpolation.
    const target = ((height-1-y)*width+x)*4
    for (let channel=0;channel<3;channel++) {
      const ink = Math.round(Math.min(255,Math.max(0,(data[i+channel]!-(1-coverage)*255)/coverage)))
      const light = linear[ink]!*coverage
      bytes[target+channel] = Math.round(255*(light<=0.0031308 ? light*12.92 : 1.055*light**(1/2.4)-0.055))
    }
    bytes[target+3] = Math.round(coverage*255)
  }
  const texture = new THREE.DataTexture(bytes,width,height)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

// 768px cells keep the numeral edges clean at 2x desktop and 3x phones.
const DIGIT_CELL = 768
const DIGIT_FAMILY = 'Ivy Countdown'

function drawDigits(atlas: HTMLCanvasElement) {
  const context = atlas.getContext('2d', { willReadFrequently: true })!
  context.clearRect(0,0,atlas.width,atlas.height)
  context.fillStyle = '#fff'
  context.font = `800 ${DIGIT_CELL*1.17}px "${DIGIT_FAMILY}", "Helvetica Neue", Arial, sans-serif`
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  for (let i = 0; i < 3; i++) {
    const digit = String(3-i)
    const metrics = context.measureText(digit)
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
    context.fillText(digit, i*DIGIT_CELL+DIGIT_CELL/2-(metrics.actualBoundingBoxRight-metrics.actualBoundingBoxLeft)/2,
      DIGIT_CELL/2+height/2-metrics.actualBoundingBoxDescent)
  }
  // Horizontal ink centroid per numeral, as a fraction of the cell.
  return [0,1,2].map(index => {
    const { data } = context.getImageData(index*DIGIT_CELL,0,DIGIT_CELL,DIGIT_CELL)
    let mass = 0
    let weightedX = 0
    for (let pixel=0;pixel<data.length/4;pixel++) {
      const alpha = data[pixel*4+3]!
      mass += alpha
      weightedX += ((pixel%DIGIT_CELL)+0.5)*alpha
    }
    return mass ? weightedX/mass/DIGIT_CELL-0.5 : 0
  })
}

export function createEntranceCurtain(canvas: HTMLCanvasElement, host: HTMLElement, logoUrl = '/assets/ivy-30th-anniversary-projection.png', options: EntranceCurtainOptions = {}) {
  const { valance = false, digitFontUrl = '/assets/fonts/lineseed-eb.woff2' } = options
  const mobile = host.clientWidth < 700
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.VSMShadowMap
  renderer.shadowMap.autoUpdate = false
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 15)
  camera.position.z = 5

  scene.add(new THREE.HemisphereLight(velvetPalette.sky, velvetPalette.ground, 0.85))
  const key = new THREE.DirectionalLight(velvetPalette.key, 2.4)
  key.position.set(-2.8, 3.5, 3)
  key.castShadow = true
  key.shadow.mapSize.setScalar(mobile ? 512 : 1024)
  key.shadow.bias = -0.00015
  key.shadow.normalBias = 0.007
  key.shadow.radius = 3
  key.shadow.blurSamples = 6
  key.shadow.camera.near = 0.1
  key.shadow.camera.far = 12
  scene.add(key)
  const fill = new THREE.DirectionalLight(velvetPalette.fill, 0.6)
  fill.position.set(2, 0.6, 3)
  scene.add(fill)
  const colourPlaceholder = new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1)
  colourPlaceholder.needsUpdate = true
  const digitAtlas = document.createElement('canvas')
  digitAtlas.width = DIGIT_CELL*3
  digitAtlas.height = DIGIT_CELL
  const digits = new THREE.CanvasTexture(digitAtlas)
  digits.minFilter = THREE.LinearMipmapLinearFilter
  digits.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
  let colourLogo: THREE.Texture | undefined
  const projection: ProjectionUniforms = {
    colourLogoMap: { value: colourPlaceholder }, digitMap: { value: digits },
    digitOffsets: { value: new THREE.Vector3(...drawDigits(digitAtlas)) },
    logoSize: { value: new THREE.Vector2(0.86,1.04) },
    projectionColor: { value: new THREE.Color(velvetPalette.projection) },
    clothTint: { value: new THREE.Color(velvetPalette.clothTint) },
    projectionStrength: { value: 0 }, countdownDigit: { value: 3 }, logoOpacity: { value: 0 },
    irisProgress: { value: 0 }, leaderFlash: { value: 0 }, leaderFlare: { value: 0 },
    filmFrame: { value: 0 }, projectorTime: { value: 0 }, countdownOpacity: { value: 0 }
  }
  const hemBraid: BraidUniforms = { braidStart: { value: 0.004 }, braidWidth: { value: 0.022 }, braidCycles: { value: 80 } }
  const geometry = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 216, mobile ? 64 : 96)
  const trimGeometry = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 216, 3)
  const trimUV = trimGeometry.attributes.uv!
  for (let i = 0; i < trimUV.count; i++) trimUV.setY(i, 0.004 + trimUV.getY(i) * 0.022)
  // The right panel mirrors x in its vertex shader. Reverse its triangle
  // winding as well so lighting and shadow normal bias remain front-facing.
  function mirrored(source: THREE.PlaneGeometry) {
    const copy = source.clone()
    const indices = copy.index!
    for (let i = 0; i < indices.count; i += 3) {
      const b = indices.getX(i + 1)
      indices.setX(i + 1, indices.getX(i + 2))
      indices.setX(i + 2, b)
    }
    return copy
  }
  const rightGeometry = mirrored(geometry)
  const rightTrimGeometry = mirrored(trimGeometry)
  const geometries: THREE.BufferGeometry[] = [geometry, trimGeometry, rightGeometry, rightTrimGeometry]
  const materials: THREE.Material[] = []
  const clothUniforms: ClothUniforms[] = []
  for (const side of [-1, 1]) {
    const uniforms: ClothUniforms = {
      curtainProgress: { value: 0 }, curtainAspect: { value: 1 },
      curtainSide: { value: side }, curtainTime: { value: 0 }
    }
    clothUniforms.push(uniforms)
    const cloth = velvetMaterial()
    deformMaterial(cloth, drapeSurface, uniforms, { stage: { ...velvetUniforms(), seed: side > 0 ? '11.0' : '3.0', flies: 0.56 }, projection })
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
    deformMaterial(depth, drapeSurface, uniforms)
    const panel = new THREE.Mesh(side === 1 ? rightGeometry : geometry, cloth)
    panel.frustumCulled = false
    panel.castShadow = panel.receiveShadow = true
    panel.customDepthMaterial = depth
    scene.add(panel)
    const trim = trimMaterial()
    // The footlight catches the hem braid, so it reads as gold rather than brass.
    deformMaterial(trim, drapeSurface, uniforms, { braid: hemBraid, stage: { ...velvetUniforms(), seed: '5.0', flies: 0 } })
    const seam = new THREE.Mesh(side === 1 ? rightTrimGeometry : trimGeometry, trim)
    seam.frustumCulled = false
    seam.receiveShadow = true
    // VSM renders shadow receivers into the depth map too. Without the deformed
    // depth pass the braid became a flat, invisible 2×2 occluder at z=0 that
    // darkened every recessed valley and ended in jagged spikes at y=1.
    seam.customDepthMaterial = depth
    scene.add(seam)
    materials.push(cloth, depth, trim)
  }
  const valanceUniforms: ValanceUniforms = { valanceAspect: { value: 1 }, valanceLift: { value: 0 } }
  const valanceBraid: BraidUniforms = { braidStart: { value: 0 }, braidWidth: { value: 0.09 }, braidCycles: { value: 160 } }
  if (valance) {
    const drape = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 240, 24)
    const edge = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 240, 3)
    const edgeUV = edge.attributes.uv!
    for (let i = 0; i < edgeUV.count; i++) edgeUV.setY(i, edgeUV.getY(i) * 0.09)
    geometries.push(drape, edge)
    const cloth = velvetMaterial()
    deformMaterial(cloth, valanceSurface, valanceUniforms, { stage: { ...velvetUniforms(), seed: '7.0', flies: 0.25 } })
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
    deformMaterial(depth, valanceSurface, valanceUniforms)
    const pelmet = new THREE.Mesh(drape, cloth)
    pelmet.frustumCulled = false
    pelmet.castShadow = pelmet.receiveShadow = true
    pelmet.customDepthMaterial = depth
    scene.add(pelmet)
    const trim = trimMaterial()
    deformMaterial(trim, valanceSurface, valanceUniforms, { braid: valanceBraid, stage: { ...velvetUniforms(), seed: '9.0', flies: 0 } })
    const cord = new THREE.Mesh(edge, trim)
    cord.frustumCulled = false
    scene.add(cord)
    materials.push(cloth, depth, trim)
  }
  const shadowGeometry = new THREE.PlaneGeometry(2, 2)
  geometries.push(shadowGeometry)
  const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.18, depthWrite: false })
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
  shadow.position.z = -0.25
  shadow.receiveShadow = true
  scene.add(shadow)
  let disposed = false
  let current = 0
  let previousOpening = -1
  function draw(progress: number) {
    if (disposed) return
    current = Math.min(1, Math.max(0, progress))
    const state = entranceTimeline(current * ENTRANCE_DURATION)
    projection.projectionStrength.value = state.projection
    projection.countdownDigit.value = state.countdown || 1
    projection.logoOpacity.value = state.logoOpacity
    projection.irisProgress.value = state.iris
    projection.leaderFlash.value = state.flash
    projection.leaderFlare.value = state.flare
    projection.filmFrame.value = state.filmFrame
    projection.projectorTime.value = current*ENTRANCE_DURATION/1000
    projection.countdownOpacity.value = state.leaderOpacity
    // The valance waits until the drapes have mostly cleared, then flies out.
    const lift = Math.min(1, Math.max(0, (state.opening - 0.5) / 0.45))
    valanceUniforms.valanceLift.value = lift * lift * (3 - 2 * lift)
    // Release the backdrop shadow before disposing the overlay, so the page
    // does not jump from a darkened frame to full brightness at the very end.
    shadowMaterial.opacity = state.shadowOpacity
    shadow.visible = state.shadowOpacity > 0
    // Only the projection changes while the closed geometry and lights
    // do not move. Reuse its shadow; invalidate on opening, seeking or resizing.
    if (state.opening !== previousOpening) renderer.shadowMap.needsUpdate = true
    previousOpening = state.opening
    for (const uniforms of clothUniforms) {
      uniforms.curtainProgress.value = state.opening
      uniforms.curtainTime.value = current * ENTRANCE_DURATION / 1000
    }
    renderer.render(scene, camera)
  }
  function resize() {
    if (disposed) return
    const { width, height } = host.getBoundingClientRect()
    const aspect = width / Math.max(1, height)
    camera.left = -aspect
    camera.right = aspect
    camera.updateProjectionMatrix()
    // Resolve the emblem's fine navy strokes on high-density displays, while
    // bounding the framebuffer on large screens instead of rendering at 3x.
    const pixelRatio = Math.min(window.devicePixelRatio || 1,2,Math.sqrt(4_500_000/Math.max(1,width*height)))
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    // Preserve the accepted desktop emblem/number scale; phones scale with width.
    const compositionWidth = Math.min(width*0.64,880,height*1.2)
    const compositionHeight = compositionWidth*9/16
    const aperture = width > 900 ? compositionHeight*0.76*2/height : Math.min(1.04,aspect*1.5)
    projection.logoSize.value.set(aperture*795/964,aperture)
    clothUniforms.forEach(uniforms => { uniforms.curtainAspect.value = aspect })
    valanceUniforms.valanceAspect.value = aspect
    // Keep one braid twist every ~9 CSS px whatever the viewport.
    hemBraid.braidCycles.value = 0.527*width/9
    valanceBraid.braidCycles.value = 1.02*width/9
    shadow.scale.x = aspect
    const extent = Math.max(2, aspect * 1.6)
    Object.assign(key.shadow.camera, { left: -extent, right: extent, top: 2.5, bottom: -2.5 })
    key.shadow.camera.updateProjectionMatrix()
    renderer.shadowMap.needsUpdate = true
    // Compile the first frame after artwork arrives, rather than a blank frame.
    if (colourLogo) draw(current)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  let digitFace: FontFace | undefined
  // A missing or slow font keeps the fallback numerals rather than blocking.
  const fontReady = typeof FontFace === 'undefined' ? Promise.resolve() : new FontFace(DIGIT_FAMILY, `url(${digitFontUrl})`, { weight: '800' })
    .load().then(face => {
      if (disposed) return
      digitFace = face
      document.fonts.add(face)
      projection.digitOffsets.value.set(...drawDigits(digitAtlas) as [number, number, number])
      digits.needsUpdate = true
      if (colourLogo) draw(current)
    }).catch(() => undefined)
  const logoReady = new THREE.ImageLoader().loadAsync(logoUrl).then(image => {
    if (disposed) return
    colourLogo = colourProjectionTexture(image)
    colourLogo.anisotropy = Math.min(4,renderer.capabilities.getMaxAnisotropy())
    projection.colourLogoMap.value = colourLogo
    draw(current)
  })
  // Start asset requests before the first synchronous shader compilation.
  resize()
  return {
    draw, ready: Promise.all([logoReady, fontReady]).then(() => undefined),
    dispose() {
      if (disposed) return
      disposed = true
      observer.disconnect()
      geometries.forEach(item => item.dispose())
      shadowMaterial.dispose()
      colourPlaceholder.dispose()
      digits.dispose()
      colourLogo?.dispose()
      if (digitFace) document.fonts.delete(digitFace)
      materials.forEach(material => material.dispose())
      key.shadow.dispose()
      scene.clear()
      renderer.dispose()
    }
  }
}

export type EntranceCurtainRenderer = ReturnType<typeof createEntranceCurtain>
