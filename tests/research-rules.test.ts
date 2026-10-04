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
  assert.match(formatAllFacts(dg, "team"), /FAILED SIE on 2026-09-24.*retake date set within 48 hours/);
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
