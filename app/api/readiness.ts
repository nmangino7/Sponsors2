// Readiness, phase and failure-mode engine — Nick's sponsor playbooks in code.
// Sources: fga-sponsors (cuts, bank exposure, speed, "never tested", dots, failure-mode
// vocabulary) and savannah-sponsorship-daily v7 (base composite + per-person calibration).
// Pure and deterministic: the model never computes readiness, it only explains it.

import type { DailyStudy, PracticeAttempt, ReportData } from "./report-extract.ts";
import type { PaceFacts } from "./pace.ts";

export const CUT_SCORES: Record<string, number> = { SIE: 70, "63": 72, "65": 72, "66": 73, "7": 72, LAH: 70 };
export const BANK_BURNOUT_EXPOSURE = 0.7; // above this, sims measure recall of seen questions
export const FAST_FINISH_RATIO = 0.6; // minutes used / allowed below this = rushing
export const UNTIMED_RATIO = 1.1;
export const GO_NO_GO_DAYS = 10;
export const RECENT_SIT_DAYS = 21; // after-pass / after-fail steps apply this long after a real exam // exam this close without the gold standard -> the team makes the call // used / allowed above this = taken off the clock (paused, multiple sittings)
const QUIZ_HAIRCUT = 12; // untimed quiz accuracy over-reads exam conditions
const READY_BAR = 80;

export interface KaplanSim {
  name: string;
  score: number;
  date: string | null;
  minutesUsed: number | null;
  minutesAllowed: number | null;
}

export interface KaplanData {
  answered: number | null;
  total: number | null;
  avgScore: number | null;
  sims: KaplanSim[];
}

export interface RealSit {
  examType: string;
  date: string; // YYYY-MM-DD
  outcome: "PASS" | "FAIL" | "PENDING";
  predictedAtSit: number | null;
}

export type FailureMode =
  | "result_missing"
  | "materials_unpaid"
  | "not_started"
  | "dormant"
  | "binge_and_vanish"
  | "reading_stalled"
  | "comfort_quizzing"
  | "bank_burnout"
  | "plateau_below_cut"
  | "never_tested";

// Most urgent / most actionable first — the first one present becomes the primary mode.
const MODE_PRIORITY: FailureMode[] = [
  "result_missing",
  "materials_unpaid",
  "not_started",
  "dormant",
  "binge_and_vanish",
  "reading_stalled",
  "comfort_quizzing",
  "bank_burnout",
  "plateau_below_cut",
  "never_tested",
];

export const MODE_LABEL: Record<FailureMode, string> = {
  result_missing: "result missing",
  materials_unpaid: "materials unpaid",
  not_started: "not started",
  dormant: "dormant",
  binge_and_vanish: "binge and vanish",
  reading_stalled: "reading stalled",
  comfort_quizzing: "comfort quizzing",
  bank_burnout: "bank burnout",
  plateau_below_cut: "plateau below cut",
  never_tested: "never tested",
};

export interface ReadinessInput {
  report: ReportData;
  pace: PaceFacts;
  exam?: string | null;
  examDate?: string | null;
  kaplan?: KaplanData | null;
  realSits?: RealSit[];
  notes?: string[];
  today?: string; // YYYY-MM-DD; defaults to the report date
}

export interface GoldGap {
  code: "timed" | "rushing" | "bank" | "calibrated";
  text: string; // team-facing (may carry the calibrated number)
  sponsorText: string; // never carries readiness/calibration numbers
}

export interface TimedAttempt {
  source: "achievable" | "kaplan";
  name: string;
  score: number;
  date: string | null;
  speedRatio: number | null;
}

