"""Assign plot numbers 1..N to polygons from noisy OCR votes + the plans' numbering continuity (n and n±1 are usually
adjacent plots): similarity-weighted votes, belief passing between adjacent plots, then a one-to-one assignment.
usage: python3 solve4.py <zid> <votes.json> [lambda=0.6] [rounds=4]"""
import json,numpy as np,collections,cv2,sys
from scipy.optimize import linear_sum_assignment
zid=sys.argv[1]; d=json.load(open(f'plans/zone_{zid}.plots.json')); P=d['plots']; N=len(P)
votes=json.load(open(sys.argv[2])); lam=float(sys.argv[3]) if len(sys.argv)>3 else 0.6; R=int(sys.argv[4]) if len(sys.argv)>4 else 4
S=3; L=np.zeros((d['height']*S,d['width']*S),np.int32)
for i,p in enumerate(P): cv2.fillPoly(L,[np.round(np.array(p['poly'])*S).astype(np.int32)],i+1)
adjc=collections.Counter()
for dx,dy in ((5,0),(0,5),(4,4),(4,-4)):
    a=L[max(0,-dy):L.shape[0]-max(0,dy), :L.shape[1]-dx]; b=L[max(0,dy):L.shape[0]-max(0,-dy), dx:]
    m=(a!=b)&(a>0)&(b>0)
    for x,y in zip(a[m],b[m]): adjc[(min(x,y)-1,max(x,y)-1)]+=1
adj=[[] for _ in range(N)]
for (i,j),c in adjc.items():
    if c>=8*S: adj[i].append(j); adj[j].append(i)
conf={frozenset(p) for p in [('0','9'),('0','8'),('0','6'),('8','9'),('8','6'),('8','3'),('3','9'),('5','6'),('5','3'),('1','7'),('6','9'),('5','9'),('1','4'),('2','7'),('0','5'),('3','5'),('0','3'),('2','3'),('4','9')]}
def sim(t,n):
    if t==n: return 1.0
    if len(t)==len(n)-1 and (n.endswith(t) or n.startswith(t)): return 0.4
    if len(t)==len(n):
        df=[(a,b) for a,b in zip(t,n) if a!=b]
        if len(df)==1: return 0.4 if frozenset(df[0]) in conf else 0.12
    return 0.0
strs=[str(n) for n in range(1,N+1)]
W=np.zeros((N,N))
for k,v in enumerate(votes):
    tot=sum(w for t,w in v) or 1
    for t,w in v:
        for n in range(N):
            s=sim(t,strs[n])
            if s: W[k,n]+=w*s
    W[k]/=max(tot,6)      # normalise: fraction of reads supporting n (few reads -> weak)
def shift(M):  # max of M[:,n-1], M[:,n+1]
    out=np.zeros_like(M); out[:,1:]=M[:,:-1]; out[:,:-1]=np.maximum(out[:,:-1],M[:,1:]); return out
B=W.copy()
for r in range(R):
    Sh=shift(B); nb=np.zeros_like(W)
    for k in range(N):
        if adj[k]: nb[k]=np.max(Sh[adj[k]],axis=0)
    B=W+lam*nb*(0.3+W>0)   # neighbours can also propose numbers with no local vote (factor>0 always)
    B/=B.max(1,keepdims=True)+1e-9
r_,c_=linear_sum_assignment(-(B+0.5*W)); num=c_+1
num=list(map(int,num))
adjs=[set(a) for a in adj]
def links(k,n,pos):
    c=0
    for m in (n-1,n+1):
        j=pos.get(m)
        if j is not None and j in adjs[k]: c+=1
    return c
pos={n:k for k,n in enumerate(num)}
def local(k,n,pos): return links(k,n,pos)+2.0*W[k,n-1]
def energy_around(ks,pos):
    # plots whose link count may change: ks, and holders of n±1 of their numbers
    aff=set(ks)
    for k in ks:
        for m in (num[k]-1,num[k]+1):
            if m in pos: aff.add(pos[m])
    return aff
improved=True; rounds=0; nsw=0
while improved and rounds<30:
    improved=False; rounds+=1
    for k in range(N):
        n=num[k]
        if links(k,n,pos)==2 and W[k,n-1]>0.5: continue
        # candidate numbers for k: neighbours' numbers ±1, and voted numbers
        cand=set()
        for j in adjs[k]: cand|={num[j]-1,num[j]+1}
        cand|={int(c)+1 for c in np.where(W[k]>0.25)[0]}
        best=(1e-6,None)
        for m in cand:
            if m<1 or m>N or m==n: continue
            j=pos[m]
            aff=set([k,j])
            for q in (n-1,n+1,m-1,m+1):
                if q in pos: aff.add(pos[q])
            e0=sum(local(a,num[a],pos) for a in aff)
            num[k],num[j]=m,n; pos[m]=k; pos[n]=j
            e1=sum(local(a,num[a],pos) for a in aff)
            num[k],num[j]=n,m; pos[n]=k; pos[m]=j
            if e1-e0>best[0]: best=(e1-e0,m)
        if best[1] is not None:
            m=best[1]; j=pos[m]; num[k],num[j]=m,n; pos[m]=k; pos[n]=j; improved=True; nsw+=1
print('repair rounds',rounds,'swaps',nsw)
num=np.array(num)
inv={int(n):k for k,n in enumerate(num)}
iso=[k for k in range(N) if not any((m in inv and inv[m] in adj[k]) for m in (num[k]-1,num[k]+1))]
both=[k for k in range(N) if all((m in inv and inv[m] in adj[k]) for m in (num[k]-1,num[k]+1) if 1<=m<=N)]
exact=np.array([sum(w for t,w in votes[k] if t==strs[num[k]-1]) for k in range(N)])
topag=sum(1 for k in range(N) if votes[k] and votes[k][0][0]==strs[num[k]-1])
print('isolated',len(iso),'both-neighbours',len(both),'no exact vote',int((exact==0).sum()),'top-vote agree',topag)
json.dump({str(k):int(n) for k,n in enumerate(num)},open(f'out/assign_{zid}.json','w'))
json.dump({'iso':iso,'noexact':np.where(exact==0)[0].tolist(),'both':both},open(f'out/flags_{zid}.json','w'))
