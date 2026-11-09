import cv2,json,numpy as np,sys
zid='3586'; d=json.load(open(f'plans/zone_{zid}.plots.json')); P=d['plots']; A=json.load(open(sys.argv[1])); fl=json.load(open(f'out/flags_{zid}.json')) if len(sys.argv)<3 else {'iso':[],'noexact':[]}
im=cv2.imread(f'plans/zone_{zid}.jpg'); U=5
Y=cv2.cvtColor(im,cv2.COLOR_BGR2YCrCb)[...,0].astype(np.float32)
hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV); yel=cv2.inRange(hsv,(12,90,120),(45,255,255)); yel=cv2.morphologyEx(yel,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8)); Y[yel==0]=235
u=cv2.resize(Y,None,fx=U,fy=U,interpolation=cv2.INTER_CUBIC); b=cv2.GaussianBlur(u,(0,0),U*0.5); u=u+1.2*(u-b)
u=(np.clip((u-120)/(222-120),0,1)*255).astype(np.uint8); up=cv2.merge([u,u,u])
bad=set(fl['iso'])|set(fl['noexact'])
for i,p in enumerate(P):
    x,y=p['num_xy']; t=str(A.get(str(i),'?')); col=(0,0,255) if i in bad else (200,80,0)
    cv2.putText(up,t,(int(x*U-17),int(y*U+31)),cv2.FONT_HERSHEY_SIMPLEX,0.5,col,1,cv2.LINE_AA)
C=np.array([p['num_xy'] for p in P]); x0,y0=int(C[:,0].min())-14,int(C[:,1].min())-10; x1,y1=int(C[:,0].max())+14,int(C[:,1].max())+12
nx,ny=3,3; k=0
for j in range(ny):
    for i in range(nx):
        a=x0+(x1-x0)*i//nx-6; b_=x0+(x1-x0)*(i+1)//nx+6; c=y0+(y1-y0)*j//ny-6; e=y0+(y1-y0)*(j+1)//ny+6
        cv2.imwrite(f'out/sheet_{k}.jpg',up[c*U:e*U,a*U:b_*U],[cv2.IMWRITE_JPEG_QUALITY,90]); k+=1
print((x1-x0)*U//nx,(y1-y0)*U//ny)
