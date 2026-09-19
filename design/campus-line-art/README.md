# 五校校舍輪廓線稿

日期：2026-09-16；國際校更新：2026-09-17

依使用者指定的國際校線稿風格，以內建 image_gen 工具，分別參考其他四校現行外觀照片製作。米白底、淡灰綠細線，不包含校名字樣。五校線稿已接入首頁分校切換，以及各校內頁的交通與聯絡區。

2026-09-17：國際校改依 `../../assets/international.webp` 的完整校舍重製，對齊其他四校的清晰灰綠細線、米白底及 3:2 構圖；保留雙側方塔、尖頂窗與長拱廊。使用內建 image_gen 生成並調整濃淡，完整提示詞見 [international-prompt.md](international-prompt.md)。

每校提供 1536×1024 PNG 生成原圖及 WebP quality 90 網站用壓縮版；轉檔未另行重繪。原圖與 WebP 檔名分別為 `<校區>-line-art.png`、`<校區>-line-art.webp`。

| 校區 | 檔名前綴 | 建築參考來源 |
| --- | --- | --- |
| 義華 | yihua | `../../assets/yihua-exterior.webp`，使用者本次提供的新照片 |
| 明華 | minghua | `../../assets/minghua.webp` |
| 崇德 | chongde | `../../assets/chongde.webp` |
| 國際 | international | `../../assets/international.webp` |
| 仁武 | renwu | `../../assets/renwu.webp` |

風格參考：使用者提供的國際校線稿截圖（2026-09-16 21:55），對應 `../campus-background-mockups/c-background-source.png` 中的建築線稿風格。插畫用於品牌裝飾，不作為工程圖。

## 網站套用

- 五校 WebP 複製到 `../../assets/campus-line-art-<校區>.webp`。
- 國際校生成原圖為 `international-line-art.png`，壓縮版為 `international-line-art.webp`，取代原 830×604 截圖。
- `campusArtwork(key)` 建立裝飾圖片；首頁標題右上與選校照片同步切換，內頁依路由顯示。共用花園、樹木與圍牆背景已移除，僅保留各校自己的線稿。
- 執行 `python3 package_preview.py` 會把五校線稿內嵌到 `preview.html`。

## 最終生成提示詞

### 義華校

```text
Use case: style-transfer / architectural illustration.
There are TWO reference images: Image 1 is the EXACT school building that must be illustrated; Image 2 is ONLY the APPROVED DRAWING STYLE, an extremely light sage architectural contour illustration. Do not borrow or copy Image 2's school facade or architectural features. Each school must remain recognizable as Image 1.
Create one refined architectural pen contour drawing of the actual school in Image 1. Preserve its overall massing, number of visible floors, relative heights, roof shapes, towers, windows, balconies, columns and photographic viewpoint faithfully. Keep all main roof tips and the whole visible school inside frame. Do not invent extra floors, turrets, gables or entrances.
MATCH IMAGE 2 closely: delicate low-contrast gray-sage lines around #B5BEAB on a plain warm ivory background around #FAF8F0; detailed but airy, mature, calm, not cartoonish. No colored materials, no solid shaded surfaces, no black strokes, no gray wash, no watercolor, no heavy hatching, no photographic pixels. Walls, roofs, sky and foliage interiors all remain the same warm ivory as background. Suggest brickwork sparingly with thin contour marks; thin tree silhouettes, little shrubs and subtle short ground perspective strokes. Most linework should be very pale, with slightly stronger structural contours like Image 2.
Canvas: high-resolution landscape 3:2, ideally 1536x1024 or larger same ratio. A SINGLE school illustration, no panels, no montage. Compose the building across 88–92% of canvas width, maintaining real architectural proportions. Building and minimal landscaping sit around the lower half to lower two-thirds with ground baseline near 86% height; leave breathing room around entire silhouette. Gently fade ground and side vegetation into clean ivory at canvas margins, but retain identifiable rooflines. No border.
Remove all people, vehicles, traffic lights, street signs, overhead cables and photographic clouds. Remove readable lettering and logos from building/signboards; do not replace with invented letters. No caption, no school name, no watermark, no UI. Do not use transparency or checkerboard. Deliver a clean standalone usable background illustration asset.
School-specific architecture: Use the recently user-provided Yihua school photograph. Long bent three-story school wing with pitched roof, small round turret at far left, and the prominent cylindrical castle entrance tower on the RIGHT crowned by one broad cone and one smaller slender cone. Preserve the asymmetric L-shaped/curving building seen from its courtyard, horizontal balconies, right tower's tall arched window, and real relative positions. Include a light sparse contour of the small playground at left and lawn ground with a few shrubs. Keep BOTH cone roof tips fully visible. The school in style reference has no such round twin turret: do NOT substitute its repeated triangular-gable courtyard facade.
```

