# C 背景正式素材

使用內建 image_gen 工具，依使用者確認的 `c-campus-line-art.png` 提案產生獨立裝飾背景。部署檔：`../../assets/campus-line-art.webp`。生成原圖：`c-background-source.png`；僅轉存壓縮為 WebP quality 90，未另行重繪。

## 最終生成提示詞

```text
Use case: precise-object-edit. Create ONLY a deployment-ready website background from the approved reference. Remove every UI element, title, word, tab, arrow, map, school photo, phone, button, logo and icon. Retain just the fine PALE sage architectural illustration at bottom left and tree/fence illustration at bottom right in the same positions and scale as the reference.
CRITICAL: the canvas is one perfectly uniform solid light ivory sRGB #FAF8F0 (250,248,240), NOT transparent. NO transparency checkerboard, NO paper grain, no creases, no fabric texture, no gradients, no vignette, no photographed material. A flat solid-colored digital background. Every empty pixel must have identical #FAF8F0 color.
Wide landscape 2.39:1 ratio. At left edge x0–27%, y55–99%, preserve the reference's restrained architectural pen drawing of the existing school, repeated triangular gables, tall columns, arched windows, some little trees. It is a partial facade cropped by the left edge and faded gently into the blank center before x27%. At right x78–100%, y46–99%, preserve a tall tree at far-right, smaller tree and low school fence. Both drawings in very light gray-sage linework, color approximately #B6C0AA, delicate 1px thin outlines like approved mockup. Upper 45% and center x28–77% entirely uniform empty ivory. ZERO illustration or floor lines across the central gap.
Retain the same mature and airy feeling as the reference; avoid detailed shading or hatching. No new buildings outside these two corners, no readable text, no UI, no photography. Export only this flat background artwork.
```
