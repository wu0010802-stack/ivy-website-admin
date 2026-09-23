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
var easeOut = (value) => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3;
function entranceTimeline(elapsedMs) {
  const elapsed = Math.min(ENTRANCE_DURATION, Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0));
  const complete = elapsed >= ENTRANCE_DURATION;
  const phase = elapsed < LOGO_DURATION ? "logo" : elapsed < OPENING_START ? "countdown" : complete ? "complete" : "opening";
  const countElapsed = Math.max(0, elapsed - LOGO_DURATION);
  const countdown = phase === "countdown" ? 3 - Math.floor(countElapsed / 1e3) : 0;
  const opening = Math.max(0, (elapsed - OPENING_START) / OPENING_DURATION);
  const iris = elapsed < LOGO_DURATION ? easeOut(elapsed / 480) * (1 - smooth((elapsed - LOGO_DURATION + 340) / 340)) : 0;
  const logoOpacity = smooth(elapsed / 160) * smooth((LOGO_DURATION - elapsed) / 100);
  const leaderOpacity = elapsed < LOGO_DURATION ? 0 : smooth(countElapsed / 100) * (1 - smooth((elapsed - OPENING_START) / 180));
  const leaderIris = elapsed < LOGO_DURATION ? 0 : easeOut(countElapsed / 260);
  const sweep = phase === "countdown" ? countElapsed % 1e3 / 1e3 : elapsed >= OPENING_START ? 1 : 0;
  const flash = phase === "countdown" ? Math.exp(-(countElapsed % 1e3) / 90) : 0;
  const flare = leaderOpacity > 0 ? smooth((elapsed - OPENING_START + 140) / 140) : 0;
  const projection = smooth(elapsed / 300) * (1 - smooth(opening / 0.24));
  const shadowOpacity = 0.18 * (1 - smooth(opening / 0.8));
  return { phase, countdown, opening, projection, iris, logoOpacity, leaderOpacity, leaderIris, sweep, flash, flare, filmFrame: Math.floor(countElapsed / (1e3 / 12)), shadowOpacity, complete };
}

