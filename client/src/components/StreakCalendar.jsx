import React, { useMemo, useRef, useState } from "react";
import { StatLabel } from "./analytics.jsx";

// A contribution-style practice calendar: one cell per day, columns are weeks, rows are weekdays.
//
// Every cell is drawn from the activity the API returned — a day with no entry is simply a day
// with no practice, which is why the response only carries days that have any. Nothing here
// invents activity to fill the grid.

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Intensity bucket for a day's activity count. Four levels, like the platforms this mirrors. */
function level(count) {
  if (!count) return 0;
  if (count >= 10) return 4;
  if (count >= 5) return 3;
  if (count >= 2) return 2;
  return 1;
}

const toKey = (date) => date.toISOString().slice(0, 10);

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th" ... */
function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}

/** "8 activities on October 3rd" / "No practice on October 3rd". */
function describeDay(dateKey, count) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const when = `${MONTH_NAMES[date.getUTCMonth()]} ${ordinal(date.getUTCDate())}`;
  if (!count) return `No practice on ${when}`;
  return `${count} ${count === 1 ? "activity" : "activities"} on ${when}`;
}

/**
 * Builds the grid as columns of weeks. The first column is padded so every row is the same
 * weekday throughout — without that the rows do not line up and the calendar is unreadable.
 */
function buildWeeks(fromKey, toKey_, days) {
  const start = new Date(`${fromKey}T00:00:00Z`);
  const end = new Date(`${toKey_}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  // Back up to the Sunday on or before the first day.
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());

  const weeks = [];
  while (cursor <= end) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      const key = toKey(cursor);
      week.push(
        cursor < start || cursor > end
          ? null                                   // outside the recorded range — rendered blank
          : { date: key, count: days[key] || 0 }
      );
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function Grid({ fromKey, toKey: toDate, days }) {
  const weeks = useMemo(() => buildWeeks(fromKey, toDate, days), [fromKey, toDate, days]);
  // The tooltip is one element positioned over the calendar, not a ::after on each cell. A
  // pseudo-element lives inside .streak-cal__scroll, which has overflow-x:auto — so it was
  // clipped at the container's edges, cutting the text off for any day near the left or top.
  const wrapRef = useRef(null);
  const [tip, setTip] = useState(null);

  const show = (event, text) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cell = event.currentTarget.getBoundingClientRect();
    const box = wrap.getBoundingClientRect();
    setTip({
      text,
      // Centre on the cell, then keep the bubble inside the calendar so an edge day still reads.
      x: Math.min(Math.max(cell.left - box.left + cell.width / 2, 70), box.width - 70),
      y: cell.top - box.top
    });
  };
  const hide = () => setTip(null);

  if (!weeks.length) return null;

  // A month label above the first week that contains that month's first days.
  const monthMarks = weeks.map((week, i) => {
    const firstReal = week.find(Boolean);
    if (!firstReal) return null;
    const date = new Date(`${firstReal.date}T00:00:00Z`);
    const previous = weeks[i - 1]?.find(Boolean);
    const previousMonth = previous ? new Date(`${previous.date}T00:00:00Z`).getUTCMonth() : null;
    return date.getUTCMonth() !== previousMonth ? MONTH_LABELS[date.getUTCMonth()] : null;
  });

  return (
    <div className="streak-cal" ref={wrapRef} onMouseLeave={hide}>
      <div className="streak-cal__weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label, i) => <span key={i}>{label}</span>)}
      </div>
      <div className="streak-cal__scroll">
        <div className="streak-cal__months" aria-hidden="true">
          {monthMarks.map((label, i) => <span key={i}>{label}</span>)}
        </div>
        <div className="streak-cal__grid" role="img"
          aria-label={`Practice calendar from ${fromKey} to ${toDate}`}>
          {weeks.map((week, wi) => (
            <div className="streak-cal__week" key={wi}>
              {week.map((day, di) => day === null
                ? <span className="streak-cal__day is-empty" key={di} aria-hidden="true"/>
                : <span
                    key={di}
                    className={`streak-cal__day is-l${level(day.count)}`}
                    aria-label={describeDay(day.date, day.count)}
                    onMouseEnter={(e) => show(e, describeDay(day.date, day.count))}
                    onFocus={(e) => show(e, describeDay(day.date, day.count))}
                    onBlur={hide}
                  />
              )}
            </div>
          ))}
        </div>
      </div>
      {tip && (
        <span className="streak-cal__tip" role="status"
          style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>
          {tip.text}
        </span>
      )}
      <div className="streak-cal__legend">
        <span className="muted">Less</span>
        {[0, 1, 2, 3, 4].map(l => <span key={l} className={`streak-cal__day is-l${l}`} aria-hidden="true"/>)}
        <span className="muted">More</span>
      </div>
    </div>
  );
}

/**
 * The calendar with its range control. "Last 30 days" is the default because it is the view a
 * student checks most often; "Since joining" is the full record the API returned.
 */
export default function StreakCalendar({ activity }) {
  const [range, setRange] = useState("month");
  if (!activity) return null;

  const todayKey = activity.to;
  const monthStart = new Date(`${todayKey}T00:00:00Z`);
  monthStart.setUTCDate(monthStart.getUTCDate() - 29);
  // Never earlier than the day the record actually starts — a 30-day window on a week-old
  // account would otherwise draw three weeks of blanks that look like missed practice.
  const monthFrom = toKey(monthStart) < activity.from ? activity.from : toKey(monthStart);

  const fromKey = range === "month" ? monthFrom : activity.from;
  const activeDays = Object.entries(activity.days || {})
    .filter(([date]) => date >= fromKey && date <= todayKey).length;
  const totalDays = Math.round(
    (Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000) + 1;

  return (
    <div className="streak-calendar">
      <div className="streak-calendar__head">
        <div>
          <StatLabel>{range === "month" ? "Last 30 days" : "Since joining"}</StatLabel>
          <p className="streak-calendar__summary">
            Practised on <b className="num-mono">{activeDays}</b> of{" "}
            <b className="num-mono">{totalDays}</b> days
            {range === "all" && activity.joinedAt && ` since ${activity.joinedAt}`}
            {range === "all" && activity.truncated && " (showing the most recent 53 weeks)"}
          </p>
        </div>
        <div className="filter-group" role="group" aria-label="Calendar range">
          <button type="button" className={range === "month" ? "filter-chip is-active" : "filter-chip"}
            aria-pressed={range === "month"} onClick={() => setRange("month")}>Last 30 days</button>
          <button type="button" className={range === "all" ? "filter-chip is-active" : "filter-chip"}
            aria-pressed={range === "all"} onClick={() => setRange("all")}>Since joining</button>
        </div>
      </div>
      <Grid fromKey={fromKey} toKey={todayKey} days={activity.days || {}}/>
    </div>
  );
}
