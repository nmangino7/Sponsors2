import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { MANAGER_INITIALS, STUDY_RESOURCES, SPECIFICITY_INSTRUCTIONS, CHAPTER_RECOMMENDATION_LOGIC } from "../context";

export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { notes, startDay, sponsorName, exam, images, scoreEntries } = await req.json();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    // Format score entries for the prompt
    let scoreContext = "";
    if (scoreEntries?.length > 0) {
      const scoreLines = scoreEntries.map((e: { date: string; sponsor: string; platform: string; scoreType: string; score: number; section: string; notes: string }) =>
        `- ${e.date} ${e.sponsor}: ${e.platform} ${e.scoreType} — ${e.score}%${e.section ? ` (${e.section})` : ""}${e.notes ? ` [${e.notes}]` : ""}`
      ).join("\n");
      scoreContext = `\n\nRECENT STUDY SCORES (use these to target weak areas in the action plan):\n${scoreLines}\n\nIMPORTANT: Base the daily action plan on these ACTUAL scores. If a section score is below 70%, assign heavy remediation. If above 80%, move to the next section. Reference the exact scores in your status and issues analysis.`;
    }

    const textPrompt = `You are helping a sponsorship coordinator at a financial advisory firm parse raw notes and study data into a structured action plan for an at-risk sponsor.

SPONSOR: ${sponsorName || "[Unknown]"}
CURRENT EXAM: ${exam || "[Unknown]"}

${MANAGER_INITIALS}

${STUDY_RESOURCES}

${SPECIFICITY_INSTRUCTIONS}

${CHAPTER_RECOMMENDATION_LOGIC}

${notes ? `RAW NOTES FROM TRACKER:\n${notes}` : "No text notes provided - analyze the uploaded images/screenshots for study data."}

${images?.length > 0 ? `
IMPORTANT: Screenshots/PDFs have been uploaded showing study reports, test scores, or quiz results.
You MUST extract EVERY piece of data visible and use it to build a complete action plan:

SCORES & METRICS TO EXTRACT:
- Every practice exam score (date, score %, exam type)
- Q-bank progress (questions completed / total, by section)
- Enrollment rate percentage
- Chapter completion status
- Time spent studying (if shown)
- Individual section/chapter scores

STUDY BEHAVIOR TO IDENTIFY:
- Are they rushing through questions? (look at time-per-question)
- Are they reviewing incorrect answers?
- Are they skipping sections or chapters?
- Study feedback/recommendations from the platform
- Patterns: scores going up, down, or flat?

WEAK AREAS TO FLAG:
- Which specific chapters/sections have lowest scores
- Which question categories are they failing
- Any sections with 0% or very low completion
- Topics where scores dropped between attempts

Use ALL extracted data to create a comprehensive, targeted action plan.
Do NOT ask for clarification — extract everything visible and build the full plan.
Reference specific scores and sections in the daily tasks.` : ""}
${scoreContext}

Extract sponsor information and return ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "sponsors": [
    {
      "name": "${sponsorName || ""}",
      "exam": "${exam || "SIE"}",
      "status": "Specific current scores and progress from the notes/images",
      "issues": "Specific problems identified from notes/images",
      "actions": [
        ["task 1 for ${days[0]}", "task 2 for ${days[0]}"],
        ["task 1 for ${days[1]}", "task 2 for ${days[1]}"],
        ["task 1 for ${days[2]}", "task 2 for ${days[2]}"],
        ["task 1 for ${days[3]}", "task 2 for ${days[3]}"]
      ],
      "dmNeeds": "What the district manager should specifically do",
      "extractedScores": [
        { "platform": "Achievable or Kaplan", "scoreType": "Simulated Exam, Q-bank, Chapter Quiz, Unit Quiz, or Certification", "score": 72, "section": "specific section or topic", "notes": "brief observation about this score" }
      ]
    }
  ]
}

IMPORTANT about "extractedScores": Extract EVERY score, percentage, quiz result, or exam result visible in the notes, images, or PDFs. Each entry should have platform, scoreType, score (number 0-100), section (if identifiable), and notes. If no scores are found, return an empty array [].

IMPORTANT: "actions" is an array of 4 arrays (one per day). Each day's array should have 3-5 hyper-specific tasks.

TASK QUALITY RULES:
- Every task MUST include: a specific number, a specific platform/resource (with URL), and a specific topic/section
- Include time-of-day context: "Morning: ...", "After lunch: ...", "Evening review: ..."
- Chain tasks: "Complete X, then based on your score, do Y"
- Include score thresholds: "Target 80%+. If below 70%, redo before moving on"
- Build on previous days: Day 2 tasks should reference Day 1 results
- Each day should have a mix of: content learning, practice questions, and review/reinforcement
- Include specific Achievable units/chapters, Kaplan question counts, and YouTube video links`;

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
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      messages: [{ role: "user", content }],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";

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
