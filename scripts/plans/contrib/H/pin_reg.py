"""Write a re-anchored registration: similarity from ground scale (m/px), rotation and one pinned point (plan px -> Mercator m).
Keeps the polygon<->plot assignment of the old reg; reports the plot-centroid shift and the new area ratio.
usage: python3 pin_reg.py <work dir> <zid> <ground m/px> <rot deg> <plan x> <plan y> <merc x> <merc y> <out reg.json> <note>"""
import sys, json, math, numpy as np
R=6378137.0
Wd,zid=sys.argv[1:3]; gs,rot,px,py,mx,my=map(float,sys.argv[3:9]); out,note=sys.argv[9:11]
r=json.load(open(f"{Wd}/reg/{zid}.json")); M0=np.array(r["affine"])
lat=math.degrees(2*math.atan(math.exp(my/R))-math.pi/2); k=math.cos(math.radians(lat)); sm=gs/k
c,s=math.cos(math.radians(rot)),math.sin(math.radians(rot)); L=sm*np.array([[c,s],[s,-c]]); M=np.hstack([L,(np.array([mx,my])-L@np.array([px,py]))[:,None]])
polys=json.load(open(f"{Wd}/plans/zone_{zid}.plots.json"))["plots"]; zp={p["id"]:p for p in json.load(open(f"{Wd}/zone_plots.json"))[zid]["plots"]}
def parea(p):
    p=np.array(p,float);x,y=p[:,0],p[:,1];return abs(np.dot(x,np.roll(y,1))-np.dot(y,np.roll(x,1)))/2
C=np.array([np.mean(p["poly"],0) for p in polys]); d=((C@M[:,:2].T+M[:,2])-(C@M0[:,:2].T+M0[:,2]))*k; sh=np.hypot(*d.T)
rat=[parea(polys[i]["poly"])*gs*gs/zp[pid]["area"] for pid,i in r["assign_ids"].items() if zp.get(pid,{}).get("area")]
r.update(prev_how=r.get("how"),prev_affine=r["affine"],prev_scale_m_per_px=r["scale_m_per_px"],how="roads-visual",affine=M.tolist(),scale_m_per_px=sm,rotation_deg=rot,rms_m=None,
         area_ratio_ground=float(np.median(rat)),centroid_shift_m={"median":float(np.median(sh)),"min":float(sh.min()),"max":float(sh.max())},note=note)
r.pop("area_ratio",None); r.pop("tol_m",None)
json.dump(r,open(out,"w"),ensure_ascii=False)
print(zid,f"scale merc {r['prev_scale_m_per_px']:.4f}->{sm:.4f} ground {r['prev_scale_m_per_px']*k:.4f}->{gs:.4f}; area ratio {np.median(rat):.3f}; centroid shift m median {np.median(sh):.0f} min {sh.min():.0f} max {sh.max():.0f}")
