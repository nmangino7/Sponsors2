// The free writer: plan + emails from computed facts, no AI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractReport } from "../app/api/report-extract.ts";
import { computeDiagnosis, cardDiagnosis } from "../app/api/diagnose.ts";
import { sponsorEmail, teamEmail, draftPlan, parseWriter } from "../app/api/templates.ts";
import { parseKaplanText } from "../app/api/kaplan-text.ts";
import { makeReport, fullExam, activeOn } from "./helpers.ts";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday"];
const phase1 = extractReport(readFileSync("tests/fixtures/report-phase1-stacked.txt", "utf8"));
const examPhase = extractReport(readFileSync("tests/fixtures/report-attempts-inline.txt", "utf8"));
const diag = (report = phase1, o: Partial<Parameters<typeof computeDiagnosis>[0]> = {}) => computeDiagnosis({
  report, kaplan: null, today: report.reportDate!, exam: "SIE", examDate: "2026-06-30", previous: null, sits: [], notes: [], emails: [], ...o,
});
const TEAM_ONLY = /calibrat|pass odds|base \d|% Ready|GO\/NO-GO|DM ESCALATION/i;

test("unknown writer values fall back to the free writer", () => {
  assert.equal(parseWriter(undefined), "free");
  assert.equal(parseWriter("anything"), "free");
  assert.equal(parseWriter("api"), "api");
  assert.equal(parseWriter("claude-app"), "claude-app");
});

test("the extractor reads Achievable's own next reading assignment", () => {
  assert.deepEqual(phase1.planReading.map(p => p.section), ["9.3.7 Index options", "10.1 Dividends"]);
});

