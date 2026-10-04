// Reading-pace math for Phase 1 (finish the Achievable textbook).
// Computed in code — NOT left to the model — so the daily quota is always exact.

// Achievable's own guidance: finish the reading ~2 weeks before test day.
export const BOOK_DEADLINE_TARGET_DAYS = 14;
// Absolute floor — below this the exam phase is too short to reach 3 exams in the 80s.
export const BOOK_DEADLINE_FLOOR_DAYS = 5;
// Above this daily reading load we flag the DM (sponsor still gets the ramped number).
const CRITICAL_MINUTES_PER_DAY = 180;
// Fallback reading estimate when Achievable's "Reading time left" is missing.
const MINUTES_PER_PAGE = 8;

export interface PaceInput {
  pagesRead?: number | null;
  pagesTotal?: number | null;
  readingMinutesLeft?: number | null;
  readingTimeHours?: number | null;
  quizTimeHours?: number | null;
  examDate?: string | null; // YYYY-MM-DD
  today?: Date;
  // Observed pace (pace v2): the previous snapshot from memory, else time on the platform.
  prevPagesRead?: number | null;
  prevDate?: string | null; // YYYY-MM-DD
  firstActivityDate?: string | null; // YYYY-MM-DD
}

export interface PaceFacts {
  pagesRead: number | null;
  pagesTotal: number | null;
  pagesRemaining: number | null;
  percentComplete: number | null;
  bookDone: boolean;
  readingMinutesLeft: number | null;
  examDate: string | null;
  bookDeadline: string | null;
  usingFloor: boolean;
  deadlinePassed: boolean; // even the 5-day floor is behind us
  examPassed: boolean; // the exam date is before today
  daysToDeadline: number | null;
  requiredMinutesPerDay: number | null;
  requiredPagesPerDay: number | null;
  observedPagesPerDay: number | null;
  observedPaceSource: "since-last-upload" | "since-first-activity" | null;
  projectedFinish: string | null; // when the book is done at the observed pace
  stalled: boolean; // pages remain but observed pace is ~0
  finishVsDeadlineDays: number | null; // + = finishes AFTER the book deadline
  finishVsExamDays: number | null; // + = finishes AFTER the exam
  status: "on-pace" | "behind" | "critical" | "unknown";
  quizVsReadingFlag: boolean;
  readingTimeHours: number | null;
  quizTimeHours: number | null;
}

/** "5h 8m" | "77m" | "2 hrs" -> minutes */
export function parseDurationToMinutes(raw?: string | number | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).toLowerCase();
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/);
  const m = s.match(/(\d+(?:\.\d+)?)\s*m(?!o)/);
  if (!h && !m) {
    const bare = s.match(/(\d+(?:\.\d+)?)/);
    return bare ? Math.round(parseFloat(bare[1])) : null;
  }
  const mins = (h ? parseFloat(h[1]) * 60 : 0) + (m ? parseFloat(m[1]) : 0);
  return Math.round(mins) || null;
}

