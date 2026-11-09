"""Plot-number OCR for low-resolution plans: JPEG chroma is subsampled, so digit shapes survive only in luminance.
Renders luminance (digits dark on white, everything but each plot's number zone blanked), upsamples tiles and runs Apple Vision.
usage: python3 ocr_lum.py <zid>  -> out/votes_lum_<zid>.json  ([[text, votes],...] per plot of plans/zone_<zid>.plots.json)"""
import cv2,numpy as np,json,subprocess,os,shutil,collections,sys
zid=sys.argv[1]; im=cv2.imread(f'plans/zone_{zid}.jpg'); d=json.load(open(f'plans/zone_{zid}.plots.json')); P=d['plots']
C=np.array([p['num_xy'] for p in P]); H,W=im.shape[:2]
tmp='out/ocrtmp'; shutil.rmtree(tmp,ignore_errors=True); os.makedirs(tmp)
Y=cv2.cvtColor(im,cv2.COLOR_BGR2YCrCb)[...,0].astype(np.float32)
def zone_mask(hw,hh,shrink):
    m=np.zeros((H,W),np.uint8)
    for p in P:
        x,y=p['num_xy']; pm=np.zeros((H,W),np.uint8)
        x0,y0,x1,y1=int(x-hw),int(y-hh),int(x+hw)+1,int(y+hh)+1
        sub=np.zeros((y1-y0,x1-x0),np.uint8); cv2.fillPoly(sub,[np.round(np.array(p['poly'])-[x0,y0]).astype(np.int32)],255)
        if shrink: sub=cv2.erode(sub,np.ones((3,3),np.uint8))
        m[y0:y1,x0:x1]=np.maximum(m[y0:y1,x0:x1],sub)
    return m
def render(mask,lo,hi):
    y=Y.copy(); y[mask==0]=255; return y
votes=[collections.Counter() for _ in P]
masks={'tight':zone_mask(8.5,5.5,True),'wide':zone_mask(11,7,True)}
runs=[]
for mk in ('tight','wide'):
    for (tw,th,ox,oy,U,sharp,lo,hi) in [(120,80,0,0,6,0,120,222),(120,80,60,40,6,1.0,120,222),(90,60,20,40,8,0,120,222),(90,60,60,10,8,1.5,120,222),(160,110,0,0,5,0,120,222),(160,110,80,55,5,1.0,140,218),(100,70,30,30,7,0.7,150,215),(140,100,40,70,6,1.5,130,220),(70,48,0,0,8,0,120,222),(70,48,35,24,10,1.0,120,222),(200,140,50,30,5,0.5,120,222),(60,40,30,20,10,1.5,135,220)]:
        runs.append((mk,tw,th,ox,oy,U,sharp,lo,hi))
ys0,ys1=int(C[:,1].min())-15,int(C[:,1].max())+15; xs0,xs1=int(C[:,0].min())-20,int(C[:,0].max())+20
for ri,(mk,tw,th,ox,oy,U,sharp,lo,hi) in enumerate(runs):
    base=render(masks[mk],lo,hi); files=[];meta=[]
    for y in range(ys0-oy,ys1,th-16):
        for x in range(xs0-ox,xs1,tw-24):
            x0,y0=max(0,x),max(0,y); x1,y1=min(W,x+tw),min(H,y+th)
            if x1-x0<20 or y1-y0<15: continue
            if not ((C[:,0]>x0)&(C[:,0]<x1)&(C[:,1]>y0)&(C[:,1]<y1)).any(): continue
            u=cv2.resize(base[y0:y1,x0:x1],None,fx=U,fy=U,interpolation=cv2.INTER_CUBIC)
            if sharp: b=cv2.GaussianBlur(u,(0,0),U*0.5); u=u+sharp*(u-b)
            u=(np.clip((u-lo)/(hi-lo),0,1)*255).astype(np.uint8)
            f=f'{tmp}/r{ri}_{x0}_{y0}.png'; cv2.imwrite(f,cv2.merge([u,u,u])); files.append(f); meta.append((x0,y0,U))
    n=0
    for i in range(0,len(files),150):
        subprocess.run(['tools/ocr_files',f'{tmp}/o.json']+files[i:i+150],check=True)
        for (x0,y0,U),obs in zip(meta[i:i+150],json.load(open(f'{tmp}/o.json'))):
            pos=set()
            for o in obs:
                key=(round(o['cx'],1),round(o['cy'],1))
                if key in pos: continue
                pos.add(key)
                t=o['text'].strip().replace('O','0').replace('o','0').replace('l','1').replace('I','1').replace('G','6').replace('S','5').replace('B','8')
                if not t.isdigit() or len(t)>3 or t[0]=='0': continue
                px,py=x0+o['cx']/U,y0+o['cy']/U
                dd=np.hypot(C[:,0]-px,C[:,1]-py); k=int(np.argmin(dd))
                if dd[k]>4.5: continue
                votes[k][t]+=1; n+=1
    print('run',ri,mk,U,sharp,len(files),'tiles, obs',n,'plots with vote',sum(1 for v in votes if v),flush=True)
json.dump([v.most_common() for v in votes],open(f'out/votes_lum_{zid}.json','w'))
top=[v.most_common(1)[0] for v in votes if v]; c=collections.Counter(t for t,w in top)
print('with votes',len(top),'distinct top',len(c),'strong',sum(1 for v in votes if v and v.most_common(1)[0][1]>=4 and (len(v)==1 or v.most_common(2)[0][1]>=2*v.most_common(2)[1][1])))