export interface Readiness {
  exam: string | null;
  cut: number;
  phase: 1 | 2 | 3 | 4;
  phaseName: string;
  timed: TimedAttempt[]; // most recent first
  trailing3: number | null;
  distanceFromCut: number | null;
  neverTested: boolean;
  evidence: number | null;
  evidenceSource: "timed" | "quiz-minus-12" | "none";
  base: number | null;
  penalty: number;
  calibrated: number | null;
  published: number | null; // null when the playbook forbids publishing a score
  band: "green" | "amber" | "red" | null;
  passOdds: number | null;
  bankExposure: number | null;
  bankBurnout: boolean;
  speedRatio: number | null; // median of the last 3 timed attempts with times
  rushing: boolean;
  darkDays: number | null;
  last4AvgMin: number | null;
  failureModes: FailureMode[];
  primaryMode: FailureMode | null;
  dot: "green" | "red" | "grey";
  dotReason: string;
  goldStandard: { met: boolean; qualifying: number; needed: number; gaps: GoldGap[] };
  calibrationReason: string | null;
  untimed: TimedAttempt[]; // full exams that ran past the clock — shown, never counted
  daysToExam: number | null; // negative once the exam date has passed
  lastSit: RealSit | null; // newest real exam, any exam type
  recentSit: RealSit | null; // lastSit when it's within RECENT_SIT_DAYS and no later exam date is set
  goNoGo: boolean; // exam within GO_NO_GO_DAYS and the gold standard isn't met
}

const DAY = 86400000;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp(x: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, x));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function ratio(used: number | null, allowed: number | null): number | null {
  return used !== null && allowed ? used / allowed : null;
}

function timedAttempts(report: ReportData, kaplan: KaplanData | null | undefined): TimedAttempt[] {
  const a: TimedAttempt[] = report.attempts
    // An abandoned full exam (quit at 12%) is not a timed full-length.
    .filter((x: PracticeAttempt) => x.fullLength && x.status !== "DISCARDED" && (x.completionPct ?? 100) >= 90)
    .map(x => ({ source: "achievable" as const, name: x.name, score: x.score, date: x.date, speedRatio: ratio(x.minutesUsed, x.minutesAllowed) }));
  const k: TimedAttempt[] = (kaplan?.sims ?? []).map(s => ({
    source: "kaplan" as const, name: s.name, score: s.score, date: s.date, speedRatio: ratio(s.minutesUsed, s.minutesAllowed),
  }));
  // Most recent first; undated entries keep their listed order after dated ones.
  return [...a, ...k].sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
}

/** Trailing-3 timed full-length average using only exams dated on or before `onOrBefore` —
 *  what the practice evidence said going into a real exam. Null when there were none. */
export function trailingAverageAsOf(report: ReportData, kaplan: KaplanData | null | undefined, onOrBefore: string): number | null {
  const prior = timedAttempts(report, kaplan).filter(t => !isUntimed(t) && t.date !== null && t.date <= onOrBefore).slice(0, 3);
  return prior.length ? avg(prior.map(t => t.score)) : null;
}

/** Ran past the clock (e.g. 316 of 105 min): an open-book score, not a timed full-length. */
function isUntimed(t: TimedAttempt): boolean {
  return t.speedRatio !== null && t.speedRatio > UNTIMED_RATIO;
}

function lastActive(daily: DailyStudy[]): string | null {
  const active = daily.filter(d => d.totalMin > 0);
  return active.length ? active[active.length - 1].date : null;
}

function avgLastN(daily: DailyStudy[], end: string, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.parse(`${end}T00:00:00Z`) - i * DAY).toISOString().slice(0, 10);
    sum += daily.find(x => x.date === d)?.totalMin ?? 0;
  }
  return sum / n;
}

