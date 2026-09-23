import * as THREE from 'three'
import type { entranceTimeline } from './entrance-timeline'

/** Desktop film leader: a centred, aged film panel with velvet visible around it. */
export function createDesktopFilmLeader(digits: THREE.CanvasTexture) {
  // Centre the visible ink, not the font's advance width. This is especially
  // noticeable for 1, whose tall stem otherwise looks shifted to the right.
  const atlas = digits.image as HTMLCanvasElement
  const context = atlas.getContext('2d')!
  const cellWidth = atlas.width/3
  const offsets = [0,1,2].map(index => {
    const { data } = context.getImageData(index*cellWidth,0,cellWidth,atlas.height)
    let mass = 0
    let weightedX = 0
    for (let pixel=0;pixel<data.length/4;pixel++) {
      const alpha = data[pixel*4+3]!
      mass += alpha
      weightedX += ((pixel%cellWidth)+0.5)*alpha
    }
    return mass ? weightedX/mass/cellWidth-0.5 : 0
  })
  const uniforms = {
    digitMap: { value: digits },
    digitOffsets: { value: new THREE.Vector3(...offsets) },
    digit: { value: 3 }, sweep: { value: 0 }, filmFrame: { value: 0 }, opacity: { value: 0 },
    aspect: { value: 1 }, aperture: { value: 1.04 },
    paperColor: { value: new THREE.Color('#d5cec4') },
    inkColor: { value: new THREE.Color('#66533c') }
  }
  const geometry = new THREE.PlaneGeometry(2, 2)
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */`
      varying vec2 filmUv;
      void main() {
        filmUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 filmUv;
      uniform sampler2D digitMap;
      uniform vec3 digitOffsets;
      uniform float digit;
      uniform float sweep;
      uniform float filmFrame;
      uniform float opacity;
      uniform float aspect;
      uniform float aperture;
      uniform vec3 paperColor;
      uniform vec3 inkColor;
      float hash(vec2 p) {
        return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
      }
      void main() {
        vec2 world = (filmUv-0.5)*vec2(2.0*aspect,2.0);
        // Frame, circle, crosshair and glyph share exactly the same centre.
        vec2 leader = world/aperture;
        float radius = length(leader);
        float aa = max(fwidth(radius),0.001);
        // A single dark ring and continuous registration cross, as on old film.
        float ring = 1.0-smoothstep(0.0075,0.0075+aa,abs(radius-0.49));
        float cross = 1.0-smoothstep(0.0007,0.0007+aa,min(abs(leader.x),abs(leader.y)));
        float angle = mod(atan(leader.x,leader.y)+6.28318530718,6.28318530718);
        float sector = 1.0-smoothstep(sweep*6.28318530718-0.01,sweep*6.28318530718+0.01,angle);
        vec3 color = mix(paperColor,inkColor,sector*0.20);
        color = mix(color,inkColor,max(ring,cross*0.60));
        vec2 digitUv = leader/0.80+0.5;
        digitUv.x += digit > 2.5 ? digitOffsets.x : digit > 1.5 ? digitOffsets.y : digitOffsets.z;
        vec2 atlasUv = vec2((digitUv.x+3.0-digit)/3.0,digitUv.y);
        float insideDigit = step(0.0,digitUv.x)*step(digitUv.x,1.0)*step(0.0,digitUv.y)*step(digitUv.y,1.0);
        float number = texture2D(digitMap,atlasUv).a*insideDigit;
        color = mix(color,inkColor,number);

        // Full-height film strips. Sprocket dimensions scale with frame height.
        float edge = aspect-abs(world.x);
        float railWidth = min(0.34,aspect*0.18);
        float rail = 1.0-smoothstep(railWidth-0.002,railWidth+0.002,edge);
        float holeX = 1.0-smoothstep(railWidth*0.245,railWidth*0.245+0.002,abs(edge-railWidth*0.50));
        float holeY = 1.0-smoothstep(0.054,0.056,abs(mod(world.y+0.10,0.22)-0.11));
        color = mix(color,inkColor,rail);
        color = mix(color,paperColor,rail*holeX*holeY);

        // Quiet texture, dirt and hairline wear instead of flashing the frame.
        vec2 grainPixel = floor(filmUv*vec2(1500.0*aspect,1500.0));
        float grain = hash(grainPixel+filmFrame*13.7)-0.5;
        color *= 1.0+grain*0.036;
        vec2 dirtUv = filmUv*vec2(aspect,1.0)*24.0;
        vec2 cell = floor(dirtUv);
        float seed = hash(cell+floor(filmFrame/4.0));
        vec2 dotCenter = vec2(hash(cell+9.1),hash(cell+21.7));
        float dirt = (1.0-smoothstep(0.018,0.11,length(fract(dirtUv)-dotCenter)))*step(0.91,seed);
        color = mix(color,inkColor,dirt*0.18);
        float scratch = 0.0;
        for (int i=0;i<3;i++) {
          float index = float(i);
          float x = fract(0.21+index*0.317+floor(filmFrame/8.0)*0.073);
          float waviness = sin(filmUv.y*19.0+index*7.0)*0.0006;
          float line = 1.0-smoothstep(0.00015,0.00065,abs(filmUv.x-x+waviness));
          scratch += line*(0.05+0.03*sin(filmUv.y*37.0+index));
        }
        color = mix(color,inkColor,scratch);
        float vignette = dot(filmUv-0.5,filmUv-0.5);
        color *= 1.0-vignette*0.10;
        gl_FragColor = vec4(color,opacity);
        #include <colorspace_fragment>
      }
    `
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(0,0.04,4)
  mesh.renderOrder = 10
  mesh.frustumCulled = false
  mesh.visible = false
  let enabled = false
  return {
    mesh,
    resize(frameWidth: number, frameHeight: number, aperture: number, desktop: boolean) {
      enabled = desktop
      mesh.scale.set(frameWidth/2,frameHeight/2,1)
      uniforms.aspect.value = frameWidth/frameHeight
      // Shader coordinates span two units in the panel's local height.
      uniforms.aperture.value = aperture*2/frameHeight
    },
    draw(state: ReturnType<typeof entranceTimeline>) {
      mesh.visible = enabled && state.leaderOpacity > 0
      uniforms.digit.value = state.countdown || 1
      uniforms.sweep.value = state.sweep
      uniforms.filmFrame.value = state.filmFrame
      uniforms.opacity.value = state.leaderOpacity
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    }
  }
}
