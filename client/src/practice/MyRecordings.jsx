import React, { useContext, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Play, RotateCcw, Share2 } from "lucide-react";
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

// m:ss, from the duration stored with the attempt, so a length shows before any audio loads.
const fmtDuration = (seconds) => {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return "";
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Available until Nov 30", or a sooner warning in the last two days; null when it never expires. */
export function availabilityNote(until, now = Date.now()) {
  if (!until) return null;
  const left = new Date(until).getTime() - now;
  if (!(left > 0)) return null;
  const days = Math.ceil(left / DAY_MS);
  if (days <= 1) return { text: "Expires within a day", soon: true };
  if (days === 2) return { text: "Expires in 2 days", soon: true };
  const date = new Date(until).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { text: `Available until ${date}`, soon: false };
}

// Only one recording plays at a time: starting one pauses whichever was playing.
let nowPlaying = null;
function claimPlayback(element) {
  if (nowPlaying && nowPlaying !== element && !nowPlaying.paused) nowPlaying.pause();
  nowPlaying = element;
}

/**
 * One attempt's recording, loaded only when the student presses Play. Until then nothing is
 * requested: no signed URL, no audio. Play fetches the owner-checked URL, swaps in the full player
 * and starts it. A lapsed URL is fetched again once.
 */
function OwnRecording({ submissionId, durationSeconds, label }) {
  const [state, setState] = useState("idle"); // idle | loading | ready | error
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);
  const audio = useRef(null);
  const blobUrl = useRef(null);
  const retried = useRef(false);
  const playWhenReady = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      if (nowPlaying === audio.current) nowPlaying = null;
    };
  }, []);

  async function fetchSrc() {
    const next = await api.ownRecordingSrc(submissionId);
    if (!alive.current) {
      if (next.isBlob) URL.revokeObjectURL(next.src);
      return null;
    }
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = next.isBlob ? next.src : null;
    return next.src;
  }

  function fail(err) {
    if (!alive.current) return;
    setError(err?.code === "RECORDING_EXPIRED"
      ? { text: "This recording has expired.", retry: false }
      : { text: "Recording could not be loaded.", retry: true });
    setState("error");
  }

  async function start() {
    setState("loading");
    setError(null);
    retried.current = false;
    try {
      const next = await fetchSrc();
      if (!next) return;
      playWhenReady.current = true;
      setSrc(next);
      setState("ready");
    } catch (err) {
      fail(err);
    }
  }

  // Starts the player once it exists. A browser that will not start audio after a network wait
  // (Safari on iPhone can refuse) leaves the player showing, one more tap away.
  useEffect(() => {
    if (state !== "ready" || !playWhenReady.current || !audio.current) return;
    playWhenReady.current = false;
    try {
      const played = audio.current.play?.();
      if (played && typeof played.catch === "function") played.catch(() => {});
    } catch { /* the controls are there to start it by hand */ }
  }, [state, src]);

  // A signed URL lasts minutes; if the page sat open past that, get a fresh one once.
  async function onError() {
    if (retried.current) { fail(null); return; }
    retried.current = true;
    try {
      const next = await fetchSrc();
      if (next) setSrc(next);
    } catch (err) {
      fail(err);
    }
  }

  if (state === "error") {
    return (
      <div className="my-recordings__player-error">
        <p className="my-recordings__error">{error?.text}</p>
        {error?.retry && <Button variant="ghost" size="sm" icon={<RotateCcw/>} onClick={start}>Try again</Button>}
      </div>
    );
  }
  if (state === "ready") {
    return <audio ref={audio} className="my-recordings__audio" controls preload="auto" src={src}
      onPlay={(e) => claimPlayback(e.currentTarget)} onError={onError} />;
  }
  const duration = fmtDuration(durationSeconds);
  return (
    <Button variant="secondary" size="sm" icon={<Play/>} className="my-recordings__play"
      loading={state === "loading"} loadingLabel="Loading…" onClick={start} aria-label={`Play ${label}`}>
      Play{duration && <span className="my-recordings__duration">{duration}</span>}
    </Button>
  );
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
  const note = row.hasAudio ? availabilityNote(row.audioAvailableUntil) : null;
  return (
    <li className="my-recordings__item">
      <span className="my-recordings__avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
      <div className="my-recordings__body">
        <p className="my-recordings__who">
          <b>{questionTitle || name}</b> <time dateTime={row.createdAt} className="muted">{fmtWhen(row.createdAt)}</time>
        </p>
        {row.hasAudio
          ? <OwnRecording submissionId={row._id} durationSeconds={row.durationSeconds} label={`your recording from ${fmtWhen(row.createdAt)}`} />
          : <p className="muted my-recordings__loading">No recording was stored for this attempt.</p>}
        <p className="my-recordings__score">
          <span className="my-recordings__chip">Score {scoreText(row)}</span>
          {row.share && <span className="my-recordings__chip is-shared">Shared</span>}
          {note && <span className={`my-recordings__expiry${note.soon ? " is-soon" : ""}`}>{note.text}</span>}
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
    // Only attempts whose recording is still kept (withAudio), newest first. One more than five
    // is read, so the list knows whether to point to My Results for the rest.
    const fetchSize = LATEST_RECORDINGS_SHOWN + 1;
    Promise.resolve()
      .then(() => api.history({ summary: 1, type: "read-aloud", question: question._id, withAudio: 1, limit: fetchSize }))
      .then((d) => {
        if (cancelled) return;
        const recordings = (d?.submissions || []).filter((s) => s.hasAudio);
        setRows(recordings.slice(0, LATEST_RECORDINGS_SHOWN));
        setHasMore(recordings.length > LATEST_RECORDINGS_SHOWN || (d?.total || 0) > LATEST_RECORDINGS_SHOWN);
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
 * Every Read Aloud recording this student still has, newest first, ten to a page, each with its
 * own player and Share — the history on My Results that the question page's latest five point to.
 * Recordings past the retention period are deleted from storage and not listed; their scores stay
 * in the attempts table above. The server returns only the signed-in student's own submissions.
 */
export function ReadAloudRecordingHistory() {
  const user = useContext(CurrentUserContext);
  const location = useLocation();
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [retentionDays, setRetentionDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(null);
  const section = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.resolve()
      .then(() => api.history({ summary: 1, type: "read-aloud", withAudio: 1, limit: HISTORY_PAGE_SIZE, page }))
      .then((d) => {
        if (cancelled) return;
        setRows((d?.submissions || []).filter((s) => s.hasAudio));
        setRetentionDays(Number(d?.recordingRetentionDays) || 0);
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
      {failed && <p className="my-recordings__error">Your recordings could not be loaded. Please reload the page.</p>}
      {!failed && rows && !rows.length && !loading && (
        <p className="muted">{retentionDays > 0 ? `No Read Aloud recordings in the last ${retentionDays} days.` : "No Read Aloud recordings yet."}</p>
      )}
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
