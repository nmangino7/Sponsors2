import { NextRequest, NextResponse } from "next/server";
import { MANAGER_INITIALS, STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS } from "../context";
import { MODEL_PARSE, createMessage, extractText, friendlyError, logUsage, withRetry } from "../anthropic";

export const maxDuration = 300;

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

    let scoreContext = "";
    if (scoreEntries?.length > 0) {
      const scoreLines = scoreEntries.map((e: { date: string; sponsor: string; platform: string; scoreType: string; score: number; section: string; notes: string }) =>
        `- ${e.date} ${e.sponsor}: ${e.platform} ${e.scoreType} — ${e.score}%${e.section ? ` (${e.section})` : ""}${e.notes ? ` [${e.notes}]` : ""}`
      ).join("\n");
      scoreContext = `\n\nRECENT STUDY SCORES (use to confirm phase + target weak areas):\n${scoreLines}`;
    }

    const textPrompt = `Parse the data below for this sponsor and return a structured action plan. Determine the sponsor's PHASE first (use PHASE DETECTION), then build the daily plan for THAT phase only. If the book isn't finished, this is PHASE 1 and the plan must lead with reading every single day.

SPONSOR: ${sponsorName || "[Unknown]"}
CURRENT EXAM: ${exam || "[Unknown]"}
KNOWN EXAM (TEST) DATE: ${examDate || "[unknown — extract it from the report's Target date if visible]"}

${notes ? `RAW NOTES FROM TRACKER:\n${notes}` : "No text notes provided - analyze the uploaded images/screenshots for study data."}

${images?.length > 0 ? `
IMPORTANT: Screenshots/PDFs of Achievable study reports have been uploaded. Extract EVERY data point and use it to determine the phase and build the plan:

READING METRICS — EXTRACT THESE FIRST, THEY DECIDE EVERYTHING:
- Pages read, as BOTH numbers: "X/Y" (e.g. "77/150"). The total is course-specific — record what the report actually says, never assume 150.
- "Reading time left" (e.g. "5h 8m") — Achievable's own estimate of reading remaining.
- "Reading time" vs "Quiz time" vs "Exam time" — the split of how they've spent their hours.
- Which chapter/section they are currently on, and how many chapters/sections remain.

OTHER ACHIEVABLE METRICS:
- Exam readiness %
- Practice exams taken (count) and the score on each full/simulated exam
- Quiz accuracy overall and PER SECTION (e.g. "Hedging strategies 51%") — find the lowest sections
- Target (exam) date and the plan status label exactly as shown (e.g. "ON TRACK" / "AT RISK" / "Overdue")

STUDY BEHAVIOR TO IDENTIFY:
- Lots of quiz time but the textbook unfinished (the #1 failure — still Phase 1)
- Rushing, not reviewing misses, skipping chapters
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
      "pagesRead": null,
      "pagesTotal": null,
      "readingTimeLeft": "the report's 'Reading time left' exactly as shown (e.g. '5h 8m'), else empty string",
      "readingTimeHours": null,
      "quizTimeHours": null,
      "currentChapter": "chapter/section they're currently on, else empty string",
      "achievableStatus": "the plan status label exactly as shown (e.g. 'ON TRACK'), else empty string",
      "status": "Lead with the PHASE and the reading numbers: e.g. 'PHASE 1 — 77/150 pages (51%), 5h 8m reading left, 38% readiness, 0 practice exams, 19h reading vs 70h quizzes.'",
      "issues": "Specific problems from the data (e.g. 'Huge quiz time but only half the book read; 0 full exams; weakest sections: Hedging 51%').",
      "actions": [
        ["reading task with time range for ${days[0]}", "task 2 for ${days[0]}"],
        ["task 1 for ${days[1]}", "task 2 for ${days[1]}"],
        ["task 1 for ${days[2]}", "task 2 for ${days[2]}"],
        ["task 1 for ${days[3]}", "task 2 for ${days[3]}"]
      ],
      "dmNeeds": "What the DM should specifically do (including any escalation flag).",
      "extractedScores": [
        { "platform": "Achievable or Kaplan", "scoreType": "Simulated Exam, Q-bank, Chapter Quiz, Unit Quiz, or Certification", "score": 72, "section": "specific section or topic", "notes": "brief observation" }
      ]
    }
  ]
}

RULES:
- "pagesRead" / "pagesTotal": numbers, from the report's "X/Y". Use null if not visible. NEVER guess the total.
- "readingTimeHours" / "quizTimeHours": numbers (decimal hours) from the report's time breakdown, else null.
- "examDate": ISO date if determinable, else "".
- "extractedScores": extract EVERY score/percentage/quiz/exam result visible. If none, return [].
- "actions": 4 arrays (one per day), 3-5 tasks each. If the book is unfinished, the FIRST task each day is the READING assignment with named chapters/sections. Every task needs a TIME-RANGE estimate. No Kaplan/videos/Quizlet and no on-demand Quiz Bank drilling while the book is unfinished.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];
    if (images?.length > 0) {
      for (const img of images) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.base64 },
        });
      }
    }
    content.push({ type: "text", text: textPrompt });

    const message = await withRetry(() => createMessage({
      model: MODEL_PARSE,
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    }));
    logUsage("parse-notes", message);

    const responseText = extractText(message);

    try {
      return NextResponse.json(JSON.parse(responseText));
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return NextResponse.json(JSON.parse(jsonMatch[0]));
      }
      return NextResponse.json({ sponsors: [], error: "Could not parse AI response" }, { status: 200 });
    }
  } catch (err: unknown) {
    const message = friendlyError(err);
    console.error("Parse notes API error:", message);
    return NextResponse.json({ sponsors: [], error: message }, { status: 500 });
  }
}
