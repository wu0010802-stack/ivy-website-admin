# 分校資訊背景 Mock-up

日期：2026-09-16

以園方提供的分校資訊截圖為參考，使用內建 image_gen 工具生成三款背景方向。這些是視覺提案，尚未套用網站；生成圖中的小字與細節不作為正式素材。

- `a-two-tone.png`：暖白＋淡鼠尾草綠雙色分層，建議方向。
- `b-leaf-shadows.png`：暖白＋柔和日光樹影。
- `c-campus-line-art.png`：米白＋淡綠校舍輪廓線稿。

## 生成提示詞

### A｜暖白＋淡鼠尾草綠雙色底

```text
Use case: ui-mockup, precise background-only edit.
Input image 1 is the exact edit target, a 2048x858 desktop website screenshot for 常春藤幼兒園 campus information. Generate ONE complete full-width high-fidelity website section mock-up per request with the SAME aspect ratio and framing as input.
INVARIANTS: preserve the exact layout, size and positions of ALL UI content, generous margins, title 分校資訊 and small Campuses label, five-campus pill tabs and arrows, large red-brick school photo with turquoise sky on left, all map geometry and place labels on right, contact details and buttons, LINE and Facebook icons. Keep 國際校 selected. Do not reinterpret, move, recolor or crop the existing photo or map. Preserve Traditional Chinese text faithfully: 義華校 明華校 崇德校 國際校 仁武校; 高雄 · 鳥松區; 所在地; 高雄市鳥松區球場路59號; 參觀專線; 07–370–8001; 預約參觀國際校; 認識國際校. Only edit the empty SECTION BACKGROUND behind the existing UI, leaving photo/map/cards/buttons intact.
No browser chrome, no device mockup, no headings/labels for the design option added inside screenshot, no watermarks. The brand is spacious, warm, established and approachable, meant for Taiwanese parents. A polished subtle background with obvious intentional art direction.
VARIANT: Warm white #FAFAF5 upper field from top edge through y=430px (50% image height). At exactly y=430px a crisp straight horizontal boundary transitions into a full-bleed pale sage green #EAF0E6 lower field to bottom. Both fields span the entire viewport width. This boundary passes BEHIND the photo and the map; the photo visibly straddles the color boundary, creating a clean architectural layered composition. Preserve every existing content pixel as closely as possible. Absolutely flat matte solid colors: no gradients, texture, leaf shadows, curved waves, drawings, new outlines or extra shadows. Sophisticated uncluttered minimalist campus website.
```

### B｜暖白日光樹影

```text
Use case: ui-mockup, precise background-only edit.
Input image 1 is the exact edit target, a 2048x858 desktop website screenshot for 常春藤幼兒園 campus information. Generate ONE complete full-width high-fidelity website section mock-up per request with the SAME aspect ratio and framing as input.
INVARIANTS: preserve the exact layout, size and positions of ALL UI content, generous margins, title 分校資訊 and small Campuses label, five-campus pill tabs and arrows, large red-brick school photo with turquoise sky on left, all map geometry and place labels on right, contact details and buttons, LINE and Facebook icons. Keep 國際校 selected. Do not reinterpret, move, recolor or crop the existing photo or map. Preserve Traditional Chinese text faithfully: 義華校 明華校 崇德校 國際校 仁武校; 高雄 · 鳥松區; 所在地; 高雄市鳥松區球場路59號; 參觀專線; 07–370–8001; 預約參觀國際校; 認識國際校. Only edit the empty SECTION BACKGROUND behind the existing UI, leaving photo/map/cards/buttons intact.
No browser chrome, no device mockup, no headings/labels for the design option added inside screenshot, no watermarks. The brand is spacious, warm, established and approachable, meant for Taiwanese parents. A polished subtle background with obvious intentional art direction.
VARIANT: Replace cream base with luminous warm white #FAFAF5. Add gentle physically plausible soft botanical SHADOWS as if morning sunlight comes through nearby trees onto a white wall: diffuse desaturated gray-sage leaf and slender branch shadows entering from the upper-left corner and far-right outer margin, at 8–13 percent effective opacity. The shadows should be visible enough to appreciate but very soft, out-of-focus, natural irregular scale and refined; some recognizable large elliptical leaf silhouettes softly overlap. Concentrate exclusively in outer empty margins x<400px and x>1650px, tapering to clear white well before content. Keep centered header and ALL text areas clean and clear. Photo and map must remain unchanged. No actual foreground plants or colored leaves, no cartoon leaf outline, no hard-edged clip art, no animated indication, no colorful gradient. Mood: quiet sunny school garden, airy high-end warm architecture.
```

### C｜淡綠校舍輪廓線稿

```text
Use case: ui-mockup, precise background-only edit.
Input image 1 is the exact edit target, a 2048x858 desktop website screenshot for 常春藤幼兒園 campus information. Generate ONE complete full-width high-fidelity website section mock-up per request with the SAME aspect ratio and framing as input.
INVARIANTS: preserve the exact layout, size and positions of ALL UI content, generous margins, title 分校資訊 and small Campuses label, five-campus pill tabs and arrows, large red-brick school photo with turquoise sky on left, all map geometry and place labels on right, contact details and buttons, LINE and Facebook icons. Keep 國際校 selected. Do not reinterpret, move, recolor or crop the existing photo or map. Preserve Traditional Chinese text faithfully: 義華校 明華校 崇德校 國際校 仁武校; 高雄 · 鳥松區; 所在地; 高雄市鳥松區球場路59號; 參觀專線; 07–370–8001; 預約參觀國際校; 認識國際校. Only edit the empty SECTION BACKGROUND behind the existing UI, leaving photo/map/cards/buttons intact.
No browser chrome, no device mockup, no headings/labels for the design option added inside screenshot, no watermarks. The brand is spacious, warm, established and approachable, meant for Taiwanese parents. A polished subtle background with obvious intentional art direction.
VARIANT: Replace background with light ivory #FAF8F0. Draw a refined single-color thin sage architectural line illustration only along the lower outer empty margins, low contrast but visible, 10–15 percent sage ink opacity. On the leftmost x=0–380px lower third, a subtly cropped continuous elevation drawing derives directly from the REAL red-brick school building shown in the provided photo: repeated triangular gables, arched windows, tall columns, and a small rounded tree silhouette drawn with the same delicate line. On far-right x=1700–2048px, continue a sparse abstract tree canopy and low campus wall line at bottom. Line art should feel like an architect's careful pen sketch, no filled shapes or colors, approximately 1–2px strokes at full resolution. Keep upper 60% and center content free of decoration. Do not invent ornate towers or other new school buildings. Preserve all current photo, map, content and spacing; drawing stays behind and outside content, is decorative only and does not overlap text or social links. Calm signature campus stationery feeling, mature rather than cartoonish.
```

