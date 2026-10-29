// 孩子頁文具（特色教學、常春藤環境共用，2026-10-29 視覺方向 B）：顏料團編號與色紙框的四種色依序輪流。
// 樣式在 assets/css/stationery.css 的 .ivy-blob-no／.ivy-kid-frame（data-tone）。
export const KID_TONES = ['yellow', 'sky', 'peach', 'leaf'] as const
export type KidTone = (typeof KID_TONES)[number]

/** 第 i 個（0 起算）顏料團或色紙用的色。 */
export const kidTone = (i: number): KidTone => KID_TONES[((i % KID_TONES.length) + KID_TONES.length) % KID_TONES.length]!
