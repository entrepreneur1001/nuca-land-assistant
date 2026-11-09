import cv2,numpy as np,json,sys
UP=4
s=cv2.imread('plans/project_1282_mainproject.jpg')
S=cv2.resize(s,None,fx=UP,fy=UP,interpolation=cv2.INTER_CUBIC)
def ymask(img):
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV); return cv2.inRange(hsv,(18,110,150),(40,255,255))
SY=cv2.GaussianBlur(ymask(S).astype(np.float32),(0,0),2.0)
def run(zid,factors,rots):
    p=cv2.imread(f'plans/zone_{zid}.jpg'); PY=ymask(p); H,W=PY.shape
    ys,xs=np.where(PY>0); x0,x1,y0,y1=xs.min()-10,xs.max()+10,ys.min()-10,ys.max()+10
    crop=PY[y0:y1,x0:x1]
    out=[]
    for fa in factors:
        for rot in rots:
            h,w=crop.shape
            Mr=cv2.getRotationMatrix2D((w/2,h/2),rot,fa)
            cs=np.array([[0,0,1],[w,0,1],[0,h,1],[w,h,1]])@Mr.T; mn=cs.min(0); mx=cs.max(0)
            Mr[:,2]-=mn; n=(int(mx[0]-mn[0])+1,int(mx[1]-mn[1])+1)
            T=cv2.GaussianBlur(cv2.warpAffine(crop,Mr,n,flags=cv2.INTER_AREA).astype(np.float32),(0,0),2.0)
            r=cv2.matchTemplate(SY,T,cv2.TM_CCOEFF_NORMED); _,m,_,loc=cv2.minMaxLoc(r)
            # plan px (x,y) -> slide px: ((Mr@[x-x0,y-y0,1]) + loc)/UP
            A=np.array([[1/UP,0,loc[0]/UP],[0,1/UP,loc[1]/UP]])@np.vstack([Mr,[0,0,1]])@np.array([[1,0,-x0],[0,1,-y0],[0,0,1]])
            out.append((m,fa,rot,A))
    out.sort(key=lambda o:-o[0]); return out
if __name__=='__main__':
    zid=sys.argv[1]; f0,f1=float(sys.argv[2]),float(sys.argv[3])
    o=run(zid,np.linspace(f0,f1,13),np.arange(-2,2.01,0.5))
    for m,fa,rot,A in o[:5]: print(round(m,4),round(fa,4),rot, 'slide px per plan px',round(fa/UP,5))
    best=o[0]
    o=run(zid,np.linspace(best[1]*0.985,best[1]*1.015,13),np.arange(best[2]-0.5,best[2]+0.51,0.125))
    for m,fa,rot,A in o[:5]: print(round(m,4),round(fa,4),rot, 'slide px per plan px',round(fa/UP,5))
    json.dump({'A':o[0][3].tolist(),'score':o[0][0],'f':o[0][1]/UP,'rot':o[0][2]},open(f'out/p2s_{zid}.json','w'))
