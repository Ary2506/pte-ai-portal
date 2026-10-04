import React, { createContext, useContext, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { tipHeadingFor, tipsFor } from "./taskTips.js";

// A surface that wraps a task can suppress the task's own rail panels (`taskPanels={false}`).
//
// The mock test does: a timed exam should not be coaching a student through the task it is
// scoring them on, whether that coaching is the tips list or the writing composition readout.
// Ordinary practice is exactly where both belong, so it keeps them.
//
// It deliberately does NOT offer a way to inject a panel into the rail. The mock test tried that
// for its question overview, and because the rail is rendered inside a subtree keyed by question
// id, every Next tore the overview down and rebuilt it. A surface that wants a panel of its own
// alongside a task renders it as a sibling, where it survives the question changing.
//
// Context rather than a prop because the four task components (Speaking, Writing, Reading,
// Listening) each own their own layout, and threading this through all four and down to their
// asides would be four signatures changed to carry something only one caller ever sets.
const TaskRailContext = createContext(null);

/** Reads the surrounding surface's rail settings. Null when a task is rendered on its own. */
export function useTaskRail() {
  return useContext(TaskRailContext);
}

export function TaskRail({ children, taskPanels = true }) {
  // Memoised so the four task components do not re-render on every tick of the mock's timer.
  const value = useMemo(() => ({ taskPanels }), [taskPanels]);
  return <TaskRailContext.Provider value={value}>{children}</TaskRailContext.Provider>;
}

// The tips sidebar, shared by all four workspaces. Speaking had one; writing, reading and
// listening did not, which made the speaking workspace look like a different product.
//
// `note` is what the panel says about scoring, and it differs by section because the truth
// differs: an AI-scored task returns a practice score from a model, an objective one is marked
// against a stored answer key. Neither claim is made on the other's behalf.
export default function TaskTips({ type, section, note, children }) {
  const rail = useContext(TaskRailContext);
  const showTips = rail?.taskPanels !== false;
  const tips = showTips ? tipsFor(type, section) : [];
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
