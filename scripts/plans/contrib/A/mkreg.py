"""Build reg/3795.json and reg/3586.json (chained) from: ground scale (m/px of 3795), rotation (deg CCW), anchor plan px (3795) -> merc.
usage: mkreg.py <ground_scale> <rot_deg> <px> <py> <mercX> <mercY>"""
import sys,json,math,numpy as np
gs,rot,px,py,mx,my=map(float,sys.argv[1:7])
lat=math.degrees(2*math.atan(math.exp(my/6378137.0))-math.pi/2); k=1/math.cos(math.radians(lat)); s=gs*k
t=math.radians(rot); A=s*np.array([[math.cos(t),math.sin(t)],[math.sin(t),-math.cos(t)]])
c=np.array([mx,my])-A@np.array([px,py]); M=np.hstack([A,c[:,None]])
B2A=np.array(json.load(open('out/b2a.json'))['M'])
MB=(np.vstack([M,[0,0,1]])@np.vstack([B2A,[0,0,1]]))[:2]
import os; os.makedirs('reg',exist_ok=True)
for zid,m,how in ((3795,M,'control:fork+corridor+area-scale'),(3586,MB,'chain:3795')):
    sc=math.sqrt(abs(np.linalg.det(m[:,:2])))
    json.dump({'zid':zid,'affine':m.tolist(),'scale_m_per_px':sc,'rotation_deg':rot,'rms_m':None,'matched':0,'polygons':0,'located':0,'assign':{},'how':how,'ground_scale_m_per_px':sc/k},open(f'reg/{zid}.json','w'))
    print(zid,'merc scale',round(sc,4),'ground',round(sc/k,4))
