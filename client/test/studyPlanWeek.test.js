import { describe, it, expect } from "vitest";
import { buildWeek, weekDates } from "../src/pages/StudyPlan.jsx";

// The plan used to be a rolling "last seven days": it never reset, its weekday labels appeared
// in whatever order the window landed in, and a given weekday changed section every day as the
// window slid. It is anchored to the calendar week now.

const sections = [
  { section: "reading", average: 12 },
  { section: "writing", average: 22 },
  { section: "listening", average: 22 },
  { section: "speaking", average: 24 }
];
const attempt = (section, date) => ({
  section, type: "x", score: 1, maxScore: 1, evaluationStatus: "COMPLETED",
  createdAt: `${date}T10:00:00.000Z`
});

describe("the week is a calendar week", () => {
  it("always starts on Monday and ends on Sunday, whatever day it is", () => {
    for (const today of ["2026-10-03", "2026-10-05", "2026-10-08", "2026-10-11"]) {
      const days = weekDates(new Date(`${today}T12:00:00Z`));
      expect(days).toHaveLength(7);
      expect(new Date(`${days[0]}T00:00:00Z`).getUTCDay()).toBe(1);  // Monday
      expect(new Date(`${days[6]}T00:00:00Z`).getUTCDay()).toBe(0);  // Sunday
      expect(days).toContain(today);
    }
  });

  it("shows the same seven days all week, then resets on Monday", () => {
    const wed = weekDates(new Date("2026-10-07T12:00:00Z"));
    const fri = weekDates(new Date("2026-10-09T12:00:00Z"));
    expect(fri).toEqual(wed);                       // stable within the week

    const nextMon = weekDates(new Date("2026-10-12T12:00:00Z"));
    expect(nextMon).not.toEqual(wed);               // a fresh week
    expect(nextMon[0]).toBe("2026-10-12");
  });

  it("gives a weekday the same focus all week, instead of shifting daily", () => {
    const onWed = buildWeek(sections, [], [], new Date("2026-10-07T12:00:00Z"));
    const onFri = buildWeek(sections, [], [], new Date("2026-10-09T12:00:00Z"));
    expect(onFri.map(d => `${d.weekday}:${d.section || d.kind}`))
      .toEqual(onWed.map(d => `${d.weekday}:${d.section || d.kind}`));
  });
});

describe("the shape of the week", () => {
  const week = buildWeek(sections, [], [], new Date("2026-10-07T12:00:00Z"));

  it("rotates Monday to Friday weakest section first", () => {
    expect(week.slice(0, 5).map(d => d.section)).toEqual(
      ["reading", "writing", "listening", "speaking", "reading"]);
  });

  it("reserves Saturday for a mock and Sunday for review", () => {
    expect(week[5]).toMatchObject({ weekday: "Sat", kind: "mock", section: null });
    expect(week[6]).toMatchObject({ weekday: "Sun", kind: "review", section: null });
  });
});

describe("what counts as done", () => {
  const today = new Date("2026-10-09T12:00:00Z");   // Friday

  it("marks a section day done only from attempts in that section", () => {
    const week = buildWeek(sections, [attempt("writing", "2026-10-06")], [], today);
    expect(week[1]).toMatchObject({ weekday: "Tue", section: "writing", status: "done" });
    // Monday is reading; a writing attempt must not satisfy it.
    expect(week[0].status).toBe("missed");
  });

  it("marks the mock day from a completed mock, never from practice attempts", () => {
    const practice = Array.from({ length: 19 }, () => attempt("reading", "2026-10-10"));
    // Nineteen reading questions on Saturday previously marked the mock as done.
    expect(buildWeek(sections, practice, [], today)[5].status).not.toBe("done");

    const withMock = buildWeek(sections, practice, [{ submittedAt: "2026-10-10T09:00:00.000Z" }], today);
    expect(withMock[5]).toMatchObject({ status: "done", attempts: 1 });
  });

  it("accepts any practice on the review day", () => {
    const week = buildWeek(sections, [attempt("listening", "2026-10-11")], [], today);
    expect(week[6]).toMatchObject({ weekday: "Sun", status: "done" });
  });

  it("separates past, today and upcoming", () => {
    const week = buildWeek(sections, [], [], today);
    expect(week[0].status).toBe("missed");     // Monday, gone
    expect(week[4].status).toBe("today");      // Friday
    expect(week[5].status).toBe("upcoming");   // Saturday, still to come
  });
});
