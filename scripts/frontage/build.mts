/**
 * Which way every plot drawn on an official zone plan faces («اتجاه الواجهة»): the compass direction of each side of
 * its outline that lies on a street. Feeds the plot page and the "orientation" factor (src/engine/frontage.ts).
 *   npx tsx scripts/frontage/build.mts [--zone <zid>[,<zid>…]] [--stats] [--debug]
 * Inputs: public/plans/<zid>.json (plot outlines, georeferenced corners) and public/plans/<zid>.webp (the plan
 * drawing: streets are grey, so the street next to a side is read off the plan itself; OpenStreetMap has almost
 * none of these internal streets), scripts/frontage/north.json (the official north arrow per zone, from
 * north_check.py; optional), public/dev-snapshot (the official corner premium per plot; optional).
 * Writes public/frontage.json:
 *   { v: 1, generated, plots: { <plotId>: [confidence 0|1|2, [[bearingDeg, fromVertex, toVertex, streetWidthM], …]] } }
 * confidence 2 = high, 1 = medium, 0 = not determined (no sides). Vertex indices refer to the plot's polygon in
 * public/plans/<zid>.json. Plots missing from the file have no outline. Re-run after the plans change.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { unpackTuples } from "@/data/snapshot";
import { compass8, isCornerPlot, plotFrontage, type Frontage, type Ground } from "@/engine/frontage";
import { boxOf, projector, type Blocker, type XY } from "@/engine/surroundings";
import { imagePointToLatLng, loadPlanFiles, type PlanZoneFile } from "@/ingest/plan-places";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "frontage.json");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const onlyZones = opt("--zone")?.split(",");

/** Zones placed approximately (scripts/plans/README.md): their directions are never "high". */
const APPROXIMATE = new Set([3611, 3698, 3699, 3795, 3586, 4817, 4804, 3585, 3581]);
/** The official north arrow may differ from the registration by this much (the arrow icon is small). */
const NORTH_TOLERANCE_DEG = 12;
/** A plan whose street grey covers less than this share of the drawing does not use the usual colours. */
const MIN_ROAD_SHARE = 0.01;

type ZoneFile = PlanZoneFile & { unassigned?: [number, number][][] };
const files = loadPlanFiles() as ZoneFile[];

// ---------- the official north arrow (north_check.py) ----------
const northFile = path.join(ROOT, "scripts", "frontage", "north.json");
const north: Record<string, { arrowDeg: number | null; regDeg: number; diffDeg: number | null }> = existsSync(northFile) ? JSON.parse(readFileSync(northFile, "utf8")) : {};
const northAgrees = (zid: number) => {
  const n = north[String(zid)];
  return !!n && n.diffDeg != null && Math.abs(n.diffDeg) <= NORTH_TOLERANCE_DEG;
};

// ---------- the official corner premium ----------
const corner = new Map<string, boolean>();
const snapDir = path.join(ROOT, "public", "dev-snapshot");
if (existsSync(snapDir))
  for (const n of readdirSync(snapDir)) {
    if (!/^c\d+\.json$/.test(n)) continue;
    const d = JSON.parse(readFileSync(path.join(snapDir, n), "utf8")) as { data: string };
    for (const t of await unpackTuples(d.data)) corner.set(t[0], t[10] > 0);
  }
console.log(`${files.length} zones, corner premium known for ${corner.size} plots, north arrow read for ${Object.values(north).filter((n) => n.diffDeg != null).length} zones`);

// ---------- the plan drawing ----------
function ground(r: number, g: number, b: number): Ground {
  if (r > 225 && g > 215 && b < 140) return "plot"; // the offered plots are yellow
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  if (hi - lo <= 14) {
    const v = (r + g + b) / 3;
    if (v >= 170 && v <= 216) return "road"; // streets: grey ≈ 196
    if (v >= 218 && v <= 243) return "pale"; // the same streets faded, outside the zone
    return "other";
  }
  if (g > r + 6 && g > b + 15) return "green";
  if (r >= 185 && r <= 240 && r - g >= 12 && r - g <= 45 && g - b >= 4 && g - b <= 30 && b >= 130) return "pave"; // pavements: tan ≈ 213,183,170
  return "other";
}

// ---------- measure ----------
const prev = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as { v: number; plots: Record<string, [number, number[][]]> }) : null;
const rows: Record<string, [number, number[][]]> = onlyZones && prev?.v === 1 ? { ...prev.plots } : {};
const stats = { plots: 0, high: 0, medium: 0, none: 0, corners: 0, cornerKnown: 0, cornerAgree: 0, byDirection: [0, 0, 0, 0, 0, 0, 0, 0] };
const zoneNotes: string[] = [];

