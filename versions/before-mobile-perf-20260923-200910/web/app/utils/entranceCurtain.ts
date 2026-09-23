import * as THREE from 'three'
import { entranceTimeline, ENTRANCE_DURATION } from './entrance-timeline'

// Crimson velvet highlights and a near-white leader lamp (both chosen 2026-09-23).
// Changing how the resting curtain looks? Re-render the first-paint posters in
// entrance-policy.ts (ENTRANCE_POSTERS), or the pre-WebGL cover shows the old one.
const velvetPalette = {
  fabric: '#561326', sheen: '#a83a48', rim: '#cf4a58', trim: '#bf9a52', tasselThread: '#e0ac50', tasselSheen: '#ffe2a8',
  sky: '#f4d8ca', ground: '#1e0a14', key: '#fff0dd', fill: '#eab6bc',
  projection: '#efce92', leaderLamp: '#fff3e4', footlight: '#ffb778', clothTint: '#ff8a99'
}
// How far the valance flies out: far enough that its ease-out finishes above
// the frame, so the tassels do not crawl across the page header on the way out.
const VALANCE_FLY = 0.5

type EntranceCurtainOptions = {
  /** Leader numerals face; the fallback sans stays drawn until it loads. */
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
  // The lower cloth trails, then swings past the rail as it slows; the leading
  // hem swings the most.
  float lag = 0.090 * pow(1.0-v, 1.5) * (sin(travel*C_PI) + 0.35*sin(2.0*travel*C_PI)) * (0.7 + 0.3*u);
  float pull = max(0.0, travel - lag);
  float wind = sin(curtainTime * 3.6 - v * 4.6 + u * 2.3 + seed) * sin(travel * C_PI);
  float width = 1.0 - pull * 0.87;
  float foldCount = clamp(curtainAspect * 4.8, 3.2, 7.5);
  float phase = u * C_PI * 2.0 * foldCount + 0.48*sin(u*17.0 + seed) + 0.23*sin(u*39.0 + seed);
  phase += (1.0-v) * (0.22*sin(u*13.0 + v*3.0 + seed) + wind*0.2);
  // Gathering deepens the folds as the panel bunches toward the wings.
  float amplitude = (0.066 + 0.019*sin(u*19.0 + seed) + 0.012*sin(u*37.0)) * (1.0 + pull*0.55);
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
  // A traveller track: the panels slide sideways and the hem stays on the
  // floor. (An earlier tableau-style lift raised the leading hem as it pulled.)
  float y = -1.025 + v*2.35 + hem;
  z += wind * 0.018 * sin(v*C_PI);
  // Finer tension creases near the trailing seam and weighted lower hem.
  z += 0.006*sin(u*104.0+v*19.0+seed)*pow(1.0-v,3.0);
  z += 0.008*sin(v*25.0+u*30.0)*pow(u,8.0)*sin(travel*C_PI);
  // The weighted leading edges hang calmer, so the centre overlap barely steps
  // the projection where the two panels meet.
  z *= mix(0.2, 1.0, 1.0 - smoothstep(0.9, 1.0, u));
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
  float y = mix(bottom, 1.04, uv.y) + valanceLift*${VALANCE_FLY.toFixed(2)};
  float x = (uv.x*2.0-1.0)*valanceAspect*1.02;
  // Hung just in front of the drapes so its shadow stays a tight band.
  float z = 0.10 + 0.034*droop*sin(uv.y*V_PI)
          + 0.016*sin((uv.y*6.5 + droop*0.9)*V_PI)*droop
          + 0.014*sin(uv.x*swags*V_PI*14.0)*pow(1.0-droop,3.0);
  return vec3(x,y,z);
}
`

// Stage light shared by drapes and valance: dark flies above, a warm
// footlight below, and velvet's pile glowing on the flanks that turn away.
const stageLightingPars = /* glsl */`
uniform vec3 rimColor;
uniform vec3 footColor;
uniform float pileDensity;
float pileHash(float n) { return fract(sin(n)*43758.5453); }
float pileNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n = i.x + i.y*57.0;
  return mix(mix(pileHash(n),pileHash(n+1.0),f.x),mix(pileHash(n+57.0),pileHash(n+58.0),f.x),f.y);
}
// Fibre-scale pile about 2 CSS px across and 8 px along the drop. It fades out
// once cells shrink below a couple of pixels (gathered cloth) instead of fizzing.
float velvetFibre(vec2 uv) {
  vec2 p = uv*vec2(pileDensity, pileDensity*0.25);
  float fade = 1.0-smoothstep(0.3,0.7,fwidth(p.x));
  return 0.5 + (pileNoise(p)-0.5)*fade;
}
float velvetPile(vec2 uv, float seed) {
  // Crushed pile runs with the drop: soft vertical streaks, not uniform noise.
  float coarse = uv.x*70.0;
  float fine = uv.x*230.0;
  float a = mix(pileHash(floor(coarse)+seed), pileHash(floor(coarse)+1.0+seed), smoothstep(0.0,1.0,fract(coarse)));
  float b = mix(pileHash(floor(fine)+seed*3.1), pileHash(floor(fine)+1.0+seed*3.1), smoothstep(0.0,1.0,fract(fine)));
  return (a*0.6+b*0.4)*(0.75+0.25*sin(uv.y*7.0+a*6.2832));
}
`
const stageLighting = (seed: string, flies: number, foot: number) => /* glsl */`
  float stageHeight = clamp((clothPosition.y+1.0)*0.5,0.0,1.0);
  float flies = 1.0-${flies.toFixed(2)}*smoothstep(0.6,1.0,stageHeight);
  float facing = clamp(abs(normal.z),0.0,1.0);
  float rim = pow(1.0-facing,1.4);
  float pile = velvetPile(clothUv, ${seed});
  float fibre = velvetFibre(clothUv);
  // Crushed velvet: broad, faint patches where the pile lies a different way.
  float crush = pileNoise(clothUv*vec2(7.0,3.0) + ${seed});
  float velvetCore = mix(0.8,1.0,rim);
  reflectedLight.directDiffuse *= flies*velvetCore;
  reflectedLight.indirectDiffuse *= flies*velvetCore;
  float footlight = exp(-pow(stageHeight/0.16,2.0));
  reflectedLight.indirectDiffuse += diffuseColor.rgb*footColor*footlight*${foot.toFixed(2)};
  reflectedLight.indirectDiffuse += rimColor*rim*(0.65+0.7*pile)*(0.75+0.5*fibre)*(0.85+0.3*crush)*flies*0.3;
