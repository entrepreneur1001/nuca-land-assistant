"""Diagnose a registration: similarity vs 6-param affine fit of polygon centroids to the plots' OLD coordinates, area ratio, plot size.
usage: python3 diag.py <work dir> <zid>..."""
import sys, json, math, numpy as np
from collections import Counter
R=6378137.0
def merc(lat,lng): return R*math.radians(lng), R*math.log(math.tan(math.pi/4+math.radians(lat)/2))
def parea(p):
    p=np.array(p,float);x,y=p[:,0],p[:,1];return abs(np.dot(x,np.roll(y,1))-np.dot(y,np.roll(x,1)))/2
W=sys.argv[1]; zp=json.load(open(f"{W}/zone_plots.json"))
for z in sys.argv[2:]:
    reg=json.load(open(f"{W}/reg/{z}.json")); polys=json.load(open(f"{W}/plans/zone_{z}.plots.json"))["plots"]
    byid={p["id"]:p for p in zp[z]["plots"]}; M=np.array(reg["affine"])
    P=[];Q=[];rat=[];dims=[];ar=[]
    for pid,i in reg["assign_ids"].items():
        o=byid.get(pid)
        if not o: continue
        poly=np.array(polys[i]["poly"],float); c=poly.mean(0)
        P.append(c); Q.append(merc(o["lat"],o["lng"])); 
        if o.get("area"): rat.append(parea(poly)/o["area"]); ar.append(o["area"])
        (cx,cy),(w,h),a=__import__("cv2").minAreaRect(poly.astype(np.float32)); dims.append(sorted([w,h]))
    P=np.array(P);Q=np.array(Q); lat=math.degrees(2*math.atan(math.exp(Q[:,1].mean()/R))-math.pi/2); k=math.cos(math.radians(lat))
    s=reg["scale_m_per_px"]
    res=(P@M[:,:2].T+M[:,2])-Q; 
    A=np.hstack([P,np.ones((len(P),1))]); X,_,_,_=np.linalg.lstsq(A,Q,rcond=None); r2=A@X-Q
    L=X[:2].T; sv=np.linalg.svd(L,compute_uv=False)
    rat=np.array(rat); dims=np.array(dims)
    print(f"== {z} {zp[z]['city']} | {zp[z]['name']}  lat {lat:.3f} cos {k:.4f}  n={len(P)}")
    print(f"  sim: scale merc {s:.4f} ground {s*k:.4f} m/px  rms(merc) {np.sqrt((res**2).sum(1).mean()):.2f} med {np.median(np.hypot(*res.T)):.2f}")
    print(f"  affine6: sing vals {sv[0]:.4f},{sv[1]:.4f} (aniso {sv[0]/sv[1]:.3f}) rms {np.sqrt((r2**2).sum(1).mean()):.2f}; cols |x|={np.hypot(*L[:,0]):.4f} |y|={np.hypot(*L[:,1]):.4f}")
    print(f"  area ratio ground: med {np.median(rat)*(s*k)**2:.3f} iqr {np.percentile(rat,25)*(s*k)**2:.3f}-{np.percentile(rat,75)*(s*k)**2:.3f}; ground scale for ratio 1.0: {math.sqrt(1/np.median(rat)):.4f}")
    print(f"  official areas: {Counter(ar).most_common(6)}")
    print(f"  plot dims px (median short,long): {np.median(dims,0)} -> m {np.median(dims,0)*s*k}")
    # old coordinate lattice: nearest neighbour distance among old coords vs among centroids
    from scipy.spatial import cKDTree
    dq=cKDTree(Q).query(Q,2)[0][:,1]*k; dp=cKDTree(P).query(P,2)[0][:,1]
    print(f"  NN pitch: old coords {np.median(dq):.1f} m ground; plan {np.median(dp):.1f} px -> implied ground scale {np.median(dq)/np.median(dp):.4f}")
    print(f"  old coord decimals sample: {[ (o['lat'],o['lng']) for o in list(byid.values())[:3]]}")
