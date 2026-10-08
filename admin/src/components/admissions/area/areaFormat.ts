// 區域分析的顯示格式與地圖用的小工具（2026-10-08 規格 9）。

/** 後端 /area/boundaries 的里界 GeoJSON（高雄 893 里，只留三個屬性）。 */
export interface VillageProperties {
  TOWNNAME: string
  VILLNAME: string
  VILLCODE: string
}
export interface VillageFeature {
  type: 'Feature'
  properties: VillageProperties
  geometry: { type: string; coordinates: unknown }
}
export interface VillageBoundaries {
  type: 'FeatureCollection'
  features: VillageFeature[]
}