`

// The valance's soft contact shadow on the drapes, computed from its own hem
// rather than a hard shadow map that carved every fold into a lit arch.
const valanceShadePars = /* glsl */`
uniform float valanceAspect;
uniform float valanceLift;
float valanceHem(float x) {
  float u = (x/(valanceAspect*1.02)+1.0)*0.5;
  float swags = max(2.0, floor(valanceAspect*2.4 + 0.5));
  return 0.77 - 0.06*sin(fract(u*swags)*3.14159265) + valanceLift*${VALANCE_FLY.toFixed(2)};
}
`
const valanceShade = /* glsl */`
  float underValance = valanceHem(clothPosition.x - 0.03) - clothPosition.y;
  float contact = 1.0 - 0.62*(underValance < 0.0 ? 1.0 : exp(-underValance/0.085));
  reflectedLight.directDiffuse *= contact;
  reflectedLight.indirectDiffuse *= contact;
`
// The front panel's leading hem reads as the split, so any projection step
// across the overlap sits inside a thin shadow instead of breaking a ring.
const centreSplit = /* glsl */`
  float centreSplit = 1.0 - 0.5*smoothstep(0.993, 1.0, clothUv.x);
  reflectedLight.directDiffuse *= centreSplit;
  reflectedLight.indirectDiffuse *= centreSplit;
