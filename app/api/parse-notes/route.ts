import { NextRequest, NextResponse } from "next/server";
import { MANAGER_INITIALS, STUDY_RESOURCES, STUDY_METHODOLOGY, PHASE_DETECTION, SPECIFICITY_INSTRUCTIONS, FAILURE_MODE_PLAYBOOK } from "../context";
import { MODEL_PARSE, createMessage, extractText, friendlyError, logUsage, withRetry } from "../anthropic";
import { extractReport, emptyReport, type ReportData } from "../report-extract";
import { parseDurationToMinutes } from "../pace";
import type { KaplanData } from "../readiness";
import { computeDiagnosis, diagnosisSummary, formatAllFacts, refreshDiagnosis, loadDiagnosis, type Diagnosis } from "../diagnose";
import { draftPlan, parseWriter } from "../templates";
import { parseKaplanText } from "../kaplan-text";
import { getStore } from "../store";
import { nameKey } from "../store-model";
import { requireUser } from "../guard";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are the sponsorship coordinator at The Financial Gym (FGA) parsing a sponsor's Achievable study report (text, screenshots, PDFs), Kaplan screenshots, and tracker notes into a structured, phase-correct action plan. You are replacing a human study coordinator — read the data carefully. Computed facts (pace, readiness, phase, checkpoints) are authoritative when provided.

${MANAGER_INITIALS}

${STUDY_RESOURCES}

${STUDY_METHODOLOGY}

${PHASE_DETECTION}

${FAILURE_MODE_PLAYBOOK}

