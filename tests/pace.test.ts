import { test } from "node:test";
import assert from "node:assert/strict";
import { computePace, formatPaceFacts } from "../app/api/pace.ts";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("late sponsor slides to the 5-day floor and goes critical (never 'impossible')", () => {
  const p = computePace({ pagesRead: 77, pagesTotal: 150, readingMinutesLeft: 308, examDate: "2026-06-17", today: d("2026-06-15") });
  assert.equal(p.usingFloor, true);
  assert.equal(p.bookDeadline, "2026-06-12");
  assert.equal(p.daysToDeadline, 1);
  assert.equal(p.requiredMinutesPerDay, 308);
  assert.equal(p.status, "critical");
});

test("healthy runway: 2-week target deadline and a modest quota", () => {
  const p = computePace({ pagesRead: 77, pagesTotal: 150, readingMinutesLeft: 308, examDate: "2026-07-15", today: d("2026-06-15") });
  assert.equal(p.bookDeadline, "2026-07-01");
  assert.equal(p.daysToDeadline, 16);
  assert.equal(p.requiredMinutesPerDay, 20);
  assert.equal(p.requiredPagesPerDay, 5);
  assert.equal(p.status, "on-pace");
});

test("observed pace from the previous upload projects the finish date", () => {
  const p = computePace({
    pagesRead: 77, pagesTotal: 150, readingMinutesLeft: 308, examDate: "2026-08-15", today: d("2026-06-15"),
    prevPagesRead: 60, prevDate: "2026-06-08",
  });
  assert.equal(p.observedPaceSource, "since-last-upload");
  assert.equal(p.observedPagesPerDay, 2.4);
  assert.equal(p.projectedFinish, "2026-07-16");
  assert.ok(p.finishVsDeadlineDays! < 0, "finishes before the 8/1 book deadline");
  assert.equal(p.status, "on-pace");
  assert.match(formatPaceFacts(p), /~2\.4 pages\/day since their last report/);
});

test("no progress since last upload = stalled; critical when the exam is close", () => {
  const far = computePace({ pagesRead: 77, pagesTotal: 150, examDate: "2026-09-30", today: d("2026-06-15"), prevPagesRead: 77, prevDate: "2026-06-08" });
  assert.equal(far.stalled, true);
  assert.equal(far.status, "behind");
  const near = computePace({ pagesRead: 77, pagesTotal: 150, examDate: "2026-06-25", today: d("2026-06-15"), prevPagesRead: 77, prevDate: "2026-06-08" });
  assert.equal(near.status, "critical");
  assert.match(formatPaceFacts(near), /STALLED/);
});

test("falls back to pace since first activity", () => {
  const p = computePace({ pagesRead: 77, pagesTotal: 150, examDate: "2026-06-17", today: d("2026-06-14"), firstActivityDate: "2026-05-15" });
  assert.equal(p.observedPaceSource, "since-first-activity");
  assert.equal(p.observedPagesPerDay, 2.6);
  assert.ok(p.finishVsExamDays! > 0, "at 2.6 pages/day the book finishes after the exam");
  assert.equal(p.status, "critical");
});

test("book done and no-data paths", () => {
  const done = computePace({ pagesRead: 150, pagesTotal: 150, readingMinutesLeft: 0, examDate: "2026-07-15", today: d("2026-06-15") });
  assert.equal(done.bookDone, true);
  assert.equal(done.status, "on-pace");
  assert.match(formatPaceFacts(done), /THE BOOK IS FINISHED/);
  const none = computePace({});
  assert.equal(none.status, "unknown");
  assert.match(formatPaceFacts(none), /NOT PROVIDED/);
});