`

// Gold braid: rounded across its width with a twisted cord along its length.
const braidPars = /* glsl */`
uniform float braidStart;
uniform float braidWidth;
uniform float braidCycles;
`
const braid = /* glsl */`
  float braidAcross = clamp((clothUv.y-braidStart)/braidWidth,0.0,1.0);
  // Two twisted strands: each period is one rounded, slanted ridge of cord.
  float strand = fract(clothUv.x*braidCycles + braidAcross*0.85);
  diffuseColor.rgb *= (0.35+0.65*sin(strand*3.14159))*(0.55+0.45*sin(braidAcross*3.14159));
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
  pileDensity: { value: number }
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
  leaderIris: { value: number }
  leaderSweep: { value: number }
  leaderLampColor: { value: THREE.Color }
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
uniform float leaderIris;
uniform float leaderSweep;
uniform vec3 leaderLampColor;
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

  // Countdown: a classic film leader projected through a round gate. Clear film
  // lights the velvet; the two rings, crosshair, sweep hand and numeral are
  // emulsion that blocks the lamp, so the numeral shows the unlit cloth.
  // The whole frame weaves a hair per film frame, as a real projector gate does.
  // The leader throws from a long booth lens (3.75x the emblem projector's
  // distance), so its circles stay round across the folds; the fold light and
  // shading below still model it onto the velvet.
  vec2 boothProjected = clothPosition.xy * (12.0/(12.0-clothPosition.z));
  vec2 gate = (boothProjected-center)/logoSize.y - vec2(sin(filmFrame*2.39),cos(filmFrame*1.73))*0.0035;
  float gateRadius = length(gate);
  float gateAa = max(fwidth(gateRadius),0.001);
  // Each number lands slightly out of focus and pulls sharp within ~150 ms.
  float focus = 0.002 + abs(clothPosition.z)*0.027 + leaderFlash*0.016;
  // A soft-edged gate: the lens fades the circle out rather than cutting it,
  // so the rings, not the cloth-warped rim, are the crisp circles.
  float gateOpen = 0.5*leaderIris;
  float lit = 1.0-smoothstep(gateOpen*0.93,gateOpen*1.04+gateAa,gateRadius);
  float ringOuter = 1.0-smoothstep(0.007,0.007+gateAa+focus*0.3,abs(gateRadius-0.455));
  float ringInner = 1.0-smoothstep(0.004,0.004+gateAa+focus*0.3,abs(gateRadius-0.375));
  float crossLines = 1.0-smoothstep(0.0028,0.0028+gateAa+focus*0.3,min(abs(gate.x),abs(gate.y)));
  // Clockwise from twelve o'clock; the wiped side prints a denser grey.
  float gateAngle = mod(atan(gate.x,gate.y)+6.28318530718,6.28318530718);
  float sweepAngle = leaderSweep*6.28318530718;
  float swept = 1.0-smoothstep(sweepAngle-0.012,sweepAngle+0.012,gateAngle);
  float handOffset = gateAngle-sweepAngle;
  float hand = (1.0-smoothstep(0.003,0.003+gateAa,gateRadius*abs(sin(handOffset))))*step(0.0,cos(handOffset));
  vec2 digitUv = gate/0.62 + 0.5;
  // Keep the numerals optically centred on their ink, not their advance width.
  digitUv.x += countdownDigit > 2.5 ? digitOffsets.x : countdownDigit > 1.5 ? digitOffsets.y : digitOffsets.z;
  float digit = digitTransmission(digitUv);
  float softDigit = (digitTransmission(digitUv+vec2(focus,0.0))
                   + digitTransmission(digitUv-vec2(focus,0.0))
                   + digitTransmission(digitUv+vec2(0.0,focus))
                   + digitTransmission(digitUv-vec2(0.0,focus)))*0.25;
  float glyph = mix(digit, softDigit, min(1.0,leaderFlash*1.3));
  float reel = floor(filmFrame/6.0);
  // Worn print: dust of mixed sizes every frame, now and then a hair that stays
  // for half a second, a running scratch, and pin-points where emulsion is gone.
  float dust = 0.0;
  float sparkle = 0.0;
  for (int i = 0; i < 4; i++) {
    float speckSeed = filmFrame*7.1 + float(i)*13.7;
    vec2 speck = vec2(pileHash(speckSeed),pileHash(speckSeed+41.3))*0.8-0.4;
    float speckSize = i == 3 ? 0.008+0.012*pileHash(speckSeed+5.9)*step(0.7,pileHash(speckSeed+2.2))
                             : 0.003+0.006*pileHash(speckSeed+5.9);
    dust = max(dust,1.0-smoothstep(speckSize,speckSize+gateAa,length(gate-speck)));
    vec2 pin = vec2(pileHash(speckSeed+17.9),pileHash(speckSeed+23.1))*0.8-0.4;
    sparkle = max(sparkle,1.0-smoothstep(0.002,0.002+gateAa,length(gate-pin)));
  }
  vec2 hairAt = gate - (vec2(pileHash(reel*5.3),pileHash(reel*6.1))*0.5-0.25);
  float hairCurve = hairAt.y - 0.04*sin(hairAt.x*18.0 + reel) - 0.6*hairAt.x*hairAt.x;
  float hair = step(0.7,pileHash(reel*3.7+1.0))*(1.0-smoothstep(0.0015,0.0015+gateAa,abs(hairCurve)))
             * (1.0-smoothstep(0.06,0.09,abs(hairAt.x)));
  float emulsion = max(max(max(ringOuter,ringInner),max(crossLines*0.9,hand*0.85)),max(glyph,hair*0.8));
  float scratchX = (pileHash(reel*4.7)-0.5)*0.6 + sin(filmFrame*0.9)*0.01;
  float scratch = (1.0-smoothstep(0.0012,0.0012+gateAa,abs(gate.x-scratchX)))*step(0.55,pileHash(reel*9.1));
  // Lamp hotspot in the middle, lens vignette toward the rim, and a clearly
  // denser grey on the side the hand has already wiped.
  float falloff = min(1.0,gateRadius/0.5);
  float tone = mix(1.0,0.55,swept)*(0.62+0.38*(1.0-falloff*falloff) + 0.12*exp(-pow(gateRadius/0.17,2.0)));
  float flicker = 0.9+0.1*pileHash(filmFrame*1.37+3.0);
  float leaderOn = countdownOpacity*projectionStrength;
  // Subtle lamp breathing affects the projection only, never the whole viewport.
  float lamp = (1.0+0.006*sin(projectorTime*23.0)+0.004*sin(projectorTime*41.0))
             * (1.0+0.30*leaderFlash+0.28*leaderFlare);
  float leaderLight = lit*(tone*(1.0-0.92*emulsion)*(1.0-0.75*dust)*flicker*(0.9+grain*0.2) + scratch*0.22 + sparkle*0.45)
                    * leaderOn*lamp*foldReception;

  vec3 lightDirection = normalize(vec3(center,3.2)-clothPosition);
  float incidence = pow(max(0.0,dot(normal,lightDirection)),0.85);
  vec2 spotPosition = (projected-center)/vec2(logoSize.x*1.2,1.05);
  float spot = exp(-1.65*dot(spotPosition,spotPosition));
  // The stage wash narrows while the projector runs, then relaxes for the opening.
  float stageFalloff = 1.0 - mix(0.22,0.4,projectionStrength)*(1.0-spot);
  float projectorPool = max(crestOn, lit*leaderOn*0.9);
  float wash = stageFalloff*(1.0-0.36*projectorPool)*(1.0-0.82*coloured*crestOn);
  reflectedLight.directDiffuse *= wash;
  reflectedLight.indirectDiffuse *= wash;
  float crestFold = 0.74+0.26*smoothstep(-0.085,0.065,clothPosition.z);
  // A little of the dyed cloth tints every projected colour so it sits in the pile.
  vec3 slideLight = slide.rgb*mix(vec3(1.0),clothTint,0.12)*crestOn*crestFold*(0.99+grain*0.02)*1.05;
  // Pools brighten the velvet itself (light times dye) and catch its pile on the
  // turning flanks, so they read as light on cloth, never as a painted disc.
  vec3 poolLight = (diffuseColor.rgb*0.95 + rimColor*rim*0.12 + 0.01)*projectionColor*crestOn*(1.0-slide.a);
  // The leader's clear film is brighter than the emblem's pool: a lit gate on the pile.
  vec3 leaderColour = (diffuseColor.rgb*6.0 + rimColor*rim*0.35 + 0.2)*leaderLampColor*leaderLight;
  reflectedLight.directDiffuse += (slideLight + poolLight + leaderColour) * incidence;
