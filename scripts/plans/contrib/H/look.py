"""Bare imagery + thin plot outlines for visual checking.
usage: python3 look.py <work dir> <zid> <out prefix> [--src esri|google] [--zoom 17] [--reg file|affine json] [--pad 0.4] [--old] [--scale f (scale about plot centroid)] [--maxw 1900]
writes <prefix>_bare.jpg and <prefix>_ov.jpg (plot polygons yellow, plan road edges cyan, old coordinates magenta dots with --old)."""
import sys, json, math, os, time
from urllib.request import Request, urlopen
import numpy as np, cv2
R=6378137.0; HALF=math.pi*R
Wd,zid,out=sys.argv[1:4]
def opt(k,d): return sys.argv[sys.argv.index(k)+1] if k in sys.argv else d
src=opt("--src","esri"); zoom=int(opt("--zoom",17)); pad=float(opt("--pad",0.4)); maxw=int(opt("--maxw",1900))
regf=opt("--reg",f"{Wd}/reg/{zid}.json")
M=np.array(json.load(open(regf))["affine"]) if os.path.exists(regf) else np.array(json.loads(regf))
polys=json.load(open(f"{Wd}/plans/zone_{zid}.plots.json"))["plots"]
allp=np.vstack([np.array(p["poly"],float) for p in polys]); c0=allp.mean(0)
if "--sim" in sys.argv:   # --sim groundscale,rot_deg,planx,plany,mercx,mercy : similarity pinning a plan px to a merc point
    gs,rot,px,py,mx_,my_=map(float,opt("--sim","").split(",")); lat0=math.degrees(2*math.atan(math.exp(my_/R))-math.pi/2); sm=gs/math.cos(math.radians(lat0))
    c_,s_=math.cos(math.radians(rot)),math.sin(math.radians(rot)); L=sm*np.array([[c_,s_],[s_,-c_]]); M=np.hstack([L,(np.array([mx_,my_])-L@np.array([px,py]))[:,None]])
    print("affine",json.dumps(M.tolist()))
f=float(opt("--scale",1))
if f!=1:
    g0=M[:,:2]@c0+M[:,2]; M=M.copy(); M[:,:2]*=f; M[:,2]=g0-M[:,:2]@c0
g=allp@M[:,:2].T+M[:,2]
if "--bbox" in sys.argv: x0,y0,x1,y1=map(float,opt("--bbox","").split(",")); mn=np.array([x0,y0]); mx=np.array([x1,y1])
else: mn,mx=g.min(0),g.max(0); p=pad*(mx-mn); mn-=p; mx+=p
n=2**zoom; res=2*HALF/n/256
def txy(x,y): return int((x+HALF)/(2*HALF)*n), int((HALF-y)/(2*HALF)*n)
tx0,ty1=txy(*mn); tx1,ty0=txy(*mx); os.makedirs(f"{Wd}/tiles",exist_ok=True)
canvas=np.zeros(((ty1-ty0+1)*256,(tx1-tx0+1)*256,3),np.uint8)
def get(tx,ty):
    fn=f"{Wd}/tiles/{zoom}_{ty}_{tx}.jpg" if src=="esri" else f"{Wd}/tiles/{src}_{zoom}_{ty}_{tx}.jpg"
    url=f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{ty}/{tx}" if src=="esri" else f"https://mt1.google.com/vt/lyrs=s&x={tx}&y={ty}&z={zoom}"
    if not os.path.exists(fn):
        for a in range(3):
            try:
                with urlopen(Request(url,headers={"User-Agent":"Mozilla/5.0"}),timeout=30) as r: open(fn,"wb").write(r.read()); break
            except Exception: time.sleep(1.5)
    return cv2.imread(fn) if os.path.exists(fn) else None
