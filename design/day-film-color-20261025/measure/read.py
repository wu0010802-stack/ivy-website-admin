"""讀色票中心 12×12 平均：data（ffmpeg 601 解）、chrome、webkit → cube/samples.npz"""
import numpy as np, json
from PIL import Image
L = json.load(open('cube/layout.json')); N, P, cols = L['N'], L['P'], L['cols']
def patches(d):
    out = []
    for f in range(L['frames']):
        a = np.asarray(Image.open(f'{d}/f{f}.png').convert('RGB'), float)[:810, :1440]
        for i in range(cols * L['rows']):
            y, x = divmod(i, cols)
            out.append(a[y * P + 6:y * P + 18, x * P + 6:x * P + 18].reshape(-1, 3).mean(0))
    return np.array(out)[:N ** 3]
levels = np.round(np.arange(N) * 255 / (N - 1))
grid = np.array([(r, g, b) for b in levels for g in levels for r in levels])
data, chrome, webkit = patches('cube/data'), patches('cube/chrome'), patches('cube/webkit')
print('data vs grid mean|Δ|', np.abs(data - grid).mean().round(2), 'max', np.abs(data - grid).max().round(1))
print('chrome vs webkit mean|Δ|', np.abs(chrome - webkit).mean().round(2), 'p99', np.percentile(np.abs(chrome - webkit), 99).round(1))
for name, c in [('gray128', (128,128,128)), ('skin', (224,172,150)), ('magenta', (240,48,144)), ('green', (64,176,80))]:
    i = np.argmin(np.abs(grid - np.array(c)).sum(1))
    print(f'  {name:8s} grid {grid[i].astype(int)} → chrome {chrome[i].round().astype(int)} webkit {webkit[i].round().astype(int)}')
np.savez('cube/samples.npz', grid=grid, data=data, chrome=chrome, webkit=webkit)