`

function velvetUniforms(pileDensity: { value: number }): StageUniforms {
  return { rimColor: { value: new THREE.Color(velvetPalette.rim) }, footColor: { value: new THREE.Color(velvetPalette.footlight) }, pileDensity }
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
    color: velvetPalette.trim, metalness: 0.45, roughness: 0.4,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  })
}

type Surface = { vertex: string, point: string, normalSign: string }
const drapeSurface: Surface = { vertex: clothDeformation, point: 'curtainPoint', normalSign: '-curtainSide' }
const valanceSurface: Surface = { vertex: valanceDeformation, point: 'valancePoint', normalSign: '1.0' }

type Shading = {
  stage?: StageUniforms & { seed: string, flies: number, foot?: number }
  braid?: BraidUniforms
  projection?: ProjectionUniforms
  valanceShadow?: ValanceUniforms
  /** Raise a cord off the cloth it is sewn to, so the two never z-fight. */
  lift?: number
}

function deformMaterial(material: THREE.Material, surface: Surface, uniforms: object, shading: Shading = {}) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = surface.vertex + shader.vertexShader
    const lift = shading.lift ? ` transformed.z += ${shading.lift.toFixed(4)};` : ''
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = ${surface.point}(uv);${lift} clothUv = uv; clothPosition = transformed;`)
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
      const { seed, flies, foot = 0.8, ...stage } = shading.stage
      Object.assign(shader.uniforms, stage)
      pars += stageLightingPars
      colour += `
        float nap = sin(clothUv.x*93.0 + sin(clothUv.y*17.0))*sin(clothUv.y*137.0);
        float dye = 0.95 + 0.035*sin(clothUv.x*37.0+clothUv.y*9.0) + nap*0.014 + 0.05*velvetPile(clothUv, ${seed})
                  + 0.06*(velvetFibre(clothUv)-0.5);
        diffuseColor.rgb *= dye;
      `
      lights += stageLighting(seed, flies, foot)
    }
    if (shading.valanceShadow) {
      Object.assign(shader.uniforms, shading.valanceShadow)
      pars += valanceShadePars
      lights += valanceShade
    }
    if (shading.projection) {
      Object.assign(shader.uniforms, shading.projection)
      pars += projectionShader
      lights += projectionLighting + centreSplit
    }
    shader.fragmentShader = pars + shader.fragmentShader
    if (colour) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${colour}`)
    if (lights) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${lights}`)
  }
  const key = `${surface.point}-${shading.projection ? 'projection' : shading.braid ? 'braid' : shading.stage ? 'velvet' : 'depth'}`
  material.customProgramCacheKey = () => `ivy-velvet-a-${key}-18`
}

