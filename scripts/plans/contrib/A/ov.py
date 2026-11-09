"""overlay plan (3795 and 3586) on imagery window. usage: ov.py <mercX> <mercY> <half> <zoom> <out> [alpha] [src] [grid]"""
import sys,json,numpy as np,cv2,geo
cx,cy,half=map(float,sys.argv[1:4]); zoom=int(sys.argv[4]); out=sys.argv[5]
alpha=float(sys.argv[6]) if len(sys.argv)>6 else 0.5; src=sys.argv[7] if len(sys.argv)>7 else 'google'; g=float(sys.argv[8]) if len(sys.argv)>8 else 0
if src=='esri': src='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
im,res=geo.tiles(cx,cy,half,zoom,src); H,W=im.shape[:2]
blend=im.astype(np.float32)
for zid in (3586,3795):
    M=np.array(json.load(open(f'reg/{zid}.json'))['affine']); p=cv2.imread(f'plans/zone_{zid}.jpg'); h,w=p.shape[:2]
    S=np.array([[1/res,0,-(cx-half)/res],[0,-1/res,(cy+half)/res]]); A=(S@np.vstack([M,[0,0,1]])).astype(np.float32)
    wp=cv2.warpAffine(p,A,(W,H),flags=cv2.INTER_AREA if res>0.6 else cv2.INTER_LINEAR); mk=np.zeros((h,w),np.uint8); mk[int(h*0.09):int(h*0.955),:]=255
    wm=cv2.warpAffine(mk,A,(W,H))
    # make near-white paper transparent
    hsv=cv2.cvtColor(wp,cv2.COLOR_BGR2HSV); paper=(hsv[...,1]<12)&(hsv[...,2]>240)
    a=np.where((wm>0)&~paper,alpha,0)[...,None]
    blend=blend*(1-a)+wp.astype(np.float32)*a
blend=blend.astype(np.uint8)
if g: geo.grid(blend,half,g)
side=np.hstack([blend,geo.grid(im.copy(),half,g) if g else im])
cv2.imwrite(out,side,[cv2.IMWRITE_JPEG_QUALITY,88])
