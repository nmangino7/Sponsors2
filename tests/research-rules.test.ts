// Rules added from the Outlook / Slack / Krisp research sweep (10/4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePace } from "../app/api/pace.ts";
import { assessReadiness } from "../app/api/readiness.ts";
import { buildCheckpoint, evaluateCheckpoint } from "../app/api/checkpoint.ts";
import { computeDiagnosis, formatAllFacts } from "../app/api/diagnose.ts";
import { makeReport, fullExam, activeOn } from "./helpers.ts";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const donePace = (today: string, examDate = "2026-10-20") =>
  computePace({ pagesRead: 150, pagesTotal: 150, readingMinutesLeft: 0, examDate, today: d(today) });

test("an exam that ran past the clock (316 of 105 min) is shown but never counted", () => {
  const today = "2026-10-04";
  const attempts = [fullExam("SIE full exam", "2026-10-02", 77, 316, 105), fullExam("Final exam B", "2026-09-30", 64), fullExam("Final exam A", "2026-09-28", 63)];
  const r = assessReadiness({ report: makeReport({ reportDate: today, daily: activeOn([today]), attempts }), pace: donePace(today), exam: "SIE" });
  assert.equal(r.untimed.length, 1);
  assert.equal(r.timed.length, 2);
  assert.equal(r.trailing3, 63.5, "the 77% doesn't lift the trailing average");
});

test("money phrasings from the team's notes read as materials unpaid", () => {
  const today = "2026-10-04";
  for (const note of ["9/9 AW: Allan is unable to purchase study materials until next wednesday", "keeps pushing back saying he's waiting to be paid", "doesn't have $50 for the achievable course"]) {
    const r = assessReadiness({ report: makeReport({ reportDate: today, pagesRead: 10, daily: activeOn([today]) }),
      pace: computePace({ pagesRead: 10, pagesTotal: 150, readingMinutesLeft: 900, examDate: "2026-11-20", today: d(today) }), notes: [note] });
    assert.ok(r.failureModes.includes("materials_unpaid"), note);
  }
});

function diag(o: { examDate: string; sits?: { examType: string; date: string; outcome: "PASS" | "FAIL" | "PENDING"; predictedAtSit: number | null }[]; attempts?: ReturnType<typeof fullExam>[] }) {
  const today = "2026-10-04";
  return computeDiagnosis({
    report: makeReport({ reportDate: today, daily: activeOn([today]), attempts: o.attempts ?? [] }), kaplan: null, today, exam: "SIE", examDate: o.examDate,
    previous: null, sits: (o.sits ?? []).map((s, i) => ({ ...s, id: `s${i}`, sponsorId: "x", score: null, createdBy: "t", createdAt: today })), notes: [], emails: [],
  });
}

test("after a pass with no next date: congratulate, and the promise is the next exam date", () => {
  const dg = diag({ examDate: "2026-10-01", sits: [{ examType: "SIE", date: "2026-10-01", outcome: "PASS", predictedAtSit: 82 }] });
  assert.match(formatAllFacts(dg, "sponsor"), /PASSED SIE on 2026-10-01\. Open with congratulations/);
  assert.equal(dg.next.metric, "exam_scheduled");
  const later = diag({ examDate: "2026-10-30", sits: [{ examType: "SIE", date: "2026-10-01", outcome: "PASS", predictedAtSit: 82 }] });
  assert.equal(evaluateCheckpoint(dg.next, { report: later.report, readiness: later.readiness, today: "2026-10-08" }).status, "HIT");
  assert.doesNotMatch(formatAllFacts(later, "sponsor"), /REAL EXAM/, "once the next date is set, the old sit isn't the headline");
});

test("after a fail: debrief and retake date within 48 hours", () => {
  const dg = diag({ examDate: "2026-09-24", sits: [{ examType: "SIE", date: "2026-09-24", outcome: "FAIL", predictedAtSit: 74 }] });
  assert.match(formatAllFacts(dg, "team"), /FAILED SIE on 2026-09-24.*next exam date \(retake or the next exam in their path\) set within 48 hours/);
});