/** "77/150" -> {read:77,total:150}. Never assume a total — it is course-specific. */
export function parsePages(raw?: string | null): { read: number | null; total: number | null } {
  if (!raw) return { read: null, total: null };
  const m = String(raw).match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { read: null, total: null };
  return { read: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

const DAY = 86400000;

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((utcDay(b) - utcDay(a)) / DAY);
}

function isoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function computePace(input: PaceInput): PaceFacts {
  const today = input.today ?? new Date();
  const pagesRead = typeof input.pagesRead === "number" ? input.pagesRead : null;
  const pagesTotal = typeof input.pagesTotal === "number" ? input.pagesTotal : null;
  const pagesRemaining =
    pagesRead !== null && pagesTotal !== null ? Math.max(0, pagesTotal - pagesRead) : null;
  const percentComplete =
    pagesRead !== null && pagesTotal ? Math.round((pagesRead / pagesTotal) * 100) : null;
  const bookDone = pagesRemaining !== null && pagesRemaining === 0;

  const readingMinutesLeft =
    typeof input.readingMinutesLeft === "number" ? input.readingMinutesLeft : null;

  let bookDeadline: string | null = null;
  let daysToDeadline: number | null = null;
  let usingFloor = false;
  let deadlinePassed = false;
  let examPassed = false;
  let exam: Date | null = null;

  if (input.examDate) {
    const e = isoDate(input.examDate);
    if (!isNaN(e.getTime())) {
      exam = e;
      const target = new Date(e.getTime() - BOOK_DEADLINE_TARGET_DAYS * DAY);
      const floor = new Date(e.getTime() - BOOK_DEADLINE_FLOOR_DAYS * DAY);
      let deadline = target;
      // If the 2-week target is already gone, slide toward the 5-day floor.
      if (daysBetween(today, target) < 1) {
        deadline = floor;
        usingFloor = true;
      }
      let d = daysBetween(today, deadline);
      examPassed = daysBetween(today, e) < 0;
      if (d < 0) {
        // Floor gone too: everything left is due before the exam — spread it over the days
        // up to the day before test day (at least today).
        deadlinePassed = true;
        d = Math.max(1, daysBetween(today, e) - 1);
      }
      if (d < 1) d = 1; // always at least "today"
      bookDeadline = toISO(deadline);
      daysToDeadline = examPassed ? null : d;
    }
  }

  let requiredMinutesPerDay: number | null = null;
  let requiredPagesPerDay: number | null = null;
  if (daysToDeadline && !bookDone) {
    if (readingMinutesLeft !== null) {
      requiredMinutesPerDay = Math.ceil(readingMinutesLeft / daysToDeadline);
    }
    if (pagesRemaining !== null) {
      requiredPagesPerDay = Math.ceil(pagesRemaining / daysToDeadline);
      if (requiredMinutesPerDay === null) {
        requiredMinutesPerDay = Math.ceil((pagesRemaining * MINUTES_PER_PAGE) / daysToDeadline);
      }
    }
  }

  // Observed pace: prefer the run-over-run delta from memory; fall back to time on the platform.
  let observedPagesPerDay: number | null = null;
  let observedPaceSource: PaceFacts["observedPaceSource"] = null;
  if (pagesRead !== null && typeof input.prevPagesRead === "number" && input.prevDate) {
    const dd = daysBetween(isoDate(input.prevDate), today);
    if (dd > 0 && pagesRead >= input.prevPagesRead) {
      observedPagesPerDay = (pagesRead - input.prevPagesRead) / dd;
      observedPaceSource = "since-last-upload";
    }
  }
  if (observedPagesPerDay === null && pagesRead !== null && input.firstActivityDate) {
    const dd = Math.max(daysBetween(isoDate(input.firstActivityDate), today), 1);
    observedPagesPerDay = pagesRead / dd;
    observedPaceSource = "since-first-activity";
  }
  if (observedPagesPerDay !== null) observedPagesPerDay = Math.round(observedPagesPerDay * 10) / 10;

  let projectedFinish: string | null = null;
  let stalled = false;
  let finishVsDeadlineDays: number | null = null;
  let finishVsExamDays: number | null = null;
  if (bookDone) {
    projectedFinish = toISO(today);
  } else if (pagesRemaining !== null && observedPagesPerDay !== null) {
    if (observedPagesPerDay < 0.05) {
      stalled = true;
    } else {
      const finish = new Date(utcDay(today) + Math.ceil(pagesRemaining / observedPagesPerDay) * DAY);
      projectedFinish = toISO(finish);
      if (bookDeadline) finishVsDeadlineDays = daysBetween(isoDate(bookDeadline), finish);
      if (exam) finishVsExamDays = daysBetween(exam, finish);
    }
  }

  const readingTimeHours =
    typeof input.readingTimeHours === "number" ? input.readingTimeHours : null;
  const quizTimeHours = typeof input.quizTimeHours === "number" ? input.quizTimeHours : null;
  // The classic failure: far more time on quizzes than reading while the book is unfinished.
  const quizVsReadingFlag =
    !bookDone &&
    readingTimeHours !== null &&
    quizTimeHours !== null &&
    readingTimeHours > 0 &&
    quizTimeHours > readingTimeHours * 1.5;

  let status: PaceFacts["status"] = "unknown";
  if (bookDone) {
    status = "on-pace";
  } else if (requiredMinutesPerDay !== null || projectedFinish !== null || stalled) {
    const examSoon = exam !== null && daysBetween(today, exam) <= 14;
    if (
      (requiredMinutesPerDay !== null && requiredMinutesPerDay > CRITICAL_MINUTES_PER_DAY) ||
      (finishVsExamDays !== null && finishVsExamDays > 0) ||
      (stalled && examSoon)
    ) {
      status = "critical";
    } else if (
      usingFloor ||
      stalled ||
      (finishVsDeadlineDays !== null && finishVsDeadlineDays > 0) ||
      (requiredMinutesPerDay !== null && requiredMinutesPerDay > 90)
    ) {
      status = "behind";
    } else {
      status = "on-pace";
    }
  }

  return {
    pagesRead,
    pagesTotal,
    pagesRemaining,
    percentComplete,
    bookDone,
    readingMinutesLeft,
    examDate: input.examDate ?? null,
    bookDeadline,
    usingFloor,
    deadlinePassed,
    examPassed,
    daysToDeadline,
    requiredMinutesPerDay,
    requiredPagesPerDay,
    observedPagesPerDay,
    observedPaceSource,
    projectedFinish,
    stalled,
    finishVsDeadlineDays,
    finishVsExamDays,
    status,
    quizVsReadingFlag,
    readingTimeHours,
    quizTimeHours,
  };
}

function fmtMins(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** The PACE FACTS block injected into every prompt. The model must restate these numbers. */
export function formatPaceFacts(p: PaceFacts): string {
  const L: string[] = [];
  L.push("PACE FACTS (computed — these numbers are authoritative, restate them exactly; do NOT recalculate):");

  if (p.pagesRead !== null && p.pagesTotal !== null) {
    L.push(`- Book progress: ${p.pagesRead}/${p.pagesTotal} pages (${p.percentComplete}%) — ${p.pagesRemaining} pages left.`);
  } else {
    L.push("- Book progress: NOT PROVIDED. Assume Phase 1 and ask them to confirm their pages read / total.");
  }

  if (p.readingMinutesLeft !== null) {
    L.push(`- Achievable "Reading time left": ${fmtMins(p.readingMinutesLeft)}.`);
  }

  if (p.examPassed) {
    L.push(`- EXAM DATE ${p.examDate} HAS PASSED. No reading quota or study plan against that date — see READINESS FACTS for the result and the next step.`);
    return L.join("\n");
  }

  if (p.bookDone) {
    L.push("- THE BOOK IS FINISHED. Do not assign more reading; move to full exams.");
  } else if (p.bookDeadline && p.daysToDeadline && p.deadlinePassed) {
    L.push(`- Exam date: ${p.examDate}. BOOK DEADLINE was ${p.bookDeadline} — ALREADY PASSED. Everything left must be read in the ${p.daysToDeadline} day(s) before test day. Say so directly.`);
    if (p.requiredMinutesPerDay !== null) {
      const pagesPart = p.requiredPagesPerDay !== null ? ` (about ${p.requiredPagesPerDay} pages/day)` : "";
      L.push(`- REQUIRED DAILY READING QUOTA: ${fmtMins(p.requiredMinutesPerDay)} per day${pagesPart}. Lead the email with this number and show the math.`);
    }
  } else if (p.bookDeadline && p.daysToDeadline) {
    L.push(`- Exam date: ${p.examDate}. BOOK DEADLINE: ${p.bookDeadline} (${p.daysToDeadline} day(s) of reading left).`);
    if (p.usingFloor) {
      L.push("- NOTE: the ideal 2-week-before target has already passed, so this deadline is the 5-day floor. They are late — say so directly.");
    }
    if (p.requiredMinutesPerDay !== null) {
      const pagesPart = p.requiredPagesPerDay !== null ? ` (about ${p.requiredPagesPerDay} pages/day)` : "";
      L.push(`- REQUIRED DAILY READING QUOTA: ${fmtMins(p.requiredMinutesPerDay)} per day${pagesPart}. Lead the email with this number and show the math.`);
    }
  } else {
    L.push("- No exam date provided: give the quota relative to the deadline (finish ~2 weeks before test day) and ask them to confirm their test date.");
  }

  if (!p.bookDone && p.observedPagesPerDay !== null) {
    const since = p.observedPaceSource === "since-last-upload" ? "since their last report" : "averaged since they started";
    if (p.stalled) {
      L.push(`- OBSERVED PACE: ~0 pages/day ${since} — reading has STALLED. At this pace the book never gets finished. Say so.`);
    } else if (p.projectedFinish) {
      let when = `the book finishes ~${p.projectedFinish}`;
      if (p.finishVsExamDays !== null && p.finishVsExamDays > 0) when += ` — ${p.finishVsExamDays} day(s) AFTER the exam`;
      else if (p.finishVsDeadlineDays !== null && p.finishVsDeadlineDays > 0) when += ` — ${p.finishVsDeadlineDays} day(s) after the book deadline`;
      else if (p.finishVsDeadlineDays !== null) when += " — before the book deadline";
      L.push(`- OBSERVED PACE: ~${p.observedPagesPerDay} pages/day ${since}; at that pace ${when}. This is the runway number — use it.`);
    }
  }

  if (p.quizVsReadingFlag) {
    L.push(`- IMBALANCE: ${p.quizTimeHours}h on quizzes vs ${p.readingTimeHours}h reading while the book is unfinished. Call this out directly — it is why they are stuck.`);
  }

  const statusLine: Record<PaceFacts["status"], string> = {
    "on-pace": "- PACE STATUS: on pace. Keep the quota steady.",
    behind: "- PACE STATUS: BEHIND. Say so plainly, give the higher quota, and do NOT suggest moving the exam date.",
    critical: "- PACE STATUS: CRITICAL — at the current pace the book is not done in time. Give the sponsor the ramped number anyway and flag the DM internally. Never tell the sponsor to move the exam date.",
    unknown: "- PACE STATUS: unknown (missing data). Assume Phase 1 and state what you need.",
  };
  L.push(statusLine[p.status]);

  return L.join("\n");
}
