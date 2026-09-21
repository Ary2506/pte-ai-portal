import React, { useState } from "react";
import { api } from "../../api.js";
import { Modal } from "../../components/common.jsx";
import { fmtDate } from "./adminFormat.js";

// Temporary/emergency Admin Subscription Extension feature — deliberately kept in this one file
// plus the two small integration points in AdminUsers.jsx (an import, a button, and rendering
// these two components). To remove this feature completely later:
//   1. Delete this file.
//   2. Delete server/src/routes/adminSubscriptionExtension.js and
//      server/src/models/SubscriptionExtension.js.
//   3. Remove the one import + one app.use line for it in server/src/app.js.
//   4. Remove the `subscriptionExtension` block from client/src/api.js.
//   5. In AdminUsers.jsx, remove the `ExtendAllActiveModal` button/render in AdminUsers and the
//      `ExtendSubscriptionModal` button/render in AdminUserDetail (each is a single self-contained
//      block, clearly commented below with a matching comment at each call site).
//   6. Drop the subscriptionextensions/bulkextensionrequests/extensioncounters collections.
// Nothing outside those files reads this feature's data, so no other code needs to change.

function addDaysPreview(dateStr, days) {
  if (!dateStr || !days) return null;
  return new Date(new Date(dateStr).getTime() + Number(days) * 86400000);
}

// --- Individual user extension --------------------------------------------------------------

export function ExtendSubscriptionButton({ user, onExtended }) {
  const [open, setOpen] = useState(false);
  if (user.subscriptionStatus !== "ACTIVE") return null;
  return <>
    <button className="secondary" onClick={() => setOpen(true)}>Extend Subscription</button>
    {open && <ExtendSubscriptionModal user={user} onClose={() => setOpen(false)} onExtended={onExtended} />}
  </>;
}

function ExtendSubscriptionModal({ user, onClose, onExtended }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum > 0;
  const reasonValid = reason.trim().length > 0;
  const newExpiry = daysValid ? addDaysPreview(user.subscriptionEndDate, daysNum) : null;

  async function submit() {
    if (!daysValid || !reasonValid) return;
    setBusy(true); setError("");
    try {
      const result = await api.admin.subscriptionExtension.extendUser(user.id, daysNum, reason.trim());
      onExtended?.(result);
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return <Modal onClose={onClose} title="Extend Subscription" ariaLabel="Extend Subscription"
    footer={<>
      <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="primary" onClick={submit} disabled={busy || !daysValid || !reasonValid}>
        {busy ? "Extending..." : "Extend Subscription"}
      </button>
    </>}>
    {error && <div className="alert error">{error}</div>}
    <dl>
      <dt>Current Expiry</dt><dd>{fmtDate(user.subscriptionEndDate)}</dd>
    </dl>
    <label>Extra Days
      <input type="number" min="1" step="1" value={days} onChange={e => setDays(e.target.value)} aria-label="Extra days" />
    </label>
    {!daysValid && days !== "" && <p className="muted" style={{ color: "var(--danger)" }}>Extra days must be a positive whole number.</p>}
    <label>Reason
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Portal technical issue" aria-label="Reason" />
    </label>
    {!reasonValid && <p className="muted">A reason is required.</p>}
    <dl>
      <dt>New Expiry</dt><dd>{newExpiry ? fmtDate(newExpiry) : "—"}</dd>
    </dl>
  </Modal>;
}

// --- Bulk extension of every currently active subscription -----------------------------------

export function ExtendAllActiveButton({ onExtended }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="secondary" onClick={() => setOpen(true)}>Extend All Active Subscriptions</button>
    {open && <ExtendAllActiveModal onClose={() => setOpen(false)} onExtended={onExtended} />}
  </>;
}

function ExtendAllActiveModal({ onClose, onExtended }) {
  // Generated once when this modal opens and reused for every preview/confirm call from it, so a
  // double-click on "Confirm Extension" (or a retried request) can never apply the same bulk
  // extension twice — the backend keys duplicate protection off this exact id.
  const [clientRequestId] = useState(() => `web-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum > 0;
  const reasonValid = reason.trim().length > 0;

  async function runPreview() {
    if (!daysValid) return;
    setPreviewing(true); setError(""); setPreview(null);
    try {
      const data = await api.admin.subscriptionExtension.bulkPreview(daysNum);
      setPreview(data);
    } catch (e) { setError(e.message); } finally { setPreviewing(false); }
  }

  async function confirmExtend() {
    setConfirming(true); setError("");
    try {
      const data = await api.admin.subscriptionExtension.bulkExtend(daysNum, reason.trim(), clientRequestId);
      setResult(data);
      setShowConfirm(false);
      onExtended?.(data);
    } catch (e) { setError(e.message); setShowConfirm(false); } finally { setConfirming(false); }
  }

  if (result) {
    return <Modal onClose={onClose} title="Extend All Active Subscriptions" ariaLabel="Extend All Active Subscriptions"
      footer={<button className="primary" onClick={onClose}>Close</button>}>
      <div className="alert notice">
        Extended {result.affectedUsers} active subscription{result.affectedUsers === 1 ? "" : "s"} by {result.daysAdded} day{result.daysAdded === 1 ? "" : "s"}.
        <br />Extension event: <b>{result.extensionId}</b>
      </div>
    </Modal>;
  }

  return <>
    <Modal onClose={onClose} title="Extend All Active Subscriptions" ariaLabel="Extend All Active Subscriptions"
      footer={<>
        <button className="secondary" onClick={onClose} disabled={previewing || confirming}>Cancel</button>
        <button className="secondary" onClick={runPreview} disabled={previewing || confirming || !daysValid}>
          {previewing ? "Loading..." : "Preview"}
        </button>
        <button className="primary" onClick={() => setShowConfirm(true)} disabled={!preview || !reasonValid || confirming}>
          Extend All Active Subscriptions
        </button>
      </>}>
      {error && <div className="alert error">{error}</div>}
      <label>Extra Days
        <input type="number" min="1" step="1" value={days} onChange={e => { setDays(e.target.value); setPreview(null); }} aria-label="Extra days" />
      </label>
      {!daysValid && days !== "" && <p className="muted" style={{ color: "var(--danger)" }}>Extra days must be a positive whole number.</p>}
      <label>Reason
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Portal technical issue" aria-label="Reason" />
      </label>
      {!reasonValid && <p className="muted">A reason is required.</p>}

      {preview && <>
        <dl>
          <dt>Affected Users</dt><dd>{preview.affectedUsers}</dd>
        </dl>
        {preview.sample.length > 0 && <>
          <p className="muted" style={{ marginBottom: 4 }}>Example changes:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {preview.sample.map(s => (
              <li key={s.username}>{s.username}: {fmtDate(s.previousExpiry)} → {fmtDate(s.newExpiry)}</li>
            ))}
          </ul>
        </>}
      </>}
    </Modal>
    {showConfirm && preview && <Modal onClose={() => setShowConfirm(false)} title="Confirm bulk extension" ariaLabel="Confirm bulk extension"
      footer={<>
        <button className="secondary" onClick={() => setShowConfirm(false)} disabled={confirming}>Cancel</button>
        <button className="primary" onClick={confirmExtend} disabled={confirming}>{confirming ? "Extending..." : "Confirm Extension"}</button>
      </>}>
      <p>Are you sure you want to extend {preview.affectedUsers} active subscription{preview.affectedUsers === 1 ? "" : "s"} by {daysNum} day{daysNum === 1 ? "" : "s"}?</p>
    </Modal>}
  </>;
}
