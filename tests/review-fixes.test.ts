// Regression tests for defects found in the adversarial review of the rebuild.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePace, formatPaceFacts } from "../app/api/pace.ts";
import { assessReadiness, formatReadinessFacts, trailingAverageAsOf } from "../app/api/readiness.ts";
import { buildCheckpoint, evaluateCheckpoint } from "../app/api/checkpoint.ts";
import { extractReport } from "../app/api/report-extract.ts";
import { MemoryStore } from "../app/api/memory-store.ts";
import { loadDiagnosis, formatAllFacts, reportAgeDays } from "../app/api/diagnose.ts";
import { makeReport, fullExam, activeOn } from "./helpers.ts";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const donePace = (today: string, examDate = "2026-10-20") =>
  computePace({ pagesRead: 150, pagesTotal: 150, readingMinutesLeft: 0, examDate, today: d(today) });

test("gold standard counts only the 3 most recent full exams: old 80s don't offset a slide below the cut", () => {
  const today = "2026-09-20";
  const attempts = [
    fullExam("SIE full exam", "2026-09-19", 65), fullExam("Final exam B", "2026-09-17", 64), fullExam("Final exam A", "2026-09-15", 66),
    fullExam("Final exam C", "2026-08-20", 84), fullExam("Final exam D", "2026-08-18", 83), fullExam("Final exam E", "2026-08-16", 82),
  ];
  const r = assessReadiness({ report: makeReport({ reportDate: today, readiness: 85, daily: activeOn([today]), attempts }), pace: donePace(today), exam: "SIE" });
  assert.equal(r.goldStandard.met, false);
  assert.ok(r.failureModes.includes("plateau_below_cut"));
});

test("an abandoned full exam (quit at 12%) is not a timed full-length", () => {
  const today = "2026-09-20";
  const quit = { ...fullExam("SIE full exam", "2026-09-19", 100, 6, 105), completionPct: 12 };
  const r = assessReadiness({ report: makeReport({ reportDate: today, daily: activeOn([today]), attempts: [quit] }), pace: donePace(today) });
  assert.equal(r.timed.length, 0);
  assert.equal(r.neverTested, true);
  assert.equal(r.phase, 2);
});

test("no study days in the 1-month window reads as dormant, not green", () => {
  const today = "2026-09-20";
  const quiet = assessReadiness({
    report: makeReport({ reportDate: today, pagesRead: 60, studyWindowEmpty: true, missing: ["daily"] }),
    pace: computePace({ pagesRead: 60, pagesTotal: 150, readingMinutesLeft: 400, examDate: "2026-12-20", today: d(today) }),
  });
  assert.equal(quiet.darkDays, 30);
  assert.ok(quiet.failureModes.includes("dormant"));
  assert.notEqual(quiet.dot, "green");

  const logged = assessReadiness({
    report: makeReport({ reportDate: today, pagesRead: 60, lastAccess: "2026-09-08", missing: ["daily"] }),
    pace: computePace({ pagesRead: 60, pagesTotal: 150, readingMinutesLeft: 400, examDate: "2026-12-20", today: d(today) }),
  });
  assert.equal(logged.darkDays, 12, "falls back to the activity log's last access date");
});

test("a target date that just passed over New Year resolves to the past year", () => {
  const r = extractReport("FINRA SIE Study report\nTest Sponsor (t@example.com)\n1/4/27, 9:00 AM\nSTUDY PLAN\nTarget date: Monday, December 28th\nAT RISK\n");
  assert.equal(r.reportDate, "2027-01-04");
  assert.equal(r.targetDate, "2026-12-28");
  const later = extractReport("FINRA SIE Study report\n11/20/26, 9:00 AM\nSTUDY PLAN\nTarget date: Friday, January 8th\n");
  assert.equal(later.targetDate, "2027-01-08");
});

test("attendance promise '3 of the next 4 days' counts the day it was set", () => {
  const set = "2026-09-20";
  const report = makeReport({ reportDate: set, pagesRead: 60, daily: activeOn(["2026-09-01"]) });
  const pace = computePace({ pagesRead: 60, pagesTotal: 150, readingMinutesLeft: 400, examDate: "2026-12-20", today: d(set) });
  const r = assessReadiness({ report, pace });
  assert.equal(r.primaryMode, "dormant");
  const cp = buildCheckpoint({ report, pace, readiness: r, today: set });
  assert.equal(cp.metric, "active_days");
  const later = makeReport({ reportDate: "2026-09-23", pagesRead: 70, daily: activeOn(["2026-09-01", "2026-09-20", "2026-09-21", "2026-09-22"]) });
  const lp = computePace({ pagesRead: 70, pagesTotal: 150, readingMinutesLeft: 350, examDate: "2026-12-20", today: d("2026-09-23") });
  const graded = evaluateCheckpoint(cp, { report: later, readiness: assessReadiness({ report: later, pace: lp }), today: "2026-09-23" });
  assert.equal(graded.status, "HIT");
});

test("Phase 1 with unknown page counts never gets an exam promise", () => {
  const today = "2026-09-20";
  const report = makeReport({ reportDate: today, pagesRead: null, pagesTotal: null, readingMinutesLeft: null, daily: activeOn([today]) });
  const pace = computePace({ pagesRead: null, pagesTotal: null, examDate: "2026-12-20", today: d(today) });
  const r = assessReadiness({ report, pace });
  assert.equal(r.phase, 1);
  const cp = buildCheckpoint({ report, pace, readiness: r, today });
  assert.equal(cp.metric, "active_days");
  assert.match(cp.text, /reading first/);
});

