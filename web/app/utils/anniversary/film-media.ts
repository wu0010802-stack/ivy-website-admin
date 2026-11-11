// 由 scripts/build-anniversary-film.py 產生，不要手改。
// 30 週年紀念影片《長成自己喜歡的樣子》的網頁版：影片、無聲預告、封面、「影片裡的話」縮圖。
export const ANNI_FILM = {
  "film": {
    "desktop": "/assets/anniversary-film/film-desktop-64093e1e64.mp4",
    "mobile": "/assets/anniversary-film/film-mobile-17f5667129.mp4"
  },
  "teaser": {
    "desktop": "/assets/anniversary-film/teaser-desktop-8993b08834.mp4",
    "mobile": "/assets/anniversary-film/teaser-mobile-c3ea61c765.mp4"
  },
  "poster": {
    "desktop": [
      {
        "src": "/assets/anniversary-film/poster-desktop-960-134915c80a.webp",
        "width": 960
      },
      {
        "src": "/assets/anniversary-film/poster-desktop-1600-2c6caf191d.webp",
        "width": 1600
      },
      {
        "src": "/assets/anniversary-film/poster-desktop-2304-aced5b53a8.webp",
        "width": 2304
      }
    ],
    "mobile": [
      {
        "src": "/assets/anniversary-film/poster-mobile-540-1289d449b1.webp",
        "width": 540
      },
      {
        "src": "/assets/anniversary-film/poster-mobile-900-0a87b1de38.webp",
        "width": 900
      },
      {
        "src": "/assets/anniversary-film/poster-mobile-1296-bd49257657.webp",
        "width": 1296
      }
    ]
  },
  "cues": [
    "/assets/anniversary-film/cue-0-a4676be72f.webp",
    "/assets/anniversary-film/cue-1-d83cfedbf5.webp",
    "/assets/anniversary-film/cue-2-91e634c93c.webp",
    "/assets/anniversary-film/cue-3-c446ef20ef.webp",
    "/assets/anniversary-film/cue-4-8c1d42bb2f.webp",
    "/assets/anniversary-film/cue-5-909d0bb06e.webp"
  ],
  "bytes": {
    "film-desktop": 46863073,
    "film-mobile": 28874517,
    "teaser-desktop": 3062197,
    "teaser-mobile": 2296573
  }
} as const
