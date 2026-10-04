import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../app/api/memory-store.ts";
import { nameKey } from "../app/api/store-model.ts";
import { makeReport } from "./helpers.ts";

const snap = (sponsorId: string, reportDate: string, pagesRead: number) => ({
  sponsorId, reportDate, pagesRead, pagesTotal: 150, readiness: 40, calibrated: null, phase: 1, primaryMode: "reading_stalled",
  dot: "red", data: makeReport({ reportDate, pagesRead }), kaplan: null, createdBy: "nick@fingyms.com",
});

test("nameKey normalizes case, accents and punctuation", () => {
  assert.equal(nameKey("  Si-Lin  LI "), "si lin li");
  assert.equal(nameKey("José Núñez"), "jose nunez");
});

test("matching prefers the Achievable UUID, then the name — and never steals another account", async () => {
  const s = new MemoryStore();
  const a = await s.createSponsor({ name: "Pat Example", achievableUuid: "uuid-a", exam: "SIE" });
  const b = await s.createSponsor({ name: "Pat Lee" });
  assert.equal((await s.findSponsor({ achievableUuid: "uuid-a", name: "someone else" }))?.id, a.id);
  assert.equal((await s.findSponsor({ name: "pat  LEE" }))?.id, b.id);
  assert.equal(await s.findSponsor({ name: "Pat Example", achievableUuid: "uuid-other" }), null,
    "same name, different Achievable account = a different person");
  assert.equal((await s.findSponsor({ name: "Pat Lee", achievableUuid: "uuid-new" }))?.id, b.id,
    "a name match is fine when the stored sponsor has no UUID yet");
});

test("snapshots come back newest report first; list shows the latest per sponsor", async () => {
  const s = new MemoryStore();
  const a = await s.createSponsor({ name: "Alpha", examDate: "2026-11-01" });
  const b = await s.createSponsor({ name: "Bravo", examDate: "2026-10-15" });
  await s.createSponsor({ name: "Charlie" });
  await s.addSnapshot(snap(a.id, "2026-09-10", 40));
  await s.addSnapshot(snap(a.id, "2026-09-20", 77));
  await s.addSnapshot(snap(a.id, "2026-09-15", 60));
  const snaps = await s.snapshots(a.id);
  assert.deepEqual(snaps.map(x => x.pagesRead), [77, 60, 40]);

  const list = await s.listSponsors();
  assert.deepEqual(list.map(x => x.name), ["Bravo", "Alpha", "Charlie"], "soonest exam first, unscheduled last");
  const alpha = list.find(x => x.id === a.id)!;
  assert.equal(alpha.pagesRead, 77);
  assert.equal(alpha.snapshotCount, 3);
  assert.equal(list.find(x => x.id === b.id)!.snapshotCount, 0);
});

test("real sits, emails and notes round-trip newest first", async () => {
  const s = new MemoryStore();
  const a = await s.createSponsor({ name: "Alpha" });
  await s.addRealSit({ sponsorId: a.id, examType: "SIE", date: "2026-06-04", outcome: "FAIL", score: null, predictedAtSit: 88, createdBy: "x" });
  await s.addRealSit({ sponsorId: a.id, examType: "SIE", date: "2026-08-20", outcome: "FAIL", score: 66, predictedAtSit: 84, createdBy: "x" });
  assert.deepEqual((await s.realSits(a.id)).map(r => r.date), ["2026-08-20", "2026-06-04"]);
  await s.addEmail({ sponsorId: a.id, kind: "sponsor", body: "first", phase: 1, checkpoint: null, checkpointResult: null, createdBy: "x" });
  await s.addEmail({ sponsorId: a.id, kind: "sponsor", body: "second", phase: 1, checkpoint: null, checkpointResult: null, createdBy: "x" });
  assert.equal((await s.emails(a.id))[0].body, "second");
  await s.addNote({ sponsorId: a.id, body: "9/28 AW: hasn't bought materials", createdBy: "x" });
  assert.equal((await s.notes(a.id)).length, 1);
  const upd = await s.updateSponsor(a.id, { examDate: "2026-10-30", achievableUuid: "u1" });
  assert.equal(upd?.examDate, "2026-10-30");
  assert.equal((await s.findSponsor({ achievableUuid: "u1" }))?.id, a.id);
});
