import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../../api.js";
import { Badge, ConfirmDialog } from "../../components/common.jsx";
import { Button } from "../../components/Button.jsx";
import { PRACTICE_SECTIONS, SECTION_LABELS } from "../../practiceTaskRegistry.js";
import { fmtDate, fmtDateTime } from "./adminFormat.js";

// Per-section access, as the admin manages it: which sections a student holds, each one's own
// window, granting more ("Add purchase"), ending one early, and the history of what was granted.
// The rules themselves live on the server (server/src/utils/subscription.js); this only collects
// the admin's choice and shows the result.

const DAY_MS = 86400000;
const STATUS_TONE = { ACTIVE: "good", EXPIRED: "bad", CANCELLED: "bad", NOT_PURCHASED: "neutral" };
const STATUS_LABEL = { ACTIVE: "Active", EXPIRED: "Expired", CANCELLED: "Cancelled", NOT_PURCHASED: "Not purchased" };
const KIND_LABEL = { PURCHASE: "Purchase", CREATE: "Account created", RENEW: "Renewal" };

function daysLeft(endDate) {
  return Math.max(0, Math.ceil((new Date(endDate) - Date.now()) / DAY_MS));
}

/**
 * One checkbox per section in `options` (all four by default). `value` is the list of ticked
 * sections, always reported back in exam order. Sections in `unavailable` are shown but cannot be
 * ticked, labelled with `unavailableNote` so the admin can see why.
 */
