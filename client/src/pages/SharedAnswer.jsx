import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { publicApi } from "../api.js";
import { API_ORIGIN } from "../apiBase.js";

// The page a shared-answer link opens: /shared-answer/:token. Standalone on purpose — no sidebar,
// no navigation into the app, no sign-in. It reads one report and one recording through the token
// and nothing else; the server enforces that, this page only displays it.
//
// Everything shown is what the submission really holds. Criteria appear only when the evaluation
// produced them, and the transcript is marked only where the existing feedback flagged a phrase.

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

// Refresh the audio URL this long before the server says it lapses.
const URL_REFRESH_MARGIN_MS = 60_000;

/** The transcript, with phrases the feedback flagged marked; plain text when there are none. */
function MarkedTranscript({ text, mistakes }) {
  const flagged = mistakes.filter((m) => m.studentText && m.studentText.trim().length > 1);
  if (!flagged.length) return <p className="shared-report__transcript">{text}</p>;
  const lower = text.toLowerCase();
  const marks = [];
  for (const m of flagged) {
    const at = lower.indexOf(m.studentText.trim().toLowerCase());
    if (at === -1) continue;
    const end = at + m.studentText.trim().length;
    if (marks.some((x) => at < x.end && end > x.start)) continue;
    marks.push({ start: at, end, title: m.problem });
  }
  marks.sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  marks.forEach((m, i) => {
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(<mark key={i} className="shared-report__flag" title={m.title}>{text.slice(m.start, m.end)}</mark>);
    cursor = m.end;
  });
  parts.push(text.slice(cursor));
  return <p className="shared-report__transcript">{parts}</p>;
}

/** Plays the shared recording, fetching a fresh temporary URL whenever the current one lapses. */
function SharedAudio({ token }) {
  const audio = useRef(null);
  const [src, setSrc] = useState(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Where to resume after swapping in a new URL, and whether it was playing.
  const resume = useRef(null);
  const retried = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await publicApi.sharedAnswerAudioUrl(token);
      setSrc(data.url || `${API_ORIGIN}${data.path}`);
      setExpiresAt(new Date(data.expiresAt).getTime());
      setError("");
      return true;
    } catch (err) {
      setError(err.message || "The recording could not be loaded.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function refresh() {
    const el = audio.current;
    resume.current = el ? { time: el.currentTime, play: !el.paused } : null;
    await load();
  }

  function onLoadedMetadata() {
    const el = audio.current;
    if (el && resume.current) {
      el.currentTime = resume.current.time;
      if (resume.current.play) el.play().catch(() => {});
      resume.current = null;
    }
    retried.current = false;
  }

  // Before playback starts on a URL that has lapsed (the page was left open), get a new one first.
  function onPlay() {
    if (expiresAt && Date.now() > expiresAt - URL_REFRESH_MARGIN_MS) refresh();
  }

  // A lapsed URL surfaces as a media error. Ask once for a new one; a second failure is shown.
  function onError() {
    if (retried.current) {
      setError("The recording could not be played. Please reload the page.");
      return;
    }
    retried.current = true;
    refresh();
  }

  if (error) return <p className="shared-report__audio-error" role="alert">{error}</p>;
  if (!src) return <p className="muted">{loading ? "Loading recording…" : ""}</p>;
  return (
    <audio ref={audio} className="shared-report__audio" controls preload="metadata" src={src}
      onLoadedMetadata={onLoadedMetadata} onPlay={onPlay} onError={onError}>
      Your browser cannot play this recording.
    </audio>
  );
}

export default function SharedAnswer() {
  const { token } = useParams();
  const [report, setReport] = useState(null);
  const [failure, setFailure] = useState(null);

  // A shared report is personal: keep it out of search engines and give the tab a plain title.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noarchive";
    document.head.appendChild(meta);
    const previousTitle = document.title;
    document.title = "Shared answer · PTE CORE AI";
    return () => { meta.remove(); document.title = previousTitle; };
  }, []);

  useEffect(() => {
    publicApi.sharedAnswer(token)
      .then((data) => setReport(data.report))
      .catch((err) => setFailure({ code: err.code, message: err.message }));
  }, [token]);

  const brand = (
    <div className="shared-report__brand brand">
      <span className="brand-mark" aria-hidden="true">P</span>
      <span className="brand-text">PTE CORE <em>AI</em></span>
    </div>
  );

  if (failure) {
    const heading = failure.code === "SHARE_EXPIRED" ? "This link has expired"
      : failure.code === "SHARE_REVOKED" ? "This answer is no longer shared"
        : failure.code === "SHARE_NOT_FOUND" ? "Shared answer not found"
          : "This shared answer could not be loaded";
    return (
      <main className="shared-report shared-report--message">
        {brand}
        <section className="panel shared-report__message">
          <h1>{heading}</h1>
          <p className="muted">{failure.message}</p>
        </section>
      </main>
    );
  }

  if (!report) {
    return <main className="shared-report">{brand}<p className="muted">Loading shared answer…</p></main>;
  }

  return (
    <main className="shared-report">
      {brand}
      <section className="panel shared-report__card">
        <p className="shared-report__task">{report.taskLabel}</p>
        <h1>{report.questionTitle || report.taskLabel}</h1>
        <p className="muted shared-report__date">Answered {fmtDate(report.answeredAt)}</p>

        <div className="shared-report__table-wrap">
          <table className="shared-report__table">
            <thead><tr><th>Component</th><th>Score</th></tr></thead>
            <tbody>
              {report.criteria.map((c) => (
                <tr key={c.key}><td>{c.label}</td><td className="num-mono">{c.value}/{c.max}</td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total score</td>
                <td className="num-mono shared-report__total">{report.score}/{report.maxScore}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <h2>Recording</h2>
        <SharedAudio token={token} />

        <h2>AI Speech Recognition</h2>
        {report.transcript
          ? <MarkedTranscript text={report.transcript} mistakes={report.mistakes} />
          : <p className="muted">No speech was recognised in this recording.</p>}
        {report.mistakes.some((m) => m.studentText) && (
          <p className="muted shared-report__legend">
            <mark className="shared-report__flag">Highlighted</mark> phrases were flagged in the feedback below.
          </p>
        )}

        {(report.overall || report.strengths.length > 0 || report.improvements.length > 0 || report.mistakes.length > 0) && (
          <>
            <h2>Feedback</h2>
            {report.overall && <p>{report.overall}</p>}
            {report.strengths.length > 0 && (
              <><h3>Strengths</h3><ul>{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></>
            )}
            {report.improvements.length > 0 && (
              <><h3>To improve</h3><ul>{report.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></>
            )}
            {report.mistakes.length > 0 && (
              <><h3>Points noted</h3><ul>{report.mistakes.map((m, i) => (
                <li key={i}>{m.problem}{m.correction ? <> — <em>{m.correction}</em></> : null}</li>
              ))}</ul></>
            )}
          </>
        )}
      </section>
      <p className="muted shared-report__footer">
        Shared from PTE CORE AI. This link is available until {fmtDate(report.expiresAt)}.
      </p>
    </main>
  );
}
