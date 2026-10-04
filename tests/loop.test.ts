import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../app/api/memory-store.ts";
import { loadDiagnosis, formatAllFacts, refreshDiagnosis, syncSponsorFromCard } from "../app/api/diagnose.ts";
import { makeReport, activeOn } from "./helpers.ts";

// The whole commitment loop through memory: upload -> email with promise -> later upload -> graded.
test("memory loop: the second email opens with the first email's checkpoint, graded", async () => {
  const store = new MemoryStore();
  const sp = await store.createSponsor({ name: "Loop Sponsor", exam: "SIE", examDate: "2026-07-15" });
  const r1 = makeReport({ reportDate: "2026-06-15", pagesRead: 77, pagesTotal: 150, readingMinutesLeft: 300, daily: activeOn(["2026-06-15"]) });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: r1.reportDate!, pagesRead: 77, pagesTotal: 150, readiness: 40, calibrated: null, phase: 1, primaryMode: null, dot: null, data: r1, kaplan: null, createdBy: "t" });

  const d1 = (await loadDiagnosis(store, sp.id))!;
  assert.equal(d1.lastResult, null, "first email has nothing to grade");
  assert.equal(d1.next.text, "The book at 92/150 pages by Thursday 6/18. I'm pulling your Achievable report that morning.");
  await store.addEmail({ sponsorId: sp.id, kind: "sponsor", body: "email 1", phase: 1, checkpoint: d1.next, checkpointResult: null, createdBy: "t" });

  // Regenerating from the SAME report must not grade its own checkpoint.
  assert.equal((await loadDiagnosis(store, sp.id))!.lastResult, null);

  const r2 = makeReport({ reportDate: "2026-06-19", pagesRead: 85, pagesTotal: 150, readingMinutesLeft: 240, daily: activeOn(["2026-06-17", "2026-06-19"]) });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: r2.reportDate!, pagesRead: 85, pagesTotal: 150, readiness: 42, calibrated: null, phase: 1, primaryMode: null, dot: null, data: r2, kaplan: null, createdBy: "t" });
  const d2 = (await loadDiagnosis(store, sp.id))!;
  assert.equal(d2.lastResult?.status, "PARTIAL");
  assert.equal(d2.lastResult?.shortBy, 7);
  assert.equal(d2.pace.observedPaceSource, "since-last-upload");
  assert.equal(d2.pace.observedPagesPerDay, 2);
  const facts = formatAllFacts(d2, "sponsor");
  assert.match(facts, /PARTIAL — they reached 85\/150, 7 pages short/);
  assert.match(facts, /OPEN the email with the miss/);
  await store.addEmail({ sponsorId: sp.id, kind: "sponsor", body: "email 2", phase: 1, checkpoint: d2.next, checkpointResult: d2.lastResult, createdBy: "t" });

  // Third report: no progress -> second miss in a row -> escalation.
  const r3 = makeReport({ reportDate: "2026-06-24", pagesRead: 85, pagesTotal: 150, readingMinutesLeft: 240, daily: activeOn(["2026-06-20"]) });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: r3.reportDate!, pagesRead: 85, pagesTotal: 150, readiness: 42, calibrated: null, phase: 1, primaryMode: null, dot: null, data: r3, kaplan: null, createdBy: "t" });
  const d3 = (await loadDiagnosis(store, sp.id))!;
  assert.equal(d3.lastResult?.status, "MISSED");
  assert.equal(d3.streak, 2);
  assert.match(formatAllFacts(d3, "team"), /DM ESCALATION/);
  assert.match(formatAllFacts(d3, "sponsor"), /manager will be reaching out/);
});

test("tracker notes flow into the facts and the failure mode", async () => {
  const store = new MemoryStore();
  const sp = await store.createSponsor({ name: "Notes Sponsor", exam: "SIE" });
  const r = makeReport({ reportDate: "2026-09-20", pagesRead: 10, pagesTotal: 150, readingMinutesLeft: 900, daily: activeOn(["2026-09-20"]) });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: "2026-09-20", pagesRead: 10, pagesTotal: 150, readiness: 10, calibrated: null, phase: 1, primaryMode: null, dot: null, data: r, kaplan: null, createdBy: "t" });
  await store.addNote({ sponsorId: sp.id, body: "9/19 AW: still hasn't bought materials yet", createdBy: "t" });
  const d = (await loadDiagnosis(store, sp.id))!;
  assert.equal(d.readiness.primaryMode, "materials_unpaid");
  assert.match(formatAllFacts(d, "team"), /LATEST TRACKER NOTES[\s\S]*hasn't bought materials/);
});

test("the sponsor list's labels follow the diagnosis after a date fix or a real result", async () => {
  const store = new MemoryStore();
  const sp = await store.createSponsor({ name: "Date Sponsor", exam: "SIE", examDate: "2026-06-17" });
  const r = makeReport({ reportDate: "2026-06-18", pagesRead: 86, pagesTotal: 150, readingMinutesLeft: 270, daily: activeOn(["2026-06-18"]) });
  await store.addSnapshot({ sponsorId: sp.id, reportDate: "2026-06-18", pagesRead: 86, pagesTotal: 150, readiness: 40, calibrated: null, phase: null, primaryMode: null, dot: null, data: r, kaplan: null, createdBy: "t" });
  const row = async () => (await store.listSponsors()).find(s => s.id === sp.id)!;

  await refreshDiagnosis(store, sp.id);
  assert.equal((await row()).primaryMode, "result_missing");
  assert.equal((await loadDiagnosis(store, sp.id))!.next.metric, "result_reported");

  // The team corrects the test date on the plan card -> saved, re-diagnosed, list updated.
  await syncSponsorFromCard(store, { sponsorId: sp.id, exam: "SIE", examDate: "2026-06-29" });
  assert.equal((await store.getSponsor(sp.id))!.examDate, "2026-06-29");
  assert.notEqual((await row()).primaryMode, "result_missing");
  assert.equal((await row()).phase, 1);
  assert.equal((await loadDiagnosis(store, sp.id))!.next.metric, "pages_read");
});
