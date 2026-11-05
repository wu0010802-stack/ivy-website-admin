/**
 * 瀏覽器能不能解 AVIF（只量一次、全站共用）。
 *
 * `<ResponsivePicture>` 的 `<picture><source type="image/avif">` 由瀏覽器自己判斷，不需要這支。
 * 它只給「用 JS 預先抓圖」的地方（例如 HomeStoryViewer 預取下一則的照片）：這些圖之後是用 `<ResponsivePicture>`
 * 顯示，預取時要抓和 `<picture>` 會選中的同一檔——支援 AVIF 的瀏覽器抓 AVIF，否則會白下載一份 WebP。
 *
 * 判斷法：讓 `new Image()` 解一張 1×1 的 AVIF data URI（不發網路請求）；解得出來就支援。
 * 不用 `canvas.toDataURL('image/avif')`：各瀏覽器遇到不支援的格式會悄悄退回 PNG，不能當判斷依據。
 */
const AVIF_1X1 =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAHgAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAJm1kYXQSAAoIGAAGiAhoNCAyEBlHh4Yhh5555oAAAJBAzeg='

let cached: Promise<boolean> | undefined

export function supportsAvif(): Promise<boolean> {
  if (cached) return cached
  if (typeof Image === 'undefined') return Promise.resolve(false)
  cached = new Promise<boolean>((resolve) => {
    const probe = new Image()
    probe.onload = () => resolve(probe.width === 1 && probe.height === 1)
    probe.onerror = () => resolve(false)
    probe.src = AVIF_1X1
  })
  return cached
}

/** 預取一張之後會用 `<ResponsivePicture>` 顯示的照片：支援 AVIF 就抓 `<picture>` 會選中的 AVIF 那檔，否則照舊抓 `src`。 */
export function prefetchImage(attrs: { src: string; sizes?: string; avifSrcset?: string }): void {
  const avifSrcset = attrs.avifSrcset
  if (!avifSrcset) {
    new Image().src = attrs.src
    return
  }
  void supportsAvif().then((ok) => {
    const image = new Image()
    if (ok) {
      // 和 <source sizes> 同一份；detached 的 Image 沒有版面，vw 以視窗寬算（HomeStoryViewer 給的是 100vw）。
      image.sizes = attrs.sizes ?? '100vw'
      image.srcset = avifSrcset
    } else {
      image.src = attrs.src
    }
  })
}
