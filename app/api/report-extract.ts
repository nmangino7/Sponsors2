// Deterministic parser for Achievable study-report text (the PDF's text layer).
// Ported from the extractor regexes in Nick's fga-sponsors / savannah-sponsorship-daily
// playbooks, made tolerant of label and value landing on the same line or on separate
// lines. Pure, dependency-free — anything it can't find is listed in `missing` so the
// LLM pass can fill the gap.

export interface PracticeAttempt {
  name: string;
  status: "PASS" | "FAIL" | "WARN" | "DISCARDED";
  date: string; // YYYY-MM-DD
  completionPct: number | null;
  minutesUsed: number | null;
  minutesAllowed: number | null;
  score: number;
  correct: number | null;
  total: number | null;
  fullLength: boolean;
}

export interface DailyStudy {
  date: string; // YYYY-MM-DD
  totalMin: number;
  readingMin: number;
  quizMin: number;
  examMin: number;
  questions: number;
}

export interface TopicScore {
  name: string;
  correct: number;
  total: number;
  pct: number;
}

export interface Summary7d {
  questions: number | null;
  accuracy: number | null;
  topics: TopicScore[];
}

export interface ReportData {
  name: string | null;
  email: string | null;
  achievableUuid: string | null;
  course: string | null;
  exam: string | null;
  reportDate: string | null;
  studyMin: number | null;
  readingMin: number | null;
  quizMin: number | null;
  examMin: number | null;
  pagesRead: number | null;
  pagesTotal: number | null;
  readingMinutesLeft: number | null;
  fullLengthCounter: number | null; // the header tile — full-lengths only, NOT attempts
  readiness: number | null;
  targetDate: string | null;
  planStatus: string | null;
  overdueMinutes: number | null;
  quiz7d: Summary7d;
  exam7d: Summary7d;
  attempts: PracticeAttempt[];
  daily: DailyStudy[];
  careerQuestions: number | null;
  activeDays: number | null;
  firstActivity: string | null; // first day on the platform ("Accessed from"), else earliest daily entry
  tooFastFlags: number;
  missing: string[];
}

const COURSE_TO_EXAM: Record<string, string> = {
  "finra-sie": "SIE",
  "finra-series-63": "63",
  "finra-series-65": "65",
  "finra-series-66": "66",
  "finra-series-7": "7",
  "insurance-life-health": "LAH",
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "3h 45m" | "56m 33s" | "10s" | "1h 0m" -> minutes (fractional). */
export function durationToMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const h = raw.match(/(\d+)\s*h/);
  const m = raw.match(/(\d+)\s*m(?![a-z])/);
  const s = raw.match(/(\d+)\s*s\b/);
  if (!h && !m && !s) return null;
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (s ? +s[1] / 60 : 0);
}

const DUR = String.raw`(\d+h(?:\s*\d+m)?(?:\s*\d+s)?|\d+m(?:\s*\d+s)?|\d+s)`;

// Page furniture that the print layout repeats on every page (and can land mid-entry).
function stripFurniture(text: string): string {
  return text
    .replace(/All rights reserved ©\s*\d{4}\s*-\s*\d{4} Achievable, Inc\.?/g, "\n")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2},\s*\d{1,2}:\d{2}\s*[AP]M\b/g, "\n")
    .replace(/Study report \| Achievable [^\n]*/g, "\n")
    // The page counter ("1/57") follows the URL — on the next line, or on the same line when
    // pdf.js joins the print footer. Strip it only there: a bare "77/150" elsewhere is pages read.
    .replace(/https:\/\/app\.achievable\.me\/study-report\/\S+(?:\s+\d{1,3}\/\d{1,3}(?=\s*\n|\s*$))?/g, "\n");
}

function between(text: string, start: string, end?: string): string {
  const i = text.indexOf(start);
  if (i < 0) return "";
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return text.slice(i, j < 0 ? text.length : j);
}

function num(m: RegExpMatchArray | null, i = 1): number | null {
  return m ? Number(m[i]) : null;
}

