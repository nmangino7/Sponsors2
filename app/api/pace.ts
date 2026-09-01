// Reading-pace math for Phase 1 (finish the Achievable textbook).
// Computed in code — NOT left to the model — so the daily quota is always exact.

// Achievable's own guidance: finish the reading ~2 weeks before test day.
export const BOOK_DEADLINE_TARGET_DAYS = 14;
// Absolute floor — below this the exam phase is too short to reach 3 exams in the 80s.
export const BOOK_DEADLINE_FLOOR_DAYS = 5;
// Above this daily reading load we flag the DM (sponsor still gets the ramped number).
const CRITICAL_MINUTES_PER_DAY = 180;

export interface PaceInput {
  pagesRead?: number | null;
  pagesTotal?: number | null;
  readingMinutesLeft?: number | null;
  readingTimeHours?: number | null;
  quizTimeHours?: number | null;
  examDate?: string | null; // YYYY-MM-DD
  today?: Date;
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
  daysToDeadline: number | null;
  requiredMinutesPerDay: number | null;
  requiredPagesPerDay: number | null;
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

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  const a0 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const b0 = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((b0 - a0) / MS);
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

  if (input.examDate) {
    const exam = new Date(`${input.examDate}T00:00:00Z`);
    if (!isNaN(exam.getTime())) {
      const target = new Date(exam.getTime() - BOOK_DEADLINE_TARGET_DAYS * 86400000);
      const floor = new Date(exam.getTime() - BOOK_DEADLINE_FLOOR_DAYS * 86400000);
      let deadline = target;
      // If the 2-week target is already gone, slide toward the 5-day floor.
      if (daysBetween(today, target) < 1) {
        deadline = floor;
        usingFloor = true;
      }
      let d = daysBetween(today, deadline);
      if (d < 1) d = 1; // always at least "today"
      bookDeadline = toISO(deadline);
      daysToDeadline = d;
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
      // Fallback estimate when Achievable's "Reading time left" is missing.
      if (requiredMinutesPerDay === null) {
        requiredMinutesPerDay = Math.ceil((pagesRemaining * 8) / daysToDeadline);
      }
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
  } else if (requiredMinutesPerDay !== null) {
    if (requiredMinutesPerDay > CRITICAL_MINUTES_PER_DAY) status = "critical";
    else if (usingFloor || requiredMinutesPerDay > 90) status = "behind";
    else status = "on-pace";
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
    daysToDeadline,
    requiredMinutesPerDay,
    requiredPagesPerDay,
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

  if (p.bookDone) {
    L.push("- THE BOOK IS FINISHED. Do not assign more reading; move to full exams.");
  } else if (p.bookDeadline && p.daysToDeadline) {
    L.push(`- Exam date: ${p.examDate}. BOOK DEADLINE: ${p.bookDeadline} (${p.daysToDeadline} day(s) from today).`);
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

  if (p.quizVsReadingFlag) {
    L.push(`- IMBALANCE: ${p.quizTimeHours}h on quizzes vs ${p.readingTimeHours}h reading while the book is unfinished. Call this out directly — it is why they are stuck.`);
  }

  const statusLine: Record<PaceFacts["status"], string> = {
    "on-pace": "- PACE STATUS: on pace. Keep the quota steady.",
    behind: "- PACE STATUS: BEHIND. Say so plainly, give the higher quota, and do NOT suggest moving the exam date.",
    critical: "- PACE STATUS: CRITICAL — the required load is very high. Give the sponsor the ramped number anyway and flag the DM internally. Never tell the sponsor to move the exam date.",
    unknown: "- PACE STATUS: unknown (missing data). Assume Phase 1 and state what you need.",
  };
  L.push(statusLine[p.status]);

  return L.join("\n");
}