/** A big day followed by 3+ days of nothing. */
function bingeAndVanish(daily: DailyStudy[], today: string): boolean {
  const byDate = new Map(daily.map(d => [d.date, d.totalMin]));
  for (const d of daily) {
    if (d.totalMin < 240 || daysBetween(d.date, today) > 21) continue;
    let dark = 0;
    for (let i = 1; i <= 3; i++) {
      const next = new Date(Date.parse(`${d.date}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);
      if (next > today) break;
      if ((byDate.get(next) ?? 0) === 0) dark++;
    }
    if (dark === 3) return true;
  }
  return false;
}

const UNPAID = new RegExp([
  String.raw`\b(hasn'?t|has not|didn'?t|did not|not yet|never)\s+(bought|purchased|paid)\b`,
  String.raw`\bunpaid\b`, String.raw`\bmaterials?\s+(not|un)\s*paid\b`, String.raw`\bpayment\s+(pending|outstanding|missing)\b`,
  String.raw`\bcan'?t afford\b`,
  // phrasings seen in the team's notes: "unable to purchase study materials", "waiting to be paid", "doesn't have $50"
  String.raw`\b(unable to|can'?t|cannot)\s+(purchase|buy|pay)\b`, String.raw`\bwaiting\s+(to\s+(be|get)\s+paid|on\s+(a\s+|his\s+|her\s+|their\s+)?pay(check)?)\b`,
  String.raw`\b(doesn'?t|does not|don'?t)\s+have\s+(the\s+)?(\$\s?\d+|money|funds)\b`,
].join("|"), "i");

export function assessReadiness(input: ReadinessInput): Readiness {
  const { report, pace } = input;
  const exam = input.exam ?? report.exam ?? null;
  const cut = CUT_SCORES[exam ?? ""] ?? 70;
  const today = input.today ?? report.reportDate ?? new Date().toISOString().slice(0, 10);
  const examDate = input.examDate ?? report.targetDate ?? null;

  const allFull = timedAttempts(report, input.kaplan);
  const untimed = allFull.filter(isUntimed);
  const timed = allFull.filter(t => !isUntimed(t));
  const last3 = timed.slice(0, 3);
  const trailing3 = avg(last3.map(t => t.score));
  const neverTested = timed.length === 0;

  let evidence: number | null = null;
  let evidenceSource: Readiness["evidenceSource"] = "none";
  if (trailing3 !== null) {
    evidence = trailing3;
    evidenceSource = "timed";
  } else if (report.quiz7d.accuracy !== null) {
    evidence = report.quiz7d.accuracy - QUIZ_HAIRCUT;
    evidenceSource = "quiz-minus-12";
  }

  // Cadence / runway (0-100): active recently and on pace.
  // Last study day from the daily table; else the activity log's last access; else, if the
  // 1-month breakdown is there but empty for someone who has studied before, 30+ days dark.
  const lastActiveDate = lastActive(report.daily) ?? report.lastAccess ?? null;
  const studiedBefore = (report.studyMin ?? 0) > 0 || (report.pagesRead ?? 0) > 0;
  const darkDays = lastActiveDate ? Math.max(0, daysBetween(lastActiveDate, today))
    : report.studyWindowEmpty && studiedBefore ? 30 : null;
  let cadence: number | null = null;
  if (darkDays !== null) {
    cadence = clamp(100 - 15 * Math.max(0, darkDays - 1));
    if (pace.status === "behind") cadence *= 0.6;
    if (pace.status === "critical") cadence *= 0.3;
  }

  const book = report.pagesRead !== null && report.pagesTotal ? (100 * report.pagesRead) / report.pagesTotal : null;

  // Base composite (savannah v7), renormalized over whatever components exist.
  const parts: [number | null, number][] = [
    [evidence, 0.4],
    [report.readiness, 0.25],
    [book, 0.2],
    [cadence, 0.15],
  ];
  const have = parts.filter(([v]) => v !== null) as [number, number][];
  const base = evidence !== null && have.length
    ? round1(have.reduce((s, [v, w]) => s + v * w, 0) / have.reduce((s, [, w]) => s + w, 0))
    : null;

  // Calibration: this person's real exams over-read by their platform scores.
  const sits = (input.realSits ?? []).filter(s => !exam || s.examType === exam);
  let penalty = 0;
  const failedHigh: number[] = [];
  for (const s of sits) {
    if (s.outcome === "FAIL" && s.predictedAtSit !== null && s.predictedAtSit >= 70) {
      penalty += 0.6 * (s.predictedAtSit - 70);
      failedHigh.push(s.predictedAtSit);
    }
  }
  penalty = round1(Math.min(20, penalty));
  const calibrated = base !== null ? round1(clamp(base - penalty)) : null;
  const calibrationReason = failedHigh.length
    ? `prior real ${exam ?? "exam"} fail${failedHigh.length > 1 ? "s" : ""} at practice ${failedHigh.join(", ")} — discounting platform scores by ${penalty}`
    : null;

  const bankExposure = input.kaplan?.answered != null && input.kaplan?.total ? input.kaplan.answered / input.kaplan.total : null;
  const bankBurnout = bankExposure !== null && bankExposure > BANK_BURNOUT_EXPOSURE;
  const speedRatio = median(last3.map(t => t.speedRatio).filter((r): r is number => r !== null));
  const rushing = speedRatio !== null && speedRatio < FAST_FINISH_RATIO;

  // Phase gate — the reading comes first, then Achievable full exams, then Kaplan.
  const achievableFull = timed.filter(t => t.source === "achievable").length;
  const kaplanSims = timed.filter(t => t.source === "kaplan").length;
  let phase: Readiness["phase"];
  if (!pace.bookDone) phase = 1;
  else if (achievableFull < 2) phase = 2;
  else if (kaplanSims >= 3 && (trailing3 ?? 0) < READY_BAR) phase = 4;
  else phase = 3;
  const phaseName = { 1: "Finish the book (Achievable only)", 2: "Full exams on Achievable", 3: "Kaplan", 4: "Supplemental help" }[phase];

  // Failure modes — the playbook vocabulary.
  const modes = new Set<FailureMode>();
  const notes = (input.notes ?? []).join("\n");
  const anyStudy = report.daily.some(d => d.totalMin > 0) || (report.studyMin ?? 0) > 0;
  if (examDate && daysBetween(examDate, today) > 0 && !sits.some(s => s.date >= examDate)) modes.add("result_missing");
  if (UNPAID.test(notes)) modes.add("materials_unpaid");
  // Only when Achievable actually shows zero — no data (e.g. LAH isn't on Achievable) is not "not started".
  if (!anyStudy && report.pagesRead === 0 && timed.length === 0) modes.add("not_started");
  if (darkDays !== null && darkDays >= 7) modes.add("dormant");
  if (bingeAndVanish(report.daily, today)) modes.add("binge_and_vanish");
  if (!pace.bookDone && (pace.stalled || (pace.finishVsDeadlineDays ?? 0) > 0 || (pace.finishVsExamDays ?? 0) > 0)) modes.add("reading_stalled");
  if (!pace.bookDone && report.quizMin !== null && report.readingMin && report.quizMin >= 1.5 * report.readingMin) modes.add("comfort_quizzing");
  if (bankBurnout) modes.add("bank_burnout");
  if (last3.length >= 2 && last3.every(t => t.score < cut) && Math.max(...last3.map(t => t.score)) - Math.min(...last3.map(t => t.score)) <= 6) modes.add("plateau_below_cut");
  if (pace.bookDone && neverTested) modes.add("never_tested");
  const failureModes = MODE_PRIORITY.filter(m => modes.has(m));

  // Upgraded gold standard: 3 full exams in the 80s, taken timed at real pace, on fresh
  // questions, with calibrated readiness at the bar. (Fixes the "80s on practice, failed the real exam" pattern.)
  // Only the 3 most recent count: old 80s don't offset a slide below the cut.
  const qualifying = last3.filter(t => t.score >= READY_BAR && (t.speedRatio === null || t.speedRatio >= FAST_FINISH_RATIO)).length;
  const gaps: GoldGap[] = [];
  if (qualifying < 3) {
    const t = `${qualifying} of 3 timed full exams in the 80s at real pace`;
    gaps.push({ code: "timed", text: t, sponsorText: t });
  }
  if (rushing) {
    const t = `finishing full exams too fast (median ${Math.round((speedRatio ?? 0) * 100)}% of the allowed time)`;
    gaps.push({ code: "rushing", text: t, sponsorText: t });
  }
  if (bankBurnout) {
    const t = `Kaplan bank ${Math.round((bankExposure ?? 0) * 100)}% seen — scores now reflect recall of seen questions`;
    gaps.push({ code: "bank", text: t, sponsorText: t });
  }
  if (calibrated === null || calibrated < READY_BAR) {
    gaps.push({
      code: "calibrated",
      text: `calibrated readiness ${calibrated ?? "n/a"} (needs ${READY_BAR}+)`,
      sponsorText: penalty > 0 ? "after past real-exam results, practice scores have to clear a higher bar before you sit" : "overall evidence isn't strong enough yet to sit",
    });
  }
  const goldStandard = { met: gaps.length === 0, qualifying, needed: 3, gaps };

  const published = neverTested ? null : calibrated;
  const band = published === null ? null : published >= 80 ? "green" : published >= 60 ? "amber" : "red";
  const passOdds = published === null ? null : Math.round(100 / (1 + Math.exp(-(published - 72) / 8)));

  // Dot (fga-sponsors): on track = pace meets need AND activity in the last 2 days.
  let dot: Readiness["dot"];
  let dotReason: string;
  const lastSit = [...(input.realSits ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const recentSit = lastSit && (!examDate || examDate <= lastSit.date) && daysBetween(lastSit.date, today) <= RECENT_SIT_DAYS ? lastSit : null;
  const failedNoDate = recentSit?.outcome === "FAIL";
  if (failedNoDate) {
    dot = "red";
    dotReason = `failed ${lastSit!.examType} ${lastSit!.date.slice(5).replace("-", "/")} — no next exam date`;
  } else if (failureModes.includes("result_missing")) {
    dot = "grey";
    dotReason = "exam date passed — result not recorded";
  } else if (!anyStudy && report.pagesRead === null) {
    dot = "grey";
    dotReason = "no study data";
  } else if (darkDays !== null && darkDays > 2) {
    dot = "red";
    dotReason = `no activity in ${darkDays} days`;
  } else if (pace.status === "behind" || pace.status === "critical") {
    dot = "red";
    dotReason = pace.status === "critical" ? "reading pace won't finish the book in time" : "behind on reading pace";
  } else if (failureModes.some(m => m === "materials_unpaid" || m === "plateau_below_cut" || m === "bank_burnout")) {
    dot = "red";
    dotReason = MODE_LABEL[failureModes.find(m => m === "materials_unpaid" || m === "plateau_below_cut" || m === "bank_burnout")!];
  } else if (pace.bookDone && trailing3 !== null && trailing3 < cut) {
    dot = "red";
    dotReason = `timed exams below the cut (avg ${round1(trailing3)} vs ${cut})`;
  } else {
    dot = "green";
    dotReason = pace.bookDone ? "book done, active" : "on pace, active";
  }

  return {
    exam,
    cut,
    phase,
    phaseName,
    timed,
    trailing3: trailing3 === null ? null : round1(trailing3),
    distanceFromCut: trailing3 === null ? null : round1(trailing3 - cut),
    neverTested,
    evidence: evidence === null ? null : round1(evidence),
    evidenceSource,
    base,
    penalty,
    calibrated,
    published,
    band,
    passOdds,
    bankExposure: bankExposure === null ? null : Math.round(bankExposure * 1000) / 1000,
    bankBurnout,
    speedRatio: speedRatio === null ? null : Math.round(speedRatio * 100) / 100,
    rushing,
    darkDays,
    last4AvgMin: report.daily.length ? Math.round(avgLastN(report.daily, today, 4)) : null,
    failureModes,
    primaryMode: failureModes[0] ?? null,
    dot,
    dotReason,
    goldStandard,
    calibrationReason,
    untimed,
    daysToExam: examDate ? daysBetween(today, examDate) : null,
    lastSit,
    recentSit,
    goNoGo: !!examDate && daysBetween(today, examDate) >= 0 && daysBetween(today, examDate) <= GO_NO_GO_DAYS && !goldStandard.met,
  };
}

/** Facts for the TEAM email. Calibrated numbers stay internal — sponsors get the consequence. */
export function formatReadinessFacts(r: Readiness, audience: "sponsor" | "team"): string {
  const L: string[] = [];
  L.push("READINESS FACTS (computed from Nick's playbook — authoritative, do NOT recalculate or override):");
  L.push(`- PHASE ${r.phase} — ${r.phaseName}. Build the plan for this phase only.`);
  L.push(`- Cut score for ${r.exam ?? "this exam"}: ${r.cut}%. Read every score as distance from the cut.`);
  if (r.neverTested) {
    L.push("- NEVER TESTED: zero timed full-length exams. Do NOT quote OUR readiness score or pass odds (Achievable's own meter is fine). The real exam is unproven.");
  } else {
    L.push(`- Last ${Math.min(3, r.timed.length)} timed full-lengths (newest first): ${r.timed.slice(0, 3).map(t => `${t.name} ${t.score}%${t.date ? ` (${t.date})` : ""}`).join("; ")}. Trailing average ${r.trailing3}% (${r.distanceFromCut! >= 0 ? "+" : ""}${r.distanceFromCut} vs cut).`);
  }
  if (r.untimed.length) {
    const eg = r.untimed[0];
    L.push(`- UNTIMED: ${r.untimed.length} full exam(s) ran past the clock (e.g. ${eg.name} ${eg.score}% at ${Math.round((eg.speedRatio ?? 0) * 100)}% of the allowed time). They are NOT counted toward readiness — say so, and have them retake timed, in one sitting.`);
  }
  if (r.rushing) L.push(`- RUSHING: they finish full exams in ~${Math.round((r.speedRatio ?? 0) * 100)}% of the allowed time. Practice scores taken this fast over-read the real exam — require full use of the clock.`);
  if (r.bankBurnout) L.push(`- BANK BURNOUT: ${Math.round((r.bankExposure ?? 0) * 100)}% of the Kaplan bank already answered. Above 70%, sims measure recall of seen questions — switch to fresh questions.`);
  if (r.failureModes.length) L.push(`- FAILURE MODE(S): ${r.failureModes.map(m => MODE_LABEL[m]).join(", ")} (primary: ${MODE_LABEL[r.primaryMode!]}). Use the matching strategy.`);
  else L.push("- FAILURE MODE: none detected — keep momentum.");
  if (r.darkDays !== null) L.push(`- Last activity: ${r.darkDays === 0 ? "today" : `${r.darkDays} day(s) ago`}; averaging ${r.last4AvgMin ?? 0} min/day over the last 4 days.`);
  const gaps = r.goldStandard.gaps.map(g => (audience === "team" ? g.text : g.sponsorText)).join("; ");
  L.push(`- EXAM-READY (gold standard: 3 timed full exams in the 80s at real pace, on fresh questions${audience === "team" ? ", calibrated 80+" : ""}): ${r.goldStandard.met ? "MET" : "NOT MET — " + gaps}.`);

  if (audience === "team") {
    if (r.published !== null) {
      L.push(`- % READY: base ${r.base} → calibrated ${r.calibrated}${r.calibrationReason ? ` (${r.calibrationReason})` : ""}. Band ${r.band}. Est. pass odds if they sat now: ~${r.passOdds}%.`);
    }
    L.push(`- Status dot: ${r.dot.toUpperCase()} — ${r.dotReason}.`);
  } else {
    L.push("- Do NOT show the sponsor any readiness %, calibration, or pass-odds number. Give them the concrete consequence and the plan instead.");
  }
  return L.join("\n");
}
