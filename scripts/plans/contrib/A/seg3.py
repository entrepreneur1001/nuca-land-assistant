"""Extraction for low-resolution plans (zone 3586, 1600 px): plot borders are 1-px faint lines, so plots are split by a
marker watershed: markers = plot-number blobs (orange/red digits), relief = black-hat of V (border lines) + distance prior.
Cells split by a spurious marker (no border between them) are merged. Writes plans/zone_<zid>.plots.json (text empty).
usage: python3 seg3.py <zid> [peak_thr=0.02] [merge_thr=4.5] [--add "x,y;x,y"]"""
import cv2,numpy as np,json,sys
zid=sys.argv[1]; PT=float(sys.argv[2]) if len(sys.argv)>2 else 0.02; MT=float(sys.argv[3]) if len(sys.argv)>3 else 4.5
F=4
im=cv2.imread(f'plans/zone_{zid}.jpg'); H0,W0=im.shape[:2]
up=cv2.resize(im,None,fx=F,fy=F,interpolation=cv2.INTER_CUBIC)
hsv=cv2.cvtColor(up,cv2.COLOR_BGR2HSV); h,s,v=cv2.split(hsv)
yel=cv2.inRange(hsv,(23,120,150),(42,255,255))
y2=cv2.morphologyEx(yel,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
cs,hier=cv2.findContours(y2,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_NONE); reg=y2.copy()
for c,hh in zip(cs,hier[0]):
    if hh[3]>=0 and cv2.contourArea(c)<F*F*45: cv2.drawContours(reg,[c],-1,255,-1)
n,lab,st,_=cv2.connectedComponentsWithStats(reg,connectivity=8)
for i in range(1,n):
    if st[i,4]<F*F*80: reg[lab==i]=0
reg[:int(0.09*H0*F)]=0; reg[int(0.955*H0*F):]=0
dig=((h<=22)&(s>110)&(v>110)&(reg>0)).astype(np.float32)
blur=cv2.GaussianBlur(dig,(0,0),sigmaX=3.2*F/2,sigmaY=1.8*F/2)
mx=cv2.dilate(blur,cv2.getStructuringElement(cv2.MORPH_RECT,(int(9*F)|1,int(7*F)|1)))
dreg=cv2.distanceTransform(reg,cv2.DIST_L2,3)
pk=np.argwhere((blur==mx)&((blur>0.08)|((blur>PT)&(dreg>5*F))))
if '--add' in sys.argv:  # manual markers for numbers too faint to detect: "x,y;x,y" in plan px
    ex=np.array([[float(t.split(',')[1])*F,float(t.split(',')[0])*F] for t in sys.argv[sys.argv.index('--add')+1].split(';')]).astype(int)
    for y,x in ex: blur[y,x]=1.0
    pk=np.vstack([pk,ex])
digd=cv2.dilate((dig>0).astype(np.uint8),np.ones((7,7),np.uint8))
vv=cv2.GaussianBlur(v,(0,0),1.2).astype(np.float32); v2=vv.copy()
vmax=cv2.dilate(vv,np.ones((25,25),np.uint8)); v2[digd>0]=vmax[digd>0]
bh=cv2.morphologyEx(v2,cv2.MORPH_BLACKHAT,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
bh=cv2.GaussianBlur(bh,(0,0),1.0)
def flood(pk):
    seed=np.full(reg.shape,255,np.uint8)
    for (y,x) in pk: cv2.ellipse(seed,(int(x),int(y)),(14,6),0,0,360,0,-1)
    dist=cv2.distanceTransform(seed,cv2.DIST_L2,3)
    img=np.clip(np.clip(cv2.GaussianBlur(bh,(0,0),1.5)*5,0,170)+np.clip(dist*1.2,0,80),0,255).astype(np.uint8)
    band=cv2.bitwise_and(reg,cv2.bitwise_not(cv2.erode(reg,np.ones((5,5),np.uint8)))); img[band>0]=255
    mk=np.zeros(reg.shape,np.int32); mk[reg==0]=1
    for i,(y,x) in enumerate(pk): cv2.ellipse(mk,(int(x),int(y)),(14,6),0,0,360,i+2,-1)
    mk[(reg==0)&(mk>1)]=1
    ws=cv2.watershed(cv2.merge([img,img,img]),mk); ws[reg==0]=1
    edges={}
    for y,x in np.argwhere(ws==-1):
        if y<1 or x<1 or y>=ws.shape[0]-1 or x>=ws.shape[1]-1: continue
        nb=set(ws[y-1:y+2,x-1:x+2].ravel().tolist())-{-1,1}
        if len(nb)==2: edges.setdefault(tuple(sorted(nb)),[]).append(bh[y,x])
    return ws,edges
for it in range(6):
    ws,edges=flood(pk)
    weak=sorted([(float(np.median(vs)),k) for k,vs in edges.items() if len(vs)>=12 and np.median(vs)<MT])
    if not weak: break
    n0=len(pk)
    # drop the weaker-blob marker of each weak pair (one per marker per round)
    drop=set(); used=set()
    for m,(a,b) in weak:
        if a in used or b in used: continue
        if np.hypot(*(pk[a-2]-pk[b-2]))>12*F: continue
        used|={a,b}; ya,xa=pk[a-2]; yb,xb=pk[b-2]
        drop.add(a-2 if blur[ya,xa]<blur[yb,xb] else b-2)
    print('round',it,'markers',len(pk),'weak pairs',len(weak),'dropping',len(drop))
    pk=np.array([p for i,p in enumerate(pk) if i not in drop])
    if len(pk)==n0: break
print('final markers',len(pk))
plots=[]
for i in range(len(pk)):
    m=(ws==i+2).astype(np.uint8)
    m=cv2.morphologyEx(cv2.dilate(m,np.ones((3,3),np.uint8)),cv2.MORPH_OPEN,np.ones((7,7),np.uint8))
    cs,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    if not cs: continue
    c=max(cs,key=cv2.contourArea); a=cv2.contourArea(c)/F/F
    poly=cv2.approxPolyDP(c,0.015*cv2.arcLength(c,True),True).reshape(-1,2)/F
    bx,by,bw,bh_=cv2.boundingRect(np.round(poly).astype(np.int32))
    plots.append({'poly':np.round(poly,1).tolist(),'bbox':[int(bx),int(by),int(bw),int(bh_)],'area_px':round(a,1),'num_xy':[float(pk[i][1])/F,float(pk[i][0])/F],'text':'','conf':0,'cands':[]})
areas=np.array([p['area_px'] for p in plots]); med=np.median(areas)
print('plots',len(plots),'median area',med,'small',[(p['num_xy'],p['area_px']) for p in plots if p['area_px']<0.55*med],'big',[(p['num_xy'],p['area_px']) for p in plots if p['area_px']>1.6*med])
json.dump({'width':W0,'height':H0,'plots':plots},open(f'plans/zone_{zid}.plots.json','w'))
vis=up.copy()
for p in plots: cv2.polylines(vis,[np.round(np.array(p['poly'])*F).astype(np.int32)],True,(255,0,0),2)
cv2.imwrite(f'out/seg_{zid}.jpg',vis)
