import React from "react";
import { Sparkles } from "lucide-react";
import { tipHeadingFor, tipsFor } from "./taskTips.js";

// The tips sidebar, shared by all four workspaces. Speaking had one; writing, reading and
// listening did not, which made the speaking workspace look like a different product.
//
// `note` is what the panel says about scoring, and it differs by section because the truth
// differs: an AI-scored task returns a practice score from a model, an objective one is marked
// against a stored answer key. Neither claim is made on the other's behalf.
export default function TaskTips({ type, section, note, children }) {
  const tips = tipsFor(type, section);
  if (!tips.length) return null;

  return (
    <aside className="panel tips">
      <h3>{tipHeadingFor(type, section)} tips</h3>
      <ul>
        {tips.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
      {children}
      {note && (
        <div className="tip-box">
          <Sparkles size={18} />
          <b>How this is scored</b>
          <p>{note}</p>
        </div>
      )}
    </aside>
  );
}

/** The two scoring notes, so no workspace has to word this for itself. */
export const AI_SCORING_NOTE =
  "We evaluate your submitted response and return a practice score.";
export const OBJECTIVE_SCORING_NOTE =
  "This task is marked against a stored answer key — your score is exact, not estimated.";