// web/app/utils/entranceCurtain.ts
var velvetPalette = {
  fabric: "#561326",
  trim: "#bf9a52",
  sky: "#f4d8ca",
  ground: "#1e0a14",
  key: "#fff0dd",
  fill: "#eab6bc",
  projection: "#efce92",
  footlight: "#ffb778",
  clothTint: "#ff8a99",
  whiteLamp: "#fff3e4"
};
var sheenTones = {
  rose: { sheen: "#c46f7e", rim: "#d98794" },
  crimson: { sheen: "#a83a48", rim: "#cf4a58" }
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
  float y = -1.025 + v*2.35 + hem + pull*u*pow(1.0-v,2.0)*0.12;
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
);
var valanceDeformation = (
  /* glsl */
  `
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
          + 0.016*sin((uv.y*6.5 + droop*0.9)*V_PI)*droop
          + 0.014*sin(uv.x*swags*V_PI*14.0)*pow(1.0-droop,3.0);
  return vec3(x,y,z);
}
`
);
var stageLightingPars = (
  /* glsl */
  `
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
);
var stageLighting = (seed, flies, foot) => (
  /* glsl */
  `
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
);
var valanceShadePars = (
  /* glsl */
  `
uniform float valanceAspect;
uniform float valanceLift;
float valanceHem(float x) {
  float u = (x/(valanceAspect*1.02)+1.0)*0.5;
  float swags = max(2.0, floor(valanceAspect*2.4 + 0.5));
  return 0.77 - 0.06*sin(fract(u*swags)*3.14159265) + valanceLift*0.4;
}
`
);
var valanceShade = (
  /* glsl */
  `
  float underValance = valanceHem(clothPosition.x - 0.03) - clothPosition.y;
  float contact = 1.0 - 0.62*(underValance < 0.0 ? 1.0 : exp(-underValance/0.085));
  reflectedLight.directDiffuse *= contact;
  reflectedLight.indirectDiffuse *= contact;
`
);
var centreSplit = (
  /* glsl */
  `
  float centreSplit = 1.0 - 0.5*smoothstep(0.993, 1.0, clothUv.x);
  reflectedLight.directDiffuse *= centreSplit;
  reflectedLight.indirectDiffuse *= centreSplit;
`
);
var braidPars = (
  /* glsl */
  `
uniform float braidStart;
uniform float braidWidth;
uniform float braidCycles;
`
);
var braid = (
  /* glsl */
  `
  float braidAcross = clamp((clothUv.y-braidStart)/braidWidth,0.0,1.0);
  // Two twisted strands: each period is one rounded, slanted ridge of cord.
  float strand = fract(clothUv.x*braidCycles + braidAcross*0.85);
  diffuseColor.rgb *= (0.35+0.65*sin(strand*3.14159))*(0.55+0.45*sin(braidAcross*3.14159));
`
);
var projectionShader = (
  /* glsl */
  `
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
);
var projectionLighting = (
  /* glsl */
  `
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
  // artwork has a clear gap at rows 876\u2013878 below IVY KIDS; blend within it.
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
  vec2 gate = leader - vec2(sin(filmFrame*2.39),cos(filmFrame*1.73))*0.0035;
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
);
function velvetUniforms(pileDensity, tone) {
  return { rimColor: { value: new THREE.Color(sheenTones[tone].rim) }, footColor: { value: new THREE.Color(velvetPalette.footlight) }, pileDensity };
}
function velvetMaterial(tone) {
  return new THREE.MeshPhysicalMaterial({
    color: velvetPalette.fabric,
    roughness: 0.96,
    metalness: 0,
    sheen: 1,
    sheenColor: sheenTones[tone].sheen,
    sheenRoughness: 0.55,
    specularIntensity: 0.14,
    side: THREE.DoubleSide
  });
}
function trimMaterial() {
  return new THREE.MeshStandardMaterial({
    color: velvetPalette.trim,
    metalness: 0.45,
    roughness: 0.4,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
}
var drapeSurface = { vertex: clothDeformation, point: "curtainPoint", normalSign: "-curtainSide" };
var valanceSurface = { vertex: valanceDeformation, point: "valancePoint", normalSign: "1.0" };
function deformMaterial(material, surface, uniforms, shading = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = surface.vertex + shader.vertexShader;
    const lift = shading.lift ? ` transformed.z += ${shading.lift.toFixed(4)};` : "";
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `vec3 transformed = ${surface.point}(uv);${lift} clothUv = uv; clothPosition = transformed;`);
    shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", `
      vec3 alongU = ${surface.point}(uv + vec2(0.0003,0.0)) - ${surface.point}(uv - vec2(0.0003,0.0));
      vec3 alongV = ${surface.point}(uv + vec2(0.0,0.0003)) - ${surface.point}(uv - vec2(0.0,0.0003));
      vec3 objectNormal = normalize(cross(alongU, alongV)) * ${surface.normalSign};
    `);
    if (!shading.stage && !shading.braid) return;
    let pars = "varying vec2 clothUv;\nvarying vec3 clothPosition;\n";
    let colour = "";
    let lights = "";
    if (shading.braid) {
      Object.assign(shader.uniforms, shading.braid);
      pars += braidPars;
      colour += braid;
    }
    if (shading.stage) {
      const { seed, flies, foot = 0.8, ...stage } = shading.stage;
      Object.assign(shader.uniforms, stage);
      pars += stageLightingPars;
      colour += `
        float nap = sin(clothUv.x*93.0 + sin(clothUv.y*17.0))*sin(clothUv.y*137.0);
        float dye = 0.95 + 0.035*sin(clothUv.x*37.0+clothUv.y*9.0) + nap*0.014 + 0.05*velvetPile(clothUv, ${seed})
                  + 0.06*(velvetFibre(clothUv)-0.5);
        diffuseColor.rgb *= dye;
      `;
      lights += stageLighting(seed, flies, foot);
    }
    if (shading.valanceShadow) {
      Object.assign(shader.uniforms, shading.valanceShadow);
      pars += valanceShadePars;
      lights += valanceShade;
    }
    if (shading.projection) {
      Object.assign(shader.uniforms, shading.projection);
      pars += projectionShader;
      lights += projectionLighting + centreSplit;
    }
    shader.fragmentShader = pars + shader.fragmentShader;
    if (colour) shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
${colour}`);
    if (lights) shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
${lights}`);
  };
  const key = `${surface.point}-${shading.projection ? "projection" : shading.braid ? "braid" : shading.stage ? "velvet" : "depth"}`;
  material.customProgramCacheKey = () => `ivy-velvet-a-${key}-18`;
}
function tasselGeometry() {
  const profile = [
    [3e-3, 0],
    [0.011, -4e-3],
    [0.015, -0.013],
    [0.011, -0.022],
    [6e-3, -0.028],
    [9e-3, -0.033],
    [6e-3, -0.038],
    [0.012, -0.045],
    [0.016, -0.075],
    [0.02, -0.105],
    [0.022, -0.122],
    [0, -0.124]
  ];
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 28);
}
function tasselMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: velvetPalette.trim, metalness: 0.45, roughness: 0.45 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec2 tasselUv;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntasselUv = uv;");
    shader.fragmentShader = "varying vec2 tasselUv;\n" + shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      // Bullion fringe down the skirt, and a darker binding at the neck.
      float skirt = smoothstep(0.62,0.66,tasselUv.y);
      diffuseColor.rgb *= mix(1.0, 0.5+0.5*abs(sin(tasselUv.x*3.14159*40.0)), skirt);
      diffuseColor.rgb *= 1.0-0.35*(1.0-smoothstep(0.02,0.05,abs(tasselUv.y-0.45)));`);
  };
  material.customProgramCacheKey = () => "ivy-velvet-a-tassel-17";
  return material;
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
var DIGIT_CELL = 768;
var DIGIT_FAMILY = "Ivy Leader";
var DIGIT_WEIGHT = "700";
function drawDigits(atlas) {
  const context = atlas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, atlas.width, atlas.height);
  context.fillStyle = "#fff";
  const family = `"${DIGIT_FAMILY}", "Helvetica Neue", Arial, sans-serif`;
  context.font = `${DIGIT_WEIGHT} 100px ${family}`;
  const sample = context.measureText("3");
  const inkHeight = Math.max(1, sample.actualBoundingBoxAscent + sample.actualBoundingBoxDescent);
  context.font = `${DIGIT_WEIGHT} ${Math.round(DIGIT_CELL * 0.84 / inkHeight * 100)}px ${family}`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  for (let i = 0; i < 3; i++) {
    const digit = String(3 - i);
    const metrics = context.measureText(digit);
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    context.fillText(
      digit,
      i * DIGIT_CELL + DIGIT_CELL / 2 - (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2,
      DIGIT_CELL / 2 + height / 2 - metrics.actualBoundingBoxDescent
    );
  }
  return [0, 1, 2].map((index) => {
    const { data } = context.getImageData(index * DIGIT_CELL, 0, DIGIT_CELL, DIGIT_CELL);
    let mass = 0;
    let weightedX = 0;
    for (let pixel = 0; pixel < data.length / 4; pixel++) {
      const alpha = data[pixel * 4 + 3];
      mass += alpha;
      weightedX += (pixel % DIGIT_CELL + 0.5) * alpha;
    }
    return mass ? weightedX / mass / DIGIT_CELL - 0.5 : 0;
  });
}
function createEntranceCurtain(canvas, host, logoUrl = "/assets/ivy-30th-anniversary-projection.png", options = {}) {
  const { digitFontUrl = "/assets/fonts/oswald-700-leader.woff2", sheenTone = "rose", leaderLamp = "warm" } = options;
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
  scene.add(new THREE.HemisphereLight(velvetPalette.sky, velvetPalette.ground, 0.85));
  const key = new THREE.DirectionalLight(velvetPalette.key, 2.4);
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
  const fill = new THREE.DirectionalLight(velvetPalette.fill, 0.6);
  fill.position.set(2, 0.6, 3);
  scene.add(fill);
  const colourPlaceholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  colourPlaceholder.needsUpdate = true;
  const digitAtlas = document.createElement("canvas");
  digitAtlas.width = DIGIT_CELL * 3;
  digitAtlas.height = DIGIT_CELL;
  const digits = new THREE.CanvasTexture(digitAtlas);
  digits.minFilter = THREE.LinearMipmapLinearFilter;
  digits.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  let colourLogo;
  const projection = {
    colourLogoMap: { value: colourPlaceholder },
    digitMap: { value: digits },
    digitOffsets: { value: new THREE.Vector3(...drawDigits(digitAtlas)) },
    logoSize: { value: new THREE.Vector2(0.86, 1.04) },
    projectionColor: { value: new THREE.Color(velvetPalette.projection) },
    clothTint: { value: new THREE.Color(velvetPalette.clothTint) },
    projectionStrength: { value: 0 },
    countdownDigit: { value: 3 },
    logoOpacity: { value: 0 },
    irisProgress: { value: 0 },
    leaderFlash: { value: 0 },
    leaderFlare: { value: 0 },
    leaderIris: { value: 0 },
    leaderSweep: { value: 0 },
    leaderLampColor: { value: new THREE.Color(leaderLamp === "white" ? velvetPalette.whiteLamp : velvetPalette.projection) },
    filmFrame: { value: 0 },
    projectorTime: { value: 0 },
    countdownOpacity: { value: 0 }
  };
  const valanceUniforms = { valanceAspect: { value: 1 }, valanceLift: { value: 0 } };
  const drapePile = { value: 200 };
  const valancePile = { value: 400 };
  const hemBraid = { braidStart: { value: 4e-3 }, braidWidth: { value: 0.022 }, braidCycles: { value: 80 } };
  const geometry = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 216, mobile ? 64 : 96);
  const trimGeometry = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 216, 3);
  const trimUV = trimGeometry.attributes.uv;
  for (let i = 0; i < trimUV.count; i++) trimUV.setY(i, 4e-3 + trimUV.getY(i) * 0.022);
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
  const geometries = [geometry, trimGeometry, rightGeometry, rightTrimGeometry];
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
    const cloth = velvetMaterial(sheenTone);
    deformMaterial(cloth, drapeSurface, uniforms, { stage: { ...velvetUniforms(drapePile, sheenTone), seed: side > 0 ? "11.0" : "3.0", flies: 0.56 }, projection, valanceShadow: valanceUniforms });
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    deformMaterial(depth, drapeSurface, uniforms);
    const panel = new THREE.Mesh(side === 1 ? rightGeometry : geometry, cloth);
    panel.frustumCulled = false;
    panel.castShadow = panel.receiveShadow = true;
    panel.customDepthMaterial = depth;
    scene.add(panel);
    const trim = trimMaterial();
    deformMaterial(trim, drapeSurface, uniforms, { braid: hemBraid, stage: { ...velvetUniforms(drapePile, sheenTone), seed: "5.0", flies: 0, foot: 0.35 }, lift: 3e-3 });
    const seam = new THREE.Mesh(side === 1 ? rightTrimGeometry : trimGeometry, trim);
    seam.frustumCulled = false;
    seam.receiveShadow = true;
    seam.customDepthMaterial = depth;
    scene.add(seam);
    materials.push(cloth, depth, trim);
  }
  const valanceBraid = { braidStart: { value: 0 }, braidWidth: { value: 0.09 }, braidCycles: { value: 160 } };
  const drape = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 240, 24);
  const edge = new THREE.PlaneGeometry(2, 2, mobile ? 144 : 240, 3);
  const edgeUV = edge.attributes.uv;
  for (let i = 0; i < edgeUV.count; i++) edgeUV.setY(i, edgeUV.getY(i) * 0.09);
  geometries.push(drape, edge);
  const pelmetCloth = velvetMaterial(sheenTone);
  deformMaterial(pelmetCloth, valanceSurface, valanceUniforms, { stage: { ...velvetUniforms(valancePile, sheenTone), seed: "7.0", flies: 0.12 } });
  const pelmet = new THREE.Mesh(drape, pelmetCloth);
  pelmet.frustumCulled = false;
  scene.add(pelmet);
  const cordTrim = trimMaterial();
  deformMaterial(cordTrim, valanceSurface, valanceUniforms, { braid: valanceBraid, stage: { ...velvetUniforms(valancePile, sheenTone), seed: "9.0", flies: 0 }, lift: 3e-3 });
  const cord = new THREE.Mesh(edge, cordTrim);
  cord.frustumCulled = false;
  scene.add(cord);
  materials.push(pelmetCloth, cordTrim);
  const tasselShape = tasselGeometry();
  const tasselGold = tasselMaterial();
  geometries.push(tasselShape);
  materials.push(tasselGold);
  const tassels = Array.from({ length: 12 }, () => {
    const tassel = new THREE.Mesh(tasselShape, tasselGold);
    tassel.scale.setScalar(1.35);
    tassel.visible = false;
    scene.add(tassel);
    return tassel;
  });
  let tieXs = [];
  const shadowGeometry = new THREE.PlaneGeometry(2, 2);
  geometries.push(shadowGeometry);
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
    projection.irisProgress.value = state.iris;
    projection.leaderFlash.value = state.flash;
    projection.leaderFlare.value = state.flare;
    projection.leaderIris.value = state.leaderIris;
    projection.leaderSweep.value = state.sweep;
    projection.filmFrame.value = state.filmFrame;
    projection.projectorTime.value = current * ENTRANCE_DURATION / 1e3;
    projection.countdownOpacity.value = state.leaderOpacity;
    const lift = Math.min(1, Math.max(0, (state.opening - 0.5) / 0.45));
    valanceUniforms.valanceLift.value = lift * lift * (3 - 2 * lift);
    const seconds = current * ENTRANCE_DURATION / 1e3;
    tassels.forEach((tassel, index) => {
      tassel.visible = index < tieXs.length;
      if (!tassel.visible) return;
      tassel.position.set(tieXs[index], 0.775 + valanceUniforms.valanceLift.value * 0.4, 0.13);
      tassel.rotation.z = 0.05 * Math.sin(seconds * 2.3 + index * 1.3) * Math.min(1, state.opening * 4);
    });
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
    const compositionWidth = Math.min(width * 0.64, 880, height * 1.2);
    const compositionHeight = compositionWidth * 9 / 16;
    const aperture = width > 900 ? compositionHeight * 0.76 * 2 / height : Math.min(1.04, aspect * 1.5);
    projection.logoSize.value.set(aperture * 795 / 964, aperture);
    clothUniforms.forEach((uniforms) => {
      uniforms.curtainAspect.value = aspect;
    });
    valanceUniforms.valanceAspect.value = aspect;
    const swags = Math.max(2, Math.floor(aspect * 2.4 + 0.5));
    tieXs = Array.from({ length: Math.min(tassels.length, swags - 1) }, (_, k) => ((k + 1) / swags * 2 - 1) * aspect * 1.02);
    hemBraid.braidCycles.value = 0.527 * width / 9;
    valanceBraid.braidCycles.value = 1.02 * width / 9;
    drapePile.value = 0.527 * width / 2;
    valancePile.value = 1.02 * width / 2;
    shadow.scale.x = aspect;
    const extent = Math.max(2, aspect * 1.6);
    Object.assign(key.shadow.camera, { left: -extent, right: extent, top: 2.5, bottom: -2.5 });
    key.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    if (colourLogo) draw(current);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  let digitFace;
  const fontReady = typeof FontFace === "undefined" ? Promise.resolve() : new FontFace(DIGIT_FAMILY, `url(${digitFontUrl})`, { weight: DIGIT_WEIGHT }).load().then((face) => {
    if (disposed) return;
    digitFace = face;
    document.fonts.add(face);
    projection.digitOffsets.value.set(...drawDigits(digitAtlas));
    digits.needsUpdate = true;
    if (colourLogo) draw(current);
  }).catch(() => void 0);
  const logoReady = new THREE.ImageLoader().loadAsync(logoUrl).then((image) => {
    if (disposed) return;
    colourLogo = colourProjectionTexture(image);
    colourLogo.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    projection.colourLogoMap.value = colourLogo;
    draw(current);
  });
  resize();
  return {
    draw,
    ready: Promise.all([logoReady, fontReady]).then(() => void 0),
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      geometries.forEach((item) => item.dispose());
      shadowMaterial.dispose();
      colourPlaceholder.dispose();
      digits.dispose();
      colourLogo?.dispose();
      if (digitFace) document.fonts.delete(digitFace);
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
