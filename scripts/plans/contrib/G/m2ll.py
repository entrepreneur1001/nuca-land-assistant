"""merc x y -> 'lat lng' (helper).  usage: python3 m2ll.py x y"""
import sys, math
R=6378137.0; x,y=map(float,sys.argv[1:3]); print(f"{math.degrees(2*math.atan(math.exp(y/R))-math.pi/2):.6f} {math.degrees(x/R):.6f}")