### 明華校

```text
Use case: style-transfer / architectural illustration.
There are TWO reference images: Image 1 is the EXACT school building that must be illustrated; Image 2 is ONLY the APPROVED DRAWING STYLE, an extremely light sage architectural contour illustration. Do not borrow or copy Image 2's school facade or architectural features. Each school must remain recognizable as Image 1.
Create one refined architectural pen contour drawing of the actual school in Image 1. Preserve its overall massing, number of visible floors, relative heights, roof shapes, towers, windows, balconies, columns and photographic viewpoint faithfully. Keep all main roof tips and the whole visible school inside frame. Do not invent extra floors, turrets, gables or entrances.
MATCH IMAGE 2 closely: delicate low-contrast gray-sage lines around #B5BEAB on a plain warm ivory background around #FAF8F0; detailed but airy, mature, calm, not cartoonish. No colored materials, no solid shaded surfaces, no black strokes, no gray wash, no watercolor, no heavy hatching, no photographic pixels. Walls, roofs, sky and foliage interiors all remain the same warm ivory as background. Suggest brickwork sparingly with thin contour marks; thin tree silhouettes, little shrubs and subtle short ground perspective strokes. Most linework should be very pale, with slightly stronger structural contours like Image 2.
Canvas: high-resolution landscape 3:2, ideally 1536x1024 or larger same ratio. A SINGLE school illustration, no panels, no montage. Compose the building across 88–92% of canvas width, maintaining real architectural proportions. Building and minimal landscaping sit around the lower half to lower two-thirds with ground baseline near 86% height; leave breathing room around entire silhouette. Gently fade ground and side vegetation into clean ivory at canvas margins, but retain identifiable rooflines. No border.
Remove all people, vehicles, traffic lights, street signs, overhead cables and photographic clouds. Remove readable lettering and logos from building/signboards; do not replace with invented letters. No caption, no school name, no watermark, no UI. Do not use transparency or checkerboard. Deliver a clean standalone usable background illustration asset.
School-specific architecture: Minghua school is a red-brick approximately U-shaped three-story building with TWO square corner towers topped by pyramidal roofs, one at far left and one at far right. A long low pitched roof between towers has several small dormer windows. Horizontal white band courses, inset balconies, broad rectangular and arched windows, brick-and-metal fence and front gates, a few slim trees. Preserve Image 1's three-quarter frontal perspective, tower locations and wall silhouette. The central school sign is an empty lightly outlined plaque only. Remove traffic light and road sign on right, cars and people; retain school wall and fence.
```

### 崇德校

