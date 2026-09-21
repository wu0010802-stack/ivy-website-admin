import manifest from '../generated/image-manifest.json'

interface ImageInfo { width: number; height: number; candidates: { src: string; width: number }[] }

export function responsiveImage(name: string, sizes = '100vw') {
  const info = (manifest as Record<string, ImageInfo>)[name]
  return {
    src: `/assets/${name}.webp`,
    width: info?.width,
    height: info?.height,
    srcset: info?.candidates.map((candidate) => `${candidate.src} ${candidate.width}w`).join(', '),
    sizes: info ? sizes : undefined
  }
}