test("a passed book deadline spreads the rest over the days left; a passed exam gets no quota at all", () => {
  const late = computePace({ pagesRead: 80, pagesTotal: 150, readingMinutesLeft: 420, examDate: "2026-10-07", today: d("2026-10-04") });
  assert.equal(late.deadlinePassed, true);
  assert.equal(late.daysToDeadline, 2);
  assert.equal(late.requiredMinutesPerDay, 210);
  const lateText = formatPaceFacts(late);
  assert.match(lateText, /BOOK DEADLINE was 2026-10-02 — ALREADY PASSED/);
  assert.doesNotMatch(lateText, /day\(s\) from today/);

  const over = computePace({ pagesRead: 80, pagesTotal: 150, readingMinutesLeft: 420, examDate: "2026-09-30", today: d("2026-10-04") });
  assert.equal(over.examPassed, true);
  const overText = formatPaceFacts(over);
  assert.match(overText, /EXAM DATE 2026-09-30 HAS PASSED/);
  assert.doesNotMatch(overText, /QUOTA|PACE STATUS/);
});

test("sponsor facts carry Achievable's own meter and only forbid OUR readiness number", async () => {
  const store = new MemoryStore();
  const sp = await store.createSponsor({ name: "Meter Sponsor", exam: "SIE", examDate: "2026-12-20" });
  const r = makeReport({ reportDate: "2026-09-20", pagesRead: 60, readiness: 38, daily: activeOn(["2026-09-20"]) });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: "2026-09-20", pagesRead: 60, pagesTotal: 150, readiness: 38, calibrated: null, phase: null, primaryMode: null, dot: null, data: r, kaplan: null, createdBy: "t" });
  const dg = (await loadDiagnosis(store, sp.id))!;
  const facts = formatAllFacts(dg, "sponsor");
  assert.match(facts, /ACHIEVABLE'S OWN READINESS METER: 38%/);
  assert.match(formatReadinessFacts(dg.readiness, "sponsor"), /Do NOT quote OUR readiness score/);
  assert.doesNotMatch(facts, /calibrated/i);
});

test("a PDF-only upload keeps last week's Kaplan data; a Kaplan-only upload keeps the Achievable report", async () => {
  const store = new MemoryStore();
  const sp = await store.createSponsor({ name: "Carry Sponsor", exam: "SIE", examDate: "2026-10-20" });
  const attempts = [fullExam("Final exam A", "2026-09-10", 78), fullExam("Final exam B", "2026-09-12", 79)];
  const kaplan = { answered: 810, total: 1000, avgScore: 74, sims: [1, 2, 3].map(i => ({ name: `sim ${i}`, score: 74, date: `2026-09-1${i + 3}`, minutesUsed: 100, minutesAllowed: 112 })) };
  const r1 = makeReport({ reportDate: "2026-09-17", attempts, daily: activeOn(["2026-09-17"]) });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: "2026-09-17", pagesRead: 150, pagesTotal: 150, readiness: 80, calibrated: null, phase: null, primaryMode: null, dot: null, data: r1, kaplan, createdBy: "t" });
  const before = (await loadDiagnosis(store, sp.id))!;
  assert.equal(before.readiness.bankBurnout, true);

  const r2 = makeReport({ reportDate: "2026-09-20", attempts, daily: activeOn(["2026-09-19", "2026-09-20"]) });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: "2026-09-20", pagesRead: 150, pagesTotal: 150, readiness: 81, calibrated: null, phase: null, primaryMode: null, dot: null, data: r2, kaplan: null, createdBy: "t" });
  const pdfOnly = (await loadDiagnosis(store, sp.id))!;
  assert.equal(pdfOnly.readiness.bankBurnout, true, "Kaplan exposure carried forward");
  assert.equal(pdfOnly.readiness.phase, before.readiness.phase);

  const bare = makeReport({ reportDate: "2026-09-22", pagesRead: null, pagesTotal: null, readingMinutesLeft: null, attempts: [], daily: [] });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: "2026-09-22", pagesRead: null, pagesTotal: null, readiness: null, calibrated: null, phase: null, primaryMode: null, dot: null, data: bare, kaplan, createdBy: "t" });
  const kaplanOnly = (await loadDiagnosis(store, sp.id))!;
  assert.notEqual(kaplanOnly.readiness.phase, 1, "book stays finished");
  assert.equal(kaplanOnly.report.pagesRead, 150);
  assert.equal(kaplanOnly.today, "2026-09-22");
});

test("predicted-at-sit uses only practice exams dated on or before the sit", () => {
  const report = makeReport({ attempts: [fullExam("Final exam A", "2026-06-01", 74), fullExam("Final exam B", "2026-09-14", 85), fullExam("SIE full exam", "2026-09-19", 86)] });
  assert.equal(trailingAverageAsOf(report, null, "2026-06-04"), 74);
  assert.equal(trailingAverageAsOf(report, null, "2026-05-01"), null);
});

test("report age is measured against the real date", () => {
  assert.equal(reportAgeDays({ today: "2026-09-26" }, new Date("2026-10-04T15:00:00Z")), 8);
  assert.equal(reportAgeDays({ today: "2026-10-04" }, new Date("2026-10-04T23:00:00Z")), 0);
});
