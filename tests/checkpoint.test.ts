import { test } from "node:test";
import assert from "node:assert/strict";
import { computePace } from "../app/api/pace.ts";
import { assessReadiness } from "../app/api/readiness.ts";
import { buildCheckpoint, evaluateCheckpoint, missStreak, formatCheckpointFacts } from "../app/api/checkpoint.ts";
import { makeReport, fullExam, activeOn } from "./helpers.ts";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const MON = "2026-06-15";

function phase1(pagesRead: number, today = MON, reportDate = today) {
  const report = makeReport({ pagesRead, pagesTotal: 150, readingMinutesLeft: 300, reportDate, daily: activeOn([reportDate]) });
  const pace = computePace({ pagesRead, pagesTotal: 150, readingMinutesLeft: 300, examDate: "2026-07-15", today: d(today) });
  return { report, pace, readiness: assessReadiness({ report, pace, examDate: "2026-07-15" }) };
}

test("Phase 1 checkpoint: exact page target, due at the end of the 4-day plan", () => {
  const { report, pace, readiness } = phase1(77);
  const cp = buildCheckpoint({ report, pace, readiness, today: MON });
  assert.equal(cp.metric, "pages_read");
  assert.equal(cp.due, "2026-06-18");
  assert.equal(cp.target, 77 + 5 * 3);
  assert.equal(cp.text, "The book at 92/150 pages by Thursday 6/18. I'm pulling your Achievable report that morning.");
});

test("grading: HIT, PARTIAL, MISSED after the due date; PENDING before it", () => {
  const s = phase1(77);
  const cp = buildCheckpoint({ ...s, today: MON });
  const grade = (pages: number, day: string) => {
    const n = phase1(pages, day, day);
    return evaluateCheckpoint(cp, { report: n.report, readiness: n.readiness, today: day });
  };
  assert.equal(grade(95, "2026-06-18").status, "HIT");
  const partial = grade(85, "2026-06-19");
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.shortBy, 7);
  assert.match(partial.text, /PARTIAL — they reached 85\/150, 7 pages short/);
  assert.equal(grade(77, "2026-06-19").status, "MISSED");
  assert.equal(grade(80, "2026-06-17").status, "PENDING");
  assert.equal(grade(95, "2026-06-17").status, "HIT", "hitting early counts");
});

test("exam-phase checkpoint counts new timed exams at the minimum score", () => {
  const today = "2026-09-20";
  const report = makeReport({ reportDate: today, daily: activeOn([today]), attempts: [fullExam("Final exam A", "2026-09-18", 74)] });
  const pace = computePace({ pagesRead: 150, pagesTotal: 150, readingMinutesLeft: 0, examDate: "2026-10-15", today: d(today) });
  const readiness = assessReadiness({ report, pace, exam: "SIE", examDate: "2026-10-15" });
  const cp = buildCheckpoint({ report, pace, readiness, today });
  assert.equal(cp.metric, "timed_full_lengths");
  assert.equal(cp.baseline, 1);
  assert.equal(cp.target, 3);
  assert.equal(cp.minScore, 75);

  const later = (scores: number[]) => {
    const r2 = makeReport({ reportDate: "2026-09-24", daily: activeOn(["2026-09-24"]), attempts: [fullExam("Final exam A", "2026-09-18", 74), ...scores.map((s, i) => fullExam(`SIE full exam ${i}`, `2026-09-2${i + 1}`, s))] });
    const rd2 = assessReadiness({ report: r2, pace, exam: "SIE", examDate: "2026-10-15" });
    return evaluateCheckpoint(cp, { report: r2, readiness: rd2, today: "2026-09-24" });
  };
  assert.equal(later([78, 81]).status, "HIT");
  assert.equal(later([70]).status, "PARTIAL", "took an exam but not at 75%+");
  assert.equal(later([]).status, "MISSED");
});

test("dormant sponsors get an attendance checkpoint", () => {
  const today = "2026-09-20";
  const report = makeReport({ reportDate: today, pagesRead: 40, readingMinutesLeft: 400, daily: activeOn(["2026-09-08"]) });
  const pace = computePace({ pagesRead: 40, pagesTotal: 150, readingMinutesLeft: 400, examDate: "2026-11-15", today: d(today) });
  const readiness = assessReadiness({ report, pace });
  assert.equal(readiness.primaryMode, "dormant");
  const cp = buildCheckpoint({ report, pace, readiness, today });
  assert.equal(cp.metric, "active_days");
  const after = makeReport({ reportDate: "2026-09-23", daily: activeOn(["2026-09-21", "2026-09-22", "2026-09-23"]) });
  assert.equal(evaluateCheckpoint(cp, { report: after, readiness, today: "2026-09-23" }).status, "HIT");
});

test("miss streak escalates to the DM after two misses", () => {
  const s = phase1(77);
  const cp = buildCheckpoint({ ...s, today: MON });
  const r = (status: "HIT" | "PARTIAL" | "MISSED" | "PENDING") => ({ checkpoint: cp, status, actual: 0, shortBy: 0, text: "" });
  assert.equal(missStreak([r("MISSED"), r("PARTIAL"), r("HIT"), r("MISSED")]), 2);
  assert.equal(missStreak([r("HIT"), r("MISSED")]), 0);
  assert.equal(missStreak([r("PENDING"), r("MISSED")]), 1);
  const team = formatCheckpointFacts(r("MISSED"), 2, cp, "team");
  assert.match(team, /DM ESCALATION/);
  assert.match(team, /close the email with exactly this one promise/);
});

test("exam date passed with no result: the promise is the result, not more reading", () => {
  const day = "2026-06-18";
  const report = makeReport({ pagesRead: 86, pagesTotal: 150, readingMinutesLeft: 270, reportDate: day, daily: activeOn([day]) });
  const pace = computePace({ pagesRead: 86, pagesTotal: 150, readingMinutesLeft: 270, examDate: "2026-06-17", today: d(day) });
  const missing = assessReadiness({ report, pace, examDate: "2026-06-17" });
  assert.equal(missing.primaryMode, "result_missing");
  const cp = buildCheckpoint({ report, pace, readiness: missing, today: day });
  assert.equal(cp.metric, "result_reported");
  assert.match(cp.text, /^Reply with your exam result — pass or fail, and your score — by Sunday 6\/21\./);

  const later = "2026-06-22";
  const stillMissing = evaluateCheckpoint(cp, { report, readiness: assessReadiness({ report, pace, examDate: "2026-06-17" }), today: later });
  assert.equal(stillMissing.status, "MISSED");
  assert.match(stillMissing.text, /still no result on file/);
  const recorded = assessReadiness({ report, pace, examDate: "2026-06-17", realSits: [{ examType: "SIE", date: "2026-06-17", outcome: "FAIL", predictedAtSit: 72 }] });
  assert.equal(evaluateCheckpoint(cp, { report, readiness: recorded, today: later }).status, "HIT");
});
