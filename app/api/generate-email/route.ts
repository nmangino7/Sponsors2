import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { MANAGER_INITIALS, STUDY_RESOURCES, SPECIFICITY_INSTRUCTIONS } from "../context";

export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { startDay, date, sponsors, scoreEntries } = await req.json();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    // Build score summary
    let scoreSummary = "";
    if (scoreEntries?.length > 0) {
      const scoreLines = scoreEntries.map((e: { date: string; sponsor: string; platform: string; scoreType: string; score: number; section: string; notes: string }) =>
        `- ${e.sponsor}: ${e.platform} ${e.scoreType} — ${e.score}%${e.section ? ` (${e.section})` : ""}${e.notes ? ` — ${e.notes}` : ""} [${e.date}]`
      ).join("\n");
      scoreSummary = `\n\nSCORE TRACKER DATA (include a "Score Summary" section right after the greeting, before individual sponsor plans):\n${scoreLines}\nFormat this as a quick-reference table at the top of the email so the team can see scores at a glance.`;
    }

    const sponsorBlocks = sponsors
      .map(
        (s: {
          name: string;
          exam: string;
          status: string;
          issues: string;
          actions: string[];
          dmNeeds: string;
        }, i: number) => {
          const actionLines = s.actions
            .map((a: string, j: number) => `  - ${days[j]}: ${a || "[No task entered]"}`)
            .join("\n");

          return `SPONSOR ${i + 1}: ${s.name}
Current Exam: ${s.exam}
Current Status/Score: ${s.status}
Key Issues: ${s.issues}
Daily Action Plan:
${actionLines}
What I Need from DM: ${s.dmNeeds}`;
        }
      )
      .join("\n\n---\n\n");

    const prompt = `You are writing a professional email for a sponsorship coordinator at a financial advisory firm (GFA). Generate a clear, actionable email based on this data. The email should be direct and give "high direction" - specific daily tasks, not vague updates.

${MANAGER_INITIALS}

${STUDY_RESOURCES}

${SPECIFICITY_INSTRUCTIONS}

EMAIL DETAILS:
- Date: ${date}
- Greeting: "Hey team,"
- Subject: At-Risk Sponsor Action Plans - Week of ${date}
- Action plan days: ${days.join(", ")}

SPONSOR DATA:
${sponsorBlocks}
${scoreSummary}

FORMAT THE EMAIL AS:
1. Start with "Hey team,"
2. Brief intro (1-2 sentences) explaining this is the at-risk sponsor action plan covering ${days[0]} through ${days[3]}
3. For each sponsor, a clearly formatted section with:
   - Name and exam as a header
   - Current status with specific scores and metrics
   - Key issues identified
   - Daily breakdown with hyper-specific tasks for each day (${days.join(", ")})
   - What's specifically needed from the DM
4. Closing: "Please confirm receipt and alignment on these action plans."
5. Sign off as "Sponsorship Coordination"

IMPORTANT QUALITY RULES:
- If any daily tasks are vague, UPGRADE them to be hyper-specific with numbers, platforms, URLs, and sections
- Include time-of-day context (morning/afternoon/evening) for each task
- Add score-based checkpoints: "If score is below X, do Y before moving on"
- Flag escalation triggers: "If [sponsor] hasn't logged in by [day], DM needs to call immediately"
- Chain tasks logically: each day should build on the previous day's work
- Reference actual study resources with direct URLs (Achievable, Kaplan, TestGeek, YouTube channels, specific review videos)
- Include exact numbers: # of exams, # of questions, target scores, specific chapters/units

SPACING AND FORMATTING RULES:
- Add a BLANK LINE between every section and subsection
- Add a BLANK LINE between each sponsor's daily breakdown
- Separate each day's tasks with a blank line
- Use clear visual separators (===) between different sponsors
- Add a blank line before and after each sponsor's header
- Add a blank line before and after the "What I Need from DM" section
- Each daily task should be on its own line with a blank line after each day's tasks
- The email should feel spacious and easy to scan — NOT a wall of text

Use plain text formatting with clear headers and dashes for structure (no HTML). Keep it professional, direct, and actionable.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    return NextResponse.json({ email: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Generate email API error:", message);
    return NextResponse.json({ email: "", error: message }, { status: 500 });
  }
}