```text
Use case: style-transfer / architectural illustration.
There are TWO reference images: Image 1 is the EXACT school building that must be illustrated; Image 2 is ONLY the APPROVED DRAWING STYLE, an extremely light sage architectural contour illustration. Do not borrow or copy Image 2's school facade or architectural features. Each school must remain recognizable as Image 1.
Create one refined architectural pen contour drawing of the actual school in Image 1. Preserve its overall massing, number of visible floors, relative heights, roof shapes, towers, windows, balconies, columns and photographic viewpoint faithfully. Keep all main roof tips and the whole visible school inside frame. Do not invent extra floors, turrets, gables or entrances.
MATCH IMAGE 2 closely: delicate low-contrast gray-sage lines around #B5BEAB on a plain warm ivory background around #FAF8F0; detailed but airy, mature, calm, not cartoonish. No colored materials, no solid shaded surfaces, no black strokes, no gray wash, no watercolor, no heavy hatching, no photographic pixels. Walls, roofs, sky and foliage interiors all remain the same warm ivory as background. Suggest brickwork sparingly with thin contour marks; thin tree silhouettes, little shrubs and subtle short ground perspective strokes. Most linework should be very pale, with slightly stronger structural contours like Image 2.
Canvas: high-resolution landscape 3:2, ideally 1536x1024 or larger same ratio. A SINGLE school illustration, no panels, no montage. Compose the building across 88–92% of canvas width, maintaining real architectural proportions. Building and minimal landscaping sit around the lower half to lower two-thirds with ground baseline near 86% height; leave breathing room around entire silhouette. Gently fade ground and side vegetation into clean ivory at canvas margins, but retain identifiable rooflines. No border.
Remove all people, vehicles, traffic lights, street signs, overhead cables and photographic clouds. Remove readable lettering and logos from building/signboards; do not replace with invented letters. No caption, no school name, no watermark, no UI. Do not use transparency or checkerboard. Deliver a clean standalone usable background illustration asset.
School-specific architecture: Chongde school is the pictured three-story courtyard building with a TALL SLENDER SQUARE TOWER on the LEFT, small pyramidal top and paired oval/round windows near tower top, and a LARGE ROUND CYLINDRICAL TOWER on the RIGHT with a shallow conical/hipped roof, arched windows, horizontal bands and rings of hanging greenery. Between them is an inward-curving/recessed balcony wing beneath a pitched roof with little dormer gables. Preserve this distinctive asymmetry and all major proportions from Image 1. Outline trees and clipped hedges lightly; remove people on road and photographic clouds. The round tower must remain round, not square.
```

### 仁武校

```text
Use case: style-transfer / architectural illustration.
There are TWO reference images: Image 1 is the EXACT school building that must be illustrated; Image 2 is ONLY the APPROVED DRAWING STYLE, an extremely light sage architectural contour illustration. Do not borrow or copy Image 2's school facade or architectural features. Each school must remain recognizable as Image 1.
Create one refined architectural pen contour drawing of the actual school in Image 1. Preserve its overall massing, number of visible floors, relative heights, roof shapes, towers, windows, balconies, columns and photographic viewpoint faithfully. Keep all main roof tips and the whole visible school inside frame. Do not invent extra floors, turrets, gables or entrances.
MATCH IMAGE 2 closely: delicate low-contrast gray-sage lines around #B5BEAB on a plain warm ivory background around #FAF8F0; detailed but airy, mature, calm, not cartoonish. No colored materials, no solid shaded surfaces, no black strokes, no gray wash, no watercolor, no heavy hatching, no photographic pixels. Walls, roofs, sky and foliage interiors all remain the same warm ivory as background. Suggest brickwork sparingly with thin contour marks; thin tree silhouettes, little shrubs and subtle short ground perspective strokes. Most linework should be very pale, with slightly stronger structural contours like Image 2.
Canvas: high-resolution landscape 3:2, ideally 1536x1024 or larger same ratio. A SINGLE school illustration, no panels, no montage. Compose the building across 88–92% of canvas width, maintaining real architectural proportions. Building and minimal landscaping sit around the lower half to lower two-thirds with ground baseline near 86% height; leave breathing room around entire silhouette. Gently fade ground and side vegetation into clean ivory at canvas margins, but retain identifiable rooflines. No border.
Remove all people, vehicles, traffic lights, street signs, overhead cables and photographic clouds. Remove readable lettering and logos from building/signboards; do not replace with invented letters. No caption, no school name, no watermark, no UI. Do not use transparency or checkerboard. Deliver a clean standalone usable background illustration asset.
School-specific architecture: Renwu school is a near-symmetrical frontal three-story building. The CENTRAL ENTRY TOWER has a large ribbed rounded dome topped by a small finial and an arched dormer feature below the dome. Two broad projecting corner wings left and right each have a steep hipped mansard-like roof with a large semicircular arched dormer. Lower pitched roof and small dormers bridge central dome to side wings; horizontal open balconies with hanging plants sit between. Preserve exact symmetry, rounded dome, banded facades, narrow tall windows and central recessed entrance shown in Image 1. Include understated low hedge, a few trees and short perspective paving marks. Do not transform dome into a pointed cone or invent castle crenellations.
```
