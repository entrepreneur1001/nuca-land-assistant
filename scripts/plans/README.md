# Zone plan georeferencing (offline)

Turns the official zone plan images (ViewZone.aspx Deep Zoom tiles) into `public/plans/<zid>.{webp,json}` + `index.json`.
Needs macOS (Apple Vision OCR via `swiftc`), Python 3 with `opencv-python-headless` and `numpy`, and a work directory `W`.

```bash
cd W
npx tsx /path/to/repo/scripts/plans/zone_plots.mts zone_plots.json   # plots per official zone from public/dev-snapshot (run from the repo root)
python3 -c "import json; m=json.load(open('public/dev-snapshot/meta.json')); json.dump({z['zid']:{'n':z.get('n'),'city':z['city'],'name':z['name'],'pid':z['pid'],'cityId':z['cityId']} for z in m['official']['zones']}, open('zone_counts.json','w'), ensure_ascii=False)"
swiftc -O -o tools/ocr_files tools/ocr_files.swift
python3 fetch_plans.py plans zones.tsv --all     # zones.tsv: zid, pid, cityId, city, name, flag, sectors (tab-separated)
zsh tools/batch_extract.sh                       # polygons + OCR per plan → plans/zone_<zid>.plots.json
zsh tools/pipeline.sh                            # register (zones with coordinates) → fill digits → export → index
```

Zones without coordinates: `chain.py` (same drawing as a registered neighbour), `match_roads.py` (OpenStreetMap roads from `osm_roads.py`),
`match_sat.py` (satellite edge correlation, only in a tight window around a known point), `georef_master.py` + `pins.py` (city master
plans with a satellite background → project pins), `control.py` (hand control points). Always check with `verify.py` before exporting.
Copy `export/*.webp`, `export/*.json` and `export/index.json` to `public/plans/`.