// A silk tassel turned from a profile: a thread-wound head, a bound ruff, then
// a skirt of loose threads left open at the hem. The origin is the hanging
// point, so rotating it swings like a pendulum.
const TASSEL_RUFF = 0.045
const TASSEL_HEM = 0.124
function tasselGeometry() {
  const profile = [[0.0025,0],[0.0075,-0.0025],[0.0105,-0.0065],[0.012,-0.012],[0.012,-0.019],[0.0095,-0.026],
    [0.0065,-0.03],[0.0065,-0.033],[0.0105,-0.036],[0.0115,-0.04],[0.0085,-0.044],[0.01,-0.048],
    [0.014,-0.058],[0.0165,-0.076],[0.0178,-0.1],[0.0183,-TASSEL_HEM]]
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 48)
}

function tasselMaterial() {
  // Silk, not bullion: no metalness, a soft sheen instead of a mirror highlight.
  // Front faces only, so the gaps in a ragged hem show the velvet behind.
  const sheen = new THREE.Color(velvetPalette.tasselSheen)
  const material = new THREE.MeshPhysicalMaterial({
    color: velvetPalette.tasselThread, metalness: 0, roughness: 0.5,
    sheen: 1, sheenRoughness: 0.3, sheenColor: sheen
  })
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 tasselUv;\nvarying float tasselDrop;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntasselUv = uv;\ntasselDrop = -position.y;')
    shader.fragmentShader = 'varying vec2 tasselUv;\nvarying float tasselDrop;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      // Each thread keeps its own shade and length, so the hem is ragged and
      // the skirt reads as strands rather than a fluted cone.
      float threads = tasselUv.x*44.0;
      float thread = floor(threads);
      float shade = fract(sin(thread*12.9898)*43758.5453);
      float threadLength = fract(sin(thread*78.233)*24634.6345);
      float skirt = smoothstep(${TASSEL_RUFF},${TASSEL_RUFF + 0.003},tasselDrop);
      if (skirt > 0.5 && tasselDrop > ${TASSEL_HEM} - 0.006*threadLength) discard;
      float gap = smoothstep(0.0,0.2,fract(threads))*smoothstep(1.0,0.8,fract(threads));
      diffuseColor.rgb *= mix(1.0, (0.8+0.32*shade)*(0.72+0.28*gap), skirt);
      // The threads bunch into shadow just under the ruff.
      diffuseColor.rgb *= 1.0 - 0.4*skirt*(1.0-smoothstep(${TASSEL_RUFF + 0.002},${TASSEL_RUFF + 0.016},tasselDrop));
      // Thread wound round the head and ruff, and a cord binding the waist.
      float wound = 0.88 + 0.12*sin(tasselDrop*1400.0);
      diffuseColor.rgb *= mix(wound, 1.0, skirt);
      diffuseColor.rgb *= 1.0 - 0.4*(1.0-smoothstep(0.0012,0.0028,abs(tasselDrop-0.032)));`)
      // Threads catch the light one by one.
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      material.sheenColor *= mix(1.0, 0.4+0.95*shade, skirt);`)
      // Hanging threads throw a soft band of sheen across the skirt below the
      // shoulder, broken thread by thread.
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      float band = exp(-pow((tasselDrop-0.066)/0.014,2.0))*skirt;
      reflectedLight.directSpecular += vec3(${sheen.r.toFixed(3)},${sheen.g.toFixed(3)},${sheen.b.toFixed(3)})*band*(0.15+0.3*shade)*gap;`)
  }
  material.customProgramCacheKey = () => 'ivy-velvet-a-tassel-silk-3'
  return material
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
// A bold gothic like the Academy leader's numerals (Oswald 700, digits only, OFL).
const DIGIT_FAMILY = 'Ivy Leader'
const DIGIT_WEIGHT = '700'

function drawDigits(atlas: HTMLCanvasElement) {
  const context = atlas.getContext('2d', { willReadFrequently: true })!
  context.clearRect(0,0,atlas.width,atlas.height)
  context.fillStyle = '#fff'
  const family = `"${DIGIT_FAMILY}", "Helvetica Neue", Arial, sans-serif`
  // Size by the drawn ink, so condensed and fallback faces fill the same height.
  context.font = `${DIGIT_WEIGHT} 100px ${family}`
  const sample = context.measureText('3')
  const inkHeight = Math.max(1, sample.actualBoundingBoxAscent + sample.actualBoundingBoxDescent)
  context.font = `${DIGIT_WEIGHT} ${Math.round(DIGIT_CELL*0.84/inkHeight*100)}px ${family}`
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
  const { digitFontUrl = '/assets/fonts/oswald-700-leader.woff2' } = options
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
    leaderIris: { value: 0 }, leaderSweep: { value: 0 },
    leaderLampColor: { value: new THREE.Color(velvetPalette.leaderLamp) },
    filmFrame: { value: 0 }, projectorTime: { value: 0 }, countdownOpacity: { value: 0 }
  }
  const valanceUniforms: ValanceUniforms = { valanceAspect: { value: 1 }, valanceLift: { value: 0 } }
  const drapePile = { value: 200 }
  const valancePile = { value: 400 }
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
    deformMaterial(cloth, drapeSurface, uniforms, { stage: { ...velvetUniforms(drapePile), seed: side > 0 ? '11.0' : '3.0', flies: 0.56 }, projection, valanceShadow: valanceUniforms })
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
    deformMaterial(depth, drapeSurface, uniforms)
    const panel = new THREE.Mesh(side === 1 ? rightGeometry : geometry, cloth)
    panel.frustumCulled = false
    panel.castShadow = panel.receiveShadow = true
    panel.customDepthMaterial = depth
    scene.add(panel)
    const trim = trimMaterial()
    // The footlight catches the hem braid, so it reads as gold rather than brass.
    deformMaterial(trim, drapeSurface, uniforms, { braid: hemBraid, stage: { ...velvetUniforms(drapePile), seed: '5.0', flies: 0, foot: 0.35 }, lift: 0.003 })
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
  const valanceBraid: BraidUniforms = { braidStart: { value: 0 }, braidWidth: { value: 0.09 }, braidCycles: { value: 160 } }
  // Festooned valance: frames the stage, then flies out after the drapes clear.
  const drape = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 240, 24)
  const edge = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 240, 3)
  const edgeUV = edge.attributes.uv!
  for (let i = 0; i < edgeUV.count; i++) edgeUV.setY(i, edgeUV.getY(i) * 0.09)
  geometries.push(drape, edge)
  const pelmetCloth = velvetMaterial()
  deformMaterial(pelmetCloth, valanceSurface, valanceUniforms, { stage: { ...velvetUniforms(valancePile), seed: '7.0', flies: 0.12 } })
  const pelmet = new THREE.Mesh(drape, pelmetCloth)
  pelmet.frustumCulled = false
  // Kept out of the shadow map (VSM renders receivers too); the drapes draw
  // its soft contact shadow themselves.
  scene.add(pelmet)
  const cordTrim = trimMaterial()
  deformMaterial(cordTrim, valanceSurface, valanceUniforms, { braid: valanceBraid, stage: { ...velvetUniforms(valancePile), seed: '9.0', flies: 0 }, lift: 0.003 })
  const cord = new THREE.Mesh(edge, cordTrim)
  cord.frustumCulled = false
  scene.add(cord)
  materials.push(pelmetCloth, cordTrim)
  const tasselShape = tasselGeometry()
  const tasselGold = tasselMaterial()
  geometries.push(tasselShape)
  materials.push(tasselGold)
  // One tassel per interior tie point; the count follows the viewport aspect.
  const tassels = Array.from({ length: 12 }, () => {
    const tassel = new THREE.Mesh(tasselShape, tasselGold)
    tassel.scale.setScalar(1.1)
    tassel.visible = false
    scene.add(tassel)
    return tassel
  })
  let tieXs: number[] = []
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
    projection.leaderIris.value = state.leaderIris
    projection.leaderSweep.value = state.sweep
    projection.filmFrame.value = state.filmFrame
    projection.projectorTime.value = current*ENTRANCE_DURATION/1000
    projection.countdownOpacity.value = state.leaderOpacity
    // The valance waits until the drapes have mostly cleared, then flies out.
    const lift = Math.min(1, Math.max(0, (state.opening - 0.5) / 0.45))
    valanceUniforms.valanceLift.value = lift * lift * (3 - 2 * lift)
    const seconds = current * ENTRANCE_DURATION / 1000
    tassels.forEach((tassel, index) => {
      tassel.visible = index < tieXs.length
      if (!tassel.visible) return
      tassel.position.set(tieXs[index]!, 0.775 + valanceUniforms.valanceLift.value*VALANCE_FLY, 0.13)
      // Still while the leader runs; the rail's pull sets them swinging.
      tassel.rotation.z = 0.05*Math.sin(seconds*2.3 + index*1.3)*Math.min(1, state.opening*4)
    })
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
    const swags = Math.max(2, Math.floor(aspect*2.4 + 0.5))
    tieXs = Array.from({ length: Math.min(tassels.length, swags - 1) }, (_, k) => ((k + 1)/swags*2 - 1)*aspect*1.02)
    // Keep one braid twist every ~9 CSS px whatever the viewport.
    hemBraid.braidCycles.value = 0.527*width/9
    valanceBraid.braidCycles.value = 1.02*width/9
    // One pile cell every ~2 CSS px across each surface's width.
    drapePile.value = 0.527*width/2
    valancePile.value = 1.02*width/2
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
  const fontReady = typeof FontFace === 'undefined' ? Promise.resolve() : new FontFace(DIGIT_FAMILY, `url(${digitFontUrl})`, { weight: DIGIT_WEIGHT })
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
