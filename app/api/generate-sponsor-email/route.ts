import { NextRequest, NextResponse } from "next/server";
import { STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS, SPONSOR_EMAIL_TONE, FAILURE_MODE_PLAYBOOK } from "../context";
import { MODEL_EMAIL, createMessage, extractText, friendlyError, logUsage, withRetry } from "../anthropic";
import { computePace, formatPaceFacts, parseDurationToMinutes } from "../pace";
import { formatAllFacts, loadDiagnosis, syncSponsorFromCard, reportAgeDays, STALE_REPORT_DAYS, cardDiagnosis } from "../diagnose";
import { parseWriter, sponsorEmail } from "../templates";
import { getStore } from "../store";
import { requireUser } from "../guard";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are the sponsorship coordinator at The Financial Gym (FGA), writing directly to a sponsor studying for a FINRA or insurance licensing exam. Your job is to keep them committed: hold them to their last promise, get them through the Achievable textbook fast, and only call them ready when the evidence says so. Be specific, time-estimated, and STRICTLY phase-correct.

${STUDY_RESOURCES}

${STUDY_METHODOLOGY}

${PHASE_DETECTION}

${FAILURE_MODE_PLAYBOOK}

${SPECIFICITY_INSTRUCTIONS}

${SPONSOR_EMAIL_TONE}`;

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const { startDay, date, sponsor, examDate, writer: writerIn } = await req.json();
    const writer = parseWriter(writerIn);
    const store = getStore();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    const actionLines = sponsor.actions
      .map((a: string, j: number) => `  ${days[j]}: ${a || "[No task]"}`)
      .join("\n");

    // With memory: the full diagnosis (pace, readiness, last promise graded, next promise).
    // Without it (typed-in sponsor, never uploaded): pace from the fields on hand.
    await syncSponsorFromCard(store, { sponsorId: sponsor.sponsorId, exam: sponsor.exam, examDate: examDate || sponsor.examDate });
    const d = sponsor.sponsorId ? await loadDiagnosis(store, sponsor.sponsorId) : null;
    if (d && reportAgeDays(d) > STALE_REPORT_DAYS) {
      return NextResponse.json({
        email: "",
        error: `${d.sponsor.name}'s latest Achievable report is from ${d.today} (${reportAgeDays(d)} days old). Upload a fresh report first, so the promise is set — and later graded — on current numbers.`,
      }, { status: 409 });
    }
    const resultMissing = d?.readiness.primaryMode === "result_missing";
    const facts = d
      ? formatAllFacts(d, "sponsor")
      : formatPaceFacts(computePace({
          pagesRead: sponsor.pagesRead ?? null,
          pagesTotal: sponsor.pagesTotal ?? null,
          readingMinutesLeft: parseDurationToMinutes(sponsor.readingTimeLeft),
          readingTimeHours: sponsor.readingTimeHours ?? null,
          quizTimeHours: sponsor.quizTimeHours ?? null,
          examDate: examDate || sponsor.examDate || null,
        }));

    const prompt = `Write the next email to this sponsor. Today's date: ${date}.

${facts}

SPONSOR DETAILS:
- Name: ${sponsor.name}
- Current Exam: ${sponsor.exam}
- Plan covers these 4 days: ${days.join(", ")}
${sponsor.currentChapter ? `- Currently on: ${sponsor.currentChapter}` : ""}
${sponsor.achievableStatus ? `- Achievable reports their plan status as: "${sponsor.achievableStatus}" (quote it as-is; don't reinterpret it)` : ""}

WHAT WE KNOW (upgrade everything to be hyper-specific, time-estimated, and phase-correct):
- Status / scores: ${sponsor.status || "[unknown — rely on the facts above]"}
- Issues: ${sponsor.issues || "[none noted]"}
- Draft daily tasks:
${actionLines}

${resultMissing
  ? `THEIR EXAM DATE HAS PASSED AND NO RESULT IS ON FILE. Write a SHORT email instead of the usual structure: the first line asks how the exam went and asks them to send the score report (pass or fail). No study plan, no quota, no day-by-day tasks until we know. Close with the NEXT CHECKPOINT word for word, then "Your Sponsorship Team".`
  : `WRITE THE EMAIL using the REQUIRED STRUCTURE (opener with the last checkpoint's result → status block → "BEST GUIDANCE — DO THESE FIRST" → day-by-day plan → "IF YOU FALL BEHIND" → "WHAT SUCCESS LOOKS LIKE" → close with the NEXT CHECKPOINT word for word → "Your Sponsorship Team").`}

HARD REQUIREMENTS:
- Use the PHASE and failure mode from READINESS FACTS and the matching strategy. Phase 1: lead with the reading quota, reading first and biggest every day, no Kaplan/videos/Quizlet, no on-demand Quiz Bank drilling.
- Every number in the facts blocks is computed — restate it exactly; never invent a different quota, date or checkpoint.
- Never show readiness %, calibration or pass odds of our own; Achievable's own readiness meter is fine.
- If they are behind, say so directly with the higher number. NEVER suggest moving their exam date.
- Every task bullet has a time-range estimate. Plain text only, blank lines between sections and days.`;

    // Free and Claude-app modes still save the promise, so the next upload grades it.
    const remember = async (body: string) => {
      if (d) {
        await store.addEmail({
          sponsorId: d.sponsor.id, kind: "sponsor", body, phase: d.readiness.phase,
          checkpoint: d.next, checkpointResult: d.lastResult, createdBy: user.email,
        });
      }
    };
    if (writer === "free") {
      const dx = d ?? cardDiagnosis({ ...sponsor, examDate: examDate || sponsor.examDate });
      const email = sponsorEmail(dx, sponsor, days);
      await remember(email);
      return NextResponse.json({ email, writer, checkpoint: d?.next ?? null, lastCheckpoint: d?.lastResult ?? null });
    }
    if (writer === "claude-app") {
      await remember("[Written in the Claude app from a copied prompt]");
      return NextResponse.json({ prompt: `${SYSTEM_PROMPT}\n\n---\n\n${prompt}`, writer, checkpoint: d?.next ?? null, lastCheckpoint: d?.lastResult ?? null });
    }

    const message = await withRetry(() => createMessage({
      model: MODEL_EMAIL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    }));
    logUsage("sponsor-email", message);
    const email = extractText(message);

    if (email) await remember(email);

    return NextResponse.json({ email, checkpoint: d?.next ?? null, lastCheckpoint: d?.lastResult ?? null });
  } catch (err: unknown) {
    const message = friendlyError(err);
    console.error("Generate sponsor email API error:", message);
    return NextResponse.json({ email: "", error: message }, { status: 500 });
  }
}
