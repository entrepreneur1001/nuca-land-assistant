import cv2,numpy as np,json,sys
C0,C1,half,res=np.load('out/mos_meta.npy'); mos=cv2.cvtColor(cv2.imread('out/mos_google16.png'),cv2.COLOR_BGR2GRAY)
s=cv2.imread('plans/project_1282_mainproject.jpg'); sg=cv2.cvtColor(s,cv2.COLOR_BGR2GRAY)
def feat(g):
    g=cv2.GaussianBlur(g.astype(np.float32),(0,0),1.2)
    # dark-line response: blackhat + tophat (roads are dark or bright lines)
    k=np.ones((7,7),np.uint8)
    return cv2.morphologyEx(g,cv2.MORPH_BLACKHAT,k)
def run(u0,v0,u1,v1,scales,rots,f=2.0):
    tpl=cv2.resize(sg[v0:v1,u0:u1],None,fx=f,fy=f,interpolation=cv2.INTER_CUBIC); T=feat(tpl)
    hsv=cv2.cvtColor(s,cv2.COLOR_BGR2HSV)
    bad=((sg<70)|(hsv[...,1]>90)).astype(np.uint8)
    bad=cv2.dilate(bad,np.ones((9,9),np.uint8))[v0:v1,u0:u1]
    bad=cv2.resize(bad,None,fx=f,fy=f,interpolation=cv2.INTER_NEAREST)
    T[bad>0]=0
    cv2.imwrite('out/tplfeat.png',np.clip(T*6,0,255).astype(np.uint8))
    best=[]
    for sc in scales:
        for rot in rots:
            # render mosaic at sc/f merc m per px, rotated by rot about centre
            z=res/(sc/f)
            Mr=cv2.getRotationMatrix2D((mos.shape[1]/2,mos.shape[0]/2),rot,z)
            n=int(mos.shape[0]*z); Mr[:,2]+=(n-mos.shape[1])/2
            im=cv2.warpAffine(mos,Mr,(n,n),flags=cv2.INTER_AREA)
            F=feat(im)
            r=cv2.matchTemplate(F,T,cv2.TM_CCOEFF_NORMED); _,mx,_,loc=cv2.minMaxLoc(r)
            best.append((mx,sc,rot,loc,Mr))
    best.sort(key=lambda b:-b[0]); return best,f
if __name__=='__main__':
    u0,v0,u1,v1=map(int,sys.argv[1:5])
    best,f=run(u0,v0,u1,v1,np.arange(7.4,10.01,0.2),[-3,-2,-1,0,1,2,3])
    for b in best[:8]: print(round(b[0],3),round(b[1],2),b[2],b[3])
    mx,sc,rot,loc,Mr=best[0]
    # slide px (u,v) -> rendered px = ((u-u0)*f+loc0,(v-v0)*f+loc1) -> mosaic px via inverse Mr -> merc
    Mi=cv2.invertAffineTransform(Mr)
    S=np.array([[f,0,loc[0]-u0*f],[0,f,loc[1]-v0*f],[0,0,1]])
    T=np.array([[res,0,C0-half],[0,-res,C1+half]])
    M=T@np.vstack([Mi,[0,0,1]])@S
    json.dump({'M':M.tolist(),'score':mx,'sc':sc,'rot':rot},open(sys.argv[5],'w')); print(M)