test("exam within a week without the gold standard: a go/no-go call for the team, never shown to the sponsor", () => {
  const dg = diag({ examDate: "2026-10-08", attempts: [fullExam("Final exam A", "2026-10-01", 78)] });
  assert.match(formatAllFacts(dg, "team"), /GO\/NO-GO DECISION NEEDED \(team only\): exam in 4 day\(s\)/);
  assert.doesNotMatch(formatAllFacts(dg, "sponsor"), /GO\/NO-GO/);
});

test("the dormant / Phase 1 promise logic is unchanged by the new exam-date branch", () => {
  const today = "2026-10-04";
  const report = makeReport({ reportDate: today, pagesRead: 60, daily: activeOn([today]) });
  const pace = computePace({ pagesRead: 60, pagesTotal: 150, readingMinutesLeft: 500, examDate: "2026-11-20", today: d(today) });
  assert.equal(buildCheckpoint({ report, pace, readiness: assessReadiness({ report, pace, examDate: "2026-11-20" }), today }).metric, "pages_read");
});

test("no exam date on file: the promise is booking one", () => {
  const today = "2026-10-04";
  const report = makeReport({ reportDate: today, pagesRead: 14, pagesTotal: 150, readingMinutesLeft: 900, daily: activeOn([today]) });
  const pace = computePace({ pagesRead: 14, pagesTotal: 150, readingMinutesLeft: 900, examDate: null, today: d(today) });
  const cp = buildCheckpoint({ report, pace, readiness: assessReadiness({ report, pace, exam: "LAH" }), today });
  assert.equal(cp.metric, "exam_scheduled");
  assert.equal(cp.text, "Book your LAH and reply with the date by Wednesday 10/7.");
});

// Found by running the real off-track roster through the app (10/4).
test("an unreachable 2-week target slides to the 5-day floor instead of an 8-hour quota", () => {
  // 26/150 pages, exam 10/20: the 10/6 target would need ~62 pages (8 hours) a day.
  const p = computePace({ pagesRead: 26, pagesTotal: 150, examDate: "2026-10-20", today: d("2026-10-04") });
  assert.equal(p.usingFloor, true);
  assert.equal(p.targetUnreachable, true);
  assert.equal(p.bookDeadline, "2026-10-15");
  assert.equal(p.requiredPagesPerDay, 12);
  const healthy = computePace({ pagesRead: 120, pagesTotal: 150, examDate: "2026-10-31", today: d("2026-10-04") });
  assert.equal(healthy.usingFloor, false, "a reachable target stays the 2-week target");
});

test("timed exams below the cut turn the dot red, even with only two of them", () => {
  const today = "2026-10-04";
  const attempts = [fullExam("SIE full exam", "2026-10-02", 64), fullExam("Final exam B", "2026-09-30", 63), fullExam("Final exam A", "2026-09-28", 77, 316, 105)];
  const r = assessReadiness({ report: makeReport({ reportDate: today, daily: activeOn(["2026-10-03", today]), attempts }), pace: donePace(today, "2026-10-13"), exam: "SIE", examDate: "2026-10-13" });
  assert.equal(r.dot, "red");
  assert.ok(r.failureModes.includes("plateau_below_cut"));
  assert.equal(r.goNoGo, true, "9 days out without the gold standard");
});

test("no Achievable data is not 'not started'; a fail with no next date is red", () => {
  const today = "2026-10-04";
  const report = makeReport({ reportDate: today, exam: null, course: null, pagesRead: null, pagesTotal: null, readingMinutesLeft: null, studyMin: null, readingMin: null, quizMin: null });
  const pace = computePace({ pagesRead: null, pagesTotal: null, examDate: null, today: d(today) });
  const r = assessReadiness({ report, pace, exam: "LAH", realSits: [{ examType: "SIE", date: "2026-09-24", outcome: "FAIL", predictedAtSit: 79 }] });
  assert.ok(!r.failureModes.includes("not_started"));
  assert.equal(r.dot, "red");
  assert.match(r.dotReason, /failed SIE 09\/24 — no next exam date/);
});
