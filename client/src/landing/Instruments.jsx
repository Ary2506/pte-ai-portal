import React from "react";
import { useCountUp } from "./motion.js";

// The landing page's visual vocabulary. Everything here is a READOUT — a thing that displays a
// measurement — rather than an illustration. That is the whole concept: the page should look like
// the product's instrumentation, so a visitor infers "this measures my English precisely" from
// the interface itself instead of from a sentence claiming it.
//
// Every number these render is passed in by the caller and is sample data, labelled as such where
// it is shown. Nothing here invents a statistic.

/** A small uppercase mono label. The page's single labelling system — used for every annotation. */
export function Label({ children, tone = "default", as: Tag = "span" }) {
  return <Tag className={`ld-label ld-label--${tone}`}>{children}</Tag>;
}

/**
 * The hero's primary number. Counts up on mount, rendered in tabular mono so the digits do not
 * jitter in width while it climbs.
 */
export function BigScore({ value, outOf = 90, animate = true }) {
  const shown = useCountUp(value, { start: animate, duration: 1400 });
  return <div className="ld-bigscore">
    <span className="ld-bigscore__value" aria-hidden="true">{shown}</span>
    <span className="ld-bigscore__outof" aria-hidden="true">/{outOf}</span>
    <span className="sr-only">Overall score {value} out of {outOf}</span>
  </div>;
}

/**
 * One PTE section's score: name, value, and a bar that fills to its proportion of `outOf`.
 * The fill is a CSS transition driven by a custom property, so it costs nothing to animate.
 */
export function SectionMeter({ name, value, outOf = 90, section, delay = 0, animate = true }) {
  const shown = useCountUp(value, { start: animate, duration: 1200 });
  return <div className="ld-meter" style={{ "--ld-delay": `${delay}ms` }} data-section={section}>
    <span className="ld-meter__name">{name}</span>
    <span className="ld-meter__track" aria-hidden="true">
      <span className="ld-meter__fill" style={{ "--ld-pct": animate ? `${(value / outOf) * 100}%` : "0%" }}/>
    </span>
    <span className="ld-meter__value num-mono" aria-hidden="true">{shown}</span>
    <span className="sr-only">{name} {value} out of {outOf}</span>
  </div>;
}

// Shared with the signed-in workspace — one implementation in components/charts.jsx, re-exported
// here so this module stays the landing page's single instrument vocabulary.
export { Trajectory } from "../components/charts.jsx";

/**
 * Speaking's signature: an audio waveform. Bar heights come from a fixed seed rather than
 * Math.random, so the shape is stable across renders and identical in every snapshot — a
 * waveform that reshuffles on every re-render reads as noise, not as a recording.
 */
const WAVE_SEED = [
  18, 34, 52, 71, 44, 88, 63, 97, 55, 38, 72, 91, 46, 29, 64, 83, 51, 95, 68, 41,
  77, 58, 86, 35, 62, 93, 47, 70, 25, 59, 81, 44, 66, 90, 37, 54, 75, 48, 28, 61
];
export function Waveform({ bars = 40, live = false, className = "" }) {
  return <div className={`ld-wave ${live ? "ld-wave--live" : ""} ${className}`} aria-hidden="true">
    {WAVE_SEED.slice(0, bars).map((h, i) => <span key={i} className="ld-wave__bar"
      style={{ "--ld-h": `${h}%`, "--ld-i": i }}/>)}
  </div>;
}

/** Reading's signature: text reduced to its rhythm, with one line marked as the answer span. */
export function ScanLines({ rows = 6, highlight = 3 }) {
  const widths = [100, 88, 94, 72, 97, 61, 84, 90];
  return <div className="ld-scan" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => <span key={i}
      className={i === highlight ? "ld-scan__line ld-scan__line--hit" : "ld-scan__line"}
      style={{ "--ld-w": `${widths[i % widths.length]}%`, "--ld-i": i }}/>)}
  </div>;
}

/** A metric delta chip — "Fluency +8%". Direction is encoded in the sign, not only in color. */
export function Delta({ metric, change }) {
  const up = change >= 0;
  return <span className={up ? "ld-delta ld-delta--up" : "ld-delta ld-delta--down"}>
    <span className="ld-delta__metric">{metric}</span>
    <span className="ld-delta__value num-mono">{up ? "+" : ""}{change}%</span>
  </span>;
}

/** The hairline technical grid behind the hero. Pure CSS; this just marks where it goes. */
export function GridField({ children }) {
  return <div className="ld-gridfield">
    <div className="ld-gridfield__lines" aria-hidden="true"/>
    <div className="ld-gridfield__fade" aria-hidden="true"/>
    {children}
  </div>;
}