${SPECIFICITY_INSTRUCTIONS}`;

interface LlmSponsor {
  name?: string; exam?: string; examDate?: string; pagesRead?: number | null; pagesTotal?: number | null;
  readingTimeLeft?: string; readingTimeHours?: number | null; quizTimeHours?: number | null; readiness?: number | null;
  currentChapter?: string; achievableStatus?: string; status?: string; issues?: string; actions?: unknown;
  dmNeeds?: string; extractedScores?: unknown[]; kaplan?: Partial<KaplanData> | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** The LLM only fills what the deterministic extractor couldn't read. */
function mergeReport(base: ReportData, llm: LlmSponsor | undefined): ReportData {
  if (!llm) return base;
  const r: ReportData = { ...base };
  if (r.name === null && llm.name) r.name = llm.name;
  if (r.exam === null && llm.exam) r.exam = llm.exam;
  if (r.pagesRead === null && typeof llm.pagesRead === "number") r.pagesRead = llm.pagesRead;
  if (r.pagesTotal === null && typeof llm.pagesTotal === "number") r.pagesTotal = llm.pagesTotal;
  if (r.readingMinutesLeft === null && llm.readingTimeLeft) r.readingMinutesLeft = parseDurationToMinutes(llm.readingTimeLeft);
  if (r.readingMin === null && typeof llm.readingTimeHours === "number") r.readingMin = llm.readingTimeHours * 60;
  if (r.quizMin === null && typeof llm.quizTimeHours === "number") r.quizMin = llm.quizTimeHours * 60;
  if (r.readiness === null && typeof llm.readiness === "number") r.readiness = llm.readiness;
  if (r.targetDate === null && llm.examDate && /^\d{4}-\d{2}-\d{2}$/.test(llm.examDate)) r.targetDate = llm.examDate;
  if (r.planStatus === null && llm.achievableStatus) r.planStatus = llm.achievableStatus;
  return r;
}

/** Key-order-independent JSON (Postgres jsonb reorders object keys). */
function canonicalJson(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, (x as Record<string, unknown>)[k]])) : x);
}

function cleanKaplan(k: Partial<KaplanData> | null | undefined): KaplanData | null {
  if (!k) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const sims = Array.isArray(k.sims)
    ? k.sims.filter(s => s && typeof s.score === "number").map(s => ({
        name: String(s.name ?? "Kaplan sim"), score: s.score, date: typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : null,
        minutesUsed: n(s.minutesUsed), minutesAllowed: n(s.minutesAllowed),
      }))
    : [];
  const out: KaplanData = { answered: n(k.answered), total: n(k.total), avgScore: n(k.avgScore), sims };
  return out.answered === null && out.total === null && out.avgScore === null && sims.length === 0 ? null : out;
}

/** The activity log is long and low-value for the model; the parser already read it. */
function trimForModel(text: string): string {
  const cut = text.search(/\nACTIVITY LOG\b/);
  return (cut > 0 ? text.slice(0, cut) : text).slice(0, 40000);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const { notes, startDay, sponsorName, exam, images, scoreEntries, examDate, reportText, sponsorId, kaplanText, writer: writerIn } = await req.json();
    // Free (default) and Claude-app modes never call the API: the plan comes from the built-in writer.
    const writer = parseWriter(writerIn);
    const manualKaplan = parseKaplanText(kaplanText);
    const store = getStore();

    const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const idx = ALL_DAYS.indexOf(startDay || "Monday");
    const days = [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);

    // 1. Deterministic read of the report's text layer.
    const extracted: ReportData | null = typeof reportText === "string" && reportText.trim() ? extractReport(reportText) : null;

    // 2. Who is this? Achievable UUID first, then name — or the user's explicit pick.
    let sponsor = sponsorId ? await store.getSponsor(sponsorId) : null;
    if (sponsor && extracted) {
      // An explicit "Save To" pick must not take someone else's report (or Achievable account).
      const owner = extracted.achievableUuid ? await store.findSponsor({ achievableUuid: extracted.achievableUuid }) : null;
      const uuidClash = (owner && owner.id !== sponsor.id)
        || (!!sponsor.achievableUuid && !!extracted.achievableUuid && sponsor.achievableUuid !== extracted.achievableUuid);
      const words = (n: string) => new Set(nameKey(n).split(" ").filter(Boolean));
      const nameClash = !sponsor.achievableUuid && !!extracted.name
        && ![...words(extracted.name)].some(w => words(sponsor!.name).has(w));
      if (uuidClash || nameClash) {
        const who = extracted.name ?? "a different Achievable account";
        const held = owner && owner.id !== sponsor.id ? (owner.name === who ? " (already in memory)" : ` (saved as ${owner.name})`) : "";
        return NextResponse.json({
          sponsors: [],
          error: `This report is for ${who}${held}, not ${sponsor.name}. Nothing was saved. Pick the right sponsor under "Save To", or choose Auto-match.`,
        }, { status: 409 });
      }
    }
    if (!sponsor) sponsor = await store.findSponsor({ achievableUuid: extracted?.achievableUuid, name: extracted?.name ?? sponsorName });
    let matched: "existing" | "new" = sponsor ? "existing" : "new";
    // Exam: an explicit pick, else the course printed on the report, else what's on file.
    const examPick: string | null = exam || extracted?.exam || sponsor?.exam || null;

    // 3. Preliminary diagnosis from memory + the deterministic read, so the draft plan is phase-correct.
    let prelimFacts = "";
    let prelimDiag: Diagnosis | null = null;
    if (extracted && !extracted.missing.some(f => f === "pagesRead" || f === "pagesTotal")) {
      const snaps = sponsor ? await store.snapshots(sponsor.id, 5) : [];
      const reportDate = extracted.reportDate ?? today();
      const prelim = computeDiagnosis({
        report: extracted, kaplan: null, today: reportDate,
        exam: examPick, examDate: examDate || sponsor?.examDate || extracted.targetDate,
        previous: snaps.find(s => s.reportDate < reportDate) ?? null,
        sits: sponsor ? await store.realSits(sponsor.id) : [],
        notes: [notes, ...(sponsor ? (await store.notes(sponsor.id, 3)).map(n => n.body) : [])].filter(Boolean),
        emails: sponsor ? await store.emails(sponsor.id, 10) : [],
      });
      // Sponsor-audience facts: the draft's status/issues text later feeds the sponsor email.
      prelimFacts = formatAllFacts(prelim, "sponsor");
      prelimDiag = prelim;
    }

    let scoreContext = "";
    if (scoreEntries?.length > 0) {
      const scoreLines = scoreEntries.map((e: { date: string; sponsor: string; platform: string; scoreType: string; score: number; section: string; notes: string }) =>
        `- ${e.date} ${e.sponsor}: ${e.platform} ${e.scoreType} — ${e.score}%${e.section ? ` (${e.section})` : ""}${e.notes ? ` [${e.notes}]` : ""}`
      ).join("\n");
      scoreContext = `\n\nRECENT STUDY SCORES logged by the team:\n${scoreLines}`;
    }

    const textPrompt = `Build this sponsor's draft 4-day plan and extract anything the parser couldn't read.

