import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { MANAGER_INITIALS, STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS } from "../context";

export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Static coaching context — identical on every request, so cache it.
const SYSTEM_PROMPT = `You are a sponsorship coordinator at a financial advisory firm parsing a sponsor's raw notes and Achievable study report (text, screenshots, and/or PDFs) into a structured, phase-correct action plan. You are replacing a human study coordinator — read the data carefully and place the sponsor in the correct phase.

${MANAGER_INITIALS}

${STUDY_RESOURCES}

${STUDY_METHODOLOGY}

${PHASE_DETECTION}

${SPECIFICITY_INSTRUCTIONS}`;

export async function POST(req: NextRequest) {
  try {
    const { notes, startDay, sponsorName, exam, images, scoreEntries, examDate } = await req.json();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    // Format score entries for the prompt
    let scoreContext = "";
    if (scoreEntries?.length > 0) {
      const scoreLines = scoreEntries.map((e: { date: string; sponsor: string; platform: string; scoreType: string; score: number; section: string; notes: string }) =>
        `- ${e.date} ${e.sponsor}: ${e.platform} ${e.scoreType} — ${e.score}%${e.section ? ` (${e.section})` : ""}${e.notes ? ` [${e.notes}]` : ""}`
      ).join("\n");
      scoreContext = `\n\nRECENT STUDY SCORES (use to confirm phase + target weak areas):\n${scoreLines}`;
    }

    const textPrompt = `Parse the data below for this sponsor and return a structured action plan. Determine the sponsor's PHASE first (use PHASE DETECTION), then build the daily plan for THAT phase only.

SPONSOR: ${sponsorName || "[Unknown]"}
CURRENT EXAM: ${exam || "[Unknown]"}
KNOWN EXAM (TEST) DATE: ${examDate || "[unknown — extract it from the report's Target date if visible]"}

${notes ? `RAW NOTES FROM TRACKER:\n${notes}` : "No text notes provided - analyze the uploaded images/screenshots for study data."}

${images?.length > 0 ? `
IMPORTANT: Screenshots/PDFs of Achievable study reports have been uploaded. Extract EVERY data point and use it to determine the phase and build the plan:

ACHIEVABLE METRICS TO EXTRACT (these decide the phase):
- Textbook progress: pages read / 150 (e.g. "77/150"). THIS DECIDES PHASE 1 vs later — if < 150, the book is NOT done and the sponsor is in Phase 1.
- Exam readiness % (Achievable's readiness score)
- Practice exams taken (count) and the score on each full/simulated exam
- Quiz accuracy overall and PER SECTION (e.g. "Hedging strategies 51%") — find the lowest sections
- Target (exam) date and ON TRACK / AT RISK status

STUDY BEHAVIOR TO IDENTIFY:
- Grinding Q-bank but textbook not finished (the #1 failure — still Phase 1)
- Rushing (time-per-question), not reviewing misses, skipping chapters
- Scores trend: up, down, or flat

Do NOT ask for clarification — extract everything visible and build the full phase-correct plan.` : ""}
${scoreContext}

Return ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "sponsors": [
    {
      "name": "${sponsorName || ""}",
      "exam": "${exam || "SIE"}",
      "examDate": "the exam/test date as YYYY-MM-DD if known or visible in the report's Target date, else empty string",
      "status": "Lead with the PHASE and the key metrics: e.g. 'PHASE 1 — book at 77/150 pages, 38% exam readiness, 0 practice exams, 72.6% quiz accuracy, target June 17 (ON TRACK).' Include the numbers that decide the phase.",
      "issues": "Specific problems from the data (e.g. 'Grinding Q-bank but only 51% through the book; 0 full exams taken; weakest sections: Hedging 51%, Income strategies 64%').",
      "actions": [
        ["phase-correct task with time range for ${days[0]}", "task 2 for ${days[0]}"],
        ["task 1 for ${days[1]}", "task 2 for ${days[1]}"],
        ["task 1 for ${days[2]}", "task 2 for ${days[2]}"],
        ["task 1 for ${days[3]}", "task 2 for ${days[3]}"]
      ],
      "dmNeeds": "What the DM should specifically do (including any escalation flag, e.g. deadline math impossible).",
      "extractedScores": [
        { "platform": "Achievable or Kaplan", "scoreType": "Simulated Exam, Q-bank, Chapter Quiz, Unit Quiz, or Certification", "score": 72, "section": "specific section or topic", "notes": "brief observation" }
      ]
    }
  ]
}

RULES:
- "examDate": ISO date if you can determine it (from the input or the report's "Target date"), else "".
- "extractedScores": extract EVERY score/percentage/quiz/exam result visible. If none, return [].
- "actions": array of 4 arrays (one per day), 3-5 tasks each. EVERY task must be PHASE-CORRECT (no Kaplan/videos/Quizlet if the book isn't done) and include a TIME-RANGE estimate (e.g. "45-60 min").
- Build on previous days; include score thresholds ("if below 80%, redo before moving on").`;

    // Build content array with text and optional images
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];

    if (images?.length > 0) {
      for (const img of images) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType || "image/jpeg",
            data: img.base64,
          },
        });
      }
    }

    content.push({ type: "text", text: textPrompt });

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });

    const responseText = message.content.map(b => (b.type === "text" ? b.text : "")).join("");

    try {
      const parsed = JSON.parse(responseText);
      return NextResponse.json(parsed);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return NextResponse.json(JSON.parse(jsonMatch[0]));
      }
      return NextResponse.json(
        { sponsors: [], error: "Could not parse AI response" },
        { status: 200 }
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Parse notes API error:", message);
    return NextResponse.json(
      { sponsors: [], error: message },
      { status: 500 }
    );
  }
}
