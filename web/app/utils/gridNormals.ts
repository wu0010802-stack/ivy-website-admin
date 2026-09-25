/**
 * 拍立得 WebGL 紙（paperPrints.ts）每次變形後重算頂點法線。演算法與 three 的
 * BufferGeometry.computeVertexNormals()（有 index 的版本）逐步相同：每個三角形取
 * (C−B)×(A−B) 未正規化的面法線累加到三個頂點、累加值存回 Float32Array，最後逐點正規化。
 * 運算順序與每一步的 float32 捨入都一樣，結果逐位元相同（tests/grid-normals.spec.ts）。
 *
 * 差別只在不經過 Vector3／fromBufferAttribute／setXYZ：角落被風掀起時每幀要跑兩面
 * 各約 5000 個三角形，three 的通用版在 4 倍 CPU 降速的手機模擬下佔捲動期間 JS 的四分之一以上。
 */
export function computeIndexedNormals(position: Float32Array, index: ArrayLike<number>, normal: Float32Array): void {
  normal.fill(0)
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i]! * 3
    const b = index[i + 1]! * 3
    const c = index[i + 2]! * 3
    const bx = position[b]!
    const by = position[b + 1]!
    const bz = position[b + 2]!
    const cbx = position[c]! - bx
    const cby = position[c + 1]! - by
    const cbz = position[c + 2]! - bz
    const abx = position[a]! - bx
    const aby = position[a + 1]! - by
    const abz = position[a + 2]! - bz
    const nx = cby * abz - cbz * aby
    const ny = cbz * abx - cbx * abz
    const nz = cbx * aby - cby * abx
    normal[a] = normal[a]! + nx
    normal[a + 1] = normal[a + 1]! + ny
    normal[a + 2] = normal[a + 2]! + nz
    normal[b] = normal[b]! + nx
    normal[b + 1] = normal[b + 1]! + ny
    normal[b + 2] = normal[b + 2]! + nz
    normal[c] = normal[c]! + nx
    normal[c + 1] = normal[c + 1]! + ny
    normal[c + 2] = normal[c + 2]! + nz
  }
  for (let i = 0; i < normal.length; i += 3) {
    const x = normal[i]!
    const y = normal[i + 1]!
    const z = normal[i + 2]!
    const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1)
    normal[i] = x * scale
    normal[i + 1] = y * scale
    normal[i + 2] = z * scale
  }
}
