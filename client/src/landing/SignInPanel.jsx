import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, X } from "lucide-react";
import { api } from "../api.js";
import { Button } from "../components/Button.jsx";

// The sign-in modal. The authentication behaviour here is carried over from the original Auth
// screen unchanged — same api.auth.signin call, same save(), same post-login redirect by role,
// same forced-logout notice read out of sessionStorage, same .auth-message-slot that holds its
// height so an error cannot push the fields around.
//
// Form factor: a centred card, not an edge sheet. A compact dialog that owns the middle of the
// screen reads as a deliberate step; a panel pinned to one edge reads as a drawer of settings.

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

export default function SignInPanel({ open, onClose, save, notice }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const cardRef = useRef(null);
  const firstFieldRef = useRef(null);
  // Where focus was when the modal opened, so closing hands it back rather than dropping the
  // caret at the top of the document.
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    firstFieldRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      // Trap: a dialog the keyboard can walk out of, into the page it is covering, is not a dialog.
      const items = [...(cardRef.current?.querySelectorAll(FOCUSABLE) || [])]
        .filter(n => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api.auth.signin({ username: form.username, password: form.password });
      save(data);
      navigate(data.user.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return <div className="ld-modal" role="presentation">
    <div className="ld-modal__scrim" onClick={onClose} aria-hidden="true"/>
    <div className="ld-modal__card" ref={cardRef}
      role="dialog" aria-modal="true" aria-labelledby="ld-signin-title">

      <button type="button" className="ld-modal__close" onClick={onClose} aria-label="Close sign in">
        <X size={17}/>
      </button>

      <div className="ld-modal__head">
        <span className="ld-modal__mark" aria-hidden="true">P</span>
        <h2 id="ld-signin-title">Welcome back</h2>
        <p className="ld-modal__sub">Sign in with the User ID and password provided by your administrator.</p>
      </div>

      <form onSubmit={submit}>
        <label>User ID
          <input ref={firstFieldRef} required autoCapitalize="none" autoCorrect="off"
            value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
            placeholder="e.g. pte001"/>
        </label>
        <label>Password
          <div className="password-field">
            <input required type={showPassword ? "text" : "password"}
              value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="Your password"/>
            <button type="button" className="password-toggle" onClick={() => setShowPassword(s => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword} tabIndex={-1}>
              {showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}
            </button>
          </div>
        </label>

        {/* Reserves its height whether or not there is a message, and sits BELOW both fields, so a
            failed attempt cannot shift the inputs the student is typing into. */}
        <div className="auth-message-slot" role="alert" aria-live="polite">
          {notice && <div className="alert error"><AlertCircle size={17}/>{notice}</div>}
          {error && <div className="alert error"><AlertCircle size={17}/>{error}</div>}
        </div>

        <Button type="submit" variant="primary" size="lg" fullWidth className="ld-modal__submit"
          loading={busy} loadingLabel="Signing in...">Sign In</Button>
      </form>

      {/* Quiet, below the action — it is policy to be aware of, not a warning to clear. */}
      <p className="ld-modal__policy">
        <AlertCircle size={14}/>
        {/* Wording is verbatim from the original screen: this is a promise about how sessions
            behave, and it is asserted word-for-word by deviceRestriction.test.jsx. */}
        <span><b>One session at a time</b> — you can sign in from any device or browser, but only
          one at a time. Signing in somewhere new will sign you out everywhere else.</span>
      </p>

      <p className="ld-modal__foot">Don't have an account? Contact your administrator to get access.</p>
    </div>
  </div>;
}
