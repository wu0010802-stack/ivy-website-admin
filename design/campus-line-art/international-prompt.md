# 國際校線稿生成提示詞

日期：2026-09-17。工具：內建 `image_gen`；未使用 CLI/API fallback。

成品：`international-line-art.png`（1536×1024）與 `international-line-art.webp`（quality 90）；網站使用 `../../assets/campus-line-art-international.webp`。

## 建築與風格重製

```text
Use case: style-transfer.
Asset type: production website campus architectural line-art, matching an existing four-image series.
Primary request: Redraw the INTERNATIONAL campus as a crisp delicate architectural line drawing in EXACTLY the graphic style of the accompanying Yihua and Chongde reference drawings. The existing international drawing is blurry, washed out and excessively cropped; replace it with a full, refined drawing of the same actual International campus architecture.

Input roles, in order:
1. assets/international.webp: PRIMARY architectural identity and geometry reference. Preserve this campus's specific building, proportions, floor count, roofline, pointed dormer windows, two squared end towers with pyramid roofs, recessed central courtyard, long elevated arcade with tall slender columns and hanging plants. Use the same front courtyard three-quarter viewing direction. This is the subject to depict.
2. assets/campus-line-art-international.webp: OLD DRAWING to replace, secondary reference only. Do NOT copy its blur, coarse thick fuzzy strokes, extreme pale contrast, cropped composition, or incomplete building.
3. assets/campus-line-art-yihua.webp: STYLE reference only. Copy its sharp fine sage-gray linework, warm ivory background, quiet detailed drafting, sparse fine landscape outlines, controlled architectural detail and subtly stronger outer edges. Do NOT copy its rounded castle towers or building.
4. assets/campus-line-art-chongde.webp: STYLE reference only. Copy this precise ink/graphite-line architectural illustration treatment and its tonal density. Do NOT depict this building.

Composition: landscape 3:2, preferably 1536x1024. Show the entire International campus from roof to ground, with both squared end towers fully inside the frame. Building takes about 88% of canvas width, architectural top near 18% from top, ground baseline near 83%. Quiet blank ivory sky across the upper area; subtle courtyard perspective lines in foreground. Keep recognizable original geometry, and do not turn the building into a different campus.
Style: finely drafted, clean continuous thin sage-gray strokes on very pale warm ivory paper, consistent with images 3 and 4. Uniformly sharp fine detail, delicate brick/roof seams and window frames, moderate fine contour contrast, sparse trees/plants in the same restrained line technique. Lines should be as legible and crisp as the four-campus series, not foggy or blurred. Restrained flat tonal interiors only if needed like the references.
Constraints: zero color fills beyond ivory and muted sage-gray, no photograph texture, no watercolor, no thick dark outlines, no dramatic shadows, no vignette, no blur, no opaque solid landscaping, no people/cars, no text, no logo, no signage words, no border. Produce only the finished illustration, no webpage or comparison. Preserve real campus architecture from image 1.
```

## 最終線色與背景校準

```text
Use case: style-transfer, tightly controlled color/tonal edit.
Image 1 is the EDIT TARGET, the International campus line drawing. Images 2 and 3 are STYLE/TONE REFERENCES (Yihua and Chongde campus).
Keep the image 1 drawing IDENTICAL in building identity, geometry, perspective, exact composition, architectural details, landscaping, resolution and 3:2 aspect ratio. Do not redesign or reinterpret any part. The sole requested change is its palette and tonal weight to make it look like it belongs to the same series as images 2 and 3.
The target currently has darker charcoal-olive strokes and near-white sky. Lighten all its linework about 20-25 percent toward the ivory paper tone; shift strokes subtly toward muted pale gray-sage, around #B5BEAB for typical fine strokes. Strong structural contours may be slightly stronger like images 2 and 3, but no dark charcoal. Match the calm pale gray-green fine-pen drafting of the two reference drawings exactly. Keep all fine edges perfectly crisp, no blur or loss of fine detail. Paper/sky/background/blank walls should match references' uniform warm ivory around #FBFAF3, not bright white, not yellow. Avoid dark filled windows or foliage; lighten existing tones along with all linework.
Preserve every subject and the framing of image 1 exactly. No new elements, text, borders, watermark, people or UI. Output only the recolored International illustration at 1536x1024.
```

