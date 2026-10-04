// One place that turns a sponsor's memory into today's diagnosis: pace, readiness, the
// grade on their last promise, and the next promise. Every route uses this, so the
// upload panel, the sponsor email and the team email can never disagree.

import type { ReportData } from "./report-extract.ts";
import type { PaceFacts } from "./pace.ts";
import type { Readiness, KaplanData, RealSit } from "./readiness.ts";
import type { Checkpoint, CheckpointResult } from "./checkpoint.ts";
import type { Store, SponsorRow, SnapshotRow, EmailRow, NoteRow, RealSitRow } from "./store-model.ts";
import { computePace, formatPaceFacts, parseDurationToMinutes } from "./pace.ts";
import { emptyReport } from "./report-extract.ts";
import { assessReadiness, formatReadinessFacts, MODE_LABEL } from "./readiness.ts";
import { buildCheckpoint, evaluateCheckpoint, missStreak, formatCheckpointFacts } from "./checkpoint.ts";

export interface DiagnosisInput {
  report: ReportData;
  kaplan: KaplanData | null;
  today: string; // the report's date
  exam: string | null;
  examDate: string | null;
  previous: Pick<SnapshotRow, "reportDate" | "pagesRead"> | null;
  sits: Pick<RealSitRow, "examType" | "date" | "outcome" | "predictedAtSit">[];
  notes: string[];
  emails: Pick<EmailRow, "kind" | "checkpoint" | "checkpointResult">[]; // newest first
}

export interface Diagnosis {
  today: string;
  exam: string | null;
  examDate: string | null;
  report: ReportData;
  pace: PaceFacts;
  readiness: Readiness;
  lastResult: CheckpointResult | null;
  streak: number;
  next: Checkpoint;
  notes: string[];
}

