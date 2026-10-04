// The commitment engine: every sponsor email closes with ONE checkpoint computed in code,
// and the next upload grades it. That closed loop — "you said 115 by Thursday, you're at
// 98" — is what turns a one-off email into accountability.

import type { ReportData } from "./report-extract.ts";
import type { PaceFacts } from "./pace.ts";
import type { Readiness } from "./readiness.ts";

export type CheckpointMetric = "pages_read" | "timed_full_lengths" | "active_days" | "result_reported";

export interface Checkpoint {
  metric: CheckpointMetric;
  createdOn: string; // YYYY-MM-DD
  due: string; // YYYY-MM-DD
  baseline: number;
  target: number;
  minScore: number | null;
  text: string; // the exact sentence the email closes with
}

export interface CheckpointResult {
  checkpoint: Checkpoint;
  status: "HIT" | "PARTIAL" | "MISSED" | "PENDING";
  actual: number;
  shortBy: number; // 0 when hit
  text: string;
}

const DAY = 86400000;
export const CHECKPOINT_DAYS = 3; // graded at the end of the 4-day plan

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${+m}/${+d}`;
}

export interface BuildInput {
  report: ReportData;
  pace: PaceFacts;
  readiness: Readiness;
  today: string;
}

export function buildCheckpoint({ report, pace, readiness, today }: BuildInput): Checkpoint {
  const due = addDays(today, CHECKPOINT_DAYS);
  const when = `${weekday(due)} ${shortDate(due)}`;

  // Exam date passed with no result on file: no study promise until we know how it went.
  if (readiness.primaryMode === "result_missing") {
    return {
      metric: "result_reported", createdOn: today, due, baseline: 0, target: 1, minScore: null,
      text: `Reply with your exam result — pass or fail, and your score — by ${when}. If your test date changed, reply with the new date.`,
    };
  }

  // Gone quiet: the next promise is just showing up.
  if (readiness.primaryMode === "dormant" || readiness.primaryMode === "not_started") {
    return {
      metric: "active_days", createdOn: today, due, baseline: 0, target: 3, minScore: null,
      text: `Study on at least 3 of the next 4 days — any amount counts. I'm checking your Achievable activity ${when}.`,
    };
  }

  if (readiness.phase === 1 && pace.pagesRead !== null && pace.pagesTotal !== null) {
    const perDay = pace.requiredPagesPerDay ?? Math.max(5, Math.ceil((pace.pagesRemaining ?? 0) / 14));
    const target = Math.min(pace.pagesTotal, pace.pagesRead + perDay * CHECKPOINT_DAYS);
    return {
      metric: "pages_read", createdOn: today, due, baseline: pace.pagesRead, target, minScore: null,
      text: target >= pace.pagesTotal
        ? `The book finished — ${pace.pagesTotal}/${pace.pagesTotal} pages — by ${when}. I'm pulling your Achievable report that morning.`
        : `The book at ${target}/${pace.pagesTotal} pages by ${when}. I'm pulling your Achievable report that morning.`,
    };
  }

  // Book unfinished but the page count is unknown: still no exam promise in Phase 1.
  if (readiness.phase === 1) {
    return {
      metric: "active_days", createdOn: today, due, baseline: 0, target: 3, minScore: null,
      text: `Read on at least 3 of the next 4 days — reading first, every day. I'm checking your Achievable activity ${when}.`,
    };
  }

  const baseline = readiness.timed.length;
  const add = readiness.phase === 4 || readiness.goldStandard.met ? 1 : 2;
  const minScore = readiness.phase === 4 || readiness.goldStandard.met ? 80 : 75;
  return {
    metric: "timed_full_lengths", createdOn: today, due, baseline, target: baseline + add, minScore,
    text: `${add} more timed full-length exam${add > 1 ? "s" : ""}, using the full clock, at ${minScore}%+ by ${when}. I'm checking your scores that morning.`,
  };
}

export interface EvaluateInput {
  report: ReportData;
  readiness: Readiness;
  today: string;
}

