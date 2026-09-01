import { NextRequest, NextResponse } from "next/server";
import { STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS, SPONSOR_EMAIL_TONE } from "../context";
import { MODEL_EMAIL, createMessage, extractText, friendlyError, logUsage, withRetry } from "../anthropic";
import { computePace, formatPaceFacts, parseDurationToMinutes } from "../pace";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are the sponsorship coordinator for a financial advisory firm (GFA), writing directly to a sponsor studying for a FINRA exam. Your job is to get them to FINISH THE ACHIEVABLE TEXTBOOK as fast as possible — that is the bottleneck stopping them from passing. Be specific, time-estimated, and STRICTLY phase-correct.

${STUDY_RESOURCES}

${STUDY_METHODOLOGY}

${PHASE_DETECTION}

${SPECIFICITY_INSTRUCTIONS}

${SPONSOR_EMAIL_TONE}`;

export async function POST(req: NextRequest) {
  try {
    const { startDay, date, sponsor, examDate } = await req.json();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    const actionLines = sponsor.actions
      .map((a: string, j: number) => `  ${days[j]}: ${a || "[No task]"}`)
      .join("\n");

    const pace = computePace({
      pagesRead: sponsor.pagesRead ?? null,
      pagesTotal: sponsor.pagesTotal ?? null,
      readingMinutesLeft: parseDurationToMinutes(sponsor.readingTimeLeft),
      readingTimeHours: sponsor.readingTimeHours ?? null,
      quizTimeHours: sponsor.quizTimeHours ?? null,
      examDate: examDate || sponsor.examDate || null,
    });

    const prompt = `Write the next email to this sponsor. Work out their PHASE from the data (use PHASE DETECTION), then write the whole plan for THAT phase only. Today's date: ${date}.

${formatPaceFacts(pace)}

SPONSOR DETAILS:
- Name: ${sponsor.name}
- Current Exam: ${sponsor.exam}
- Plan covers these 4 days: ${days.join(", ")}
${sponsor.currentChapter ? `- Currently on: ${sponsor.currentChapter}` : ""}
${sponsor.achievableStatus ? `- Achievable reports their plan status as: "${sponsor.achievableStatus}" (quote it as-is; don't reinterpret it)` : ""}

WHAT WE KNOW ABOUT THEIR PROGRESS (upgrade everything to be hyper-specific, time-estimated, and phase-correct):
- Status / scores: ${sponsor.status || "[unknown — infer phase conservatively]"}
- Issues: ${sponsor.issues || "[none noted]"}
- Draft daily tasks:
${actionLines}

WRITE THE EMAIL using the REQUIRED STRUCTURE from your instructions (opener → status block led by TODAY'S READING quota → "BEST GUIDANCE — DO THESE FIRST" → day-by-day plan → "IF YOU FALL BEHIND" → "WHAT SUCCESS LOOKS LIKE" → one time-bound closing checkpoint → "Your Sponsorship Team").

HARD REQUIREMENTS:
- If the book isn't finished, this is PHASE 1: the email leads with the daily reading quota from PACE FACTS, every day's FIRST task is reading, and reading is the biggest time block of each day.
- Phase 1 quizzing = the quiz built into the reading flow + any DUE reviews only. No on-demand Quiz Bank drilling, no Kaplan, no videos, no Quizlet.
- Use the 60/40 readiness rule to explain WHY the reading is urgent.
- If they are behind, say so directly and give the higher number. NEVER suggest moving their exam date.
- Every task bullet has a time-range estimate. Reference their real numbers so it's clearly personalised.
- Plain text only — no HTML, no markdown headers beyond the simple labels shown. Blank lines between sections and days so it scans easily.`;

    const message = await withRetry(() => createMessage({
      model: MODEL_EMAIL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    }));
    logUsage("sponsor-email", message);

    return NextResponse.json({ email: extractText(message) });
  } catch (err: unknown) {
    const message = friendlyError(err);
    console.error("Generate sponsor email API error:", message);
    return NextResponse.json({ email: "", error: message }, { status: 500 });
  }
}