from concurrent.futures import ThreadPoolExecutor
jobs=[(tx,ty) for tx in range(tx0,tx1+1) for ty in range(ty0,ty1+1)]
with ThreadPoolExecutor(12) as ex: tiles=list(ex.map(lambda j:get(*j),jobs))
for (tx,ty),t in zip(jobs,tiles):
    if t is not None: canvas[(ty-ty0)*256:(ty-ty0+1)*256,(tx-tx0)*256:(tx-tx0+1)*256]=t
ox=tx0/n*2*HALF-HALF; oy=HALF-ty0/n*2*HALF
def topx(q): q=np.atleast_2d(q); return np.stack([(q[:,0]-ox)/res,(oy-q[:,1])/res],1)
ov=canvas.copy()
if "--roads" in sys.argv:
    img=cv2.imread(f"{Wd}/plans/zone_{zid}.jpg"); hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV)
    road=cv2.inRange(hsv,(0,0,150),(180,25,215)); road=cv2.morphologyEx(road,cv2.MORPH_OPEN,np.ones((3,3),np.uint8)); e=cv2.Canny(road,50,150)
    S=np.array([[1/res,0],[0,-1/res]]); A=S@M[:,:2]; t=S@(M[:,2]-np.array([ox,oy]))
    we=cv2.warpAffine(e,np.hstack([A,t[:,None]]).astype(np.float32),(canvas.shape[1],canvas.shape[0])); ov[we>80]=(255,255,0)
if "--faint" in sys.argv:   # faint context line work of the plan (parcel lines, neighbouring roads) in white
    img=cv2.imread(f"{Wd}/plans/zone_{zid}.jpg"); g_=cv2.GaussianBlur(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY),(0,0),1.2); e=cv2.Canny(g_,6,18); e=cv2.dilate(e,np.ones((3,3),np.uint8))
    S=np.array([[1/res,0],[0,-1/res]]); A=S@M[:,:2]; t=S@(M[:,2]-np.array([ox,oy]))
    we=cv2.warpAffine(e,np.hstack([A,t[:,None]]).astype(np.float32),(canvas.shape[1],canvas.shape[0]),flags=cv2.INTER_AREA); ov[we>60]=(255,255,255)
for p in polys:
    q=topx(np.array(p["poly"],float)@M[:,:2].T+M[:,2]); cv2.polylines(ov,[q.astype(np.int32)],True,(0,255,255),1,cv2.LINE_AA)
if "--old" in sys.argv:
    zp=json.load(open(f"{Wd}/zone_plots.json"))[zid]["plots"]
    for o in zp:
        if o.get("lat"):
            x=R*math.radians(o["lng"]); y=R*math.log(math.tan(math.pi/4+math.radians(o["lat"])/2)); q=topx([x,y])[0]; cv2.circle(ov,(int(q[0]),int(q[1])),3,(255,0,255),-1)
a=topx(mn)[0]; b=topx(mx)[0]; X0,X1=int(max(a[0],0)),int(b[0]); Y0,Y1=int(max(b[1],0)),int(a[1])
# 100 m ground scale bar
lat=math.degrees(2*math.atan(math.exp(((mn+mx)/2)[1]/R))-math.pi/2); L=int(100/math.cos(math.radians(lat))/res)
for im,nm in ((canvas,"bare"),(ov,"ov")):
    c=im[Y0:Y1,X0:X1].copy(); cv2.line(c,(20,20),(20+L,20),(255,255,255),3); cv2.putText(c,"100 m",(20,45),cv2.FONT_HERSHEY_SIMPLEX,0.6,(255,255,255),2)
    if c.shape[1]>maxw: c=cv2.resize(c,(maxw,int(c.shape[0]*maxw/c.shape[1])),interpolation=cv2.INTER_AREA)
    cv2.imwrite(f"{out}_{nm}.jpg",c,[cv2.IMWRITE_JPEG_QUALITY,88])
k=(X1-X0)/c.shape[1]*res; print(f"img px (u,v) -> merc: x={ox+X0*res:.2f}+u*{k:.5f}  y={oy-Y0*res:.2f}-v*{k:.5f}")
print(out,c.shape,"bbox merc",mn.tolist(),mx.tolist(),"res",res)
