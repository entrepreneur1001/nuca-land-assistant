#!/bin/zsh
# Register every extracted zone that has coordinates, export all registered zones, rebuild the index.
cd "$(dirname "$0")/.."
python3 tools/register.py zone_counts.json zone_plots.json plans reg | grep -v SKIP > reg/report.txt
for f in plans/zone_*.plots.json; do z=${${f##*/zone_}%.plots.json}; python3 tools/fill_digits.py plans/zone_$z.jpg $f; done > plans/fill.log 2>&1
for f in reg/[0-9]*.json; do z=${${f##*/}%.json}; python3 tools/export_plan.py plans reg zone_plots.json export $z; done > export/report.txt
python3 tools/build_index.py export zone_plots.json export/index.json
