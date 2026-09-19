import React, { useEffect } from "react";
import { X } from "lucide-react";

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

export function SkeletonTableRows({ count = 6 }) {
  return <div aria-hidden="true" style={{padding:"4px 0"}}>{Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton skeleton-row"/>)}</div>;
}

// Generic modal shell — the same overlay/panel/header/footer structure every admin modal
// (Question Preview, Edit Question, User details, Test session details, credential messages)
// already hand-assembled identically. Reproduces that exact existing markup/classes/ARIA
// (.modal-overlay > .modal-panel[role=dialog][aria-modal] > .modal-head(h3 + close button) >
// children > .modal-actions footer) so migrating a call site changes nothing visible or
// test-detectable — only removes the duplicated overlay/Escape-key boilerplate.
// ConfirmDialog (below) intentionally stays on its own simpler markup rather than being
// rebuilt on top of this, since it predates this component, is already shared/deduplicated,
// and has no close button/header of its own to reconcile.
export function Modal({ onClose, title, ariaLabel, footer, children, panelClassName = "", overlayClassName = "" }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className={overlayClassName ? `modal-overlay ${overlayClassName}` : "modal-overlay"} onClick={onClose}>
    <div className={panelClassName ? `modal-panel ${panelClassName}` : "modal-panel"} role="dialog" aria-modal="true" aria-label={ariaLabel || title} onClick={e => e.stopPropagation()}>
      <div className="modal-head">
        <h3>{title}</h3>
        {onClose && <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button>}
      </div>
      {children}
      {footer && <div className="modal-actions">{footer}</div>}
    </div>
  </div>;
}

// Shared by every admin destructive/confirmation flow (user status changes, question
// activate/deactivate/delete). Intentionally distinct from Mock.jsx's own student-facing
// ConfirmDialog, which has a different (no "danger" tone) signature for its one use case.
export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onCancel(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return <div className="modal-overlay confirm-overlay" onClick={e => { e.stopPropagation(); onCancel(); }}>
    <div className="modal-panel confirm-panel" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <h3>{title}</h3>
      <p className="muted">{message}</p>
      <div className="modal-actions">
        <button className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={danger ? "primary danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? "Working..." : confirmLabel}</button>
      </div>
    </div>
  </div>;
}

// Shared table shell for the three admin list views (Questions, Users, Test Sessions) — replaces
// each file's own hand-rolled loading/empty/table/pager block with one implementation, while
// leaving every table's own error banner, filter bar, and row-action content exactly as each
// file already renders it (error handling stays external/unchanged — see each call site).
// `columns` is [{ key, header, render(row), cellClassName? }]; `render` returns the exact same
// cell JSX each table already produced, so no visible/test-detectable output changes on migration.
// Every <td> carries a data-label (its column header) purely so the CSS-only responsive
// card/stacked layout (styles.css, `.admin-table` breakpoint rules) can label a cell on narrow
// screens — the same single DOM tree serves both the desktop table and the mobile card view.
export function DataTable({ columns, rows, rowKey, loading, loadingRows = 6, emptyText = "No results found.", pagination }) {
  if (loading) return <SkeletonTableRows count={loadingRows}/>;
  if (!rows?.length) return <Empty text={emptyText}/>;
  return <>
    <div className="table-wrap admin-table">
      <table>
        <thead><tr>{columns.map(c => <th key={c.key}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map(row => <tr key={rowKey(row)}>
            {columns.map(c => <td key={c.key} data-label={typeof c.header === "string" ? c.header : undefined} className={c.cellClassName}>{c.render(row)}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    {pagination && <div className="pager">
      <button className="secondary" disabled={pagination.page <= 1} onClick={pagination.onPrevious}>‹ Previous</button>
      <span className="muted">Page {pagination.page} of {pagination.totalPages} · {pagination.total} {pagination.itemLabel}</span>
      <button className="secondary" disabled={pagination.page >= pagination.totalPages} onClick={pagination.onNext}>Next ›</button>
    </div>}
  </>;
}