const centreOf = (f: ZoneFile) => imagePointToLatLng(f, f.w / 2, f.h / 2);
for (const f of files) {
  if (onlyZones && !onlyZones.includes(String(f.zid))) continue;
  const image = path.join(ROOT, "public", "plans", `${f.zid}.webp`);
  if (!existsSync(image)) {
    zoneNotes.push(`zone ${f.zid}: no plan image, skipped`);
    continue;
  }
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / f.w;
  const sy = info.height / f.h;
  let roadPx = 0;
  for (let i = 0; i < data.length; i += 3 * 7) if (ground(data[i], data[i + 1], data[i + 2]) === "road") roadPx++;
  const roadColour = roadPx / (data.length / (3 * 7)) >= MIN_ROAD_SHARE;

  // Plan pixels ↔ local metres (x east, y north): affine, as the plan itself is placed.
  const [lat0] = centreOf(f);
  const P = projector(lat0);
  const o = P(imagePointToLatLng(f, 0, 0));
  const ex = P(imagePointToLatLng(f, f.w, 0));
  const ey = P(imagePointToLatLng(f, 0, f.h));
  const ax = (ex[0] - o[0]) / f.w;
  const ay = (ex[1] - o[1]) / f.w;
  const bx = (ey[0] - o[0]) / f.h;
  const by = (ey[1] - o[1]) / f.h;
  const det = ax * by - bx * ay;
  const toM = ([x, y]: [number, number]): XY => [o[0] + ax * x + bx * y, o[1] + ay * x + by * y];
  const probe = (mx: number, my: number): Ground => {
    const dx = mx - o[0];
    const dy = my - o[1];
    const px = Math.round(((by * dx - bx * dy) / det) * sx);
    const py = Math.round(((ax * dy - ay * dx) / det) * sy);
    if (px < 0 || py < 0 || px >= info.width || py >= info.height) return "other";
    const i = (py * info.width + px) * 3;
    return ground(data[i], data[i + 1], data[i + 2]);
  };

  // Blockers: every shape of this plan and of the plans next to it (neighbouring zones share streets).
  const blockers = new Map<string, Blocker>();
  const add = (key: string, poly: XY[]) => poly.length >= 3 && blockers.set(key, { poly, box: boxOf(poly) });
  for (const [id, poly] of Object.entries(f.plots)) add(id, poly.map(toM));
  (f.unassigned ?? []).forEach((poly, i) => add(`u${i}`, poly.map(toM)));
  const zb = boxOf([toM([0, 0]), toM([f.w, 0]), toM([0, f.h]), toM([f.w, f.h])]);
  for (const g of files) {
    if (g.zid === f.zid) continue;
    const gb = boxOf([[0, 0], [g.w, 0], [0, g.h], [g.w, g.h]].map(([x, y]) => P(imagePointToLatLng(g, x, y))));
    if (gb.x0 > zb.x1 || zb.x0 > gb.x1 || gb.y0 > zb.y1 || zb.y0 > gb.y1) continue;
    for (const [id, poly] of Object.entries(g.plots)) if (!blockers.has(id)) add(id, poly.map(([x, y]) => P(imagePointToLatLng(g, x, y))));
  }

  const trusted = !APPROXIMATE.has(f.zid) && northAgrees(f.zid);
  const zone = { plots: 0, high: 0, medium: 0, none: 0 };
  const debug: { id: string; ring: XY[]; f: Frontage }[] = [];
  for (const [id, poly] of Object.entries(f.plots)) {
    if (poly.length < 3) continue;
    const ring = poly.map(toM);
    const others = [...blockers].filter(([k]) => k !== id).map(([, b]) => b);
    const fr = plotFrontage(ring, probe, others, { trusted, roadColour, corner: corner.get(id) ?? null });
    rows[id] = [fr.conf, fr.sides.map((s) => [s.bearing, s.from, s.to, s.widthM])];
    zone.plots++;
    if (fr.conf === 2) zone.high++;
    else if (fr.conf === 1) zone.medium++;
    else zone.none++;
    if (fr.conf > 0) {
      stats.byDirection[compass8(fr.sides[0].bearing)]++;
      if (isCornerPlot(fr)) stats.corners++;
      if (corner.has(id)) {
        stats.cornerKnown++;
        if (corner.get(id) === isCornerPlot(fr)) stats.cornerAgree++;
      }
    }
    if (flag("--debug")) debug.push({ id, ring, f: fr });
  }
  stats.plots += zone.plots;
  stats.high += zone.high;
  stats.medium += zone.medium;
  stats.none += zone.none;
  const why = [APPROXIMATE.has(f.zid) ? "approximate placement" : "", !northAgrees(f.zid) ? "north arrow not confirmed" : "", !roadColour ? "no street colour" : ""].filter(Boolean).join(", ");
  process.stdout.write(`zone ${f.zid}: ${zone.plots} plots, high ${zone.high}, medium ${zone.medium}, not determined ${zone.none}${why ? ` (${why})` : ""}\n`);
  if (flag("--debug")) {
    const dir = path.join(ROOT, "data", "frontage", "debug");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${f.zid}.json`), JSON.stringify({ zid: f.zid, trusted, roadColour, plots: debug }));
  }
}
for (const n of zoneNotes) console.warn(n);

writeFileSync(OUT, JSON.stringify({ v: 1, generated: new Date().toISOString(), plots: rows }));
if (flag("--stats") || !onlyZones) {
  const names = ["بحري", "بحري شرقي", "شرقي", "قبلي شرقي", "قبلي", "قبلي غربي", "غربي", "بحري غربي"];
  console.log({ ...stats, byDirection: Object.fromEntries(names.map((n, i) => [n, stats.byDirection[i]])) });
  if (stats.cornerKnown) console.log(`corner agreement with the official premium: ${((100 * stats.cornerAgree) / stats.cornerKnown).toFixed(1)} % of ${stats.cornerKnown} determined plots`);
}
console.log(`wrote ${path.relative(ROOT, OUT)} (${Math.round(readFileSync(OUT).length / 1024)} KB)`);
