import { describe, expect, it } from 'vitest'
import { BufferAttribute, PlaneGeometry } from 'three'
import { computeIndexedNormals } from '../app/utils/gridNormals'
import { createCurl, curlPoint, setCurl } from '../app/utils/cornerCurl'

// 跟 paperPrints.ts 同規格的紙：44×56 格、上緣多一條膠帶帶
const W = 342
const H = 428
const TOP = 12

function paper() {
  const geometry = new PlaneGeometry(W, H + TOP, 44, 56)
  geometry.translate(0, TOP / 2, 0)
  return geometry
}

// 右下角被風掀起＋翻面懸臂彎曲，跟 deform() 一樣逐點改寫位置
function bend(geometry: PlaneGeometry, hinge: number, tip: number, depth: number) {
  const position = geometry.attributes.position!
  const array = position.array as Float32Array
  const curl = createCurl()
  const reach = 110
  const nx = Math.SQRT1_2
  const ny = -Math.SQRT1_2
  setCurl(curl, { hinge, tip, nx, ny, ox: W / 2 - nx * reach, oy: -H / 2 - ny * reach, reach, ripple: 0.12, rippleK: 0.045, rippleW: 9 })
  const point = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < position.count; i++) {
    point.x = array[i * 3]!
    point.y = array[i * 3 + 1]!
    point.z = depth * (point.x / W + 0.5) ** 2
    curlPoint(point, curl, 0.37)
    array[i * 3] = point.x
    array[i * 3 + 1] = point.y
    array[i * 3 + 2] = point.z
  }
}

function fastNormals(geometry: PlaneGeometry) {
  const normal = geometry.attributes.normal as BufferAttribute
  computeIndexedNormals(geometry.attributes.position!.array as Float32Array, geometry.index!.array, normal.array as Float32Array)
  return normal.array as Float32Array
}

describe('格狀紙張法線（取代 three 的 computeVertexNormals）', () => {
  for (const [name, hinge, tip, depth] of [
    ['平的紙', 0, 0, 0],
    ['角落輕掀', 0.6, 0, 0],
    ['強風翻過 90°', 2.7, -0.4, 0],
    ['翻面中懸臂彎曲＋角落', 1.3, 0.2, 38]
  ] as const) {
    it(`${name}：每個分量與 three 的結果逐位元相同`, () => {
      const reference = paper()
      const fast = paper()
      bend(reference, hinge, tip, depth)
      bend(fast, hinge, tip, depth)
      reference.computeVertexNormals()
      // 先放一組舊法線，確認會整組覆寫、不會累加到上一幀
      ;(fast.attributes.normal!.array as Float32Array).fill(0.5)
      expect(Array.from(fastNormals(fast))).toEqual(Array.from(reference.attributes.normal!.array as Float32Array))
    })
  }

  it('背面（同一列左右對調、x 與 z 取負）也跟 three 一致', () => {
    const front = paper()
    bend(front, 2.1, 0.1, 20)
    const back = paper()
    const f = front.attributes.position!.array as Float32Array
    const b = back.attributes.position!.array as Float32Array
    const cols = 45
    for (let i = 0; i < front.attributes.position!.count; i++) {
      const row = Math.floor(i / cols)
      const j = row * cols + (cols - 1 - (i - row * cols))
      b[j * 3] = -f[i * 3]!
      b[j * 3 + 1] = f[i * 3 + 1]!
      b[j * 3 + 2] = -f[i * 3 + 2]!
    }
    const reference = back.clone()
    reference.computeVertexNormals()
    expect(Array.from(fastNormals(back))).toEqual(Array.from(reference.attributes.normal!.array as Float32Array))
  })
})
