// The free writer: the draft plan, the sponsor email and the team email written from the
// computed facts — no AI, no credits. Every number comes from the engine (pace, readiness,
// checkpoint), so these are exactly as accurate as the AI-written versions, just plainer.

import type { Diagnosis } from "./diagnose.ts";
import type { CheckpointResult } from "./checkpoint.ts";
import { MODE_LABEL } from "./readiness.ts";

/** Who writes the words: built-in templates (free), a prompt to paste into the Claude app, or the Claude API (credits). */
export type Writer = "free" | "claude-app" | "api";

export function parseWriter(v: unknown): Writer {
  return v === "api" || v === "claude-app" ? v : "free";
}

export interface CardInput {
  name: string;
  actions?: string[]; // one string per day, tasks joined with "; "
  dmNeeds?: string;
  status?: string;
  issues?: string;
}

export interface PlanDraft {
  status: string;
  issues: string;
  actions: string[][]; // 4 days x tasks
  dmNeeds: string;
}

function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

function md(iso: string | null | undefined): string {
  if (!iso) return "?";
  const [, m, d] = iso.split("-");
  return `${+m}/${+d}`;
}

function mins(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** "46–60 min", "1h 30m–1h 45m" */
function span(lo: number, extra = 15): string {
  const hi = lo + extra;
  return lo < 60 && hi < 60 ? `${lo}–${hi} min` : `${mins(lo)}–${mins(hi)}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function weakestTopic(d: Diagnosis): string | null {
  // Only a real weak spot (under 80%) — never call a 91% topic "weakest".
  const topics = [...d.report.quiz7d.topics, ...d.report.exam7d.topics].filter(t => t.total >= 10 && t.pct < 80);
  if (!topics.length) return null;
  return topics.reduce((a, b) => (b.pct < a.pct ? b : a)).name;
}

function primary(d: Diagnosis) {
  return d.readiness.primaryMode;
}

function examLabel(exam: string | null): string {
  if (!exam) return "exam";
  return /^\d+$/.test(exam) ? `Series ${exam}` : exam;
}

/** A recent real exam with no later exam date set yet (drives the after-pass / after-fail steps). */
function openSit(d: Diagnosis) {
  return d.readiness.recentSit;
}

/** LAH isn't on Achievable, so never tell an LAH sponsor to open Achievable. */
function course(d: Diagnosis): string {
  return d.exam === "LAH" ? "your LAH course" : "Achievable";
}

/** "6/9", or "6/9/2027" when it isn't this year. */
function mdy(iso: string | null | undefined, today: string): string {
  if (!iso) return "?";
  return iso.slice(0, 4) === today.slice(0, 4) ? md(iso) : `${md(iso)}/${iso.slice(0, 4)}`;
}

// ---------------------------------------------------------------- the 4-day plan

function readingTasks(d: Diagnosis, days: string[]): string[][] {
  const p = d.pace;
  const total = p.pagesTotal;
  const read = p.pagesRead;
  const quota = p.requiredMinutesPerDay ?? 60;
  const perDay = p.requiredPagesPerDay ?? (p.pagesRemaining !== null ? Math.max(5, Math.ceil(p.pagesRemaining / 14)) : null);
  const sections = d.report.planReading.slice(0, 3).map(s => s.section);
  let bookDoneOn = -1;
  return days.map((_, i) => {
    const tasks: string[] = [];
    if (bookDoneOn >= 0) {
      // The plan finishes the book early: Phase 2 starts the next day.
      return i === bookDoneOn + 1
        ? ["Your first timed Achievable full exam, one sitting, start to finish — 2–2.5 hrs — Target: 80%+"]
        : ["Review every missed AND guessed question from the exam — 45–75 min", "Due reviews — 15–20 min"];
    }
    if (read !== null && total !== null && perDay !== null) {
      const to = Math.min(total, read + perDay * (i + 1));
      if (to >= total) bookDoneOn = i;
      const start = i === 0 && sections.length ? `; start with ${sections.join(", ")}` : "";
      tasks.push(to >= total
        ? `Reading — finish the book: to page ${total}/${total}${start} — ${span(quota)} — Target: book done`
        : `Reading — to page ${to}/${total} (~${perDay} pages${start}) — ${span(quota)} — Target: page ${to} by tonight`);
    } else {
      tasks.push(`Reading — your next sections in ${course(d)}${i === 0 && sections.length ? ` (${sections.join(", ")})` : ""} — ${span(quota, 30)} — Target: reading first, before anything else`);
    }
    tasks.push("Chapter quizzes for what you read + any due reviews — 15–25 min — Target: 80%+ (under 80%: re-read that section first)");
    return tasks;
  });
}

function examTasks(d: Diagnosis, days: string[]): string[][] {
  const r = d.readiness;
  const weak = weakestTopic(d);
  const clock = r.rushing ? " — use the full clock, ~1+ min per question, review flagged questions before submitting" : "";
  const where = r.phase === 2 ? "Achievable full exam" : r.bankBurnout ? "Kaplan simulated exam you haven't taken (fresh questions only)" : "Kaplan simulated exam you haven't taken";
  const reread = weak ? `Re-read your weakest section (${weak}) — 30–45 min` : "Re-read the section you missed most — 30–45 min";
  const plan: string[][] = [
    [`Timed ${where}, one sitting, start to finish${clock} — 2–2.5 hrs — Target: 80%+`],
    ["Review every missed AND guessed question from the exam — 45–75 min — Target: know why each answer is right", reread],
    [`Timed ${where}, one sitting${clock} — 2–2.5 hrs — Target: 80%+`],
    ["Review every missed and guessed question — 45–75 min", "Due reviews — 15–20 min"],
  ];
  if (r.phase === 4 || r.failureModes.includes("plateau_below_cut")) {
    plan[1] = [
      "Error analysis on your last 3 full exams: mark each miss didn't-know / misapplied / careless — 60–90 min",
      weak ? `Watch ONE Series 7 Guru video on ${weak}, then 20 questions on that topic — 45–60 min` : "Watch ONE Series 7 Guru video on your weakest topic, then 20 questions on it — 45–60 min",
    ];
    plan[3] = ["Review every miss from the exam — 45–75 min", "Ask your sponsorship team for Ken's next free tutoring session — 5 min"];
  }
  return plan.slice(0, days.length);
}

function shortTasks(d: Diagnosis, days: string[]): string[][] | null {
  const mode = primary(d);
  const sit = openSit(d);
  if (mode === "result_missing") return [["Reply with your exam result (pass or fail) and send the score report — 5 min"], [], [], []];
  if (sit?.outcome === "PASS") return [["Book your next exam and reply with the date — 15 min"], ["Start your next course: read the first section — 30–45 min"], ["Read — 45–60 min"], ["Read — 45–60 min"]];
  if (sit?.outcome === "FAIL" && d.exam && sit.examType !== d.exam) {
    // Failed one exam, moving on to another (e.g. SIE -> LAH): book the next one, then read for it.
    const next = examLabel(d.exam);
    return days.map((_, i) => i === 0
      ? [`Book your ${next} and reply with the date — 15 min`, `Start ${course(d)}: read your next sections — 45–60 min`]
      : [`Read ${course(d)} — 60–90 min — Target: reading first, every day`, "Chapter quizzes for what you read — 15–25 min — Target: 80%+"]);
  }
  if (sit?.outcome === "FAIL") return [["Send the score report so we can see your weakest sections — 5 min", "Book the retake and reply with the date — 15 min"], ["Re-read your weakest score-report section — 45–60 min"], ["Re-read the next weakest section — 45–60 min"], ["Timed full exam, one sitting — 2–2.5 hrs — Target: 80%+"]];
  if (mode === "materials_unpaid") return [[`Get your ${d.exam === "LAH" ? "LAH course" : "Achievable"} access sorted (your manager will help) — today`], ["Read your first sections once you're in — 30–45 min"], ["Read — 45–60 min"], ["Read — 45–60 min"]];
  if (mode === "dormant" || mode === "not_started") return days.map((_, i) => [i === 0 ? `Log in to ${course(d)} and read one section — 20–30 min — Target: just show up today` : "Read — 30–45 min — Target: study today, any amount counts"]);
  return null;
}

export function draftTasks(d: Diagnosis, days: string[]): string[][] {
  const short = shortTasks(d, days);
  if (short) return short.slice(0, days.length);
  return d.readiness.phase === 1 ? readingTasks(d, days) : examTasks(d, days);
}

export function draftPlan(d: Diagnosis, days: string[]): PlanDraft {
  const r = d.readiness;
  const p = d.pace;
  const bits: string[] = [`Phase ${r.phase} — ${r.phaseName}.`];
  if (p.pagesRead !== null && p.pagesTotal !== null) bits.push(`Book ${p.pagesRead}/${p.pagesTotal} (${p.percentComplete}%).`);
  if (r.phase === 1 && p.requiredMinutesPerDay !== null) bits.push(`Needs ${mins(p.requiredMinutesPerDay)}/day${p.requiredPagesPerDay !== null ? ` (~${p.requiredPagesPerDay} pages)` : ""}.`);
  if (r.timed.length) bits.push(`Last full exams: ${r.timed.slice(0, 3).map(t => `${t.score}%`).join(", ")} (cut ${r.cut}%).`);
  else if (r.phase > 1) bits.push("No timed full exam yet.");
  if (d.lastResult) bits.push(`Last promise: ${d.lastResult.status}.`);

  const issues: string[] = r.failureModes.map(m => MODE_LABEL[m]);
  if (r.untimed.length) issues.push(`${r.untimed.length} untimed full exam(s) — not counted`);
  if (r.rushing) issues.push(`rushing full exams (~${Math.round((r.speedRatio ?? 0) * 100)}% of the clock)`);
  if (p.quizVsReadingFlag) issues.push(`${p.quizTimeHours}h quizzing vs ${p.readingTimeHours}h reading`);

  const dm: string[] = [];
  if (d.streak >= 2) dm.push(`${d.streak} promises missed in a row — reach out directly today.`);
  if (r.goNoGo) dm.push(`Exam in ${r.daysToExam} day(s), gold standard not met — make the go/no-go call today and tell the sponsor.`);
  if (primary(d) === "materials_unpaid") dm.push("Help them get study materials sorted.");
  if (primary(d) === "result_missing") dm.push("Get the exam result.");
  if (p.status === "critical" && r.phase === 1) dm.push("Reading pace is critical — check in today.");
  if (primary(d) === "dormant") dm.push(`No study in ${r.darkDays ?? "7+"} days — personal outreach.`);

  return { status: bits.join(" "), issues: issues.join("; ") || "None flagged", actions: draftTasks(d, days), dmNeeds: dm.join(" ") || "Nothing urgent." };
}

// ---------------------------------------------------------------- sponsor email

function opener(last: CheckpointResult, total: number | null): string {
  const cp = last.checkpoint;
  const due = `${weekday(cp.due)}'s`;
  switch (cp.metric) {
    case "pages_read":
      if (last.status === "HIT") return `${due} target was ${cp.target}/${total ?? "?"} pages. You're at ${last.actual} — promise kept.`;
      if (last.status === "PENDING") return `Your target is ${cp.target}/${total ?? "?"} pages by ${weekday(cp.due)} ${md(cp.due)}. You're at ${last.actual} so far — ${last.shortBy} to go.`;
      if (last.status === "MISSED") return `${due} target was ${cp.target}/${total ?? "?"} pages. You're still at ${last.actual} — no progress since ${md(cp.createdOn)}.`;
      return `${due} target was ${cp.target}/${total ?? "?"} pages. You're at ${last.actual} — ${last.shortBy} pages short.`;
    case "active_days":
      return last.status === "HIT"
        ? `You said you'd study at least 3 of the 4 days through ${md(cp.due)}, and you did (${last.actual}). That's the habit.`
        : `You said you'd study at least 3 of the 4 days through ${md(cp.due)}. You studied ${last.actual}.`;
    case "timed_full_lengths": {
      const need = cp.target - cp.baseline;
      return last.status === "HIT"
        ? `You promised ${need} timed full exam${need > 1 ? "s" : ""} at ${cp.minScore}%+ by ${md(cp.due)} — done.`
        : `You promised ${need} timed full exam${need > 1 ? "s" : ""} at ${cp.minScore}%+ by ${md(cp.due)}. You have ${last.actual}.`;
    }
    case "result_reported":
      return last.status === "HIT" ? "Thanks for sending your result." : "We still don't have your exam result.";
    case "exam_scheduled":
      return last.status === "HIT" ? "Your next exam is on the calendar — good." : "We still need your next exam date.";
  }
}

function sponsorStatusBlock(d: Diagnosis): string[] {
  const p = d.pace;
  const r = d.readiness;
  const L: string[] = [];
  if (r.phase === 1) {
    if (p.requiredMinutesPerDay !== null) L.push(`TODAY'S READING: ${mins(p.requiredMinutesPerDay)}${p.requiredPagesPerDay !== null ? ` (~${p.requiredPagesPerDay} pages)` : ""}`);
    if (p.pagesRead !== null && p.pagesTotal !== null) {
      const due = p.deadlinePassed
        ? `the deadline (${md(p.bookDeadline)}) has passed — the rest is due before your exam on ${md(p.examDate)}`
        : p.bookDeadline ? `due ${md(p.bookDeadline)}, ${p.daysToDeadline} day(s) left` : "add your test date so we can set the deadline";
      L.push(`BOOK: ${p.pagesRead}/${p.pagesTotal} (${p.percentComplete}%) — ${due}`);
    }
  } else {
    const q = r.goldStandard.qualifying;
    const counted = r.rushing || r.untimed.length ? " that count (timed, at real pace)" : "";
    L.push(`EXAM TARGET: 3 timed full exams in the 80s — you have ${q} of 3${counted}`);
    if (r.timed.length) L.push(`LAST FULL EXAMS: ${r.timed.slice(0, 3).map(t => `${t.name} ${t.score}%`).join(" · ")} (pass mark ${r.cut}%)`);
    else L.push("LAST FULL EXAMS: none timed yet — the first one happens this week");
  }
  if (d.report.readiness !== null) L.push(`ACHIEVABLE READINESS: ${d.report.readiness}% — reading + quizzes caps you near 60%; the last 40% only comes from full exams`);
  L.push("GOAL TO BE READY: 3 timed full exams in the 80s, at real pace, on fresh questions");
  return L;
}

function guidance(d: Diagnosis): string[] {
  const p = d.pace;
  const r = d.readiness;
  const g: string[] = [];
  if (r.phase === 1) {
    if (p.readingMinutesLeft !== null && p.daysToDeadline && p.requiredMinutesPerDay !== null) {
      g.push(`Read first, every day: ${mins(p.readingMinutesLeft)} of reading left ÷ ${p.daysToDeadline} day(s) = ~${mins(p.requiredMinutesPerDay)} a day${p.requiredPagesPerDay !== null ? ` (about ${p.requiredPagesPerDay} pages)` : ""}.`);
    } else {
      g.push("Read first, every day — the reading is the job until the book is done.");
    }
    if (p.stalled) g.push("Your reading has stalled. At this pace the book never gets finished — that changes this week.");
    else if (p.projectedFinish && p.finishVsExamDays !== null && p.finishVsExamDays > 0) g.push(`At your current pace (~${p.observedPagesPerDay} pages/day) the book finishes ${mdy(p.projectedFinish, d.today)} — ${p.finishVsExamDays} day(s) AFTER your exam. The daily number above fixes that.`);
    else if (p.projectedFinish && p.finishVsDeadlineDays !== null && p.finishVsDeadlineDays > 0) g.push(`At your current pace (~${p.observedPagesPerDay} pages/day) the book finishes ${mdy(p.projectedFinish, d.today)} — ${p.finishVsDeadlineDays} day(s) past the deadline.`);
    if (p.quizVsReadingFlag) g.push(`You've spent ${p.quizTimeHours}h on quizzes and ${p.readingTimeHours}h reading. The quizzes feel productive, but the reading is what moves the book — reading comes first and biggest.`);
    g.push("Take each chapter's quiz as you finish it and keep due reviews current. Under 80%: re-read that section before moving on.");
    if (d.exam !== "LAH") g.push("Stay on Achievable only until the book is done — no Kaplan, videos or extra question banks yet.");
  } else {
    if (r.failureModes.includes("plateau_below_cut") && r.trailing3 !== null) {
      g.push(`Your last timed exams (${r.timed.slice(0, 3).map(t => `${t.score}%`).join(", ")}) are under the ${r.cut}% pass mark. More of the same won't move it: go through every miss and mark it didn't-know / misapplied / careless, then re-read those sections.`);
      g.push("Get on Ken's free tutoring (Series 7 Whisperer) — ask your sponsorship team for the next session invite.");
    }
    if (r.untimed.length) g.push(r.untimed.length === 1
      ? "One of your full exams ran past the clock, so it doesn't count. Every full exam from now on is timed, in one sitting."
      : `${r.untimed.length} of your full exams ran past the clock, so they don't count. Every full exam from now on is timed, in one sitting.`);
    if (r.rushing) g.push(`You're finishing full exams in about ${Math.round((r.speedRatio ?? 0) * 100)}% of the time. Use the clock — ~1+ minute per question, and review flagged questions before you submit.`);
    if (r.bankBurnout) g.push("You've seen most of the Kaplan question bank, so those scores are memory now. Only exams and questions you haven't seen count.");
    if (r.neverTested) g.push("The next step is your first timed full exam this week, under real conditions.");
    g.push("After every full exam, review every missed AND guessed question — that's where the points come from.");
    const weak = weakestTopic(d);
    if (weak) g.push(`Your weakest area right now: ${weak}. Re-read it before the next exam.`);
  }
  return g.slice(0, 5);
}

function dayBlocks(d: Diagnosis, card: CardInput, days: string[]): string {
  const fromCard = (card.actions ?? []).some(a => a && a.trim());
  const tasks = fromCard
    ? days.map((_, i) => (card.actions?.[i] ?? "").split(/;\s*/).map(t => t.trim()).filter(Boolean))
    : draftTasks(d, days);
  return days
    .map((day, i) => {
      const t = tasks[i] ?? [];
      return `${day.toUpperCase()}\n${t.length ? t.map(x => `• ${x}`).join("\n") : "• Rest / catch up on due reviews"}`;
    })
    .join("\n\n");
}

function replyQuestion(d: Diagnosis): string {
  if (primary(d) === "dormant" || primary(d) === "not_started") return "Reply with the time you'll study tomorrow (like 7pm).";
  return d.readiness.phase === 1
    ? "Reply with the exact time you'll read each day this week (like 7–9pm)."
    : "Reply with the day and time you'll take your next timed full exam.";
}

export function sponsorEmail(d: Diagnosis, card: CardInput, days: string[]): string {
  const name = firstName(card.name);
  const r = d.readiness;
  const p = d.pace;
  const sign = "Your Sponsorship Team";
  const promise = d.next.text;
  const exam = examLabel(r.lastSit?.examType ?? d.exam);
  const sit = openSit(d);

  // Short emails: the playbook says no study plan until the basics are sorted.
  if (primary(d) === "result_missing") {
    return [`Hey ${name},`, `Your ${examLabel(d.exam)} was on ${md(d.examDate)} — how did it go? Reply with your result (pass or fail) and send a photo or PDF of the score report.`,
      "Once we have it, we'll set up what's next.", promise, sign].join("\n\n");
  }
  if (sit?.outcome === "PASS") {
    return [`Hey ${name},`, `Congratulations on passing the ${exam}! That's a real step.`,
      "Keep the momentum: the first few days after a pass are when people stall. Get your next exam on the calendar now and start the next course right away.",
      dayBlocks(d, card, days), promise, sign].join("\n\n");
  }
  if (sit?.outcome === "FAIL" && d.exam && sit.examType !== d.exam) {
    return [`Hey ${name},`, `Your ${examLabel(sit.examType)} on ${md(sit.date)} didn't go your way. That's one attempt, not the verdict. Next up is your ${examLabel(d.exam)} — and it needs a date before anything else.`,
      `Send us the ${examLabel(sit.examType)} score report for the record, book the exam, and start reading right away — the date is what makes the daily plan real.`,
      dayBlocks(d, card, days), promise, replyQuestion(d), sign].join("\n\n");
  }
  if (sit?.outcome === "FAIL") {
    return [`Hey ${name},`, `Your ${exam} on ${md(sit.date)} didn't go your way. That's one attempt, not the verdict — here's the reset:`,
      "1. Send us the score report so we can see your weakest sections.\n2. We build the next plan from those sections.\n3. Get your next exam date booked within 48 hours.",
      dayBlocks(d, card, days), promise, sign].join("\n\n");
  }
  if (primary(d) === "materials_unpaid") {
    return [`Hey ${name},`, `First thing: getting your ${d.exam === "LAH" ? "LAH course" : "Achievable"} access sorted. Your manager will reach out today to help with it. Nothing else matters until you can log in.`,
      "Once you're in, start reading right away — even 30 minutes counts.", promise, replyQuestion(d), sign].join("\n\n");
  }
  if (primary(d) === "dormant" || primary(d) === "not_started") {
    const gap = r.darkDays !== null && primary(d) === "dormant" ? `It's been ${r.darkDays} days since you last studied. ` : "";
    return [`Hey ${name},`, `${gap}No lecture — just one step today: log in to ${course(d)} and read one section, 20–30 minutes.`,
      dayBlocks(d, card, days), promise, replyQuestion(d), sign].join("\n\n");
  }

  const parts: string[] = [`Hey ${name},`];
  const open: string[] = [];
  if (d.lastResult) open.push(opener(d.lastResult, d.report.pagesTotal));
  if (d.streak >= 2) open.push("That's the second promise in a row that slipped, so your manager will be reaching out.");
  if (!d.lastResult) {
    open.push(r.phase === 1
      ? p.status === "critical" || p.status === "behind"
        ? "You're behind on the reading, so here's exactly what it takes from today."
        : "Here's your plan for the next four days — reading first."
      : "The book is done. Now it's about timed full exams.");
  } else if (p.status === "critical" || p.status === "behind") {
    open.push("You're behind on the reading — here's the number that catches you up.");
  }
  parts.push(open.join(" "));
  parts.push(sponsorStatusBlock(d).join("\n"));
  parts.push(`BEST GUIDANCE — DO THESE FIRST\n${guidance(d).map(x => `• ${x}`).join("\n")}`);
  parts.push(dayBlocks(d, card, days));

  const behind: string[] = [];
  if (r.phase === 1 && p.readingMinutesLeft !== null && p.daysToDeadline && p.daysToDeadline > 1) {
    behind.push(`Miss a day and the reading goes up to ~${mins(Math.ceil(p.readingMinutesLeft / (p.daysToDeadline - 1)))} a day for the days left. Don't let it stack.`);
  } else if (r.phase === 1) {
    behind.push("Miss a day and tomorrow's reading doubles. Don't let it stack.");
  } else {
    behind.push("Under 75% on a full exam: review every miss before you take another — don't stack exams.");
    behind.push("Can't fit a full exam in one sitting? Take it the next day you can — never in pieces.");
  }
  behind.push(r.phase === 1 ? "Any chapter quiz under 80%: re-read that section before moving on." : "Any topic under 70% on an exam: re-read that section the next day.");
  parts.push(`IF YOU FALL BEHIND\n${behind.map(x => `• ${x}`).join("\n")}`);

  const by = d.examDate ? ` before your exam on ${md(d.examDate)}` : "";
  parts.push(`WHAT SUCCESS LOOKS LIKE\n${r.phase === 1 && p.bookDeadline
    ? `The book finished by ${md(p.bookDeadline)}, then timed full exams at real pace, ending with 3 in the 80s${by}.`
    : `3 timed full exams in the 80s, at real pace, on fresh questions${by}.`}`);
  parts.push(promise);
  parts.push(replyQuestion(d));
  parts.push(sign);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- team email

export interface TeamEntry {
  card: CardInput & { exam?: string; examDate?: string };
  d: Diagnosis | null;
  staleNote?: string;
}

const DOT_WORD: Record<string, string> = { red: "RED", green: "GREEN", grey: "GREY" };

function teamBlock(e: TeamEntry, days: string[]): string {
  const { card, d } = e;
  const L: string[] = [];
  if (!d) {
    L.push(`${card.name} — ${card.exam ?? "?"}${card.examDate ? `, test ${md(card.examDate)}` : ""} (not in memory — upload a report to track promises)`);
    if (card.status) L.push(`Status: ${card.status}`);
    if (card.issues) L.push(`Issues: ${card.issues}`);
  } else {
    const r = d.readiness;
    const p = d.pace;
    const until = r.daysToExam !== null ? (r.daysToExam >= 0 ? ` (${r.daysToExam} days)` : " (passed)") : "";
    L.push(`${card.name} — ${examLabel(d.exam)}${d.examDate ? `, test ${md(d.examDate)}${until}` : ", no test date"}`);
    L.push(`Status: ${DOT_WORD[r.dot] ?? r.dot} — ${r.dotReason}`);
    L.push(`Phase ${r.phase}: ${r.phaseName} | Failure mode: ${r.failureModes.length ? r.failureModes.map(m => MODE_LABEL[m]).join(", ") : "none"}`);
    if (p.pagesRead !== null && p.pagesTotal !== null) {
      const need = r.phase === 1 && p.requiredMinutesPerDay !== null ? ` · needs ${mins(p.requiredMinutesPerDay)}/day${p.requiredPagesPerDay !== null ? ` (~${p.requiredPagesPerDay} pages)` : ""}` : "";
      const doing = p.observedPagesPerDay !== null && !p.bookDone ? ` · doing ~${p.observedPagesPerDay} pages/day` : "";
      const finish = p.stalled ? " · STALLED" : p.projectedFinish && !p.bookDone ? ` · book done ~${md(p.projectedFinish)}` : "";
      L.push(`Reading: ${p.pagesRead}/${p.pagesTotal} (${p.percentComplete}%)${need}${doing}${finish}`);
    }
    if (r.neverTested) L.push("% Ready: never tested — no score published");
    else L.push(`% Ready: ${r.calibrated !== null && r.calibrated !== r.base ? `base ${r.base ?? "?"} → calibrated ${r.calibrated}` : `${r.base ?? "?"} (no calibration discount)`}${r.calibrationReason ? ` (${r.calibrationReason})` : ""} · last full exams ${r.timed.slice(0, 3).map(t => `${t.score}%`).join(", ")} vs cut ${r.cut}%`);
    if (r.untimed.length) L.push(`Untimed: ${r.untimed.length} full exam(s) ran past the clock — not counted`);
    L.push(`Gold standard: ${r.goldStandard.met ? "MET" : `not met — ${r.goldStandard.gaps.map(g => g.text).join("; ")}`}`);
    L.push(`Last promise: ${d.lastResult ? d.lastResult.text : "none on record"}`);
    L.push(`Next promise: "${d.next.text}"`);
    if (d.streak >= 2) L.push(`DM ESCALATION: ${d.streak} promises missed in a row — reach out directly.`);
    if (r.goNoGo) L.push(`GO/NO-GO: exam in ${r.daysToExam} day(s) without the gold standard — the owner makes the call today and tells the sponsor the same day.`);
    if (d.notes.length) L.push(`Latest note: ${d.notes[0].split("\n")[0].slice(0, 160)}`);
  }
  if (e.staleNote) L.push(e.staleNote);
  const fromCard = (card.actions ?? []).some(a => a && a.trim());
  const tasks = fromCard ? days.map((_, i) => card.actions?.[i] ?? "") : d ? draftTasks(d, days).map(t => t.join("; ")) : [];
  if (tasks.length) L.push(`Plan:\n${days.map((day, i) => `  - ${day}: ${tasks[i] || "—"}`).join("\n")}`);
  const dm = card.dmNeeds?.trim() || (d ? draftPlan(d, days).dmNeeds : "");
  if (dm) L.push(`What I need from the DM: ${dm}`);
  return L.join("\n");
}

export function teamEmail(entries: TeamEntry[], days: string[], date: string, scoreBlock: string, signer = "Sponsorship Coordination"): string {
  const rank = (e: TeamEntry) => (e.d ? ({ red: 0, grey: 1, green: 2 } as Record<string, number>)[e.d.readiness.dot] ?? 1 : 3);
  const sorted = [...entries].sort((a, b) => rank(a) - rank(b) || (a.d?.examDate ?? "9999").localeCompare(b.d?.examDate ?? "9999"));
  const parts = [
    `Subject: At-Risk Sponsor Action Plans - Week of ${date}`,
    "Hey team,",
    `Here's the at-risk sponsor action plan for ${days[0]} through ${days[days.length - 1]}. Red first, then soonest exam. Every number below is computed from the latest Achievable report.`,
  ];
  if (scoreBlock.trim()) parts.push(`--- SCORE SNAPSHOT ---${scoreBlock}--- END SCORES ---`);
  parts.push(sorted.map(e => teamBlock(e, days)).join("\n\n────────────\n\n"));
  parts.push("Please confirm receipt and alignment on these action plans.");
  parts.push(signer);
  return parts.join("\n\n");
}
