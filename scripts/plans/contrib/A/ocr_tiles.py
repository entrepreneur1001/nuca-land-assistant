import cv2,numpy as np,json,subprocess,os,shutil,collections,sys
zid='3586'; im=cv2.imread(f'plans/zone_{zid}.jpg'); d=json.load(open(f'plans/zone_{zid}.plots.json')); P=d['plots']
C=np.array([p['num_xy'] for p in P])
tmp='out/ocrtmp'; shutil.rmtree(tmp,ignore_errors=True); os.makedirs(tmp)
H,W=im.shape[:2]
def prep(c,U,mode):
    c=cv2.resize(c,None,fx=U,fy=U,interpolation=cv2.INTER_CUBIC)
    if mode=='sharp':
        b=cv2.GaussianBlur(c,(0,0),U*0.6); c=cv2.addWeighted(c,1.8,b,-0.8,0)
    if mode=='rg':
        b,g,r=cv2.split(c.astype(np.float32)); m=np.clip((r-g)*2.0,0,255); m=255-m.astype(np.uint8); c=cv2.merge([m,m,m])
    return c
votes=[collections.Counter() for _ in P]
ys0,ys1=int(C[:,1].min())-15,int(C[:,1].max())+15; xs0,xs1=int(C[:,0].min())-20,int(C[:,0].max())+20
runs=[(90,60,20,40,6,'plain'),(90,60,60,10,6,'plain'),(120,80,0,0,5,'plain'),(120,80,50,35,5,'plain'),(120,80,80,60,6,'plain'),(160,110,0,0,5,'plain'),(160,110,70,50,5,'plain'),(160,110,110,20,4,'plain'),(100,70,30,30,7,'plain'),(100,70,70,55,7,'sharp'),(140,100,40,70,6,'sharp'),(200,140,0,0,4,'plain'),(200,140,90,60,5,'plain'),(70,48,0,0,8,'plain'),(70,48,35,24,8,'plain'),(50,36,10,7,8,'sharp')]
for ri,(tw,th,ox,oy,U,mode) in enumerate(runs):
    files=[];meta=[]
    for y in range(ys0-oy,ys1,th-16):
        for x in range(xs0-ox,xs1,tw-24):
            x0,y0=max(0,x),max(0,y); x1,y1=min(W,x+tw),min(H,y+th)
            if x1-x0<20 or y1-y0<15: continue
            if not ((C[:,0]>x0)&(C[:,0]<x1)&(C[:,1]>y0)&(C[:,1]<y1)).any(): continue
            f=f'{tmp}/r{ri}_{x0}_{y0}.png'; cv2.imwrite(f,prep(im[y0:y1,x0:x1],U,mode)); files.append(f); meta.append((x0,y0,U))
    n=0
    for i in range(0,len(files),150):
        subprocess.run(['tools/ocr_files',f'{tmp}/o.json']+files[i:i+150],check=True)
        for (x0,y0,U),obs in zip(meta[i:i+150],json.load(open(f'{tmp}/o.json'))):
            seen=set(); pos=set()
            for o in obs:
                key=(round(o['cx'],1),round(o['cy'],1))
                if key in pos: continue
                pos.add(key)
                t=o['text'].strip()
                if not t.isdigit() or len(t)>3 or t[0]=='0': continue
                px,py=x0+o['cx']/U,y0+o['cy']/U
                dd=np.hypot(C[:,0]-px,C[:,1]-py); k=int(np.argmin(dd))
                if dd[k]>4.5 or (k,t) in seen: continue
                seen.add((k,t)); votes[k][t]+=1; n+=1
    print('run',ri,mode,len(files),'tiles, obs assigned',n,'plots with any vote',sum(1 for v in votes if v),flush=True)
json.dump([v.most_common() for v in votes],open('out/votes_tiles.json','w'))
