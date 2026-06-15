import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { MANAGER_INITIALS, STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS } from "../context";

export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Static coaching context — identical on every request, so cache it.
const SYSTEM_PROMPT = `You are a sponsorship coordinator at a financial advisory firm (GFA) writing a team-facing email of at-risk sponsor action plans for the coordinators/DMs. Every plan must be specific, time-estimated, and STRICTLY phase-correct — you are replacing a human study coordinator.

${MANAGER_INITIALS}

${STUDY_RESOURCES}

${STUDY_METHODOLOGY}

${PHASE_DETECTION}

${SPECIFICITY_INSTRUCTIONS}`;

export async function POST(req: NextRequest) {
  try {
    const { startDay, date, sponsors, scoreEntries } = await req.json();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    // Build score summary — pre-formatted so AI preserves the layout
    let scoreSummary = "";
    if (scoreEntries?.length > 0) {
      // Group scores by sponsor
      const byName: Record<string, typeof scoreEntries> = {};
      for (const e of scoreEntries) {
        const key = (e as { sponsor: string }).sponsor || "Unknown";
        if (!byName[key]) byName[key] = [];
        byName[key].push(e);
      }

      let tableBlock = "";
      for (const [name, entries] of Object.entries(byName)) {
        tableBlock += `\n  ${name}:\n`;
        for (const e of entries as { date: string; sponsor: string; platform: string; scoreType: string; score: number; section: string; notes: string }[]) {
          const sectionStr = e.section ? ` — ${e.section}` : "";
          const noteStr = e.notes ? ` (${e.notes})` : "";
          tableBlock += `    • ${e.platform} ${e.scoreType}: ${e.score}%${sectionStr}${noteStr}  [${e.date}]\n`;
        }
      }

      scoreSummary = `\n\nSCORE SUMMARY — include this section EXACTLY as formatted below, right after "Hey team," and before individual sponsor plans. Copy this layout directly into the email:\n\n--- SCORE SNAPSHOT ---${tableBlock}--- END SCORES ---\n\nDo NOT reformat, rearrange, or turn the score snapshot into a different layout. Preserve the grouping by sponsor name, the bullet points, and the exact spacing shown above.`;
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
          examDate?: string;
        }, i: number) => {
          const actionLines = s.actions
            .map((a: string, j: number) => `  - ${days[j]}: ${a || "[No task entered]"}`)
            .join("\n");

          return `SPONSOR ${i + 1}: ${s.name}
Current Exam: ${s.exam}
Exam (test) date: ${s.examDate ? `${s.examDate} — book must be done 5-7 days before this` : "not provided"}
Current Status/Score: ${s.status}
Key Issues: ${s.issues}
Draft Daily Action Plan (upgrade to phase-correct, time-estimated tasks):
${actionLines}
What I Need from DM: ${s.dmNeeds}`;
        }
      )
      .join("\n\n---\n\n");

    const prompt = `Generate the team email. For EACH sponsor, first determine their PHASE from the data (use PHASE DETECTION), then build that sponsor's plan for that phase only. Be direct and give high direction — specific, time-estimated daily tasks, not vague updates. Today's date: ${date}.

EMAIL DETAILS:
- Greeting: "Hey team,"
- Subject: At-Risk Sponsor Action Plans - Week of ${date}
- Action plan days: ${days.join(", ")}

SPONSOR DATA:
${sponsorBlocks}
${scoreSummary}

FORMAT THE EMAIL AS:
1. Start with "Hey team,"
2. Brief intro (1-2 sentences) — this is the at-risk action plan covering ${days[0]} through ${days[3]}.
3. (If a score snapshot is provided above, place it here, exactly as formatted.)
4. For EACH sponsor, a clearly separated section (use === between sponsors) with:
   - Header: Name — Exam — and "PHASE: [1-4] — [phase name]" and, if known, the book-finish deadline + days to their exam date.
   - Current status with their specific scores/metrics.
   - Key issues.
   - "BEST GUIDANCE": 2-4 prioritized, phase-correct bullets (the highest-leverage moves).
   - Daily breakdown for ${days.join(", ")} — each task a bullet "• [task] — [time range] — Target: [...]", phase-correct resources only.
   - "What I need from the DM": specific asks (including any escalation flags).
5. Closing: "Please confirm receipt and alignment on these action plans."
6. Sign off as "Sponsorship Coordination"

HARD REQUIREMENTS:
- Phase gating is absolute: if a sponsor's book isn't finished, that's PHASE 1 — Achievable ONLY; do NOT assign Kaplan, videos, or Quizlet for them.
- Every daily task includes a time-range estimate (e.g. "45-60 min").
- The gold standard for "ready" is 3 full practice exams in the 80s — reference it in success criteria.
- Reference actual numbers and scores. Use plain text (no HTML). Keep it spacious and scannable with blank lines between sections, sponsors, and days.`;

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content.map(b => (b.type === "text" ? b.text : "")).join("");

    return NextResponse.json({ email: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Generate email API error:", message);
    return NextResponse.json({ email: "", error: message }, { status: 500 });
  }
}