SPONSOR: ${sponsorName || extracted?.name || sponsor?.name || "[Unknown]"}
CURRENT EXAM: ${examPick || "[Unknown]"}
EXAM (TEST) DATE: ${examDate || sponsor?.examDate || extracted?.targetDate || "[unknown — use the report's Target date if visible]"}
${prelimFacts ? `\n${prelimFacts}\n\nThe facts above are computed from the report and this sponsor's history — use them; don't re-derive the phase or the quota.` : ""}
${extracted ? `\nACHIEVABLE REPORT TEXT (already parsed; use it for chapter/section names and weak topics):\n${trimForModel(reportText)}` : ""}
${notes ? `\nTRACKER NOTES (newest first):\n${notes}` : ""}
${images?.length > 0 ? `\nSCREENSHOTS ATTACHED: read every number. Kaplan QBank screenshots matter most — capture Total Questions, Answered, Average Score, and every named sim with its score, date and minutes used/allowed. Kaplan logins are SHARED: count only sims labelled for THIS sponsor; skip attempts labelled with another person's name or a staff label (e.g. "Tay").` : ""}
${scoreContext}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "sponsors": [
    {
      "name": "${sponsorName || extracted?.name || ""}",
      "exam": "${examPick || "SIE"}",
      "examDate": "YYYY-MM-DD if known or visible, else empty string",
      "pagesRead": null,
      "pagesTotal": null,
      "readingTimeLeft": "e.g. '5h 8m' if visible, else empty string",
      "readingTimeHours": null,
      "quizTimeHours": null,
      "readiness": null,
      "currentChapter": "chapter/section they're on, else empty string",
      "achievableStatus": "plan status label as shown (e.g. 'AT RISK'), else empty string",
      "status": "One line leading with the PHASE and the decisive numbers.",
      "issues": "The specific problems, named in the playbook's failure-mode words where they fit.",
      "actions": [
        ["task 1 for ${days[0]}", "task 2 for ${days[0]}"],
        ["task 1 for ${days[1]}", "task 2 for ${days[1]}"],
        ["task 1 for ${days[2]}", "task 2 for ${days[2]}"],
        ["task 1 for ${days[3]}", "task 2 for ${days[3]}"]
      ],
      "dmNeeds": "What the DM should specifically do, including any escalation.",
      "extractedScores": [
        { "platform": "Achievable or Kaplan", "scoreType": "Simulated Exam, Q-bank, Chapter Quiz, Unit Quiz, or Certification", "score": 72, "section": "topic", "notes": "observation" }
      ],
      "kaplan": { "answered": null, "total": null, "avgScore": null, "sims": [ { "name": "", "score": 0, "date": "YYYY-MM-DD or null", "minutesUsed": null, "minutesAllowed": null } ] }
    }
  ]
}

