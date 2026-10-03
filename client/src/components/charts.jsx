import React, { useId } from "react";

// Chart primitives shared by the landing page and the signed-in workspace. One implementation,
// imported by both, so the public page and the dashboard cannot drift into drawing the same
// thing two different ways.

/**
 * A line over a soft area fill, drawn from a short series of numbers. Deliberately not a charting
 * library: this plots a handful of points and a dependency would cost more than it saves.
 *
 * `animate` draws the line left to right on first paint; the global prefers-reduced-motion rule
 * collapses that to nothing.
 */
export function Trajectory({ points, width = 268, height = 72, animate = true, className = "" }) {
  const gradientId = useId();
  if (!points || points.length < 2) return null;

  const min = Math.min(...points) - 3;
  const max = Math.max(...points) + 3;
  const span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * (width - 8) + 4;
  const y = (v) => height - 8 - ((v - min) / span) * (height - 20);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;

  return <svg className={`ld-traj ${animate ? "ld-traj--draw" : ""} ${className}`}
    viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    role="img" aria-label={`Trend: ${points.join(", then ")}`}>
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--ld-accent,var(--blue))" stopOpacity=".22"/>
        <stop offset="100%" stopColor="var(--ld-accent,var(--blue))" stopOpacity="0"/>
      </linearGradient>
    </defs>
    <path className="ld-traj__area" d={area} fill={`url(#${gradientId})`}/>
    <path className="ld-traj__line" d={path} fill="none"/>
    {points.map((v, i) => <circle key={i}
      className={i === points.length - 1 ? "ld-traj__dot ld-traj__dot--last" : "ld-traj__dot"}
      cx={x(i)} cy={y(v)} r={i === points.length - 1 ? 3.5 : 2}/>)}
  </svg>;
}