export function computeDiagnosis(i: DiagnosisInput): Diagnosis {
  const { report } = i;
  const previous = i.previous && i.previous.reportDate < i.today ? i.previous : null;
  const pace = computePace({
    pagesRead: report.pagesRead,
    pagesTotal: report.pagesTotal,
    readingMinutesLeft: report.readingMinutesLeft,
    readingTimeHours: report.readingMin !== null ? Math.round(report.readingMin / 6) / 10 : null,
    quizTimeHours: report.quizMin !== null ? Math.round(report.quizMin / 6) / 10 : null,
    examDate: i.examDate,
    today: new Date(`${i.today}T00:00:00Z`),
    prevPagesRead: previous?.pagesRead ?? null,
    prevDate: previous?.reportDate ?? null,
    firstActivityDate: report.firstActivity,
  });
  const sits: RealSit[] = i.sits.map(s => ({ examType: s.examType, date: s.date, outcome: s.outcome, predictedAtSit: s.predictedAtSit }));
  const readiness = assessReadiness({ report, pace, exam: i.exam, examDate: i.examDate, kaplan: i.kaplan, realSits: sits, notes: i.notes, today: i.today });

  // Only grade checkpoints set from an EARLIER report — regenerating today's email must not grade itself.
  const earlier = i.emails.filter(e => e.kind === "sponsor" && e.checkpoint && e.checkpoint.createdOn < i.today);
  const open = earlier[0]?.checkpoint ?? null;
  const lastResult = open ? evaluateCheckpoint(open, { report, readiness, today: i.today }) : null;

  const seen = new Set<string>();
  const history: CheckpointResult[] = [];
  for (const r of [lastResult, ...earlier.map(e => e.checkpointResult)]) {
    if (!r) continue;
    const key = `${r.checkpoint.createdOn}|${r.checkpoint.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    history.push(r);
  }

  return {
    today: i.today, exam: i.exam, examDate: i.examDate, report, pace, readiness, lastResult,
    streak: missStreak(history), next: buildCheckpoint({ report, pace, readiness, today: i.today }), notes: i.notes,
  };
}

export interface LoadedDiagnosis extends Diagnosis {
  sponsor: SponsorRow;
  snapshot: SnapshotRow;
  emails: EmailRow[];
  noteRows: NoteRow[];
  sitRows: RealSitRow[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A sponsor typed into the plan without a report on file: diagnose from the card's own fields
 *  so the free writer still has the pace math. Nothing is saved for these. */
export function cardDiagnosis(card: {
  name?: string; exam?: string | null; examDate?: string | null; pagesRead?: number | null; pagesTotal?: number | null;
  readingTimeLeft?: string | null; readingTimeHours?: number | null; quizTimeHours?: number | null; notes?: string[];
}, today: string = new Date().toISOString().slice(0, 10)): Diagnosis {
  const report: ReportData = {
    ...emptyReport(), name: card.name ?? null, exam: card.exam ?? null, reportDate: today,
    pagesRead: card.pagesRead ?? null, pagesTotal: card.pagesTotal ?? null,
    readingMinutesLeft: parseDurationToMinutes(card.readingTimeLeft),
    readingMin: card.readingTimeHours != null ? card.readingTimeHours * 60 : null,
    quizMin: card.quizTimeHours != null ? card.quizTimeHours * 60 : null,
  };
  return computeDiagnosis({
    report, kaplan: null, today, exam: card.exam ?? null, examDate: card.examDate && ISO_DATE.test(card.examDate) ? card.examDate : null,
    previous: null, sits: [], notes: card.notes ?? [], emails: [],
  });
}

/** A promise set from an old report is already overdue — the sponsor email needs a fresh one. */
export const STALE_REPORT_DAYS = 3;

/** Days between the latest report and the server's today (UTC). */
export function reportAgeDays(d: Pick<Diagnosis, "today">, now: Date = new Date()): number {
  return Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(d.today)) / 86400000);
}

/** Did this upload include an Achievable report (vs. only screenshots / notes)? */
function hasAchievable(r: ReportData): boolean {
  return r.pagesRead !== null || r.attempts.length > 0 || r.daily.length > 0;
}

/** The plan card is where the team corrects a sponsor's exam or test date — save those edits
 *  before diagnosing, so the email, the grade and the timeline all use the same date. */
export async function syncSponsorFromCard(store: Store, card: { sponsorId?: string | null; exam?: string | null; examDate?: string | null }): Promise<void> {
  if (!card.sponsorId) return;
  const row = await store.getSponsor(card.sponsorId);
  if (!row) return;
  const patch: { exam?: string | null; examDate?: string | null } = {};
  if (card.exam && card.exam !== row.exam) patch.exam = card.exam;
  if (card.examDate && ISO_DATE.test(card.examDate) && card.examDate !== row.examDate) patch.examDate = card.examDate;
  if (Object.keys(patch).length) {
    await store.updateSponsor(row.id, patch);
    await refreshDiagnosis(store, row.id);
  }
}

/** Diagnose with everything on file and write the result onto the latest snapshot, so the
 *  sponsor list's dot / phase / failure mode match the diagnosis panel (call after anything
 *  that changes the inputs: a new report, an exam-date edit, a recorded real exam). */
export async function refreshDiagnosis(store: Store, sponsorId: string): Promise<LoadedDiagnosis | null> {
  const d = await loadDiagnosis(store, sponsorId);
  if (d) {
    const r = d.readiness;
    await store.restampSnapshot(d.snapshot.id, { calibrated: r.calibrated, phase: r.phase, primaryMode: r.primaryMode, dot: r.dot });
  }
  return d;
}

export async function loadDiagnosis(store: Store, sponsorId: string): Promise<LoadedDiagnosis | null> {
  const sponsor = await store.getSponsor(sponsorId);
  if (!sponsor) return null;
  const snaps = await store.snapshots(sponsorId, 20);
  const current = snaps[0];
  if (!current) return null;
  const [sitRows, noteRows, emails] = await Promise.all([store.realSits(sponsorId), store.notes(sponsorId, 10), store.emails(sponsorId, 20)]);
  // Uploads are often partial: this week's Achievable PDF without the Kaplan screenshots, or a
  // Kaplan screenshot alone. Carry each source forward from the newest upload that had it.
  const reportSnap = hasAchievable(current.data) ? current : snaps.find(s => hasAchievable(s.data)) ?? current;
  const kaplan = current.kaplan ?? snaps.find(s => s.kaplan)?.kaplan ?? null;
  // Observed pace compares against the previous report from the SAME course (SIE -> 65 resets pages).
  const sameCourse = (s: SnapshotRow) => hasAchievable(s.data) && (s.data.course ?? null) === (reportSnap.data.course ?? null);
  const d = computeDiagnosis({
    report: reportSnap.data,
    kaplan,
    today: current.reportDate,
    exam: sponsor.exam ?? reportSnap.data.exam,
    examDate: sponsor.examDate ?? reportSnap.data.targetDate,
    previous: snaps.find(s => s.reportDate < reportSnap.reportDate && sameCourse(s)) ?? null,
    sits: sitRows,
    notes: noteRows.map(n => n.body),
    emails,
  });
  return { ...d, sponsor, snapshot: current, emails, noteRows, sitRows };
}

/** Everything the model must treat as fact, for one audience. */
export function formatAllFacts(d: Diagnosis, audience: "sponsor" | "team"): string {
  const parts = [
    formatPaceFacts(d.pace),
    formatReadinessFacts(d.readiness, audience),
    formatCheckpointFacts(d.lastResult, d.streak, d.next, audience),
  ];
  const r = d.readiness;
  const sit = r.recentSit;
  if (sit) {
    // The newest real exam is the latest event and no later exam date is set yet.
    parts.push(sit.outcome === "PASS"
      ? `REAL EXAM: PASSED ${sit.examType} on ${sit.date}. Open with congratulations, then lock in the next exam — set its date now (momentum drops right after a pass).`
      : sit.outcome === "FAIL"
        ? `REAL EXAM: FAILED ${sit.examType} on ${sit.date}. Debrief within a day, build the plan from the weakest sections of their score report, and get the next exam date (retake or the next exam in their path) set within 48 hours.`
        : `REAL EXAM: ${sit.examType} on ${sit.date}, result pending — ask for the score report.`);
  }
  if (audience === "team" && r.goNoGo) {
    parts.push(`GO/NO-GO DECISION NEEDED (team only): exam in ${r.daysToExam} day(s) and the gold standard is NOT met (${r.goldStandard.gaps.map(g => g.text).join("; ")}). The owner makes the call today and relays it to the sponsor the same day — never let a no-go go unsent.`);
  }
  if (audience === "sponsor") {
    parts.push(d.report.readiness !== null
      ? `ACHIEVABLE'S OWN READINESS METER: ${d.report.readiness}% — Achievable's number, not ours. Quote it on the "ACHIEVABLE READINESS" line.`
      : `ACHIEVABLE'S OWN READINESS METER: not on this report — leave the "ACHIEVABLE READINESS" line out.`);
  }
  if (d.notes.length) {
    parts.push(`LATEST TRACKER NOTES (newest first — strong evidence, often better than the metrics):\n${d.notes.slice(0, 3).map(n => `- ${n}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

/** Compact summary the UI shows next to the suggestions. */
export function diagnosisSummary(d: Diagnosis) {
  const r = d.readiness;
  return {
    phase: r.phase,
    phaseName: r.phaseName,
    dot: r.dot,
    dotReason: r.dotReason,
    primaryMode: r.primaryMode ? MODE_LABEL[r.primaryMode] : null,
    failureModes: r.failureModes.map(m => MODE_LABEL[m]),
    neverTested: r.neverTested,
    readiness: { base: r.base, calibrated: r.calibrated, published: r.published, calibrationReason: r.calibrationReason },
    goldStandard: { met: r.goldStandard.met, gaps: r.goldStandard.gaps.map(g => g.text) },
    flags: { rushing: r.rushing, bankBurnout: r.bankBurnout, bankExposure: r.bankExposure, speedRatio: r.speedRatio, untimed: r.untimed.length },
    daysToExam: r.daysToExam,
    goNoGo: r.goNoGo,
    darkDays: r.darkDays,
    last4AvgMin: r.last4AvgMin,
    pace: {
      pagesRead: d.pace.pagesRead, pagesTotal: d.pace.pagesTotal, percentComplete: d.pace.percentComplete,
      bookDeadline: d.pace.bookDeadline, requiredMinutesPerDay: d.pace.requiredMinutesPerDay, requiredPagesPerDay: d.pace.requiredPagesPerDay,
      observedPagesPerDay: d.pace.observedPagesPerDay, projectedFinish: d.pace.projectedFinish, stalled: d.pace.stalled, status: d.pace.status,
    },
    lastCheckpoint: d.lastResult ? { status: d.lastResult.status, text: d.lastResult.text } : null,
    nextCheckpoint: { text: d.next.text, due: d.next.due },
    streak: d.streak,
  };
}
