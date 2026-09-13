import React from "react";

export function Page({ title, subtitle, children, actions }) {
  return <>
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {actions}
    </div>
    {children}
  </>;
}

export function Badge({ tone, children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({ text }) {
  return <div className="empty">{text}</div>;
}

export function SkeletonCards({ count = 4, gridClass = "score-grid" }) {
  return <div className={gridClass} aria-hidden="true">
    {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton skeleton-card" />)}
  </div>;
}

export function SkeletonRows({ count = 5 }) {
  return <div aria-hidden="true">
    {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}
  </div>;
}
