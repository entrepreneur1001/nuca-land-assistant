#!/bin/zsh
# Low-resolution plans (2048 px, ~6 px digits): read numbers from upscaled tiles, re-segment, resolve, audit, export.
# usage: run_lowres.sh <work dir with plans/ reg/ zone_plots.json> <out dir> <zid>...   (tools in the same dir as this script)
T=${0:A:h}; W=$1; O=$2; shift 2
[ -x $T/ocr_tokens ] || swiftc -O -o $T/ocr_tokens $T/ocr_tokens.swift
mkdir -p $O/tok $O/seg $O/plans $O/export
for z in "$@"; do
  [ -f $O/tok/$z.json ] || python3 $T/read_tiles.py $W/plans/zone_$z.jpg $W/plans/zone_$z.plots.json $O/tok/$z.json
  python3 $T/segment.py $W/plans/zone_$z.jpg $W/plans/zone_$z.plots.json $O/tok/$z.json $O/seg/zone_$z.plots.json --fix $T/fixes.json
  python3 $T/resolve.py $O/seg/zone_$z.plots.json $O/tok/$z.json $W/zone_plots.json $W/reg/$z.json $z $O/plans/zone_$z.plots.json --fix $T/fixes.json
  cp $W/plans/zone_$z.jpg $O/plans/
  python3 $T/export_plan.py $O/plans $W/reg $W/zone_plots.json $O/export $z
done
