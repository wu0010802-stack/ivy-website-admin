"""17³ 色票測試片：1440×810、24fps、沒有色彩標記（跟正式站 day-film.mp4 同格式），每格停 1 秒。"""
import subprocess, numpy as np, json
from PIL import Image
N, P, W, H = 17, 24, 1440, 810
cols, rows = W // P, H // P
levels = np.round(np.arange(N) * 255 / (N - 1)).astype(int)
grid = np.array([(r, g, b) for b in levels for g in levels for r in levels])  # .cube 順序：紅最快
per = cols * rows
frames = []
for f in range(int(np.ceil(len(grid) / per))):
    im = np.zeros((H, W, 3), np.uint8) + 128
    for i, c in enumerate(grid[f * per:(f + 1) * per]):
        y, x = divmod(i, cols)
        im[y * P:(y + 1) * P, x * P:(x + 1) * P] = c
    Image.fromarray(im).save(f'cube/frame{f}.png'); frames.append(f'cube/frame{f}.png')
json.dump({'N': N, 'P': P, 'cols': cols, 'rows': rows, 'frames': len(frames)}, open('cube/layout.json', 'w'))
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', 'cube/frame%d.png',
                '-vf', 'scale=out_color_matrix=bt601:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,fps=24',
                '-c:v', 'libx264', '-profile:v', 'high', '-crf', '4', '-preset', 'slow', '-an', 'cube/tagged.mp4'], check=True)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', 'cube/tagged.mp4', '-c', 'copy', '-bsf:v',
                'h264_metadata=colour_primaries=2:transfer_characteristics=2:matrix_coefficients=2', 'cube/untagged.mp4'], check=True)
print(len(grid), 'colors in', len(frames), 'frames')
