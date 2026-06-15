import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS, SPONSOR_EMAIL_TONE } from "../context";

export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Static coaching context — identical on every request, so cache it.
const SYSTEM_PROMPT = `You are the sponsorship coordinator for a financial advisory firm (GFA), writing directly to a sponsor studying for a FINRA exam. Your guidance must be specific, time-estimated, and STRICTLY phase-correct — you are replacing a human study coordinator, so the advice has to be exactly right for where this sponsor is in their study path.

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

    const examDateLine = (examDate || sponsor.examDate)
      ? `- Exam (test) date: ${examDate || sponsor.examDate} — the book must be DONE 5-7 days before this date so there's time for full exams.`
      : `- Exam (test) date: NOT PROVIDED — give phase-correct guidance and express the book deadline relative to the exam (e.g. "5-7 days before your test"); ask them to confirm their test date in the closing checkpoint.`;

    const prompt = `Write the next email to this sponsor. First, figure out their PHASE from the data below (use PHASE DETECTION), then write the whole plan for THAT phase only. Today's date: ${date}.

SPONSOR DETAILS:
- Name: ${sponsor.name}
- Current Exam: ${sponsor.exam}
- Plan covers these 4 days: ${days.join(", ")}
${examDateLine}

WHAT WE KNOW ABOUT THEIR PROGRESS (current status, issues, and draft tasks — upgrade everything to be hyper-specific, time-estimated, and phase-correct):
- Status / scores: ${sponsor.status || "[unknown — infer phase conservatively]"}
- Issues: ${sponsor.issues || "[none noted]"}
- Draft daily tasks:
${actionLines}

WRITE THE EMAIL using the REQUIRED STRUCTURE from your instructions (PAS opener → PHASE/DEADLINE/GOAL header → "BEST GUIDANCE — DO THESE FIRST" bullets → day-by-day plan with every task as "• [task] — [time range] — Target: [...]" → "IF YOU DON'T HIT YOUR TARGETS" → "WHAT SUCCESS LOOKS LIKE" ending in the 3-exams-in-the-80s gold standard → one time-bound closing checkpoint → "Your Sponsorship Team").

HARD REQUIREMENTS:
- Determine the phase FIRST and only use that phase's resources. If the book isn't finished, this is PHASE 1 — Achievable ONLY, do NOT mention Kaplan, videos, or Quizlet at all.
- Every task bullet has a time-range estimate (e.g. "45-60 min").
- Reference their actual scores/metrics so it's clearly personalized.
- Plain text only — no HTML, no markdown headers other than the simple labels shown. Use blank lines between sections and between each day so it's easy to scan.`;

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content.map(b => (b.type === "text" ? b.text : "")).join("");

    return NextResponse.json({ email: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Generate sponsor email API error:", message);
    return NextResponse.json({ email: "", error: message }, { status: 500 });
  }
}
