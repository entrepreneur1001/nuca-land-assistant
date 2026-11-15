import { compass8, type Frontage } from "@/engine/frontage";
import { COMPASS, t } from "@/i18n/ar";

/** Colours of the main frontage and of any further one: the same on the compass and on the map's highlighted edges. */
export const FRONT_COLORS = ["#06b6d4", "#d946ef"] as const;
export const frontColor = (i: number) => FRONT_COLORS[i === 0 ? 0 : 1];

/**
 * A small compass with one arrow per street side of the plot, pointing the way that side faces. North (بحري) is
 * always up: the bearings are true-north, the same as the map, which never rotates.
 */
export function FrontageCompass({ frontage, size = 104 }: { frontage: Frontage; size?: number }) {
  const c = 50;
  const r = 30;
  const point = (deg: number, d: number) => {
    const a = (deg * Math.PI) / 180;
    return [c + Math.sin(a) * d, c - Math.cos(a) * d] as const;
  };
  const label = frontage.sides.map((s) => COMPASS[compass8(s.bearing)]).join("، ");
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${t.detail.compassTitle}: ${label}`} className="shrink-0">
      <circle cx={c} cy={c} r={r} className="fill-surface-2 stroke-border" strokeWidth={1.5} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => {
        const [x1, y1] = point(d, r);
        const [x2, y2] = point(d, r - (d % 90 ? 3 : 6));
        return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-muted" strokeWidth={d % 90 ? 1 : 1.5} />;
      })}
      {(
        [
          [0, COMPASS[0], 50, 13],
          [90, COMPASS[2], 91, 53.5],
          [180, COMPASS[4], 50, 95],
          [270, COMPASS[6], 9, 53.5],
        ] as const
      ).map(([d, name, x, y]) => (
        <text key={d} x={x} y={y} textAnchor="middle" fontSize={d === 0 ? 10.5 : 9.5} fontWeight={d === 0 ? 700 : 500} className={d === 0 ? "fill-text" : "fill-muted"}>
          {name}
        </text>
      ))}
      {/* Later sides first, so the main frontage's arrow lies on top. */}
      {frontage.sides
        .map((s, i) => ({ s, i }))
        .reverse()
        .map(({ s, i }) => {
          const [tx, ty] = point(s.bearing, r - 7);
          const [lx, ly] = point(s.bearing - 150, 7);
          const [rx, ry] = point(s.bearing + 150, 7);
          return (
            <g key={i}>
              <line x1={c} y1={c} x2={tx} y2={ty} stroke={frontColor(i)} strokeWidth={i === 0 ? 4 : 3} strokeLinecap="round" />
              <polygon
                points={`${tx},${ty} ${tx + (lx - c)},${ty + (ly - c)} ${tx + (rx - c)},${ty + (ry - c)}`}
                fill={frontColor(i)}
                transform={`translate(${(tx - c) * 0.18}, ${(ty - c) * 0.18})`}
              />
            </g>
          );
        })}
      <circle cx={c} cy={c} r={2.5} className="fill-text" />
    </svg>
  );
}
