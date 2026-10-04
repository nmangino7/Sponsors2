import { NextRequest, NextResponse } from "next/server";
import { MANAGER_INITIALS, STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS, FAILURE_MODE_PLAYBOOK } from "../context";
import { MODEL_EMAIL, createMessage, extractText, friendlyError, logUsage, withRetry } from "../anthropic";
import { computePace, formatPaceFacts, parseDurationToMinutes } from "../pace";
import { formatAllFacts, loadDiagnosis, syncSponsorFromCard } from "../diagnose";
import { getStore } from "../store";
import { requireUser } from "../guard";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are the sponsorship coordinator at The Financial Gym (FGA) writing a team-facing email of at-risk sponsor action plans for the managers/DMs. The team is measured on sponsor conversion and pass rates, and its biggest problems are sponsors who stall in the Achievable textbook and sponsors whose practice scores over-read the real exam. Every plan must hold the sponsor to their last promise, drive the reading to completion, and gate "ready" on real evidence. Be specific, time-estimated, and STRICTLY phase-correct.

${MANAGER_INITIALS}

${STUDY_RESOURCES}

${STUDY_METHODOLOGY}

${PHASE_DETECTION}

${FAILURE_MODE_PLAYBOOK}

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
  sponsorId?: string | null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

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

    const store = getStore();
    const sponsorBlocks = (await Promise.all((sponsors as SponsorInput[])
      .map(async (s, i) => {
        const actionLines = s.actions
          .map((a: string, j: number) => `  - ${days[j]}: ${a || "[No task entered]"}`)
          .join("\n");

        await syncSponsorFromCard(store, s);
        const d = s.sponsorId ? await loadDiagnosis(store, s.sponsorId) : null;
        const facts = d
          ? formatAllFacts(d, "team")
          : formatPaceFacts(computePace({
              pagesRead: s.pagesRead ?? null,
              pagesTotal: s.pagesTotal ?? null,
              readingMinutesLeft: parseDurationToMinutes(s.readingTimeLeft),
              readingTimeHours: s.readingTimeHours ?? null,
              quizTimeHours: s.quizTimeHours ?? null,
              examDate: s.examDate || null,
            }));

        return `SPONSOR ${i + 1}: ${s.name}
Current Exam: ${s.exam}
${facts}
${s.achievableStatus ? `Achievable plan status (quote as-is): "${s.achievableStatus}"` : ""}
Current Status/Score: ${s.status}
Key Issues: ${s.issues}
Draft Daily Action Plan (upgrade to phase-correct, time-estimated tasks):
${actionLines}
What I Need from DM: ${s.dmNeeds}`;
      })))
      .join("\n\n---\n\n");

    const prompt = `Generate the team email. For EACH sponsor, use the PHASE, failure mode and checkpoint facts given (work the phase out yourself only when no READINESS FACTS are provided), then build that sponsor's plan for that phase only. Be direct and give high direction — specific, time-estimated daily tasks. Today's date: ${date}.

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
   - A status line: the dot (GREEN on track / RED off track / GREY waiting) with its reason, and the primary failure mode in the playbook's words.
   - "LAST PROMISE": the last checkpoint and how it graded (HIT / PARTIAL / MISSED, exact numbers), plus the miss streak if 2+.
   - "% READY": base → calibrated with the one-line reason, or "Never tested" when there are no timed full-lengths. Add RUSHING / BANK BURNOUT flags when present.
   - For Phase 1 sponsors: a "READING" line with book progress, the book deadline, the REQUIRED DAILY QUOTA, and the projected finish at their observed pace.
   - Current status with their specific metrics.
   - Key issues.
   - "BEST GUIDANCE": 2-4 prioritized, phase-correct bullets.
   - Daily breakdown for ${days.join(", ")} — each task a bullet "• [task] — [time range] — Target: [...]". For Phase 1 sponsors the first task each day is the reading assignment.
   - "What I need from the DM": specific asks, including escalation flags (2+ missed checkpoints = 1-1 this week, gone dark, extreme reading load, materials unpaid, result missing).
   - "NEXT PROMISE": the next checkpoint the sponsor email will close with, word for word.
5. Closing: "Please confirm receipt and alignment on these action plans."
6. Sign off as "Sponsorship Coordination"

HARD REQUIREMENTS:
- Phase gating is absolute: book unfinished = PHASE 1, Achievable ONLY, no Kaplan/videos/Quizlet and no on-demand Quiz Bank drilling.
- Use each sponsor's PACE / READINESS / ACCOUNTABILITY FACTS verbatim — do not recalculate or override any number, phase or verdict.
- Never call a sponsor ready unless their READINESS FACTS say the gold standard is MET.
- Every daily task includes a time-range estimate.
- Never recommend moving a sponsor's exam date; ramp the daily load instead and flag the DM.
- The gold standard for "ready" is 3 timed full exams in the 80s, at real pace, on fresh questions, calibrated 80+ — READINESS FACTS decides it.
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