export function SectionCheckboxes({
  value, onChange, legend = "Sections", disabled = false, options = PRACTICE_SECTIONS,
  unavailable = [], unavailableNote = ""
}) {
  function toggle(section) {
    const next = value.includes(section) ? value.filter(s => s !== section) : [...value, section];
    onChange(PRACTICE_SECTIONS.filter(s => next.includes(s)));
  }
  return (
    <fieldset className="section-checkboxes" disabled={disabled}>
      <legend>{legend}</legend>
      {options.map(section => {
        const locked = unavailable.includes(section);
        return (
          <label key={section} className={locked ? "section-checkbox is-unavailable" : "section-checkbox"}>
            <input type="checkbox" checked={!locked && value.includes(section)} disabled={locked}
              onChange={() => toggle(section)} />
            {SECTION_LABELS[section]}
            {locked && unavailableNote && <span className="section-checkbox-note">{unavailableNote}</span>}
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * The users table's compact "which sections" cell: "All" for a student with every section active,
 * otherwise the active ones by name, or a dash for none. An account the server sent without a
 * sections list (an older server) shows a dash rather than guessing.
 */
export function SectionsSummary({ user }) {
  if (user.role === "admin") return <span className="muted">All</span>;
  if (!Array.isArray(user.sections)) return <span className="muted">—</span>;
  const active = user.sections.filter(r => r.status === "ACTIVE").map(r => r.section);
  if (active.length === PRACTICE_SECTIONS.length) return <span>All</span>;
  if (!active.length) return <span className="muted">—</span>;
  return <span title={active.map(s => SECTION_LABELS[s]).join(", ")}>{active.map(s => SECTION_LABELS[s]).join(" · ")}</span>;
}

const EMPTY_PURCHASE = { sections: [], days: 30, paymentId: "" };

/** The "Sections" block of the user detail panel. `onChanged` reloads the user after any change. */
export function UserSectionsPanel({ user, notify, onChanged }) {
  const [purchases, setPurchases] = useState([]);
  const [form, setForm] = useState(EMPTY_PURCHASE);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  function loadPurchases() {
    // Best-effort and separate from the user itself: the history is supporting detail, and a
    // failure here must not stop the admin managing the account.
    Promise.resolve()
      .then(() => api.admin.listPurchases?.(user.id))
      .then(d => setPurchases(d?.purchases || []))
      .catch(() => setPurchases([]));
  }
  useEffect(loadPurchases, [user.id]);

  async function addPurchase(e) {
    e.preventDefault();
    if (!selected.length) return;
    setBusy(true);
    try {
      await api.admin.addPurchase(user.id, {
        sections: selected,
        days: Number(form.days),
        paymentId: form.paymentId.trim() || undefined
      });
      notify("success", `Added ${form.days} days of ${selected.map(s => SECTION_LABELS[s]).join(", ")}.`);
      setForm(EMPTY_PURCHASE);
      onChanged();
      loadPurchases();
    } catch (err) {
      notify("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      notify("success", confirm.successMsg);
      setConfirm(null);
      onChanged();
    } catch (err) {
      notify("error", err.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const rows = Array.isArray(user.sections) ? user.sections : [];
  // A purchase is for sections the student does not have running right now. One that is active
  // already is shown but cannot be ticked here — adding days to it is Extend Subscription's job —
  // while one that has expired or was cancelled can be bought again and starts from today.
  const alreadyActive = rows.filter(r => r.status === "ACTIVE").map(r => r.section);
  const purchasable = PRACTICE_SECTIONS.filter(s => !alreadyActive.includes(s));
  // Filtered at use, not only when ticked: a section that became active since the box was ticked
  // (the purchase that just went through, a refresh) must drop out of the next submission.
  const selected = form.sections.filter(s => purchasable.includes(s));

  return (
    <section className="user-sections">
      <h4>Sections</h4>
      {rows.length ? (
        <table className="section-access-table">
          <thead>
            <tr><th>Section</th><th>Status</th><th>Start</th><th>Expiry</th><th>Days left</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.section}>
                <td>{SECTION_LABELS[row.section]}</td>
                <td><Badge tone={STATUS_TONE[row.status] || "neutral"}>{STATUS_LABEL[row.status] || row.status}</Badge></td>
                <td>{fmtDate(row.startDate)}</td>
                <td>{fmtDate(row.endDate)}</td>
                <td>{row.status === "ACTIVE" ? daysLeft(row.endDate) : "—"}</td>
                <td>
                  {row.status === "ACTIVE" && (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm({
                      title: `Cancel ${SECTION_LABELS[row.section]}?`,
                      message: `${user.username} will lose ${SECTION_LABELS[row.section]} immediately. Their other sections are not affected.`,
                      label: `Cancel ${SECTION_LABELS[row.section]}`,
                      successMsg: `${SECTION_LABELS[row.section]} cancelled`,
                      run: () => api.admin.subscriptionExtension.cancelUser(user.id, [row.section])
                    })}>Cancel</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No section information for this account.</p>
      )}

      <h4>Add purchase</h4>
      <p className="muted section-purchase-hint">
        {purchasable.length
          ? "Tick the sections being bought. Each one starts today and runs for the days chosen. Sections already active can't be bought again here — use Extend Subscription to add days to them."
          : "Every section is already active, so there is nothing new to buy. Use Extend Subscription to add days."}
      </p>
      <form className="admin-create-form section-purchase-form" onSubmit={addPurchase}>
        <SectionCheckboxes value={selected} onChange={sections => setForm({ ...form, sections })} legend="Sections bought"
          disabled={busy} unavailable={alreadyActive} unavailableNote="Active" />
        <label>Days
          <select value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} disabled={busy}>
            <option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option>
          </select>
        </label>
        <label>Payment ID (optional)
          <input value={form.paymentId} maxLength={200} onChange={e => setForm({ ...form, paymentId: e.target.value })} disabled={busy} />
        </label>
        <Button type="submit" variant="primary" icon={<Plus />} loading={busy} loadingLabel="Adding..." disabled={!selected.length}>
          Add purchase
        </Button>
      </form>

      <h4>Purchase history</h4>
      {purchases.length ? (
        <div className="session-list">
          {purchases.map(p => (
            <div className="session-row" key={p.id}>
              <Badge tone="info">{KIND_LABEL[p.kind] || p.kind}</Badge>
              <div>
                <small>
                  {p.sections.map(s => SECTION_LABELS[s]).join(", ")} · {p.days} days
                  {p.paymentId ? ` · ${p.paymentId}` : ""}
                </small>
                <small className="muted">
                  {fmtDateTime(p.createdAt)}{p.grantedBy ? ` · by ${p.grantedBy.username}` : ""}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No purchases recorded yet.</p>
      )}

      <ConfirmDialog open={!!confirm} title={confirm?.title} message={confirm?.message} confirmLabel={confirm?.label}
        danger busy={busy} onConfirm={runConfirm} onCancel={() => setConfirm(null)} />
    </section>
  );
}