test("Phase 1 sponsor email: quota first, the promise word for word, one reply question, no internal numbers", () => {
  const d = diag();
  const email = sponsorEmail(d, { name: "Test Sponsor" }, days);
  assert.match(email, /^Hey Test,/);
  assert.match(email, /TODAY'S READING: 2h 34m \(~37 pages\)/);
  assert.match(email, /BOOK: 77\/150 \(51%\)/);
  assert.match(email, /ACHIEVABLE READINESS: 38%/);
  assert.ok(email.includes(d.next.text), "closes with the computed promise");
  assert.match(email, /Reply with the exact time you'll read each day this week/);
  assert.match(email, /start with 9\.3\.7 Index options/);
  assert.doesNotMatch(email, TEAM_ONLY);
  assert.doesNotMatch(email, /move (your|the) (exam|test)|reschedul/i);
  assert.match(email, /Your Sponsorship Team$/);
});

test("Phase 1 plan: reading leads every day until the book is done, then the first timed full exam", () => {
  const plan = draftPlan(diag(), days);
  assert.match(plan.actions[0][0], /^Reading — to page 114\/150/);
  assert.match(plan.actions[1][0], /^Reading — finish the book/);
  assert.match(plan.actions[2][0], /first timed Achievable full exam/);
  assert.match(plan.status, /^Phase 1 — Finish the book/);
});

test("exam-phase email: counts only timed exams at real pace, no internal numbers", () => {
  const d = diag(examPhase, { examDate: "2026-10-20", kaplan: { answered: 300, total: 1000, avgScore: null, sims: [{ name: "Kaplan Sim 1", score: 76, date: "2026-09-19", minutesUsed: 50, minutesAllowed: 112 }] } });
  const email = sponsorEmail(d, { name: "Test Sponsor Two" }, days);
  assert.match(email, /EXAM TARGET: 3 timed full exams in the 80s — you have 0 of 3 that count/);
  assert.match(email, /finishing full exams in about \d+% of the time/);
  assert.match(email, /Reply with the day and time you'll take your next timed full exam/);
  assert.doesNotMatch(email, TEAM_ONLY);
  assert.doesNotMatch(email, /TODAY'S READING/);
});

test("short emails: result missing asks only for the result; dormant asks only for one small step", () => {
  const missing = sponsorEmail(diag(phase1, { examDate: "2026-06-10" }), { name: "Test Sponsor" }, days);
  assert.match(missing, /how did it go\? Reply with your result/);
  assert.doesNotMatch(missing, /TODAY'S READING|MONDAY/);

  const quiet = makeReport({ reportDate: "2026-09-20", pagesRead: 40, pagesTotal: 150, readingMinutesLeft: 800, daily: activeOn(["2026-09-05"]) });
  const dormant = sponsorEmail(diag(quiet, { examDate: "2026-11-20" }), { name: "Quiet Sponsor" }, days);
  assert.match(dormant, /It's been 15 days since you last studied\. No lecture/);
  assert.doesNotMatch(dormant, TEAM_ONLY);
});

test("after a real pass the email congratulates and asks for the next date", () => {
  const r = makeReport({ reportDate: "2026-10-04", daily: activeOn(["2026-10-03"]), attempts: [fullExam("Final exam A", "2026-09-28", 84)] });
  const d = computeDiagnosis({ report: r, kaplan: null, today: "2026-10-04", exam: "SIE", examDate: "2026-10-01", previous: null,
    sits: [{ id: "s", sponsorId: "x", examType: "SIE", date: "2026-10-01", outcome: "PASS", score: 78, predictedAtSit: 82, createdBy: "t", createdAt: "2026-10-01" }], notes: [], emails: [] });
  const email = sponsorEmail(d, { name: "Pass Sponsor" }, days);
  assert.match(email, /Congratulations on passing the SIE/);
  assert.match(email, /Reply with your next exam date — booked/);
});

test("the plan card's own tasks are used when the team edited them", () => {
  const email = sponsorEmail(diag(), { name: "Test Sponsor", actions: ["Read 10.1-10.3 (60-75 min); Quiz 10.1 (15 min)", "", "", ""] }, days);
  assert.match(email, /MONDAY\n• Read 10\.1-10\.3 \(60-75 min\)\n• Quiz 10\.1 \(15 min\)/);
});

test("team email: red first, calibrated numbers and the go/no-go call are there for the team", () => {
  const red = diag();
  const soon = diag(examPhase, { examDate: "2026-09-24" });
  const email = teamEmail([{ card: { name: "Green-ish Sponsor" }, d: soon }, { card: { name: "Red Sponsor" }, d: red }], days, "Sunday, October 4, 2026", "");
  assert.ok(email.indexOf("Red Sponsor") < email.indexOf("Green-ish Sponsor"), "red first");
  assert.match(email, /GO\/NO-GO: exam in 4 day\(s\)/);
  assert.match(email, /% Ready: never tested/);
  assert.match(email, /Next promise: "/);
  assert.match(email, /Sponsorship Coordination$/);
});

test("a typed-in sponsor with no report still gets the pace math", () => {
  const d = cardDiagnosis({ name: "Typed Sponsor", exam: "SIE", examDate: "2026-11-01", pagesRead: 50, pagesTotal: 150, readingTimeLeft: "10h" }, "2026-10-04");
  assert.equal(d.readiness.phase, 1);
  assert.match(sponsorEmail(d, { name: "Typed Sponsor" }, days), /TODAY'S READING: \d+ min/);
});

test("typed Kaplan numbers parse into bank exposure and sims", () => {
  const k = parseKaplanText("Answered 810 of 1000\nSim 1 74% 9/20 100/112 min\nSimulated Exam 2 - 68% 9/22", 2026)!;
  assert.equal(k.answered, 810);
  assert.equal(k.total, 1000);
  assert.deepEqual(k.sims.map(s => [s.name, s.score, s.date, s.minutesUsed, s.minutesAllowed]), [
    ["Sim 1", 74, "2026-09-20", 100, 112],
    ["Simulated Exam 2", 68, "2026-09-22", null, null],
  ]);
  assert.equal(parseKaplanText("   "), null);
});
