import type { ReportData, PracticeAttempt, DailyStudy } from "../app/api/report-extract.ts";

export function makeReport(o: Partial<ReportData> = {}): ReportData {
  return {
    name: "Test Sponsor", email: null, achievableUuid: null, course: "finra-sie", exam: "SIE",
    reportDate: "2026-09-20", studyMin: 600, readingMin: 300, quizMin: 300, examMin: 0,
    pagesRead: 150, pagesTotal: 150, readingMinutesLeft: 0, fullLengthCounter: 0, readiness: 60,
    targetDate: null, planStatus: null, overdueMinutes: null,
    quiz7d: { questions: null, accuracy: null, topics: [] }, exam7d: { questions: null, accuracy: null, topics: [] },
    attempts: [], daily: [], careerQuestions: null, activeDays: null, firstActivity: null, lastAccess: null, studyWindowEmpty: false, tooFastFlags: 0, missing: [],
    ...o,
  };
}

export function fullExam(name: string, date: string, score: number, used = 95, allowed = 105): PracticeAttempt {
  return { name, status: score >= 70 ? "PASS" : "FAIL", date, completionPct: 100, minutesUsed: used, minutesAllowed: allowed, score, correct: null, total: null, fullLength: true };
}

/** Activity on each of the given dates. */
export function activeOn(dates: string[], minutes = 90): DailyStudy[] {
  return dates.map(date => ({ date, totalMin: minutes, readingMin: minutes / 2, quizMin: minutes / 2, examMin: 0, questions: 30 }));
}
