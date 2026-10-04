// 整頁內容（特色教學頁、關於常春藤頁）兩個編輯頁共用的小工具。

/** 內建照片的預覽網址（後台和官網同源，/assets 由官網提供）。 */
export function builtinPhotoSrc(code: string): string {
  return `/assets/${code}.webp`
}
