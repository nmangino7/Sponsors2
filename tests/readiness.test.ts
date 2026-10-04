import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractReport } from "../app/api/report-extract.ts";
import { computePace } from "../app/api/pace.ts";
import { assessReadiness, formatReadinessFacts } from "../app/api/readiness.ts";
import { makeReport, fullExam, activeOn } from "./helpers.ts";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const donePace = (today: string) => computePace({ pagesRead: 150, pagesTotal: 150, readingMinutesLeft: 0, examDate: "2026-10-15", today: d(today) });

test("real Phase-1 report: reading stalled + comfort quizzing, never tested but no score published", () => {
  const report = extractReport(readFileSync(new URL("./fixtures/report-phase1-stacked.txt", import.meta.url), "utf8"));
  const pace = computePace({
    pagesRead: report.pagesRead, pagesTotal: report.pagesTotal, readingMinutesLeft: report.readingMinutesLeft,
    examDate: report.targetDate, today: d(report.reportDate!), firstActivityDate: report.firstActivity,
  });
  const r = assessReadiness({ report, pace });
  assert.equal(r.phase, 1);
  assert.ok(r.failureModes.includes("reading_stalled"));
  assert.ok(r.failureModes.includes("comfort_quizzing"), "70h of quizzes vs 20h reading");
  assert.ok(!r.failureModes.includes("never_tested"), "never-tested only applies once the book is done");
  assert.equal(r.neverTested, true);
  assert.equal(r.published, null, "no readiness score with zero timed full-lengths");
  assert.equal(r.dot, "red");
  assert.equal(r.last4AvgMin, 147);
});

test("the Villacres case is NOT ready: 80s on practice, but rushed, bank-burned, and failed twice", () => {
  const today = "2026-09-20";
  const report = makeReport({
    readiness: 89, reportDate: today,
    attempts: [fullExam("SIE full exam", "2026-09-19", 88, 50), fullExam("Final exam B", "2026-09-17", 86, 52), fullExam("Final exam A", "2026-09-15", 84, 48)],
    daily: activeOn(["2026-09-18", "2026-09-19", "2026-09-20"]),
  });
  const r = assessReadiness({
    report, pace: donePace(today), exam: "SIE", examDate: "2026-10-15",
    kaplan: { answered: 2186, total: 2715, avgScore: 84, sims: [
      { name: "kaplan sim 1", score: 84, date: "2026-09-16", minutesUsed: 55, minutesAllowed: 112 },
    ] },
    realSits: [
      { examType: "SIE", date: "2026-06-04", outcome: "FAIL", predictedAtSit: 88 },
      { examType: "SIE", date: "2026-08-20", outcome: "FAIL", predictedAtSit: 84 },
    ],
  });
  assert.equal(r.bankBurnout, true);
  assert.equal(r.rushing, true);
  assert.equal(r.penalty, 19.2, "0.6×18 + 0.6×14");
  assert.ok(r.calibrated! < 80, `calibrated ${r.calibrated} must be under the bar`);
  assert.equal(r.goldStandard.met, false);
  assert.equal(r.goldStandard.qualifying, 0, "fast finishes don't count toward the gold standard");
  assert.ok(r.failureModes.includes("bank_burnout"));
  assert.notEqual(r.dot, "green");
  assert.notEqual(r.band, "green");
  const team = formatReadinessFacts(r, "team");
  assert.match(team, /RUSHING/);
  assert.match(team, /BANK BURNOUT/);
  assert.match(team, /prior real SIE fails/);
  const sponsor = formatReadinessFacts(r, "sponsor");
  assert.doesNotMatch(sponsor, /calibrated|pass odds ~/i, "sponsors never see the reality discount");
});

test("genuinely ready: 3 timed 80s at real pace, fresh bank, no fails", () => {
  const today = "2026-09-20";
  const report = makeReport({
    readiness: 90, reportDate: today,
    attempts: [fullExam("SIE full exam", "2026-09-19", 88), fullExam("Final exam B", "2026-09-17", 86), fullExam("Final exam A", "2026-09-15", 84)],
    daily: activeOn(["2026-09-19", "2026-09-20"]),
  });
  const r = assessReadiness({ report, pace: donePace(today), exam: "SIE", examDate: "2026-10-15", kaplan: { answered: 1000, total: 2715, avgScore: 80, sims: [] } });
  assert.equal(r.goldStandard.met, true, r.goldStandard.gaps.map(g => g.text).join("; "));
  assert.equal(r.phase, 3);
  assert.equal(r.band, "green");
  assert.equal(r.dot, "green");
  assert.equal(r.failureModes.length, 0);
});

