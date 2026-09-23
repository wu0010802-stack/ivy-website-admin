"""開場布幕投影貼圖：把去背後必為全透明的白紙像素壓成純白，再轉無損 WebP。

以 web/app/utils/entranceCurtain.ts colourProjectionTexture 的 Python 移植驗證去背輸出逐位元相同；
加 --write 才寫檔。寫檔後把 sha256 前 8 碼更新到 entrance-policy.ts 的 ENTRANCE_PROJECTION。
"""
from PIL import Image
import io, sys, numpy as np
SRC='web/public/assets/ivy-30th-anniversary-projection.png'
DST='web/public/assets/ivy-30th-anniversary-projection.webp'

def keyed(rgba):
    d=rgba.astype(np.int64); h,w,_=d.shape
    pig=1-d[...,:3].min(axis=2)/255
    t=np.clip((pig-0.045)/0.060,0,1); alpha=t*t*(3-2*t)*d[...,3]/255
    lin=np.array([c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4 for c in (np.arange(256)/255)])
    out=np.zeros((h,w,4),np.uint8)
    pad=np.pad(alpha,1,constant_values=1.0)  # 邊界外不算 <0.05
    nb=(pad[1:-1,:-2]<0.05)|(pad[1:-1,2:]<0.05)|(pad[:-2,1:-1]<0.05)|(pad[2:,1:-1]<0.05)
    ys,xs=np.nonzero(alpha)
    for y,x in zip(ys.tolist(),xs.tolist()):
        cov=alpha[y,x]
        if cov<0.99 or nb[y,x]:
            best=0;ref=None
            for dy in range(-2,3):
                for dx in range(-2,3):
                    yy,xx=y+dy,x+dx
                    if 0<=yy<h and 0<=xx<w and alpha[yy,xx]>0.99:
                        diff=((255-d[yy,xx,:3])**2).sum()
                        if diff>best: best=diff;ref=(yy,xx)
            if best:
                dot=((255-d[y,x,:3])*(255-d[ref][:3])).sum()
                cov=min(cov,max(0,dot/best))
        if cov<0.001: continue
        for c in range(3):
            ink=int(round(min(255,max(0,(d[y,x,c]-(1-cov)*255)/cov))))
            light=lin[ink]*cov
            out[y,x,c]=int(round(255*(light*12.92 if light<=0.0031308 else 1.055*light**(1/2.4)-0.055)))
        out[y,x,3]=int(round(cov*255))
    return out

src=np.asarray(Image.open(SRC).convert('RGBA')).copy()
pig=1-src[...,:3].min(axis=2)/255
paper=(pig<=0.045)            # alpha 恆為 0 的像素
flat=src.copy(); flat[paper,:3]=255
buf=io.BytesIO(); Image.fromarray(flat[...,:3]).save(buf,'WEBP',lossless=True,quality=100,method=6)
dec=np.asarray(Image.open(io.BytesIO(buf.getvalue())).convert('RGBA'))
assert (dec==flat).all(), '無損解碼不一致'
a,b=keyed(src),keyed(dec)
same=(a==b).all()
print(f'paper {paper.mean():.3f}  webp {len(buf.getvalue()):,} bytes  keyed identical: {same}')
if not same: sys.exit(1)
if '--write' in sys.argv: open(DST,'wb').write(buf.getvalue()); print('寫入',DST)
