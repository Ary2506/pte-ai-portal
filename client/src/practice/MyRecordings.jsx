import React, { useContext, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Share2 } from "lucide-react";
import { api } from "../api.js";
import { CurrentUserContext } from "../access.js";
import { Button } from "../components/Button.jsx";
import { Pager } from "../components/common.jsx";
import ShareAnswerDialog from "../components/ShareAnswerDialog.jsx";

// Read Aloud only: the signed-in student's own recorded attempts at this question, newest first,
// each with its player, its real score and a Share action. Never anyone else's — the history
// endpoint returns only the requesting student's submissions, and every recording is checked
// against its owner again when it is loaded.

const fmtWhen = (d) => new Date(d).toLocaleString(undefined, {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
});

function scoreText(r) {
  if (r.evaluationStatus === "PENDING" || r.evaluationStatus === "PROCESSING") return "Evaluating…";
  if (r.evaluationStatus === "FAILED") return "Not scored";
  return `${r.score}/${r.maxScore}`;
}

/** One attempt's recording, loaded through its owner-checked URL; a lapsed URL is fetched again. */
function OwnRecording({ submissionId }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState("");
  const blobUrl = useRef(null);
  const retried = useRef(false);

  async function load() {
    try {
      const next = await api.ownRecordingSrc(submissionId);
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = next.isBlob ? next.src : null;
      setSrc(next.src);
      setError("");
    } catch (err) {
      setError(err.message || "Recording could not be loaded.");
    }
  }

  useEffect(() => {
    load();
    return () => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  // A signed URL lasts minutes; if the page sat open past that, get a fresh one once.
  function onError() {
    if (retried.current) { setError("Recording could not be played."); return; }
    retried.current = true;
    load();
  }

  if (error) return <p className="my-recordings__error">{error}</p>;
  if (!src) return <p className="muted my-recordings__loading">Loading recording…</p>;
  return <audio className="my-recordings__audio" controls preload="metadata" src={src} onError={onError} />;
}

// How many recordings the question page lists; the full history is on My Results.
export const LATEST_RECORDINGS_SHOWN = 5;
// Where "Go to My Results" leads: the recordings section of the My Results page.
export const RECORDING_HISTORY_PATH = "/history#read-aloud-recordings";

/**
 * One recorded attempt: who and when (or which question, in the full history), its player, its
 * real score, whether a link to it is live, and a Share button for exactly this attempt.
 */
function RecordingItem({ row, name, questionTitle, onShare }) {
  return (
    <li className="my-recordings__item">
      <span className="my-recordings__avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
      <div className="my-recordings__body">
        <p className="my-recordings__who">
          <b>{questionTitle || name}</b> <time dateTime={row.createdAt} className="muted">{fmtWhen(row.createdAt)}</time>
        </p>
        {row.hasAudio
          ? <OwnRecording submissionId={row._id} />
          : <p className="muted my-recordings__loading">No recording was stored for this attempt.</p>}
        <p className="my-recordings__score">
          <span className="my-recordings__chip">Score {scoreText(row)}</span>
          {row.share && <span className="my-recordings__chip is-shared">Shared</span>}
        </p>
      </div>
      {row.hasAudio && row.evaluationStatus === "COMPLETED" && (
        <Button variant="ghost" size="sm" icon={<Share2/>} className="my-recordings__share"
          aria-label={`Share your recording from ${fmtWhen(row.createdAt)}`} onClick={() => onShare(row)}>
          Share
        </Button>
      )}
    </li>
  );
}

/** The Share popup for one attempt, marking that attempt as shared once its link exists. */
function ShareFor({ row, title, setRows, onClose }) {
  return (
    <ShareAnswerDialog
      submission={{ ...row, question: { title } }}
      onShared={(created) => setRows((current) => current.map((r) => (r._id === row._id ? { ...r, share: { expiresAt: created.expiresAt } } : r)))}
      onClose={onClose}
    />
  );
}

export default function MyRecordings({ question, refreshKey }) {
  const user = useContext(CurrentUserContext);
  const [rows, setRows] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [sharing, setSharing] = useState(null);

  useEffect(() => {
    if (!question?._id) return undefined;
    let cancelled = false;
    // A list that cannot load is simply not shown; it must never break the question above it.
    // A little more than five are read, newest first, so an attempt without a recording does not
    // leave the list short; only the newest five recordings are kept.
    const fetchSize = LATEST_RECORDINGS_SHOWN * 2;
    Promise.resolve()
      .then(() => api.history({ summary: 1, type: "read-aloud", question: question._id, limit: fetchSize }))
      .then((d) => {
        if (cancelled) return;
        const recordings = (d?.submissions || []).filter((s) => s.hasAudio);
        setRows(recordings.slice(0, LATEST_RECORDINGS_SHOWN));
        setHasMore(recordings.length > LATEST_RECORDINGS_SHOWN || (d?.total || 0) > fetchSize);
      })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [question?._id, refreshKey]);

  if (!rows || !rows.length) return null;
  const name = user?.name || user?.username || "You";
  return (
    <section className="my-recordings" aria-label="My recordings">
      <h3 className="my-recordings__title">My recordings</h3>
      <ul className="my-recordings__list">
        {rows.map((r) => <RecordingItem key={r._id} row={r} name={name} onShare={setSharing} />)}
      </ul>
      {hasMore && (
        <div className="my-recordings__more">
          <p className="muted">Showing your latest 5 recordings. To view and share your other recordings, visit My Results.</p>
          <NavLink to={RECORDING_HISTORY_PATH} className="link">Go to My Results →</NavLink>
        </div>
      )}
      {sharing && <ShareFor row={sharing} title={question.title} setRows={setRows} onClose={() => setSharing(null)} />}
    </section>
  );
}

const HISTORY_PAGE_SIZE = 10;

/**
 * Every Read Aloud attempt this student has recorded, newest first, ten to a page, each with its
 * own player and Share — the complete history on My Results that the question page's latest five
 * point to. The server returns only the signed-in student's own submissions.
 */
export function ReadAloudRecordingHistory() {
  const user = useContext(CurrentUserContext);
  const location = useLocation();
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(null);
  const section = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.resolve()
      .then(() => api.history({ summary: 1, type: "read-aloud", limit: HISTORY_PAGE_SIZE, page }))
      .then((d) => {
        if (cancelled) return;
        setRows(d?.submissions || []);
        setTotal(d?.total || 0);
        setTotalPages(d?.totalPages || 1);
        setFailed(false);
      })
      .catch(() => { if (!cancelled) { setRows([]); setFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

  // Arriving from "Go to My Results": bring this section into view once it has rendered.
  useEffect(() => {
    if (location.hash !== "#read-aloud-recordings" || rows === null) return;
    if (typeof section.current?.scrollIntoView === "function") {
      section.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [location.hash, rows === null]);

  const name = user?.name || user?.username || "You";
  return (
    <section className="panel my-recordings my-recordings--history" id="read-aloud-recordings" ref={section}
      aria-label="Read Aloud recordings">
      <h3 className="my-recordings__title">Read Aloud recordings</h3>
      <p className="muted my-recordings__intro">Every Read Aloud answer you have recorded, newest first. Share any of them, old or new.</p>
      {failed && <p className="my-recordings__error">Your recordings could not be loaded. Please reload the page.</p>}
      {!failed && rows && !rows.length && !loading && <p className="muted">No Read Aloud recordings yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="my-recordings__list">
          {rows.map((r) => (
            <RecordingItem key={r._id} row={r} name={name} questionTitle={r.question?.title || "Read Aloud"} onShare={setSharing} />
          ))}
        </ul>
      )}
      {totalPages > 1 && (
        <Pager page={page} totalPages={totalPages} total={total} itemLabel={total === 1 ? "attempt" : "attempts"}
          busy={loading} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
      )}
      {sharing && (
        <ShareFor row={sharing} title={sharing.question?.title} setRows={setRows} onClose={() => setSharing(null)} />
      )}
    </section>
  );
}