test("book done with zero timed exams: never tested, quiz accuracy gets the 12-point haircut", () => {
  const today = "2026-09-20";
  const report = makeReport({ reportDate: today, quiz7d: { questions: 400, accuracy: 90, topics: [] }, daily: activeOn([today]) });
  const r = assessReadiness({ report, pace: donePace(today) });
  assert.equal(r.evidenceSource, "quiz-minus-12");
  assert.equal(r.evidence, 78);
  assert.equal(r.neverTested, true);
  assert.equal(r.published, null);
  assert.equal(r.phase, 2);
  assert.equal(r.primaryMode, "never_tested");
  assert.match(formatReadinessFacts(r, "team"), /NEVER TESTED/);
});

test("calibration only counts fails at a practice score of 70+, capped at 20", () => {
  const today = "2026-09-20";
  const report = makeReport({ reportDate: today, attempts: [fullExam("SIE full exam", "2026-09-19", 80)], daily: activeOn([today]) });
  const one = assessReadiness({ report, pace: donePace(today), exam: "SIE", realSits: [{ examType: "SIE", date: "2026-05-01", outcome: "FAIL", predictedAtSit: 85 }, { examType: "SIE", date: "2026-04-01", outcome: "FAIL", predictedAtSit: 65 }] });
  assert.equal(one.penalty, 9);
  const many = assessReadiness({ report, pace: donePace(today), exam: "SIE", realSits: [1, 2, 3].map(i => ({ examType: "SIE", date: `2026-0${i}-01`, outcome: "FAIL" as const, predictedAtSit: 95 })) });
  assert.equal(many.penalty, 20);
  const otherExam = assessReadiness({ report, pace: donePace(today), exam: "SIE", realSits: [{ examType: "65", date: "2026-05-01", outcome: "FAIL", predictedAtSit: 95 }] });
  assert.equal(otherExam.penalty, 0, "a Series 65 fail doesn't discount SIE scores");
});

test("failure modes: materials unpaid (from notes), dormant, plateau, result missing, phase 4", () => {
  const today = "2026-09-20";
  const unpaid = assessReadiness({ report: makeReport({ reportDate: today, daily: activeOn([today]) }), pace: donePace(today), notes: ["9/18 AW: still hasn't bought materials yet"] });
  assert.equal(unpaid.primaryMode, "materials_unpaid");
  assert.equal(unpaid.dot, "red");

  const dormant = assessReadiness({ report: makeReport({ reportDate: today, daily: activeOn(["2026-09-10"]) }), pace: donePace(today) });
  assert.ok(dormant.failureModes.includes("dormant"));
  assert.equal(dormant.darkDays, 10);
  assert.equal(dormant.dot, "red");

  const plateau = assessReadiness({
    report: makeReport({ reportDate: today, daily: activeOn([today]), attempts: [fullExam("SIE full exam", "2026-09-19", 66), fullExam("Final exam B", "2026-09-17", 64), fullExam("Final exam A", "2026-09-15", 65)] }),
    pace: donePace(today), exam: "SIE",
  });
  assert.ok(plateau.failureModes.includes("plateau_below_cut"));
  assert.equal(plateau.distanceFromCut, -5);

  const missing = assessReadiness({ report: makeReport({ reportDate: today, daily: activeOn([today]) }), pace: donePace(today), examDate: "2026-09-12" });
  assert.equal(missing.primaryMode, "result_missing");
  assert.equal(missing.dot, "grey");

  const kaplanSims = [1, 2, 3].map(i => ({ name: `sim ${i}`, score: 74, date: `2026-09-1${i}`, minutesUsed: 100, minutesAllowed: 112 }));
  const p4 = assessReadiness({
    report: makeReport({ reportDate: today, daily: activeOn([today]), attempts: [fullExam("Final exam A", "2026-09-05", 76), fullExam("Final exam B", "2026-09-07", 77)] }),
    pace: donePace(today), exam: "SIE", kaplan: { answered: 500, total: 2715, avgScore: 74, sims: kaplanSims },
  });
  assert.equal(p4.phase, 4, "reached Kaplan and still under 80");
});
