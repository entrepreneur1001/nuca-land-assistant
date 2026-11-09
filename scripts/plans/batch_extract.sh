#!/bin/zsh
# Extract polygons for every downloaded zone plan that has no plots.json yet; keeps polling while the downloader runs.
cd "$(dirname "$0")/.."
while true; do
  for f in plans/zone_*.jpg; do
    zid=${${f##*/zone_}%.jpg}
    [[ "$zid" == *_* || "$zid" == *.* ]] && continue
    [[ -f plans/zone_$zid.plots.json ]] && continue
    n=$(python3 -c "import json,sys; print(json.load(open('zone_counts.json')).get('$zid',{}).get('n') or 0)")
    python3 tools/extract.py "$f" plans/zone_$zid.plots.json --expect $n >> plans/extract.log 2>&1 || echo "FAIL $zid" >> plans/extract.log
  done
  pgrep -f fetch_plans.py >/dev/null || break
  sleep 60
done
echo BATCH-DONE >> plans/extract.log
