import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractReport, avgStudyMinutes, lastActiveDate, durationToMinutes } from "../app/api/report-extract.ts";

const stacked = readFileSync(new URL("./fixtures/report-phase1-stacked.txt", import.meta.url), "utf8");
const inline = readFileSync(new URL("./fixtures/report-attempts-inline.txt", import.meta.url), "utf8");

test("durations parse to minutes", () => {
  assert.equal(durationToMinutes("5h 8m"), 308);
  assert.equal(durationToMinutes("1h 0m"), 60);
  assert.equal(durationToMinutes("10s"), 10 / 60);
  assert.equal(durationToMinutes("56m 33s"), 56 + 33 / 60);
  assert.equal(durationToMinutes(""), null);
});

test("stacked layout: identity, header tiles, plan", () => {
  const r = extractReport(stacked);
  assert.equal(r.name, "Test Sponsor");
  assert.equal(r.email, "test.sponsor@example.com");
  assert.equal(r.achievableUuid, "00000000-1111-4222-8333-444444444444");
  assert.equal(r.course, "finra-sie");
  assert.equal(r.exam, "SIE");
  assert.equal(r.reportDate, "2026-06-14");
  assert.equal(r.pagesRead, 77);
  assert.equal(r.pagesTotal, 150);
  assert.equal(r.readingMinutesLeft, 308);
  assert.equal(r.readiness, 38);
  assert.equal(r.fullLengthCounter, 0);
  assert.equal(Math.round(r.readingMin!), 1179);
  assert.equal(Math.round(r.quizMin!), 4199);
  assert.equal(r.targetDate, "2026-06-17");
  assert.equal(r.planStatus, "ON TRACK");
  assert.equal(r.overdueMinutes, null);
  assert.equal(r.careerQuestions, 2427);
  assert.equal(r.activeDays, 30);
  assert.deepEqual(r.missing, []);
});

test("stacked layout: 7-day quiz summary keeps its denominator and topics", () => {
  const r = extractReport(stacked);
  assert.equal(r.quiz7d.questions, 259);
  assert.equal(r.quiz7d.accuracy, 72.6);
  const hedging = r.quiz7d.topics.find(t => t.name === "Hedging strategies");
  assert.deepEqual(hedging, { name: "Hedging strategies", correct: 23, total: 45, pct: 51 });
  assert.equal(r.attempts.length, 0, "'No results' means no attempts");
});

test("stacked layout: daily table survives page breaks mid-entry and ignores chart axis dates", () => {
  const r = extractReport(stacked);
  const dates = r.daily.map(d => d.date);
  assert.deepEqual(dates, ["2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"]);
  const jun5 = r.daily[0];
  assert.equal(jun5.totalMin, 454);
  assert.equal(jun5.questions, 196, "questions after a page break still belong to Jun 5");
  const jun13 = r.daily.find(d => d.date === "2026-06-13")!;
  assert.equal(jun13.quizMin, 0, "empty Quiz value must not borrow a later number");
  assert.equal(jun13.questions, 0);
  // Last 4 calendar days, missing days count as zero (playbook rule).
  assert.equal(Math.round(avgStudyMinutes(r.daily, "2026-06-14")), 147);
  assert.equal(lastActiveDate(r.daily), "2026-06-14");
});

test("inline layout: different book total, AT RISK, overdue, and the full attempts list", () => {
  const r = extractReport(inline);
  assert.equal(r.name, "Test Sponsor Two");
  assert.equal(r.pagesRead, 149);
  assert.equal(r.pagesTotal, 149, "never assume 150");
  assert.equal(r.readingMinutesLeft, 0);
  assert.equal(r.readiness, 81);
  assert.equal(r.reportDate, "2026-09-20");
  assert.equal(r.targetDate, "2026-10-02");
  assert.equal(r.planStatus, "AT RISK");
  assert.equal(r.overdueMinutes, 126);
  assert.equal(r.exam7d.questions, 225);
  assert.equal(r.exam7d.accuracy, 84);

  assert.equal(r.attempts.length, 4, "the true attempt count comes from the list, not the header tile");
  const [full, finalB, midterm, chapter] = r.attempts;
  assert.deepEqual(
    { name: full.name, status: full.status, date: full.date, used: full.minutesUsed, allowed: full.minutesAllowed, score: full.score, fullLength: full.fullLength },
    { name: "SIE full exam", status: "PASS", date: "2026-09-19", used: 49, allowed: 105, score: 86, fullLength: true }
  );
  assert.equal(finalB.fullLength, true);
  assert.equal(midterm.name, "Midterm 2: Chapters 9 to 15");
  assert.equal(midterm.fullLength, false);
  assert.equal(chapter.status, "FAIL");
  assert.equal(chapter.correct, 16);
  assert.equal(chapter.total, 25);

  const sep19 = r.daily.find(d => d.date === "2026-09-19")!;
  assert.equal(sep19.readingMin, 0, "blank Reading must not grab the Quiz value");
  assert.equal(sep19.examMin, 108);
});

test("garbage in: everything is reported missing, nothing throws", () => {
  const r = extractReport("not an achievable report");
  assert.ok(r.missing.includes("pagesRead"));
  assert.ok(r.missing.includes("daily"));
  assert.equal(r.attempts.length, 0);
});
