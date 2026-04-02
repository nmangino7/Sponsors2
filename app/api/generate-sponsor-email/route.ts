import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { STUDY_RESOURCES, SPECIFICITY_INSTRUCTIONS, SPONSOR_EMAIL_TONE, CHAPTER_RECOMMENDATION_LOGIC } from "../context";

export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { startDay, date, sponsor } = await req.json();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    const actionLines = sponsor.actions
      .map((a: string, j: number) => `  ${days[j]}: ${a || "[No task]"}`)
      .join("\n");

    const prompt = `You are writing an email FROM the sponsorship coordination team TO a sponsor (${sponsor.name}) at a financial advisory firm (GFA). This email tells them their study action plan for the next 4 days.

${STUDY_RESOURCES}

${SPECIFICITY_INSTRUCTIONS}

${CHAPTER_RECOMMENDATION_LOGIC}

${SPONSOR_EMAIL_TONE}

SPONSOR DETAILS:
- Name: ${sponsor.name}
- Current Exam: ${sponsor.exam}
- Date: ${date}
- Plan Days: ${days.join(", ")}

THEIR ACTION PLAN:
${actionLines}

WRITE THE EMAIL - FORMAT AS FOLLOWS:

Hey ${sponsor.name.split(" ")[0]},

[1-2 sentence direct opener about their current situation and what this plan fixes]

**YOUR PLAN FOR ${days[0].toUpperCase()} - ${days[3].toUpperCase()}:**

**${days[0].toUpperCase()}**
• [Task 1] — [Time: Morning/Afternoon/Evening] — Target: [score/completion target]
• [Task 2] — [Time: Morning/Afternoon/Evening] — Target: [score/completion target]
• [Task 3] — [Time: Morning/Afternoon/Evening] — Target: [score/completion target]
[Include clickable URLs for resources]

**${days[1].toUpperCase()}**
• [Task 1] — [Time] — Target: [score/completion]
• [Task 2] — [Time] — Target: [score/completion]
• [Task 3] — [Time] — Target: [score/completion]
[Include clickable URLs]

[Repeat for ${days[2].toUpperCase()} and ${days[3].toUpperCase()}]

**IF YOU DON'T HIT YOUR TARGETS:**
• Below 70% → [What to redo/refocus on]
• Below 80% → [What to strengthen before moving on]
• Above 85% → [Next section to unlock]

**WHAT SUCCESS LOOKS LIKE:**
• Complete [X] by [Day]
• Hit [Score]% on simulated exams
• Zero questions skipped or avoided

[1-2 sentence direct close: reference their exam date, specific goal, or what you're watching for]

Your Sponsorship Team

RULES:
- EVERY line must be actionable and scannable
- Use bullet points ONLY — no paragraphs except opener and closer
- Do NOT mention internal team issues, DM requests, or anything the sponsor shouldn't see
- DO include direct URLs inline (e.g., "Kaplan Q-bank (https://home.kaplanlearn.com/login)")
- DO be specific about times and targets
- Tone: Coach-like, direct, no fluff
- Use plain text, no HTML, no extra formatting

SPACING RULES:
- Add a BLANK LINE between each day's section
- Add a BLANK LINE between each bullet point group
- Add a BLANK LINE before and after the "IF YOU DON'T HIT YOUR TARGETS" section
- Add a BLANK LINE before and after the "WHAT SUCCESS LOOKS LIKE" section
- The email should feel spacious and easy to scan — NOT a dense wall of text
- Each day's header should have a blank line before it`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    return NextResponse.json({ email: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Generate sponsor email API error:", message);
    return NextResponse.json({ email: "", error: message }, { status: 500 });
  }
}
