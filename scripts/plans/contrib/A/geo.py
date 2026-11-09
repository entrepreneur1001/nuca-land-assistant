import math, json, numpy as np, cv2, os, time
from urllib.request import Request, urlopen
R=6378137.0; HALF=math.pi*R
def merc(lat,lng): return (math.radians(lng)*R, math.log(math.tan(math.pi/4+math.radians(lat)/2))*R)
def unmerc(x,y): return (math.degrees(2*math.atan(math.exp(y/R))-math.pi/2), math.degrees(x/R))
def osm_img(cx,cy,half,res,raw='osm/raw.json',names=False):
    n=int(2*half/res); im=np.full((n,n,3),255,np.uint8)
    d=json.load(open(raw))
    for w in d['elements']:
        if w['type']!='way': continue
        pts=np.array([[(merc(p['lat'],p['lon'])[0]-(cx-half))/res,((cy+half)-merc(p['lat'],p['lon'])[1])/res] for p in w['geometry']],np.int32)
        hw=w['tags'].get('highway'); t=3 if hw in('motorway','trunk','primary','motorway_link','trunk_link') else 1
        cv2.polylines(im,[pts],False,(0,0,0) if t==1 else (0,0,200),t,cv2.LINE_AA)
    return im
def tiles(cx,cy,half,zoom,src='google'):
    n=2**zoom; res=2*HALF/n/256
    def txy(x,y): return int((x+HALF)/(2*HALF)*n), int((HALF-y)/(2*HALF)*n)
    tx0,ty1=txy(cx-half,cy-half); tx1,ty0=txy(cx+half,cy+half)
    os.makedirs('tiles_'+src,exist_ok=True)
    canvas=np.zeros(((ty1-ty0+1)*256,(tx1-tx0+1)*256,3),np.uint8)
    for tx in range(tx0,tx1+1):
        for ty in range(ty0,ty1+1):
            f=f'tiles_{src}/{zoom}_{ty}_{tx}.jpg'
            if not os.path.exists(f):
                if src=='google': u=f'https://mt1.google.com/vt/lyrs=s&x={tx}&y={ty}&z={zoom}'
                elif src=='bing':
                    q=''.join(str(((tx>>i)&1)+2*((ty>>i)&1)) for i in range(zoom-1,-1,-1)); u=f'https://ecn.t0.tiles.virtualearth.net/tiles/a{q}.jpeg?g=14000'
                else: u=src.format(z=zoom,x=tx,y=ty)
                for a in range(3):
                    try:
                        with urlopen(Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30) as r: open(f,'wb').write(r.read()); break
                    except Exception as e: time.sleep(1)
            t=cv2.imread(f)
            if t is not None: canvas[(ty-ty0)*256:(ty-ty0+1)*256,(tx-tx0)*256:(tx-tx0+1)*256]=t
    ox=tx0/n*2*HALF-HALF; oy=HALF-ty0/n*2*HALF
    x0=int((cx-half-ox)/res); y0=int((oy-(cy+half))/res); x1=int((cx+half-ox)/res); y1=int((oy-(cy-half))/res)
    return canvas[y0:y1,x0:x1].copy(), res
def grid(im,half,g):
    h,w=im.shape[:2]; res=2*half/w; k=int(half//g)
    for i in range(-k,k+1):
        px=int((half+i*g)/res); py=int((half-i*g)/res); col=(0,255,255) if i==0 else (255,255,0)
        cv2.line(im,(px,0),(px,h),col,1); cv2.line(im,(0,py),(w,py),col,1)
        cv2.putText(im,f'{int(i*g):+d}',(px+3,14),0,0.45,col,1); cv2.putText(im,f'{int(i*g):+d}',(3,py-3),0,0.45,col,1)
    return im