function isoFromMDY(mdy: string): string | null {
  const m = mdy.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseSummary(seg: string): Summary7d {
  const topics: TopicScore[] = [];
  const re = /(?:^|\n)([A-Z][^\n\d]{2,45}?)\s*\n?\s*(\d+)\s*\/\s*(\d+)\s+(\d+)%/g;
  for (const m of seg.matchAll(re)) {
    topics.push({ name: m[1].trim(), correct: +m[2], total: +m[3], pct: +m[4] });
  }
  return {
    questions: num(seg.match(/QUESTIONS\s+(\d+)/)),
    accuracy: num(seg.match(/ACCURACY\s+([\d.]+)%/)),
    topics,
  };
}

function parseDaily(text: string): DailyStudy[] {
  const out: DailyStudy[] = [];
  const dates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)];
  for (let i = 0; i < dates.length; i++) {
    const start = (dates[i].index ?? 0) + dates[i][0].length;
    const end = i + 1 < dates.length ? dates[i + 1].index ?? text.length : text.length;
    // Cap the segment so the last entry can't borrow values from later sections.
    const seg = text.slice(start, Math.min(end, start + 400));
    if (!/\bTotal\s+\d/.test(seg)) continue; // chart-axis dates and "Accessed from" lines
    const field = (label: string) => durationToMinutes((seg.match(new RegExp(`\\b${label}\\s+${DUR}`)) || [])[1]);
    out.push({
      date: dates[i][1],
      totalMin: field("Total") ?? 0,
      readingMin: field("Reading") ?? 0,
      quizMin: field("Quiz") ?? 0,
      examMin: field("Exam") ?? 0,
      questions: num(seg.match(/(\d+)\s+taken/)) ?? 0,
    });
  }
  // A date can appear twice (axis + entry); keep the entry with data.
  const byDate = new Map<string, DailyStudy>();
  for (const d of out) {
    const prev = byDate.get(d.date);
    if (!prev || d.totalMin > prev.totalMin) byDate.set(d.date, d);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function parseAttempts(seg: string): PracticeAttempt[] {
  const re = new RegExp(
    String.raw`(?:^|\n)([A-Za-z][\w .,:&'\-]{1,60}?)\s+(PASS|FAIL|WARN|DISCARDED)\s+(\d{1,2}-\d{1,2}-\d{4})\s+[\d:]+\s*[ap]m\s+(\d+)%\s*(\d+)\s*\/\s*(\d+)\s*m\s+(\d+)%(?:\s*,\s*(\d+)\s*\/\s*(\d+))?`,
    "g"
  );
  const out: PracticeAttempt[] = [];
  for (const m of seg.matchAll(re)) {
    const name = m[1].trim();
    out.push({
      name,
      status: m[2] as PracticeAttempt["status"],
      date: isoFromMDY(m[3]) ?? m[3],
      completionPct: +m[4],
      minutesUsed: +m[5],
      minutesAllowed: +m[6],
      score: +m[7],
      correct: m[8] ? +m[8] : null,
      total: m[9] ? +m[9] : null,
      fullLength: /full exam|final exam/i.test(name),
    });
  }
  return out;
}

function resolveTargetDate(raw: string, reportDate: string | null): string | null {
  const m = raw.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const ref = reportDate ? new Date(`${reportDate}T00:00:00Z`) : new Date();
  let year = ref.getUTCFullYear();
  // Target dates have no year; one that's well before the report date is next year.
  const candidate = Date.UTC(year, month, +m[2]);
  if (candidate < ref.getTime() - 60 * 86400000) year += 1;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
}

export function extractReport(rawText: string): ReportData {
  const raw = rawText.replace(/\r/g, "");

  // Identity + print metadata come from the page furniture, so read them before stripping it.
  const url = raw.match(/study-report\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([a-z0-9-]+)/i);
  const printed = raw.match(/\b(\d{1,2}\/\d{1,2}\/\d{2}),\s*\d{1,2}:\d{2}\s*[AP]M\b/);
  const reportDate = printed ? isoFromMDY(printed[1]) : null;

  const t = stripFurniture(raw);
  const who = t.match(/Study report\s+(.+?)\s*\(([^()\s]+@[^()\s]+)\)/);
  const course = url ? url[2] : null;

  const pages = t.match(/Pages read\s+(\d+)\s*\/\s*(\d+)/);
  const readinessSeg = between(t, "Exam readiness", "Study time");
  const target = t.match(/Target date:\s*([^\n]+)/);
  const status = target ? (t.slice((target.index ?? 0) + target[0].length, (target.index ?? 0) + target[0].length + 80).match(/\b(ON TRACK|AT RISK|OFF TRACK|BEHIND|COMPLETED?)\b/) || [])[1] ?? null : null;

  const data: ReportData = {
    name: who ? who[1].trim() : null,
    email: who ? who[2].trim() : null,
    achievableUuid: url ? url[1].toLowerCase() : null,
    course,
    exam: course ? COURSE_TO_EXAM[course] ?? null : (t.match(/FINRA (SIE|Series \d+) Study report/) || [])[1]?.replace("Series ", "") ?? null,
    reportDate,
    studyMin: durationToMinutes((t.match(new RegExp(`Study time\\s+${DUR}`)) || [])[1]),
    readingMin: durationToMinutes((t.match(new RegExp(`Reading time\\s+${DUR}`)) || [])[1]),
    quizMin: durationToMinutes((t.match(new RegExp(`Quiz time\\s+${DUR}`)) || [])[1]),
    examMin: durationToMinutes((t.match(new RegExp(`Exam time\\s+${DUR}`)) || [])[1]),
    pagesRead: num(pages, 1),
    pagesTotal: num(pages, 2),
    readingMinutesLeft: durationToMinutes((t.match(new RegExp(`Reading time left\\s+${DUR}`)) || [])[1]),
    fullLengthCounter: num(t.match(/Practice exams\s+(\d+)\b/)),
    readiness: num(readinessSeg.match(/(\d+)%/)),
    targetDate: target ? resolveTargetDate(target[1], reportDate) : null,
    planStatus: status,
    overdueMinutes: num(t.match(/Overdue!\s*(\d+)\s*m/)),
    quiz7d: parseSummary(between(t, "Quiz summary", "Exam summary")),
    exam7d: parseSummary(between(t, "Exam summary", "PRACTICE EXAMS LIST")),
    attempts: parseAttempts(between(t, "PRACTICE EXAMS LIST", "TEXTBOOK PROGRESS")),
    daily: parseDaily(t),
    careerQuestions: num(t.match(/QUIZ QUESTIONS\s+Total:\s*(\d+)/)),
    activeDays: num(t.match(/with\s+(\d+)\s+distinct days of activity/)),
    firstActivity: null,
    tooFastFlags: (between(t, "TEXTBOOK PROGRESS").match(/too fast/gi) || []).length,
    missing: [],
  };

  const required: (keyof ReportData)[] = ["name", "exam", "reportDate", "pagesRead", "pagesTotal", "readingMinutesLeft", "readiness"];
  data.firstActivity = (t.match(/Accessed from\s+(\d{4}-\d{2}-\d{2})/) || [])[1] ?? data.daily[0]?.date ?? null;
  data.missing = required.filter(k => data[k] === null) as string[];
  if (data.daily.length === 0) data.missing.push("daily");
  return data;
}

/** Days with no entry count as zero (playbook rule): avg minutes/day over the N days ending on `end`. */
export function avgStudyMinutes(daily: DailyStudy[], end: string, days = 4): number {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(endMs - i * 86400000).toISOString().slice(0, 10);
    sum += daily.find(x => x.date === d)?.totalMin ?? 0;
  }
  return sum / days;
}

export function lastActiveDate(daily: DailyStudy[]): string | null {
  const active = daily.filter(d => d.totalMin > 0);
  return active.length ? active[active.length - 1].date : null;
}

/** A blank report to fill from the LLM pass when there's no text layer (screenshots, scans). */
export function emptyReport(): ReportData {
  const s = (): Summary7d => ({ questions: null, accuracy: null, topics: [] });
  return {
    name: null, email: null, achievableUuid: null, course: null, exam: null, reportDate: null,
    studyMin: null, readingMin: null, quizMin: null, examMin: null, pagesRead: null, pagesTotal: null,
    readingMinutesLeft: null, fullLengthCounter: null, readiness: null, targetDate: null, planStatus: null,
    overdueMinutes: null, quiz7d: s(), exam7d: s(), attempts: [], daily: [], careerQuestions: null,
    activeDays: null, firstActivity: null, tooFastFlags: 0, missing: [],
  };
}
