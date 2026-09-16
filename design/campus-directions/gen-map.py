"""把 geo-source/*.json（Nominatim polygon_geojson 結果）投影成 map-data.js。
重新抓取：對每個區執行
  curl -A "ivy-website-prototype/1.0" "https://nominatim.openstreetmap.org/search?format=json&limit=1&polygon_geojson=1&polygon_threshold=0.0008&countrycodes=tw&q=<區名> 高雄市" -o geo-source/<區名>.json
五校座標來源：Nominatim 查「<路名> <區> 高雄市」的第一筆 residential 節點（道路層級，非門牌）。
"""
import json,math,glob,os
HERE=os.path.dirname(os.path.abspath(__file__))
core={'三民區','左營區','鳥松區','仁武區'}
pins={'yihua':(22.6431663,120.3386948,'義華校'),'minghua':(22.6627306,120.3095816,'明華校'),'chongde':(22.6759412,120.3034018,'崇德校'),'international':(22.6568854,120.3387042,'國際校'),'renwu':(22.6820934,120.3417336,'仁武校')}
lon0,lon1=120.245,120.415; lat0,lat1=22.585,22.745
W=600; k=math.cos(math.radians(22.66)); H=round(W*(lat1-lat0)/((lon1-lon0)*k))
P=lambda lon,lat:(round((lon-lon0)/(lon1-lon0)*W,1),round((lat1-lat)/(lat1-lat0)*H,1))
rows=[]
for f in sorted(glob.glob(f'{HERE}/geo-source/*.json')):
    name=os.path.basename(f)[:-5]
    if name=='旗津區': continue
    d=json.load(open(f))
    if not d: continue
    g=d[0]['geojson']; polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
    path=[];xs=[];ys=[]
    for poly in polys:
        for ring in poly:
            pts=[P(x,y) for x,y in ring]; xs+= [p[0] for p in pts]; ys+=[p[1] for p in pts]
            path.append('M'+' L'.join(f'{x} {y}' for x,y in pts)+'Z')
    rows.append('    {name:%s,core:%s,cx:%s,cy:%s,d:%s},'%(json.dumps(name,ensure_ascii=False),'true' if name in core else 'false',round(sum(xs)/len(xs),1),round(sum(ys)/len(ys),1),json.dumps(' '.join(path))))
pinout={k_:{'x':P(lon,lat)[0],'y':P(lon,lat)[1],'label':lb} for k_,(lat,lon,lb) in pins.items()}
out=['// 由 gen-map.py 產生：OpenStreetMap 行政區邊界（Nominatim，簡化）投影到 %dx%d 的 viewBox；'%(W,H),'// 五校座標為各校所在道路的 OSM 節點，僅供示意，非門牌精確位置。','window.CAMPUS_MAP = {',f'  W:{W}, H:{H},','  districts:[',*rows,'  ],','  pins:'+json.dumps(pinout,ensure_ascii=False),'};']
open(f'{HERE}/map-data.js','w').write('\n'.join(out)+'\n'); print('map-data.js written')
