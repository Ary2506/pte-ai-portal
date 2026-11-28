import React, { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ClipboardCopy, MessageSquareText } from "lucide-react";
import { api } from "../api.js";
import { Button } from "./Button.jsx";
import { Modal } from "./common.jsx";
import { useToast } from "./toast.jsx";

// "RA · Visit to Canada · PTE CORE AI Score 71/90", from the server's summary of the shared answer
// (falling back to what the caller already knows about it).
export function shareHeadline(summary, submission) {
  const code = summary?.taskCode;
  const title = summary?.questionTitle || submission?.question?.title;
  const score = summary?.score ?? submission?.score;
  const maxScore = summary?.maxScore ?? submission?.maxScore;
  return [code, title, `PTE CORE AI Score ${score}/${maxScore}`].filter(Boolean).join(" · ");
}

// Share Answer's popup. Opening it asks for the answer's link (POST /submissions/:id/share): its
// existing live link when it has one, otherwise a new one. Copy Link puts it on the clipboard.
export default function ShareAnswerDialog({ submission, onShared, onClose }) {
  const toast = useToast();
  const [share, setShare] = useState(null);
  const [error, setError] = useState("");
  // Which button last copied: "link" or "message".
  const [copied, setCopied] = useState(null);
  const field = useRef(null);
  // A link is created once per opening, even under React's double-invoked effects in development.
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    api.shareSubmission(submission._id)
      .then(({ share: created }) => { setShare(created); onShared?.(created); })
      .catch((err) => setError(err.message || "The link could not be created."));
  }, [submission._id, onShared]);

  // Copy Link copies the link alone, so it opens when pasted into an address bar (with words around
  // it, a browser searches for the text instead). Copy message adds a line saying what the answer
  // is, for pasting into WhatsApp and similar, which turn the link inside it into a tap target.
  const headline = share ? shareHeadline(share.summary, submission) : "";
  const message = share ? `${headline}\n${share.url}` : "";

  async function copy(kind) {
    const text = kind === "message" ? message : share.url;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // No async clipboard (an insecure origin, an old browser): copy through a temporary field.
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      scratch.remove();
    }
    if (ok) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
      toast.success(kind === "message"
        ? "Message copied. Paste it into WhatsApp or any chat."
        : "Link copied. Paste it into a browser, or send it to anyone you like.");
    } else {
      field.current?.select();
      toast.error("Copying failed. The link is selected — copy it with Ctrl+C.");
    }
  }

  // An answer already shared gets its existing link back (same address, same expiry), not a new one.
  const title = share ? (share.reused ? "Your Answer Link" : "Answer Link Created") : error ? "Could not share this answer" : "Creating link…";
  return (
    <Modal onClose={onClose} title={title} panelClassName="share-dialog"
      footer={<>
        <Button variant="tertiary" onClick={onClose}>Cancel</Button>
        {share && (
          <Button variant="secondary" icon={copied === "message" ? <Check/> : <MessageSquareText/>} success={copied === "message"}
            successLabel="Copied!" onClick={() => copy("message")}>
            Copy message
          </Button>
        )}
        {share && (
          <Button variant="primary" icon={copied === "link" ? <Check/> : <ClipboardCopy/>} success={copied === "link"}
            successLabel="Copied!" onClick={() => copy("link")}>
            Copy Link
          </Button>
        )}
      </>}>
      {share && (
        <div className="share-dialog__body">
          <p className="share-dialog__lead">
            <CheckCircle2 aria-hidden="true" className="share-dialog__icon" />
            Send the following link to your friends to share your answer!
          </p>
          <p className="muted share-dialog__headline">{headline}</p>
          <input ref={field} readOnly className="share-dialog__url" value={share.url}
            aria-label="Share link" onFocus={(e) => e.target.select()} />
          <p className="muted share-dialog__meta">
            Anyone with this link can see this one report and play its recording until{" "}
            {new Date(share.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.
            You can stop sharing at any time from Practice History.
          </p>
        </div>
      )}
      {error && <p className="share-dialog__error" role="alert">{error}</p>}
      {!share && !error && <p className="muted">Preparing your link…</p>}
    </Modal>
  );
}
