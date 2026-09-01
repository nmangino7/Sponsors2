import { NextRequest, NextResponse } from "next/server";
import { MANAGER_INITIALS, STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS } from "../context";
import { MODEL_EMAIL, createMessage, extractText, friendlyError, logUsage, withRetry } from "../anthropic";
import { computePace, formatPaceFacts, parseDurationToMinutes } from "../pace";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are a sponsorship coordinator at a financial advisory firm (GFA) writing a team-facing email of at-risk sponsor action plans for the coordinators/DMs. The team's #1 problem is sponsors not finishing the Achievable textbook, so every plan must drive the reading to completion. Be specific, time-estimated, and STRICTLY phase-correct.

${MANAGER_INITIALS}

${STUDY_RESOURCES}

${STUDY_METHODOLOGY}

${PHASE_DETECTION}

${SPECIFICITY_INSTRUCTIONS}`;

interface SponsorInput {
  name: string;
  exam: string;
  status: string;
  issues: string;
  actions: string[];
  dmNeeds: string;
  examDate?: string;
  pagesRead?: number | null;
  pagesTotal?: number | null;
  readingTimeLeft?: string;
  readingTimeHours?: number | null;
  quizTimeHours?: number | null;
  currentChapter?: string;
  achievableStatus?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { startDay, date, sponsors, scoreEntries } = await req.json();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    let scoreSummary = "";
    if (scoreEntries?.length > 0) {
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
      scoreSummary = `\n\nSCORE SUMMARY — include this section EXACTLY as formatted below, right after "Hey team," and before individual sponsor plans. Copy this layout directly into the email:\n\n--- SCORE SNAPSHOT ---${tableBlock}--- END SCORES ---\n\nDo NOT reformat, rearrange, or turn the score snapshot into a different layout.`;
    }

    const sponsorBlocks = (sponsors as SponsorInput[])
      .map((s, i) => {
        const actionLines = s.actions
          .map((a: string, j: number) => `  - ${days[j]}: ${a || "[No task entered]"}`)
          .join("\n");

        const pace = computePace({
          pagesRead: s.pagesRead ?? null,
          pagesTotal: s.pagesTotal ?? null,
          readingMinutesLeft: parseDurationToMinutes(s.readingTimeLeft),
          readingTimeHours: s.readingTimeHours ?? null,
          quizTimeHours: s.quizTimeHours ?? null,
          examDate: s.examDate || null,
        });

        return `SPONSOR ${i + 1}: ${s.name}
Current Exam: ${s.exam}
${formatPaceFacts(pace)}
${s.achievableStatus ? `Achievable plan status (quote as-is): "${s.achievableStatus}"` : ""}
Current Status/Score: ${s.status}
Key Issues: ${s.issues}
Draft Daily Action Plan (upgrade to phase-correct, time-estimated tasks):
${actionLines}
What I Need from DM: ${s.dmNeeds}`;
      })
      .join("\n\n---\n\n");

    const prompt = `Generate the team email. For EACH sponsor, work out their PHASE from the data, then build that sponsor's plan for that phase only. Be direct and give high direction — specific, time-estimated daily tasks. Today's date: ${date}.

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
   - Header: Name — Exam — "PHASE: [1-4] — [phase name]".
   - For Phase 1 sponsors: a "READING" line with their book progress, the book deadline, and the REQUIRED DAILY QUOTA from their PACE FACTS, plus whether they're on pace or behind.
   - Current status with their specific metrics.
   - Key issues.
   - "BEST GUIDANCE": 2-4 prioritized, phase-correct bullets.
   - Daily breakdown for ${days.join(", ")} — each task a bullet "• [task] — [time range] — Target: [...]". For Phase 1 sponsors the first task each day is the reading assignment.
   - "What I need from the DM": specific asks, including escalation flags (extreme reading load, no logins, pace slipping).
5. Closing: "Please confirm receipt and alignment on these action plans."
6. Sign off as "Sponsorship Coordination"

HARD REQUIREMENTS:
- Phase gating is absolute: book unfinished = PHASE 1, Achievable ONLY, no Kaplan/videos/Quizlet and no on-demand Quiz Bank drilling.
- Use each sponsor's PACE FACTS numbers verbatim — do not recalculate them.
- Every daily task includes a time-range estimate.
- Never recommend moving a sponsor's exam date; ramp the daily load instead and flag the DM.
- The gold standard for "ready" is 3 full practice exams in the 80s.
- Plain text (no HTML). Spacious and scannable.`;

    const message = await withRetry(() => createMessage({
      model: MODEL_EMAIL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    }));
    logUsage("team-email", message);

    return NextResponse.json({ email: extractText(message) });
  } catch (err: unknown) {
    const message = friendlyError(err);
    console.error("Generate email API error:", message);
    return NextResponse.json({ email: "", error: message }, { status: 500 });
  }
}
