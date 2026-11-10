# Compounds layer (Nawy outlines, logos and master plans)

Builds `public/compounds/` (`index.json`, `img/<id>.webp`, `logo/<devId>.webp`) from Nawy's compound list. Raw
downloads live in `data/compounds/` (gitignored). Python 3.9 with `opencv-python-headless`, `numpy`, `Pillow`.
Scripts that read downloaded files are run with `python3 -I` (they add the user's site-packages themselves).

```bash
python3 scripts/compounds/fetch_nawy.py data/compounds list      # outlines, names, prices, developer logos (urls)
python3 scripts/compounds/fetch_nawy.py data/compounds detail    # master-plan url per compound (one page each, paced)
python3 scripts/compounds/fetch_nawy.py data/compounds images    # master-plan images → data/compounds/master/<id>.*
python3 scripts/compounds/build_compounds.py data/compounds public/compounds --all-images   # export every image (for fitting)
python3 scripts/compounds/fit_master.py data/compounds public/compounds data/compounds/fits.json   # outline fit (prior only)
python3 -I scripts/compounds/loop.py data/compounds public/compounds --jobs 4 --near-only   # street matching, near NUCA land first
python3 -I scripts/compounds/loop.py data/compounds public/compounds --jobs 4               # then everything else (resumable)
# look at data/compounds/previews/ambiguous_<id>.jpg (and a sample of verified_<id>.jpg); record decisions in reviewed.json
python3 scripts/compounds/build_compounds.py data/compounds public/compounds               # publish checked plans only
npx vitest run tests/compounds-data.test.ts
```

## Placement and what is published

- `place_compound.py` matches the plan's streets (grey asphalt or white roads on the drawing, reduced to centre lines)
  against Google's road map (zoom 16, labels off, tiles cached in `data/compounds/gtiles`) around Nawy's outline,
  over all turns, the scale within ±25 % of the outline's (drawings that fill their frame: 45–115 % of the frame
  laid over the outline), the drawing covering ≥ 70 % of the outline. It reports `score` (normalised correlation),
  `ratio` (best over the best clearly different placement), corners `{tl, tr, bl}` and the clip (outline in image
  pixels, cut to the image box). Method adapted from `scripts/plans/past/place_g.py`.
- `loop.py` keeps its state in `data/compounds/place.json` (`status`: `verified` when the rule below holds,
  `ambiguous`, `fail`) and writes previews to `data/compounds/previews/<status>_<id>.jpg`: Google's roads with the
  plan, the plan with Google's roads in red, the plan over the Esri satellite; Nawy's outline in yellow.
- `reviewed.json` holds decisions by eye: `"reject"` (seen not to fit, or no site plan: always hidden), `"hide"`
  (the earlier review could not place it: hidden unless the matcher now verifies it), or `{corners, clip, check}`
  with `check` `"ground"` (checked against the satellite earlier), `"eye"` (accepted from a preview) or `"unbuilt"`
  (kept for later, not published); its clip is in exported-image pixels. A `ground`/`eye` entry wins over the matcher.
- `build_compounds.py` publishes a plan only with `plan.status` `"verified"` or `"reviewed"`; all other compounds
  keep their outline (and `devId`/`devLogo`) with `plan: null`, `img: false`.
- Verification rule (`is_clear` in `place_compound.py`), set on the 82 earlier ground-checked compounds: a clearly
  different runner-up was found and loses (score ≥ 0.4 and ratio ≥ 1.15 as for the past plans, or score ≥ 0.12 and
  ratio ≥ 1.4), Google maps streets inside the outline (`gdens` ≥ 0.03: unbuilt sites have none, and then nothing
  can be verified), and ≥ 45 % of the plan's street centre lines lie within 10 m of Google's (`precision`). On the
  calibration set every accepted placement agreed with the ground check within 60 m (one disagreement, 410, was
  the old check being 120 m off). The raw score runs lower than for the zone plans (brochure streets are noisier).
- Older tools: `align.py` (satellite edges, weak), `review.py` (candidate sheets), `control.py` (hand control points).

Nawy's terms forbid automated collection without permission; fetching is run rarely, one request at a time, by the
owner's decision.
