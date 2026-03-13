import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { dayType, date, sponsors, dmName } = await req.json();

  const days =
    dayType === "monday"
      ? ["Monday", "Tuesday", "Wednesday", "Thursday (Check-in)"]
      : ["Thursday", "Friday", "Saturday", "Sunday"];

  const coveragePeriod =
    dayType === "monday" ? "Monday through Thursday" : "Thursday through Sunday";

  const nextCheckIn =
    dayType === "monday"
      ? "Thursday"
      : "Monday";

  const sponsorBlocks = sponsors
    .map(
      (s: {
        name: string;
        exam: string;
        status: string;
        issues: string;
        actions: string[];
        dmNeeds: string;
        mondayResult?: string;
      }, i: number) => {
        const actionLines = s.actions
          .map((a: string, j: number) => `  - ${days[j]}: ${a || "[No task entered]"}`)
          .join("\n");

        const resultLine =
          dayType === "thursday" && s.mondayResult
            ? `Monday Action Plan Result: ${s.mondayResult}\n`
            : "";

        return `SPONSOR ${i + 1}: ${s.name}
Current Exam: ${s.exam}
${resultLine}Current Status/Score: ${s.status}
Key Issues: ${s.issues}
Daily Action Plan:
${actionLines}
What I Need from DM: ${s.dmNeeds}`;
      }
    )
    .join("\n\n---\n\n");

  const prompt = `You are writing a professional email for a sponsorship coordinator at a financial advisory firm. Generate a clear, actionable email based on this data. The email should be direct and give "high direction" - specific daily tasks, not vague updates.

EMAIL DETAILS:
- Day: ${dayType === "monday" ? "Monday" : "Thursday"}
- Date: ${date}
- To: Nicholas Mangino, Lexi, ${dmName || "[District Manager]"}
- Subject: At-Risk Sponsor Action Plans${dayType === "thursday" ? " (Thu-Sun)" : ""} - Week of ${date}
- Coverage: ${coveragePeriod}
- Next check-in: ${nextCheckIn}

SPONSOR DATA:
${sponsorBlocks}

FORMAT THE EMAIL AS:
1. Brief intro (1-2 sentences) explaining this is the ${dayType === "monday" ? "weekly" : "mid-week"} at-risk sponsor action plan
2. For each sponsor, a clearly formatted section with:
   - Name and exam in bold/caps
   - ${dayType === "thursday" ? "Results from Monday plan\n   - " : ""}Current status and scores
   - Key issues
   - Daily breakdown with specific tasks for each day
   - What's needed from the DM
3. Closing asking for confirmation by end of day
4. Sign off as "Nick B, Sponsorship Coordinator"

Keep it professional but concise. Each daily task should be specific and actionable (e.g., "Complete 2 simulated exams and score above 75%" not just "study more"). Use plain text formatting with clear headers and dashes for structure (no HTML).`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  return NextResponse.json({ email: text });
}