export function evaluateCheckpoint(cp: Checkpoint, { report, readiness, today }: EvaluateInput): CheckpointResult {
  let actual: number;
  let progressed: boolean;
  let hit: boolean;

  if (cp.metric === "result_reported") {
    // Kept once the result is no longer missing: a real sit was recorded (or the date was corrected).
    actual = readiness.failureModes.includes("result_missing") ? 0 : 1;
    progressed = false;
    hit = actual >= 1;
  } else if (cp.metric === "pages_read") {
    actual = report.pagesRead ?? cp.baseline;
    progressed = actual > cp.baseline;
    hit = actual >= cp.target;
  } else if (cp.metric === "active_days") {
    // "3 of the next 4 days" = the day it was set through the due date.
    actual = report.daily.filter(d => d.totalMin > 0 && d.date >= cp.createdOn && d.date <= cp.due).length;
    progressed = actual > 0;
    hit = actual >= cp.target;
  } else {
    const fresh = readiness.timed.filter(t => (t.date ?? "") > cp.createdOn);
    const good = fresh.filter(t => t.score >= (cp.minScore ?? 0));
    actual = good.length;
    progressed = fresh.length > 0;
    hit = good.length >= cp.target - cp.baseline;
  }

  const needed = cp.metric === "timed_full_lengths" ? cp.target - cp.baseline : cp.target;
  const shortBy = Math.max(0, needed - actual);
  const status: CheckpointResult["status"] = hit ? "HIT" : today < cp.due ? "PENDING" : progressed ? "PARTIAL" : "MISSED";

  const unit = cp.metric === "pages_read" ? "pages" : cp.metric === "active_days" ? "study days" : cp.metric === "result_reported" ? "exam result" : `timed exams at ${cp.minScore}%+`;
  const shown = cp.metric === "pages_read" ? `${actual}${report.pagesTotal ? `/${report.pagesTotal}` : ""}` : `${actual}`;
  const verdict = cp.metric === "result_reported" ? {
    HIT: "HIT — the result is on file.",
    PENDING: `not due yet (${shortDate(cp.due)}) — still no result on file.`,
    PARTIAL: "MISSED — still no result on file.",
    MISSED: "MISSED — still no result on file.",
  }[status] : {
    HIT: `HIT — they're at ${shown}.`,
    PENDING: `not due yet (${shortDate(cp.due)}) — so far ${shown}, ${shortBy} ${unit} to go.`,
    PARTIAL: `PARTIAL — they reached ${shown}, ${shortBy} ${unit} short.`,
    MISSED: `MISSED — no progress: still at ${shown}.`,
  }[status];
  return { checkpoint: cp, status, actual, shortBy, text: `Last checkpoint (set ${shortDate(cp.createdOn)}): "${cp.text}" → ${verdict}` };
}

/** Consecutive missed or partial checkpoints, most recent first. */
export function missStreak(results: CheckpointResult[]): number {
  let n = 0;
  for (const r of results) {
    if (r.status === "MISSED" || r.status === "PARTIAL") n++;
    else if (r.status === "HIT") break;
  }
  return n;
}

export function formatCheckpointFacts(last: CheckpointResult | null, streak: number, next: Checkpoint, audience: "sponsor" | "team"): string {
  const L: string[] = ["ACCOUNTABILITY FACTS (computed — restate exactly):"];
  if (last) {
    L.push(`- ${last.text}`);
    L.push(last.status === "HIT"
      ? "- OPEN the email by crediting the hit with the exact number — a promise kept is the strongest motivator they have."
      : last.status === "PENDING"
        ? "- Mention progress toward it briefly; it isn't due yet."
        : "- OPEN the email with the miss and the exact gap. No softening, no lecture — name it, then reset with the next checkpoint.");
  } else {
    L.push("- No previous checkpoint on file — this is the first plan we're holding them to.");
  }
  if (streak >= 2) {
    L.push(audience === "team"
      ? `- ${streak} checkpoints missed in a row → DM ESCALATION: needs a 1-1 this week; the plan alone isn't working.`
      : `- ${streak} checkpoints missed in a row → shrink the ask to the smallest next step, name the pattern plainly, and tell them their manager will be reaching out.`);
  }
  L.push(`- NEXT CHECKPOINT — close the email with exactly this one promise: "${next.text}"`);
  return L.join("\n");
}
