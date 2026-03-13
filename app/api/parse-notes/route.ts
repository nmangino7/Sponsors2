import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { notes, dayType } = await req.json();

  const days =
    dayType === "monday"
      ? ["Monday", "Tuesday", "Wednesday", "Thursday"]
      : ["Thursday", "Friday", "Saturday", "Sunday"];

  const prompt = `You are helping a sponsorship coordinator parse their raw notes into structured data for at-risk sponsors at a financial advisory firm. These sponsors are studying for financial exams (SIE, Series 63, Series 65, LAH, VA).

RAW NOTES:
${notes}

Extract sponsor information and return ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "sponsors": [
    {
      "name": "Full Name",
      "exam": "SIE or 63 or 65 or LAH or VA",
      "status": "Current scores, progress in material, percentage complete etc.",
      "issues": "What's going wrong - not studying, bad habits, not responsive, etc.",
      "actions": ["task for ${days[0]}", "task for ${days[1]}", "task for ${days[2]}", "task for ${days[3]}"],
      "dmNeeds": "What the district manager should do for this person",
      "mondayResult": "Only if Thursday - what happened with Monday's plan"
    }
  ]
}

For the actions array, generate specific, actionable daily tasks based on the notes. For example:
- "Complete 2 simulated exams, target 80%+"
- "Review chapters 3-5, watch SIE review video"
- "Do 100 Q-bank questions focusing on options"
- "Complete certification section in Achievable"

If info is missing, make reasonable suggestions based on the context. Always return exactly 4 actions per sponsor (one per day).`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return NextResponse.json(JSON.parse(jsonMatch[0]));
    }
    return NextResponse.json({ sponsors: [], error: "Could not parse response" });
  }
}
