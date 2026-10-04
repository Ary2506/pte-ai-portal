import React, { useState } from "react";
import { CalendarPlus, CalendarX2 } from "lucide-react";
import { api } from "../../api.js";
import { Modal, ConfirmDialog } from "../../components/common.jsx";
import { Button } from "../../components/Button.jsx";
import { fmtDate } from "./adminFormat.js";

// Temporary/emergency Admin Subscription Extension feature (extend/revoke/cancel a user's
// subscription) — deliberately kept in this one file plus the small integration points in
// AdminUsers.jsx (an import, a few buttons, and rendering these components). To remove this
// feature completely later:
//   1. Delete this file.
//   2. Delete server/src/routes/adminSubscriptionExtension.js and
//      server/src/models/SubscriptionExtension.js.
//   3. Remove the one import + one app.use line for it in server/src/app.js.
//   4. Remove the `subscriptionExtension` block from client/src/api.js.
//   5. In AdminUsers.jsx, remove the `ExtendAllActiveModal` button/render in AdminUsers, and in
//      AdminUserDetail: the `ExtendSubscriptionButton`/`RevokeSubscriptionButton` renders and the
//      "Cancel Subscription" button (each is a single self-contained block, clearly commented
//      below with a matching comment at each call site).
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
    <Button variant="secondary" size="sm" icon={<CalendarPlus/>} onClick={() => setOpen(true)}>Extend Subscription</Button>
    {open && <ExtendSubscriptionModal user={user} onClose={() => setOpen(false)} onExtended={onExtended} />}
  </>;
}

function ExtendSubscriptionModal({ user, onClose, onExtended }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum > 0;
  const reasonValid = reason.trim().length > 0;
  const newExpiry = daysValid ? addDaysPreview(user.subscriptionEndDate, daysNum) : null;

  async function confirmExtend() {
    setBusy(true); setError("");
    try {
      const result = await api.admin.subscriptionExtension.extendUser(user.id, daysNum, reason.trim());
      onExtended?.(result);
      setShowConfirm(false);
      onClose();
    } catch (e) {
      setError(e.message);
      setShowConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Modal onClose={onClose} title="Extend Subscription" ariaLabel="Extend Subscription"
      footer={<>
        <Button variant="tertiary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => setShowConfirm(true)} disabled={busy || !daysValid || !reasonValid}>
          Extend Subscription
        </Button>
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
    </Modal>
    <ConfirmDialog
      open={showConfirm}
      title="Confirm Extension"
      message={`Confirm extend subscription for ${user.username} by ${daysNum} day(s)?`}
      confirmLabel="Confirm"
      busy={busy}
      onConfirm={confirmExtend}
      onCancel={() => setShowConfirm(false)}
    />
  </>;
}

// --- Revoke a specific number of days from one user's active subscription --------------------

export function RevokeSubscriptionButton({ user, onRevoked }) {
  // null = closed, "input" = entering a day count, "confirm" = the confirm popup.
  const [step, setStep] = useState(null);
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user.subscriptionStatus !== "ACTIVE") return null;

  const remainingDays = Math.max(0, Math.ceil((new Date(user.subscriptionEndDate) - Date.now()) / 86400000));
  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum > 0 && daysNum <= remainingDays;

  function open() {
    setDays(""); setError(""); setStep("input");
  }

  async function confirmRevoke() {
    setBusy(true); setError("");
    try {
      const result = await api.admin.subscriptionExtension.revokeUser(user.id, daysNum);
      onRevoked?.(result);
      setStep(null);
    } catch (e) {
      setError(e.message);
      setStep(null);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Button variant="danger" size="sm" icon={<CalendarX2/>} onClick={open}>Revoke Subscription</Button>
    {step === "input" && (
      <Modal onClose={() => setStep(null)} title="Revoke Subscription" ariaLabel="Revoke Subscription"
        footer={<>
          <Button variant="tertiary" onClick={() => setStep(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => setStep("confirm")} disabled={!daysValid}>OK</Button>
        </>}>
        {error && <div className="alert error">{error}</div>}
        <dl>
          <dt>Days remaining</dt><dd>{remainingDays}</dd>
        </dl>
        <label>Days to revoke
          <input type="number" min="1" max={remainingDays} step="1" value={days}
            onChange={e => setDays(e.target.value)} aria-label="Days to revoke" autoFocus />
        </label>
        {days !== "" && !daysValid && (
          <p className="muted" style={{ color: "var(--danger)" }}>
            {daysNum > remainingDays
              ? `You cannot revoke more than the ${remainingDays} day(s) this subscription has left.`
              : "Enter a positive whole number of days."}
          </p>
        )}
      </Modal>
    )}
    <ConfirmDialog
      open={step === "confirm"}
      title="Revoke Subscription"
      message={`Confirm revoke subscription for ${user.username}?`}
      confirmLabel="Confirm"
      danger
      busy={busy}
      onConfirm={confirmRevoke}
      onCancel={() => setStep(null)}
    />
  </>;
}

// --- Bulk extension of every currently active subscription -----------------------------------

export function ExtendAllActiveButton({ onExtended }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="secondary" icon={<CalendarPlus/>} onClick={() => setOpen(true)}>Extend All Active Subscriptions</Button>
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
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div className="alert notice">
        Extended {result.affectedUsers} active subscription{result.affectedUsers === 1 ? "" : "s"} by {result.daysAdded} day{result.daysAdded === 1 ? "" : "s"}.
        <br />Extension event: <b>{result.extensionId}</b>
      </div>
    </Modal>;
  }

  return <>
    <Modal onClose={onClose} title="Extend All Active Subscriptions" ariaLabel="Extend All Active Subscriptions"
      footer={<>
        <Button variant="tertiary" onClick={onClose} disabled={previewing || confirming}>Cancel</Button>
        <Button variant="secondary" onClick={runPreview} loading={previewing} loadingLabel="Loading..."
          disabled={confirming || !daysValid}>Preview</Button>
        <Button variant="primary" onClick={() => setShowConfirm(true)} disabled={!preview || !reasonValid || confirming}>
          Extend All Active Subscriptions
        </Button>
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
        <Button variant="tertiary" onClick={() => setShowConfirm(false)} disabled={confirming}>Cancel</Button>
        <Button variant="primary" onClick={confirmExtend} loading={confirming} loadingLabel="Extending...">Confirm Extension</Button>
      </>}>
      <p>Are you sure you want to extend {preview.affectedUsers} active subscription{preview.affectedUsers === 1 ? "" : "s"} by {daysNum} day{daysNum === 1 ? "" : "s"}?</p>
    </Modal>}
  </>;
}