RULES:
- Numbers you can't see stay null. NEVER guess a page total — it's course-specific.
- "kaplan": only from Kaplan screenshots; otherwise null.
- "actions": 4 arrays, 3-5 tasks each, every task with a time range. Phase 1: the FIRST task each day is the reading assignment with named chapters/sections; no Kaplan, videos, Quizlet or on-demand Quiz Bank drilling.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];
    for (const img of images ?? []) {
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.base64 } });
    }
    content.push({ type: "text", text: textPrompt });

    // The deterministic read, the diagnosis and the promise grading don't need the model —
    // if the AI step fails (credits, outage), still save the report and return the diagnosis.
    let responseText = "";
    let aiError: string | null = null;
    if (writer !== "api") {
      if (images?.length) aiError = "Screenshots can only be read with the Claude API writer — type the Kaplan numbers into the Kaplan box instead.";
    } else try {
      const message = await withRetry(() => createMessage({
        model: MODEL_PARSE,
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      }));
      logUsage("parse-notes", message);
      responseText = extractText(message);
    } catch (err: unknown) {
      if (!extracted) throw err;
      aiError = friendlyError(err);
      console.error("Parse notes AI step failed; saving the report without a draft plan:", aiError);
    }
    let parsed: { sponsors?: LlmSponsor[] } = {};
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const m = responseText.match(/\{[\s\S]*\}/);
      try { if (m) parsed = JSON.parse(m[0]); } catch { /* fall through: no draft plan */ }
    }
    const llm = parsed.sponsors?.[0];
    if (!llm && !extracted && writer === "api" && !manualKaplan) {
      return NextResponse.json({ sponsors: [], error: "Could not parse AI response" }, { status: 200 });
    }

    // 4. Merge, remember, diagnose.
    const report = mergeReport(extracted ?? emptyReport(), llm);
    const kaplan = manualKaplan ?? cleanKaplan(llm?.kaplan); // typed numbers beat a screenshot read
    // The name printed on the report is the identity; a typed name is for screenshots/notes.
    const name = (extracted?.name || sponsorName || report.name || llm?.name || "").trim();
    const theExam = examPick || llm?.exam || null;
    const theExamDate = examDate || (llm?.examDate && /^\d{4}-\d{2}-\d{2}$/.test(llm.examDate) ? llm.examDate : null) || report.targetDate || null;

    if (writer !== "api" && !extracted && !name) {
      return NextResponse.json({ sponsors: [], error: "Nothing to work with yet: upload the Achievable report PDF, or type the sponsor's name to add notes or Kaplan numbers." }, { status: 200 });
    }

    let summary = null;
    let sponsorRecord = null;
    let finalD: Diagnosis | null = null;
    if (name && !sponsor) {
      // Second chance: the name may only be known now (typed, or read from a screenshot by the model).
      sponsor = await store.findSponsor({ achievableUuid: report.achievableUuid, name });
      if (!sponsor && report.name && nameKey(report.name) !== nameKey(name)) {
        sponsor = await store.findSponsor({ achievableUuid: report.achievableUuid, name: report.name });
      }
      if (sponsor) matched = "existing";
    }
    if (name) {
      if (!sponsor) {
        sponsor = await store.createSponsor({ name, achievableUuid: report.achievableUuid, exam: theExam, examDate: theExamDate });
      } else {
        sponsor = (await store.updateSponsor(sponsor.id, {
          achievableUuid: sponsor.achievableUuid ?? report.achievableUuid,
          exam: theExam ?? sponsor.exam,
          examDate: examDate || sponsor.examDate || theExamDate,
        })) ?? sponsor;
      }
      if (typeof notes === "string" && notes.trim()) {
        const recent = await store.notes(sponsor.id, 5);
        if (!recent.some(n => n.body === notes.trim())) await store.addNote({ sponsorId: sponsor.id, body: notes.trim(), createdBy: user.email });
      }
      if (report.pagesRead !== null || report.attempts.length || report.daily.length || kaplan) {
        const reportDate = report.reportDate ?? today();
        const latest = (await store.snapshots(sponsor.id, 1))[0];
        const duplicate = latest && latest.reportDate === reportDate && latest.pagesRead === report.pagesRead
          && latest.data.attempts.length === report.attempts.length && canonicalJson(latest.kaplan) === canonicalJson(kaplan);
        if (!duplicate) {
          const prelim = computeDiagnosis({
            report, kaplan, today: reportDate, exam: sponsor.exam, examDate: sponsor.examDate ?? report.targetDate,
            previous: null, sits: await store.realSits(sponsor.id), notes: [], emails: [],
          });
          await store.addSnapshot({
            sponsorId: sponsor.id, reportDate, pagesRead: report.pagesRead, pagesTotal: report.pagesTotal, readiness: report.readiness,
            calibrated: prelim.readiness.calibrated, phase: prelim.readiness.phase, primaryMode: prelim.readiness.primaryMode,
            dot: prelim.readiness.dot, data: { ...report, reportDate }, kaplan, createdBy: user.email,
          });
        }
        finalD = await refreshDiagnosis(store, sponsor.id);
      }
      // Notes-only (or Kaplan-only) upload for someone already on file: diagnose from memory.
      if (!finalD) finalD = await loadDiagnosis(store, sponsor.id);
      if (finalD) summary = diagnosisSummary(finalD);
      sponsorRecord = { id: sponsor.id, name: sponsor.name, matched, snapshotCount: (await store.snapshots(sponsor.id, 50)).length };
    }

    // No AI draft (free writer, or the AI step failed): the built-in writer drafts the plan.
    const base = finalD ?? prelimDiag;
    const draft = !llm && base ? draftPlan(base, days) : null;

    const out = {
      ...(llm ?? {}),
      ...(draft ?? {}),
      currentChapter: llm?.currentChapter || report.planReading[0]?.section || "",
      name: llm?.name || name,
      exam: theExam ?? "SIE",
      examDate: sponsor?.examDate ?? theExamDate ?? "", // the date the diagnosis used
      achievableTargetDate: report.targetDate ?? "",
      pagesRead: report.pagesRead,
      pagesTotal: report.pagesTotal,
      readingTimeLeft: llm?.readingTimeLeft || (report.readingMinutesLeft !== null ? `${Math.round(report.readingMinutesLeft)}m` : ""),
      readingTimeHours: report.readingMin !== null ? Math.round(report.readingMin / 6) / 10 : null,
      quizTimeHours: report.quizMin !== null ? Math.round(report.quizMin / 6) / 10 : null,
      achievableStatus: report.planStatus || llm?.achievableStatus || "",
      sponsorId: sponsor?.id ?? null,
    };
    return NextResponse.json({ sponsors: [out], sponsorRecord, diagnosis: summary, memory: store.kind, extraction: extracted ? { missing: extracted.missing } : null, aiError });
  } catch (err: unknown) {
    const message = friendlyError(err);
    console.error("Parse notes API error:", message);
    return NextResponse.json({ sponsors: [], error: message }, { status: 500 });
  }
}
