"""Manual corrections after eyeballing the luminance sheets (out/sheet_*.jpg): solver's number -> printed number."""
import json,collections,numpy as np,cv2
fix={146:149,147:148,148:147,149:146, 169:166,168:165,166:168,165:169, 549:545,548:546,546:548,545:549,
     94:98,93:97,90:96,55:83,54:84,89:95,84:94,83:93,98:55,91:54,97:89,96:90,95:91}
assert sorted(fix)==sorted(fix.values())
A=json.load(open('out/assign_3586.json')); A={k:fix.get(n,n) for k,n in A.items()}
assert sorted(A.values())==list(range(1,617))
json.dump(A,open('out/assign_3586_fixed.json','w'))
d=json.load(open('plans/zone_3586.plots.json')); P=d['plots']; votes=json.load(open('out/votes_comb.json'))
for i,p in enumerate(P):
    n=str(A[str(i)]); ex=sum(w for t,w in votes[i] if t==n); tot=sum(w for t,w in votes[i]) or 1
    p['text']=n; p['conf']=round(min(1.0,0.5+0.5*ex/tot),3); p['cands']=[n]; p['method']='ocr-lum+sequence' if ex else 'sequence'
json.dump(d,open('plans/zone_3586.plots.json','w'))
# continuity report
S=3; L=np.zeros((d['height']*S,d['width']*S),np.int32)
for i,p in enumerate(P): cv2.fillPoly(L,[np.round(np.array(p['poly'])*S).astype(np.int32)],i+1)
adj=collections.defaultdict(set)
cnt=collections.Counter()
for dx,dy in ((5,0),(0,5),(4,4),(4,-4)):
    a=L[max(0,-dy):L.shape[0]-max(0,dy), :L.shape[1]-dx]; b=L[max(0,dy):L.shape[0]-max(0,-dy), dx:]
    m=(a!=b)&(a>0)&(b>0)
    for x,y in zip(a[m],b[m]): cnt[(min(x,y)-1,max(x,y)-1)]+=1
for (i,j),c in cnt.items():
    if c>=24: adj[i].add(j); adj[j].add(i)
pos={int(p['text']):i for i,p in enumerate(P)}
iso=[n for n,i in pos.items() if not any(m in pos and pos[m] in adj[i] for m in (n-1,n+1))]
one=[n for n,i in pos.items() if sum(m in pos and pos[m] in adj[i] for m in (n-1,n+1))==1]
print('isolated numbers',sorted(iso)); print('numbers with only one consecutive neighbour (row ends)',len(one),sorted(one))
print('exact OCR support',sum(1 for p in P if p['method']!='sequence'),'/',len(P))
