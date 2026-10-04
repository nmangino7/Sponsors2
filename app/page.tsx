"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { signIn, signOut } from "next-auth/react";
import { pageText } from "./pdf-text";

interface Sponsor {
  sponsorId?: string | null; // set when this sponsor is in memory
  name: string;
  exam: string;
  examDate: string;
  status: string;
  issues: string;
  actions: string[];
  dmNeeds: string;
  pagesRead?: number | null;
  pagesTotal?: number | null;
  readingTimeLeft?: string;
  readingTimeHours?: number | null;
  quizTimeHours?: number | null;
  currentChapter?: string;
  achievableStatus?: string;
}

interface UploadedFile {
  name: string;
  type: string;
  base64: string;
  text?: string; // Achievable report PDFs: the text layer, parsed server-side (no page images sent)
  pageCount?: number;
  preview?: string;
}

interface AiSuggestion {
  sponsorId?: string | null;
  achievableTargetDate?: string;
  name: string;
  exam: string;
  examDate: string;
  status: string;
  issues: string;
  actions: string[][];
  dmNeeds: string;
  pagesRead?: number | null;
  pagesTotal?: number | null;
  readingTimeLeft?: string;
  readingTimeHours?: number | null;
  quizTimeHours?: number | null;
  currentChapter?: string;
  achievableStatus?: string;
}

interface SuggestionChecks {
  status: boolean;
  issues: boolean;
  actions: boolean[][];
  dmNeeds: boolean;
}

interface ScoreEntry {
  id: string;
  sponsor: string;
  platform: string;
  scoreType: string;
  score: number;
  section: string;
  notes: string;
  date: string;
}

interface Diagnosis {
  phase: number;
  phaseName: string;
  dot: "green" | "red" | "grey";
  dotReason: string;
  primaryMode: string | null;
  failureModes: string[];
  neverTested: boolean;
  readiness: { base: number | null; calibrated: number | null; published: number | null; calibrationReason: string | null };
  goldStandard: { met: boolean; gaps: string[] };
  flags: { rushing: boolean; bankBurnout: boolean; bankExposure: number | null; speedRatio: number | null; untimed: number };
  daysToExam: number | null;
  goNoGo: boolean;
  darkDays: number | null;
  last4AvgMin: number | null;
  pace: {
    pagesRead: number | null; pagesTotal: number | null; percentComplete: number | null; bookDeadline: string | null;
    requiredMinutesPerDay: number | null; requiredPagesPerDay: number | null; observedPagesPerDay: number | null;
    projectedFinish: string | null; stalled: boolean; status: string;
  };
  lastCheckpoint: { status: string; text: string } | null;
  nextCheckpoint: { text: string; due: string };
  streak: number;
}

interface SponsorSummary {
  id: string;
  name: string;
  exam: string | null;
  examDate: string | null;
  lastReportDate: string | null;
  pagesRead: number | null;
  pagesTotal: number | null;
  phase: number | null;
  dot: string | null;
  primaryMode: string | null;
  snapshotCount: number;
}

interface Whoami {
  user: { email: string; name: string | null } | null;
  error: string | null;
  status: number;
  authConfigured: boolean;
  devBypass: boolean;
  memory: "postgres" | "memory";
  aiKey?: boolean;
}

type Writer = "free" | "claude-app" | "api";
const WRITER_KEY = "fga.writer";

interface Timeline {
  sponsor: { id: string; name: string; exam: string | null; examDate: string | null };
  diagnosis: Diagnosis | null;
  snapshots: { id: string; reportDate: string; pagesRead: number | null; pagesTotal: number | null; readiness: number | null; calibrated: number | null; phase: number | null; dot: string | null; primaryMode: string | null; createdBy: string }[];
  emails: { id: string; kind: string; createdAt: string; createdBy: string; body: string; checkpoint: { text: string; due: string } | null; lastResult: { status: string; text: string } | null }[];
  sits: { id: string; examType: string; date: string; outcome: string; score: number | null; predictedAtSit: number | null }[];
  notes: { id: string; body: string; createdBy: string; createdAt: string }[];
}

const MODE_TEXT: Record<string, string> = {
  "reading_stalled": "reading stalled", "comfort_quizzing": "comfort quizzing", "never_tested": "never tested",
  "bank_burnout": "bank burnout", "plateau_below_cut": "plateau below cut", "materials_unpaid": "materials unpaid",
  "dormant": "dormant", "binge_and_vanish": "binge and vanish", "result_missing": "result missing", "not_started": "not started",
};

const DOT_CLASS: Record<string, string> = { green: "bg-emerald-500", red: "bg-red-500", grey: "border-2 border-slate-300 bg-transparent" };

const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const emptySponsor = (): Sponsor => ({
  name: "",
  exam: "SIE",
  examDate: "",
  status: "",
  issues: "",
  actions: ["", "", "", ""],
  dmNeeds: "",
});

function getDays(startDay: string): string[] {
  const idx = ALL_DAYS.indexOf(startDay);
  return [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const modeText = (m: string | null | undefined) => (m ? MODE_TEXT[m] ?? m : null);

const STATUS_CHIP: Record<string, string> = {
  HIT: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PARTIAL: "bg-amber-100 text-amber-700 border-amber-200",
  MISSED: "bg-red-100 text-red-700 border-red-200",
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
};

function Dot({ dot, title }: { dot: string | null | undefined; title?: string }) {
  return <span title={title} className={`inline-block w-3 h-3 rounded-full shrink-0 ${DOT_CLASS[dot || "grey"] ?? DOT_CLASS.grey}`} />;
}

/** The computed read on a sponsor — team view (shows calibrated readiness; sponsors never see it). */
function DiagnosisPanel({ d }: { d: Diagnosis }) {
  const p = d.pace;
  const r = d.readiness;
  return (
    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/40 p-5 mb-5">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Dot dot={d.dot} title={d.dotReason} />
        <span className="font-bold text-slate-800">Phase {d.phase} — {d.phaseName}</span>
        <span className="text-xs text-slate-500">{d.dotReason}</span>
        {d.goNoGo && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            Exam in {d.daysToExam} day{d.daysToExam === 1 ? "" : "s"} — go/no-go call needed today
          </span>
        )}
      </div>

      {d.failureModes.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {d.failureModes.map(m => (
            <span key={m} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${m === d.primaryMode ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-50 text-slate-600 border-slate-200"}`}>
              {m === d.primaryMode ? "Primary: " : ""}{m}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="rounded-xl bg-white border border-slate-100 p-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Reading</div>
          <div className="font-semibold text-slate-800">
            {p.pagesRead ?? "?"}/{p.pagesTotal ?? "?"} pages{p.percentComplete != null ? ` (${p.percentComplete}%)` : ""}
          </div>
          {p.requiredPagesPerDay != null && (
            <div className="text-slate-600 mt-1">Needs {p.requiredPagesPerDay} pages/day{p.requiredMinutesPerDay != null ? ` (~${p.requiredMinutesPerDay} min)` : ""}</div>
          )}
          {p.observedPagesPerDay != null && <div className="text-slate-600">Doing {p.observedPagesPerDay} pages/day</div>}
          <div className="text-slate-600">
            Book deadline {fmtDate(p.bookDeadline)} · projected {p.stalled ? <span className="text-red-600 font-semibold">stalled</span> : fmtDate(p.projectedFinish)}
          </div>
          <div className="text-slate-500 text-xs mt-1">
            Last 4 days: {d.last4AvgMin != null ? `${Math.round(d.last4AvgMin)} min/day` : "—"}{d.darkDays != null ? ` · ${d.darkDays} dark day${d.darkDays === 1 ? "" : "s"}` : ""}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-100 p-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Readiness (team only)</div>
          {d.neverTested ? (
            <div className="font-semibold text-amber-700">Never tested — no score published</div>
          ) : (
            <div className="font-semibold text-slate-800">
              {r.base != null ? `${Math.round(r.base)}` : "?"}{r.calibrated != null && r.calibrated !== r.base ? ` → ${Math.round(r.calibrated)} calibrated` : ""}
            </div>
          )}
          {r.calibrationReason && <div className="text-xs text-slate-500 mt-1">{r.calibrationReason}</div>}
          {(d.flags.rushing || d.flags.bankBurnout || d.flags.untimed > 0) && (
            <div className="flex flex-wrap gap-2 mt-2">
              {d.flags.untimed > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{d.flags.untimed} untimed full exam{d.flags.untimed === 1 ? "" : "s"} (not counted)</span>}
              {d.flags.rushing && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">Rushing{d.flags.speedRatio != null ? ` (${Math.round(d.flags.speedRatio * 100)}% of time used)` : ""}</span>}
              {d.flags.bankBurnout && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">Bank burnout{d.flags.bankExposure != null ? ` (${Math.round(d.flags.bankExposure * 100)}% seen)` : ""}</span>}
            </div>
          )}
          <div className="mt-2 text-xs">
            {d.goldStandard.met ? (
              <span className="text-emerald-700 font-semibold">Gold standard met</span>
            ) : (
              <>
                <span className="text-slate-500 font-semibold">Gold standard not met:</span>
                <ul className="list-disc ml-4 text-slate-500">{d.goldStandard.gaps.map(g => <li key={g}>{g}</li>)}</ul>
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-100 p-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Accountability</div>
          {d.lastCheckpoint ? (
            <div className="mb-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border mr-2 ${STATUS_CHIP[d.lastCheckpoint.status] ?? STATUS_CHIP.PENDING}`}>{d.lastCheckpoint.status}</span>
              <span className="text-slate-700">{d.lastCheckpoint.text}</span>
            </div>
          ) : (
            <div className="text-slate-500 mb-2">No earlier promise on record.</div>
          )}
          {d.streak >= 2 && <div className="text-xs font-bold text-red-700 mb-2">Missed {d.streak} in a row — DM should reach out directly.</div>}
          <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Next promise</div>
          <div className="text-slate-800">{d.nextCheckpoint.text}</div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [startDay, setStartDay] = useState("Monday");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  const [sponsors, setSponsors] = useState<Sponsor[]>([emptySponsor()]);

  const [parserName, setParserName] = useState("");
  const [parserExam, setParserExam] = useState(""); // "" = the course on the report, else what's on file
  const [notes, setNotes] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion | null>(null);
  const [suggestionChecks, setSuggestionChecks] = useState<SuggestionChecks>({ status: true, issues: true, actions: [[], [], [], []], dmNeeds: true });
  const [customActions, setCustomActions] = useState<string[]>(["", "", "", ""]);

  const [generatedEmail, setGeneratedEmail] = useState("");
  const [teamIsPrompt, setTeamIsPrompt] = useState(false);
  const [writer, setWriterState] = useState<Writer>("free");
  const [kaplanText, setKaplanText] = useState("");
  const [generatedSponsorEmails, setGeneratedSponsorEmails] = useState<{ name: string; email: string; checkpoint: string | null; isPrompt?: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSponsorEmails, setLoadingSponsorEmails] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSponsor, setCopiedSponsor] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [scoreEntries, setScoreEntries] = useState<ScoreEntry[]>([]);
  const [scoreForm, setScoreForm] = useState({ sponsor: "", platform: "Achievable", scoreType: "Simulated Exam", score: "", section: "", notes: "" });
  const [showScoreTracker, setShowScoreTracker] = useState(false);

  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [sponsorRecord, setSponsorRecord] = useState<{ id: string; name: string; matched: string; snapshotCount: number } | null>(null);
  const [sponsorList, setSponsorList] = useState<SponsorSummary[]>([]);
  const [sponsorQuery, setSponsorQuery] = useState("");
  const [parserSponsorId, setParserSponsorId] = useState("");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [sitForm, setSitForm] = useState({ examType: "SIE", date: "", outcome: "FAIL", score: "" });
  const [savingSit, setSavingSit] = useState(false);

  const signedIn = !!whoami?.user;

  /** A 401/403/503 from any data route means our session state is stale — re-check it. */
  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/whoami", { cache: "no-store" });
      setWhoami(await res.json());
    } catch {
      setWhoami({ user: null, error: "Couldn't reach the server.", status: 503, authConfigured: false, devBypass: false, memory: "memory" });
    }
  }, []);

  const loadSponsors = useCallback(async () => {
    const res = await fetch("/api/sponsors", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) return checkAuth();
    const data = await res.json();
    if (Array.isArray(data.sponsors)) setSponsorList(data.sponsors);
  }, [checkAuth]);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  // The writer choice is a per-browser convenience; default is the free built-in writer.
  useEffect(() => {
    try {
      const w = localStorage.getItem(WRITER_KEY);
      if (w === "free" || w === "claude-app" || w === "api") setWriterState(w);
    } catch { /* storage blocked: keep the default */ }
  }, []);
  const setWriter = (w: Writer) => {
    setWriterState(w);
    try { localStorage.setItem(WRITER_KEY, w); } catch { /* ignore */ }
  };
  const effectiveWriter: Writer = writer === "api" && whoami && !whoami.aiKey ? "free" : writer;
  useEffect(() => { if (signedIn) loadSponsors(); }, [signedIn, loadSponsors]);

  const openTimeline = async (id: string) => {
    setLoadingTimeline(true);
    try {
      const res = await fetch(`/api/sponsors/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setTimeline(data);
        setSitForm(f => ({ ...f, examType: data.sponsor.exam || "SIE" }));
      }
    } catch (e) {
      setError(`Failed to load sponsor: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
    setLoadingTimeline(false);
  };

  const recordSit = async () => {
    if (!timeline || !sitForm.date) return;
    setSavingSit(true);
    try {
      const res = await fetch(`/api/sponsors/${timeline.sponsor.id}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examType: sitForm.examType, date: sitForm.date, outcome: sitForm.outcome, score: sitForm.score }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setSitForm(f => ({ ...f, date: "", score: "" }));
        await openTimeline(timeline.sponsor.id);
        loadSponsors();
      }
    } catch (e) {
      setError(`Failed to record result: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
    setSavingSit(false);
  };

  /** Put a remembered sponsor into the action plan without re-uploading anything. */
  const loadIntoPlan = (s: { id: string; name: string; exam: string | null; examDate: string | null }) => {
    const sponsor: Sponsor = { ...emptySponsor(), sponsorId: s.id, name: s.name, exam: s.exam || "SIE", examDate: s.examDate || "" };
    setSponsors(prev => {
      if (prev.some(p => p.sponsorId === s.id)) return prev;
      const hasEmpty = prev.length === 1 && !prev[0].name.trim();
      return hasEmpty ? [sponsor] : [...prev, sponsor];
    });
  };

  const days = getDays(startDay);

  const updateSponsor = (index: number, field: keyof Sponsor, value: string | string[]) => {
    setSponsors(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const updateAction = (sponsorIndex: number, actionIndex: number, value: string) => {
    setSponsors(prev => prev.map((s, i) => {
      if (i !== sponsorIndex) return s;
      const newActions = [...s.actions];
      newActions[actionIndex] = value;
      return { ...s, actions: newActions };
    }));
  };

  const addSponsor = () => setSponsors(prev => [...prev, emptySponsor()]);

  const removeSponsor = (index: number) => {
    if (sponsors.length > 1) setSponsors(prev => prev.filter((_, i) => i !== index));
  };

  const MAX_FILE_SIZE = 30 * 1024 * 1024;

  const pdfToUploads = async (file: File): Promise<UploadedFile[]> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Achievable reports have a real text layer: send the text (exact numbers, ~6x cheaper
    // than page images) and read the WHOLE report, not just the first 40 pages.
    const texts: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 300); i++) texts.push(await pageText(await pdf.getPage(i)));
    const text = texts.join("\n");
    if (text.length > 300 && /Study report|Pages read|Achievable/i.test(text)) {
      return [{ name: file.name, type: "application/pdf", base64: "", text, pageCount: pdf.numPages }];
    }

    // Scans and other PDFs: render pages as small images for the vision pass.
    const results: UploadedFile[] = [];
    const maxPages = Math.min(pdf.numPages, 40);
    // Keep pages small: vision token cost scales with image area, so clamp the
    // long edge instead of rendering at a fixed high scale.
    const MAX_PAGE_EDGE_PX = 1100;
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_PAGE_EDGE_PX / Math.max(base.width, base.height), 1.5);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page.render({ canvasContext: ctx, viewport } as any)).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      const base64 = dataUrl.split(",")[1];
      results.push({ name: `${file.name} (page ${i})`, type: "image/jpeg", base64 });
    }
    if (pdf.numPages > 40) {
      setError(`PDF has ${pdf.numPages} pages — only first 40 were processed.`);
    }
    return results;
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files) return;
    const newFiles: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      if (file.type === "application/pdf") {
        try {
          newFiles.push(...(await pdfToUploads(file)));
        } catch (e) {
          setError(`Failed to process PDF "${file.name}": ${e instanceof Error ? e.message : "unknown error"}`);
        }
      } else if (file.type.startsWith("image/")) {
        if (file.size > MAX_FILE_SIZE) {
          setError(`File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 30MB per file.`);
          continue;
        }
        const base64 = await fileToBase64(file);
        newFiles.push({ name: file.name, type: file.type, base64, preview: URL.createObjectURL(file) });
      }
    }
    setUploadedFiles(prev => [...prev, ...newFiles]);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index: number) => setUploadedFiles(prev => prev.filter((_, i) => i !== index));

  const addScoreEntry = () => {
    if (!scoreForm.sponsor.trim() || !scoreForm.score) return;
    const entry: ScoreEntry = {
      id: Date.now().toString(),
      sponsor: scoreForm.sponsor,
      platform: scoreForm.platform,
      scoreType: scoreForm.scoreType,
      score: Number(scoreForm.score),
      section: scoreForm.section,
      notes: scoreForm.notes,
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
    setScoreEntries(prev => [entry, ...prev]);
    setScoreForm(f => ({ ...f, score: "", section: "", notes: "" }));
  };

  const removeScoreEntry = (id: string) => setScoreEntries(prev => prev.filter(e => e.id !== id));

  const parseNotes = async () => {
    if (!parserName.trim() && !notes.trim() && uploadedFiles.length === 0 && scoreEntries.length === 0) return;
    const reports = uploadedFiles.filter(f => f.text);
    if (reports.length > 1) {
      setError("Upload one Achievable report at a time — each report is one sponsor on one day. Remove the extra PDFs and run it again.");
      return;
    }
    setParsing(true);
    setError("");
    try {
      const images = uploadedFiles.filter(f => !f.text).map(f => ({ base64: f.base64, mediaType: f.type }));
      const reportText = reports[0]?.text ?? "";
      const res = await fetch("/api/parse-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, startDay, sponsorName: parserName, exam: parserExam || undefined, writer: effectiveWriter, kaplanText: kaplanText || undefined, images, reportText, sponsorId: parserSponsorId || undefined, scoreEntries: scoreEntries.filter(s => !parserName.trim() || s.sponsor.toLowerCase().includes(parserName.toLowerCase())) }),
      });
      if (res.status === 401 || res.status === 403) { await checkAuth(); setParsing(false); return; }
      const data = await res.json();
      if (data.error) { setError(data.error); setParsing(false); return; }
      setDiagnosis(data.diagnosis ?? null);
      setSponsorRecord(data.sponsorRecord ?? null);
      if (data.sponsorRecord) loadSponsors();
      if (data.aiError) setError(effectiveWriter === "api"
        ? `The Claude API step failed (${data.aiError}). The report was saved and the free writer drafted the plan instead.`
        : data.aiError);
      if (data.sponsors?.length > 0) {
        const s = data.sponsors[0];
        let normalizedActions: string[][] = [[], [], [], []];
        if (s.actions?.length === 4) {
          normalizedActions = s.actions.map((a: string | string[]) => Array.isArray(a) ? a : [a]);
        }
        setAiSuggestions({
          sponsorId: s.sponsorId ?? data.sponsorRecord?.id ?? null,
          name: s.name || parserName, exam: s.exam || parserExam || "SIE",
          examDate: s.examDate || "",
          achievableTargetDate: s.achievableTargetDate || "",
          pagesRead: s.pagesRead ?? null,
          pagesTotal: s.pagesTotal ?? null,
          readingTimeLeft: s.readingTimeLeft || "",
          readingTimeHours: s.readingTimeHours ?? null,
          quizTimeHours: s.quizTimeHours ?? null,
          currentChapter: s.currentChapter || "",
          achievableStatus: s.achievableStatus || "",
          status: s.status || "", issues: s.issues || "",
          actions: normalizedActions, dmNeeds: s.dmNeeds || "",
        });
        setSuggestionChecks({
          status: true, issues: true, dmNeeds: true,
          actions: normalizedActions.map(dayTasks => dayTasks.map(() => true)),
        });
        setCustomActions(["", "", "", ""]);

        if (s.extractedScores?.length > 0) {
          const newScores: ScoreEntry[] = s.extractedScores.map((es: { platform: string; scoreType: string; score: number; section: string; notes: string }, i: number) => ({
            id: `${Date.now()}-${i}`,
            sponsor: s.name || parserName,
            platform: es.platform || "Achievable",
            scoreType: es.scoreType || "Simulated Exam",
            score: es.score,
            section: es.section || "",
            notes: es.notes || "",
            date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          }));
          setScoreEntries(prev => [...newScores, ...prev]);
          setShowScoreTracker(true);
        }
      } else {
        setError("AI could not extract sponsor data. Try adding more detail.");
      }
    } catch (e) {
      setError(`Failed to connect: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
    setParsing(false);
  };

  const updateSuggestionTask = (dayIndex: number, taskIndex: number, value: string) => {
    setAiSuggestions(prev => {
      if (!prev) return prev;
      const newActions = prev.actions.map((dayTasks, d) =>
        d === dayIndex ? dayTasks.map((t, j) => j === taskIndex ? value : t) : dayTasks
      );
      return { ...prev, actions: newActions };
    });
  };

  const removeSuggestionTask = (dayIndex: number, taskIndex: number) => {
    setAiSuggestions(prev => {
      if (!prev) return prev;
      const newActions = prev.actions.map((dayTasks, d) =>
        d === dayIndex ? dayTasks.filter((_, j) => j !== taskIndex) : dayTasks
      );
      return { ...prev, actions: newActions };
    });
    setSuggestionChecks(prev => {
      const newChecks = prev.actions.map((dayChecks, d) =>
        d === dayIndex ? dayChecks.filter((_, j) => j !== taskIndex) : dayChecks
      );
      return { ...prev, actions: newChecks };
    });
  };

  const addSuggestionTask = (dayIndex: number) => {
    const val = customActions[dayIndex]?.trim();
    if (!val) return;
    setAiSuggestions(prev => {
      if (!prev) return prev;
      const newActions = prev.actions.map((dayTasks, d) =>
        d === dayIndex ? [...dayTasks, val] : dayTasks
      );
      return { ...prev, actions: newActions };
    });
    setSuggestionChecks(prev => {
      const newChecks = prev.actions.map((dayChecks, d) =>
        d === dayIndex ? [...dayChecks, true] : dayChecks
      );
      return { ...prev, actions: newChecks };
    });
    const newCustom = [...customActions];
    newCustom[dayIndex] = "";
    setCustomActions(newCustom);
  };

  const addFromSuggestions = () => {
    if (!aiSuggestions) return;
    // The panel is where the team confirms the test date — save it so emails and grading use it
    // (in the background; the email routes sync the card again anyway).
    const id = aiSuggestions.sponsorId;
    if (id) {
      fetch(`/api/sponsors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exam: aiSuggestions.exam || undefined, ...(aiSuggestions.examDate ? { examDate: aiSuggestions.examDate } : {}) }),
      }).then(() => {
        loadSponsors();
        if (timeline?.sponsor.id === id) openTimeline(id);
      }).catch(() => {});
    }
    const sponsor: Sponsor = {
      sponsorId: aiSuggestions.sponsorId ?? null,
      name: aiSuggestions.name, exam: aiSuggestions.exam,
      examDate: aiSuggestions.examDate || "",
      pagesRead: aiSuggestions.pagesRead ?? null,
      pagesTotal: aiSuggestions.pagesTotal ?? null,
      readingTimeLeft: aiSuggestions.readingTimeLeft || "",
      readingTimeHours: aiSuggestions.readingTimeHours ?? null,
      quizTimeHours: aiSuggestions.quizTimeHours ?? null,
      currentChapter: aiSuggestions.currentChapter || "",
      achievableStatus: aiSuggestions.achievableStatus || "",
      status: suggestionChecks.status ? aiSuggestions.status : "",
      issues: suggestionChecks.issues ? aiSuggestions.issues : "",
      actions: aiSuggestions.actions.map((dayTasks, i) => {
        return dayTasks.filter((_, j) => suggestionChecks.actions[i]?.[j]).join("; ");
      }),
      dmNeeds: suggestionChecks.dmNeeds ? aiSuggestions.dmNeeds : "",
    };
    setSponsors(prev => {
      // Re-parsing a sponsor already in the plan replaces their card instead of duplicating it.
      if (sponsor.sponsorId && prev.some(p => p.sponsorId === sponsor.sponsorId)) {
        return prev.map(p => (p.sponsorId === sponsor.sponsorId ? sponsor : p));
      }
      const hasEmpty = prev.length === 1 && !prev[0].name.trim();
      return hasEmpty ? [sponsor] : [...prev, sponsor];
    });
    setAiSuggestions(null);
    setDiagnosis(null);
    setSponsorRecord(null);
    setParserName(""); setParserExam(""); setNotes(""); setUploadedFiles([]); setParserSponsorId(""); setKaplanText("");
  };

  const discardSuggestions = () => {
    setAiSuggestions(null); setDiagnosis(null); setSponsorRecord(null); setCustomActions(["", "", "", ""]);
    // A discarded upload must not ride along with the next one, or keep pointing at a sponsor.
    setUploadedFiles([]); setParserSponsorId("");
  };

  const generateEmail = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDay, date, sponsors, scoreEntries, writer: effectiveWriter }),
      });
      if (res.status === 401 || res.status === 403) { await checkAuth(); setLoading(false); return; }
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setGeneratedEmail(data.prompt ?? data.email); setTeamIsPrompt(!!data.prompt); }
    } catch (e) {
      setError(`Failed to generate email: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
    setLoading(false);
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(generatedEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateSponsorEmails = async () => {
    const namedSponsors = sponsors.filter(s => s.name.trim());
    if (namedSponsors.length === 0) return;
    setLoadingSponsorEmails(true); setError("");
    try {
      const results: { name: string; email: string; checkpoint: string | null; isPrompt?: boolean }[] = [];
      const problems: string[] = [];
      for (const sponsor of namedSponsors) {
        const res = await fetch("/api/generate-sponsor-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDay, date, sponsor, writer: effectiveWriter }),
        });
        if (res.status === 401 || res.status === 403) { await checkAuth(); break; }
        const data = await res.json();
        if (data.error) { problems.push(data.error); if (res.status !== 409) break; continue; }
        results.push({ name: sponsor.name, email: data.prompt ?? data.email, checkpoint: data.checkpoint?.text ?? null, isPrompt: !!data.prompt });
      }
      setGeneratedSponsorEmails(results);
      if (problems.length) setError(problems.join(" "));
      loadSponsors();
      if (timeline && namedSponsors.some(s => s.sponsorId === timeline.sponsor.id)) openTimeline(timeline.sponsor.id);
    } catch (e) {
      setError(`Failed to generate sponsor emails: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
    setLoadingSponsorEmails(false);
  };

  const copySponsorEmail = (index: number) => {
    navigator.clipboard.writeText(generatedSponsorEmails[index].email);
    setCopiedSponsor(index);
    setTimeout(() => setCopiedSponsor(null), 2000);
  };

  const namedSponsorCount = sponsors.filter(s => s.name.trim()).length;

  const q = sponsorQuery.trim().toLowerCase();
  const DOT_RANK: Record<string, number> = { red: 0, grey: 1, green: 2 };
  const visibleSponsors = (q ? sponsorList.filter(s => s.name.toLowerCase().includes(q)) : sponsorList)
    .slice()
    .sort((a, b) => (DOT_RANK[a.dot ?? "grey"] ?? 1) - (DOT_RANK[b.dot ?? "grey"] ?? 1)
      || (a.examDate ?? "9999").localeCompare(b.examDate ?? "9999"));

  if (!whoami) {
    return <div className="min-h-screen flex items-center justify-center"><span className="loading-dots"><span /><span /><span /></span></div>;
  }

  if (!whoami.user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass-card rounded-2xl shadow-xl p-10 max-w-md w-full text-center animate-fade-in">
          <div className="w-12 h-12 rounded-xl header-gradient text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">F</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">FGA Sponsor Coach</h1>
          {whoami.status === 401 ? (
            <>
              <p className="text-sm text-slate-500 mb-6">Sign in with your Financial Gym Microsoft account. Sponsor records are only visible to the team.</p>
              <button onClick={() => signIn("azure-ad")}
                className="bg-gradient-to-r from-indigo-600 to-indigo-500 text-white px-7 py-3 rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-indigo-600 transition-all shadow-md btn-press">
                Sign in with Microsoft
              </button>
            </>
          ) : whoami.status === 403 ? (
            <>
              <p className="text-sm text-red-600 mb-6">{whoami.error} Ask Nick to add your email.</p>
              <button onClick={() => signOut()} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">Sign in with a different account</button>
            </>
          ) : (
            <p className="text-sm text-amber-700">{whoami.error || "Sign-in isn't available right now."}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 sm:px-6 lg:px-8">

      {/* Header */}
      <div className="header-gradient text-white rounded-2xl p-10 mb-10 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-lg font-bold">F</div>
              <h1 className="text-3xl font-bold tracking-tight">FGA Sponsor Coach</h1>
            </div>
            <p className="text-indigo-200 text-lg font-light">Every email grades the last promise and sets the next one</p>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-indigo-300 uppercase tracking-wider font-medium">Sponsors Loaded</div>
              <div className="text-2xl font-bold">{namedSponsorCount}</div>
            </div>
            <div className="w-px h-10 bg-white/20" />
            <div className="text-right">
              <div className="text-xs text-indigo-300 uppercase tracking-wider font-medium">Date</div>
              <div className="text-sm font-medium">{date}</div>
            </div>
            <div className="w-px h-10 bg-white/20" />
            <div className="text-right">
              <div className="text-xs text-indigo-300 uppercase tracking-wider font-medium">{whoami.devBypass ? "Dev mode" : "Signed in"}</div>
              <div className="text-sm font-medium">{whoami.user.name || whoami.user.email}</div>
              {!whoami.devBypass && <button onClick={() => signOut()} className="text-xs text-indigo-200 hover:text-white underline">Sign out</button>}
            </div>
          </div>
        </div>
      </div>

      {/* Settings Row */}
      <div className="glass-card rounded-2xl shadow-lg p-6 mb-8 animate-fade-in">
        <div className="flex flex-wrap gap-6 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Start Day</label>
            <select value={startDay} onChange={e => setStartDay(e.target.value)}
              className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all">
              {ALL_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Date</label>
            <input type="text" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Email Writer</label>
            <select value={effectiveWriter} onChange={e => setWriter(e.target.value as Writer)} aria-label="Email writer"
              className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all">
              <option value="free">Free — built-in writer</option>
              <option value="claude-app">Free — copy to Claude app</option>
              <option value="api" disabled={!whoami?.aiKey}>Claude API (uses credits){whoami?.aiKey ? "" : " — no key set"}</option>
            </select>
          </div>
          <div className="flex-1 min-w-[250px]">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl px-4 py-3 border border-indigo-100">
              <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">Plan Days</span>
              <p className="text-sm font-semibold text-slate-700 mt-0.5">
                {days[0]} <span className="text-indigo-300">&rarr;</span> {days[1]} <span className="text-indigo-300">&rarr;</span> {days[2]} <span className="text-indigo-300">&rarr;</span> {days[3]}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 mb-8 text-sm flex items-start justify-between animate-slide-in shadow-sm">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-600 ml-4 shrink-0 text-lg leading-none">&times;</button>
        </div>
      )}

      {whoami.memory === "memory" && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 mb-8 text-sm shadow-sm">
          <strong>Memory isn&apos;t connected.</strong> No database is set (DATABASE_URL), so sponsors are only remembered until the server restarts — promises can&apos;t be graded across weeks. Connect Neon Postgres in Vercel → Storage.
        </div>
      )}

      {/* Section Label: Sponsor Memory */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7zm4 4h8m-8 4h5" /></svg>
        </div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sponsor Memory</h2>
        <span className="text-xs text-slate-400">{sponsorList.length} remembered · red first, then soonest exam</span>
      </div>

      <div className="glass-card rounded-2xl shadow-lg p-6 mb-8 animate-fade-in">
        {sponsorList.length === 0 ? (
          <p className="text-sm text-slate-500">No sponsors yet. Upload an Achievable study report below and the sponsor is remembered from then on — the next upload grades the promise from the last email.</p>
        ) : (
          <>
            <input type="text" value={sponsorQuery} onChange={e => setSponsorQuery(e.target.value)} placeholder="Search sponsors..."
              className="w-full border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm bg-slate-50/80 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
            <div className="max-h-80 overflow-y-auto overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wider">
                    <th className="py-2 pr-3"></th><th className="py-2 pr-3">Sponsor</th><th className="py-2 pr-3">Exam</th><th className="py-2 pr-3">Test date</th>
                    <th className="py-2 pr-3">Book</th><th className="py-2 pr-3">Phase</th><th className="py-2 pr-3">Failure mode</th><th className="py-2 pr-3">Last report</th><th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSponsors.map(s => (
                    <tr key={s.id} className={`border-t border-slate-100 ${timeline?.sponsor.id === s.id ? "bg-indigo-50/60" : ""}`}>
                      <td className="py-2 pr-3"><Dot dot={s.dot} /></td>
                      <td className="py-2 pr-3 font-semibold text-slate-800 whitespace-nowrap">{s.name}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.exam || "—"}</td>
                      <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{fmtDate(s.examDate)}</td>
                      <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{s.pagesRead != null ? `${s.pagesRead}/${s.pagesTotal ?? "?"}` : "—"}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.phase ?? "—"}</td>
                      <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{modeText(s.primaryMode) || "—"}</td>
                      <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{fmtDate(s.lastReportDate)} · {s.snapshotCount} upload{s.snapshotCount === 1 ? "" : "s"}</td>
                      <td className="py-2 whitespace-nowrap text-right">
                        <button onClick={() => openTimeline(s.id)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 mr-3">Timeline</button>
                        <button onClick={() => loadIntoPlan(s)} className="text-xs font-semibold text-emerald-600 hover:text-emerald-800">Add to plan</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Sponsor Timeline */}
      {(timeline || loadingTimeline) && (
        <div className="glass-card rounded-2xl border-2 border-emerald-200/60 shadow-xl p-6 mb-8 animate-slide-in">
          {loadingTimeline && !timeline ? (
            <span className="loading-dots"><span /><span /><span /></span>
          ) : timeline && (
            <>
              <div className="flex flex-wrap justify-between items-start gap-3 mb-5">
                <div>
                  <h2 className="font-bold text-emerald-700 text-lg">{timeline.sponsor.name}</h2>
                  <p className="text-sm text-slate-500">{timeline.sponsor.exam || "Exam ?"} · test {fmtDate(timeline.sponsor.examDate)} · {timeline.snapshots.length} report{timeline.snapshots.length === 1 ? "" : "s"} · {timeline.emails.length} email{timeline.emails.length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex gap-4">
                  <button onClick={() => loadIntoPlan(timeline.sponsor)} className="text-sm font-semibold text-emerald-600 hover:text-emerald-800">Add to plan</button>
                  <button onClick={() => { setParserSponsorId(timeline.sponsor.id); setParserName(timeline.sponsor.name); setParserExam(""); }}
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">Upload new report</button>
                  <button onClick={() => setTimeline(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
                </div>
              </div>

              {timeline.diagnosis && <DiagnosisPanel d={timeline.diagnosis} />}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Reports</h3>
                  {timeline.snapshots.length === 0 ? <p className="text-sm text-slate-400">None yet.</p> : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-[11px] text-slate-400 uppercase tracking-wider"><th className="py-1 pr-2"></th><th className="py-1 pr-2">Date</th><th className="py-1 pr-2">Book</th><th className="py-1 pr-2">Achievable</th><th className="py-1 pr-2">Calibrated</th><th className="py-1">Mode</th></tr></thead>
                      <tbody>
                        {timeline.snapshots.map(sn => (
                          <tr key={sn.id} className="border-t border-slate-100">
                            <td className="py-1.5 pr-2"><Dot dot={sn.dot} /></td>
                            <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDate(sn.reportDate)}</td>
                            <td className="py-1.5 pr-2">{sn.pagesRead ?? "?"}/{sn.pagesTotal ?? "?"}</td>
                            <td className="py-1.5 pr-2">{sn.readiness != null ? `${Math.round(sn.readiness)}%` : "—"}</td>
                            <td className="py-1.5 pr-2">{sn.calibrated != null ? Math.round(sn.calibrated) : "—"}</td>
                            <td className="py-1.5 text-slate-500">{modeText(sn.primaryMode) || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-6 mb-2">Real exam results</h3>
                  {timeline.sits.length === 0 ? <p className="text-sm text-slate-400 mb-3">None recorded.</p> : (
                    <ul className="text-sm mb-3 space-y-1">
                      {timeline.sits.map(st => (
                        <li key={st.id}>
                          <span className={`font-bold ${st.outcome === "PASS" ? "text-emerald-700" : st.outcome === "FAIL" ? "text-red-700" : "text-slate-500"}`}>{st.outcome}</span>{" "}
                          {st.examType} on {fmtDate(st.date)}{st.score != null ? ` — ${st.score}%` : ""}
                          {st.predictedAtSit != null && <span className="text-slate-400"> (we had them at {Math.round(st.predictedAtSit)})</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-end gap-2 bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                    <select value={sitForm.examType} onChange={e => setSitForm(f => ({ ...f, examType: e.target.value }))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                      {["SIE", "63", "65", "66", "7", "LAH", "VA"].map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                    <input type="date" value={sitForm.date} onChange={e => setSitForm(f => ({ ...f, date: e.target.value }))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white" />
                    <select value={sitForm.outcome} onChange={e => setSitForm(f => ({ ...f, outcome: e.target.value }))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                      <option value="PASS">PASS</option><option value="FAIL">FAIL</option><option value="PENDING">PENDING</option>
                    </select>
                    <input type="number" min={0} max={100} value={sitForm.score} onChange={e => setSitForm(f => ({ ...f, score: e.target.value }))} placeholder="Score %" className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white w-24" />
                    <button onClick={recordSit} disabled={savingSit || !sitForm.date}
                      className="bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-all">
                      {savingSit ? "Saving..." : "Record real exam result"}
                    </button>
                    <p className="text-[11px] text-slate-400 w-full">A FAIL after strong practice scores discounts this sponsor&apos;s future practice scores.</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Emails &amp; promises</h3>
                  {timeline.emails.length === 0 ? <p className="text-sm text-slate-400">No emails yet.</p> : (
                    <ul className="space-y-3">
                      {timeline.emails.map(em => (
                        <li key={em.id} className="text-sm border border-slate-100 rounded-xl p-3 bg-white">
                          <div className="text-xs text-slate-400 mb-1">{fmtDate(em.createdAt)} · {em.kind} email · {em.createdBy}</div>
                          {em.lastResult && (
                            <div className="mb-1">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border mr-2 ${STATUS_CHIP[em.lastResult.status] ?? STATUS_CHIP.PENDING}`}>{em.lastResult.status}</span>
                              <span className="text-slate-600">{em.lastResult.text}</span>
                            </div>
                          )}
                          {em.checkpoint && <div className="text-slate-800"><span className="text-xs font-semibold text-slate-400">Promise: </span>{em.checkpoint.text}</div>}
                          <details className="mt-1">
                            <summary className="text-xs text-indigo-600 cursor-pointer">Show email</summary>
                            <pre className="whitespace-pre-wrap text-xs text-slate-700 mt-2 font-sans">{em.body}</pre>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}

                  {timeline.notes.length > 0 && (
                    <>
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-6 mb-2">Tracker notes</h3>
                      <ul className="text-sm space-y-2">
                        {timeline.notes.map(n => (
                          <li key={n.id} className="text-slate-600 whitespace-pre-wrap"><span className="text-xs text-slate-400">{fmtDate(n.createdAt)} · {n.createdBy}: </span>{n.body}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Section Label: AI Parser */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
        </div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Report &amp; Notes</h2>
      </div>

      {/* AI Notes Parser */}
      <div className="glass-card rounded-2xl shadow-lg p-6 mb-8 gradient-border animate-fade-in">
        <p className="text-sm text-slate-500 mb-6">
          Enter sponsor info, paste notes, and/or upload study reports. AI will generate a full action plan.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sponsor Name</label>
            <input type="text" value={parserName} onChange={e => setParserName(e.target.value)}
              placeholder="e.g., John Smith"
              className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Current Exam</label>
            <select value={parserExam} onChange={e => setParserExam(e.target.value)} aria-label="Current exam"
              className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all">
              <option value="">From report / on file</option>
              <option value="SIE">SIE</option>
              <option value="63">Series 63</option>
              <option value="65">Series 65</option>
              <option value="LAH">LAH</option>
              <option value="VA">VA</option>
            </select>
          </div>
        </div>

        {sponsorList.length > 0 && (
          <div className="mb-5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Save To</label>
            <select value={parserSponsorId} onChange={e => setParserSponsorId(e.target.value)}
              className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all">
              <option value="">Auto-match (Achievable account, then name) — or new sponsor</option>
              {sponsorList.map(s => <option key={s.id} value={s.id}>{s.name}{s.exam ? ` — ${s.exam}` : ""}</option>)}
            </select>
          </div>
        )}

        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Notes from Tracker</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Paste the notes column from the tracker here..."
            className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 h-28 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all" />
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Kaplan Numbers (optional)</label>
          <textarea value={kaplanText} onChange={e => setKaplanText(e.target.value)}
            placeholder={"Answered 810 of 1000\nSim 1 74% 9/20 100/112 min\nSim 2 68% 9/22 105/112 min"}
            className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 h-20 resize-y font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all" />
          <p className="text-[11px] text-slate-400 mt-1">Only this sponsor&apos;s sims (Kaplan logins are shared). One per line: name, score %, date, minutes used/allowed.{effectiveWriter !== "api" ? " The free writers can't read screenshots, so type them here." : ""}</p>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Upload Study Reports</label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("drag-active"); }}
            onDragLeave={e => { e.currentTarget.classList.remove("drag-active"); }}
            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("drag-active"); handleFileUpload(e.dataTransfer.files); }}
            className="border-2 border-dashed border-slate-300/70 rounded-2xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all duration-300">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            </div>
            <p className="text-sm text-slate-600 font-medium">Click or drag files here</p>
            <p className="text-xs text-slate-400 mt-1">Achievable PDFs are read from their text (whole report). Screenshots and scans: PNG, JPG, PDF up to 40 pages, 30MB per file</p>
          </div>
          <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf" onChange={e => handleFileUpload(e.target.files)} className="hidden" />
          {uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {uploadedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 bg-indigo-50 border border-indigo-200/60 rounded-xl px-3 py-2 text-sm shadow-sm">
                  {f.preview ? (
                    <img src={f.preview} alt={f.name} className="w-8 h-8 object-cover rounded-lg" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                    </div>
                  )}
                  <span className="text-slate-700 max-w-32 truncate text-xs font-medium">{f.name}</span>
                  {f.text && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">text · {f.pageCount} pages</span>}
                  <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-600 text-sm ml-1 transition-colors">&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={parseNotes}
          disabled={parsing || (!parserName.trim() && !notes.trim() && uploadedFiles.length === 0 && !kaplanText.trim())}
          className="bg-gradient-to-r from-indigo-600 to-indigo-500 text-white px-7 py-3 rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md btn-press">
          {parsing ? (
            <span className="flex items-center gap-3">
              <span className="loading-dots"><span /><span /><span /></span>
              Analyzing...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              {effectiveWriter === "api" ? "Get AI Suggestions" : "Build Plan"}
            </span>
          )}
        </button>
      </div>

      {/* AI Suggestions Review Panel */}
      {aiSuggestions && (
        <div className="glass-card rounded-2xl border-2 border-indigo-200/60 shadow-xl p-6 mb-8 animate-slide-in">
          <div className="flex justify-between items-center mb-5">
            <div>
              <h2 className="font-bold text-indigo-700 text-lg flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                AI Suggestions
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">{aiSuggestions.name} — {aiSuggestions.exam}</p>
            </div>
            <button onClick={discardSuggestions} className="text-red-500 text-sm font-medium hover:text-red-700 transition-colors flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Discard
            </button>
          </div>
          {sponsorRecord && (
            <p className="text-sm mb-4 text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              {sponsorRecord.matched === "existing"
                ? <>Saved to <strong>{sponsorRecord.name}</strong> — {sponsorRecord.snapshotCount} report{sponsorRecord.snapshotCount === 1 ? "" : "s"} on file.</>
                : <>New sponsor <strong>{sponsorRecord.name}</strong> saved to memory.</>}
              {" "}Wrong person? Pick them under &quot;Save To&quot; and re-run.
            </p>
          )}
          {diagnosis && <DiagnosisPanel d={diagnosis} />}
          <p className="text-xs text-slate-400 mb-5 bg-slate-50/80 rounded-lg px-3 py-2">Edit text directly, check/uncheck to include, add your own tasks. Click &quot;Add to Action Plan&quot; when done.</p>

          {/* Exam Date */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Exam Date</span>
            <input type="date" value={aiSuggestions.examDate}
              onChange={e => setAiSuggestions(prev => prev ? { ...prev, examDate: e.target.value } : prev)}
              className="border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
            <span className="text-xs text-slate-400">{aiSuggestions.examDate ? "Used for the book deadline and grading. Saved to memory when you add the plan." : "Add the test date so the plan can set a book deadline."}</span>
            {aiSuggestions.achievableTargetDate && aiSuggestions.examDate && aiSuggestions.achievableTargetDate !== aiSuggestions.examDate && (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                This report&apos;s Achievable target date is {fmtDate(aiSuggestions.achievableTargetDate)}, but {fmtDate(aiSuggestions.examDate)} is on file.{" "}
                <button onClick={() => setAiSuggestions(prev => prev ? { ...prev, examDate: prev.achievableTargetDate || prev.examDate } : prev)} className="font-semibold underline">Use {fmtDate(aiSuggestions.achievableTargetDate)}</button>
              </span>
            )}
          </div>

          {/* Status */}
          <div className={`mb-5 p-5 rounded-2xl border transition-all duration-300 ${suggestionChecks.status ? "bg-indigo-50/40 border-indigo-200/60 shadow-sm" : "bg-slate-50/50 border-slate-200/40 opacity-60"}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={suggestionChecks.status}
                onChange={e => setSuggestionChecks(prev => ({ ...prev, status: e.target.checked }))}
                className="mt-1 w-4 h-4 rounded" />
              <div className="flex-1">
                <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Status / Scores</span>
                <textarea value={aiSuggestions.status}
                  onChange={e => setAiSuggestions(prev => prev ? { ...prev, status: e.target.value } : prev)}
                  className="w-full mt-2 text-sm text-slate-700 bg-white/80 border border-slate-200/60 rounded-xl px-4 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  rows={4} />
              </div>
            </div>
          </div>

          {/* Issues */}
          <div className={`mb-5 p-5 rounded-2xl border transition-all duration-300 ${suggestionChecks.issues ? "bg-indigo-50/40 border-indigo-200/60 shadow-sm" : "bg-slate-50/50 border-slate-200/40 opacity-60"}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={suggestionChecks.issues}
                onChange={e => setSuggestionChecks(prev => ({ ...prev, issues: e.target.checked }))}
                className="mt-1 w-4 h-4 rounded" />
              <div className="flex-1">
                <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Key Issues</span>
                <textarea value={aiSuggestions.issues}
                  onChange={e => setAiSuggestions(prev => prev ? { ...prev, issues: e.target.value } : prev)}
                  className="w-full mt-2 text-sm text-slate-700 bg-white/80 border border-slate-200/60 rounded-xl px-4 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  rows={4} />
              </div>
            </div>
          </div>

          {/* Daily Actions */}
          <div className="mb-5">
            <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider block mb-4">Daily Action Plan</span>
            {days.map((day, di) => (
              <div key={di} className="rounded-2xl border border-slate-200/60 mb-4 overflow-hidden shadow-sm">
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-5 py-3 flex items-center justify-between">
                  <span className="text-sm font-bold">{day}</span>
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">
                    {aiSuggestions.actions[di]?.filter((_, j) => suggestionChecks.actions[di]?.[j]).length || 0} tasks
                  </span>
                </div>
                <div className="p-4 space-y-3">
                  {aiSuggestions.actions[di]?.map((task, ti) => (
                    <div key={ti} className={`flex items-start gap-3 p-3 rounded-xl transition-all duration-300 ${suggestionChecks.actions[di]?.[ti] ? "bg-white shadow-sm border border-slate-100" : "bg-slate-50/50 opacity-50"}`}>
                      <input type="checkbox" checked={suggestionChecks.actions[di]?.[ti] ?? true}
                        onChange={e => {
                          const newActions = suggestionChecks.actions.map((dayChecks, d) =>
                            d === di ? dayChecks.map((c, t) => t === ti ? e.target.checked : c) : [...dayChecks]
                          );
                          setSuggestionChecks(prev => ({ ...prev, actions: newActions }));
                        }}
                        className="mt-2 w-4 h-4 shrink-0 rounded" />
                      <textarea value={task} rows={4}
                        onChange={e => updateSuggestionTask(di, ti, e.target.value)}
                        className={`flex-1 text-sm border border-slate-200/60 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y transition-all ${suggestionChecks.actions[di]?.[ti] ? "text-slate-800 bg-slate-50/50" : "text-slate-400 line-through bg-slate-50/30"}`} />
                      <button onClick={() => removeSuggestionTask(di, ti)}
                        className="text-red-300 hover:text-red-500 text-lg leading-none shrink-0 mt-2 transition-colors">&times;</button>
                    </div>
                  ))}
                  {(!aiSuggestions.actions[di] || aiSuggestions.actions[di].length === 0) && (
                    <p className="text-xs text-slate-400 italic px-3 py-2">No suggestions for this day</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <input type="text" value={customActions[di]}
                      onChange={e => { const c = [...customActions]; c[di] = e.target.value; setCustomActions(c); }}
                      onKeyDown={e => { if (e.key === "Enter") addSuggestionTask(di); }}
                      placeholder={`+ Add task for ${day}...`}
                      className="flex-1 border border-dashed border-slate-300/60 rounded-xl px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none transition-all" />
                    <button onClick={() => addSuggestionTask(di)}
                      className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white text-sm font-medium rounded-xl hover:from-indigo-700 hover:to-indigo-600 transition-all shrink-0 btn-press">+ Add</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* DM Needs */}
          <div className={`mb-6 p-5 rounded-2xl border transition-all duration-300 ${suggestionChecks.dmNeeds ? "bg-indigo-50/40 border-indigo-200/60 shadow-sm" : "bg-slate-50/50 border-slate-200/40 opacity-60"}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={suggestionChecks.dmNeeds}
                onChange={e => setSuggestionChecks(prev => ({ ...prev, dmNeeds: e.target.checked }))}
                className="mt-1 w-4 h-4 rounded" />
              <div className="flex-1">
                <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">What I Need from DM</span>
                <textarea value={aiSuggestions.dmNeeds}
                  onChange={e => setAiSuggestions(prev => prev ? { ...prev, dmNeeds: e.target.value } : prev)}
                  className="w-full mt-2 text-sm text-slate-700 bg-white/80 border border-slate-200/60 rounded-xl px-4 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  rows={4} />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={addFromSuggestions}
              className="bg-gradient-to-r from-emerald-600 to-emerald-500 text-white px-7 py-3 rounded-xl text-sm font-bold hover:from-emerald-700 hover:to-emerald-600 transition-all shadow-md btn-press flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Add to Action Plan
            </button>
            <button onClick={discardSuggestions}
              className="bg-slate-100 text-slate-600 px-6 py-3 rounded-xl text-sm font-medium hover:bg-slate-200 transition-all btn-press">
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Section Label: Score Tracker */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        </div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Score Tracker</h2>
      </div>

      {/* Quick Score Tracker */}
      <div className="glass-card rounded-2xl shadow-lg mb-8 overflow-hidden animate-fade-in">
        <button onClick={() => setShowScoreTracker(!showScoreTracker)}
          className="w-full flex justify-between items-center px-6 py-4 bg-gradient-to-r from-amber-600 to-orange-500 text-white hover:from-amber-700 hover:to-orange-600 transition-all">
          <h2 className="font-bold flex items-center gap-2">
            Quick Score Tracker
          </h2>
          <span className="text-sm flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full">
            {showScoreTracker ? "Hide" : `Show${scoreEntries.length > 0 ? ` (${scoreEntries.length})` : ""}`}
            <svg className={`w-4 h-4 transition-transform duration-300 ${showScoreTracker ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </span>
        </button>
        {showScoreTracker && (
          <div className="p-6 animate-fade-in">
            <p className="text-sm text-slate-500 mb-5">Log study scores from Kaplan/Achievable. The AI will use these to build smarter action plans.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
              <input type="text" value={scoreForm.sponsor}
                onChange={e => setScoreForm(f => ({ ...f, sponsor: e.target.value }))}
                placeholder="Sponsor name"
                className="border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all" />
              <select value={scoreForm.platform}
                onChange={e => setScoreForm(f => ({ ...f, platform: e.target.value }))}
                className="border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all">
                <option>Achievable</option>
                <option>Kaplan</option>
              </select>
              <select value={scoreForm.scoreType}
                onChange={e => setScoreForm(f => ({ ...f, scoreType: e.target.value }))}
                className="border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all">
                <option>Simulated Exam</option>
                <option>Q-bank</option>
                <option>Chapter Quiz</option>
                <option>Unit Quiz</option>
                <option>Certification</option>
              </select>
              <div className="flex items-center gap-2">
                <input type="number" value={scoreForm.score}
                  onChange={e => setScoreForm(f => ({ ...f, score: e.target.value }))}
                  placeholder="Score %"
                  min="0" max="100"
                  className="w-24 border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all" />
                <span className="text-slate-400 text-sm font-medium">%</span>
              </div>
              <input type="text" value={scoreForm.section}
                onChange={e => setScoreForm(f => ({ ...f, section: e.target.value }))}
                placeholder="Section (e.g., Options, Unit 5)"
                className="border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all" />
              <input type="text" value={scoreForm.notes}
                onChange={e => setScoreForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notes (e.g., rushing, weak on bonds)"
                className="border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all" />
            </div>
            <button onClick={addScoreEntry}
              disabled={!scoreForm.sponsor.trim() || !scoreForm.score}
              className="bg-gradient-to-r from-amber-600 to-orange-500 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:from-amber-700 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md btn-press mb-5">
              + Log Score
            </button>

            {scoreEntries.length > 0 && (
              <div className="border border-slate-200/60 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sponsor</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Platform</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Score</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Section</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                      <th className="px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoreEntries.map((entry, idx) => (
                      <tr key={entry.id} className={`border-t border-slate-100 hover:bg-indigo-50/30 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                        <td className="px-4 py-3 text-slate-600">{entry.date}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{entry.sponsor}</td>
                        <td className="px-4 py-3 text-slate-600">{entry.platform}</td>
                        <td className="px-4 py-3 text-slate-600">{entry.scoreType}</td>
                        <td className="px-4 py-3">
                          <span className={`score-pill ${entry.score >= 80 ? "bg-emerald-100 text-emerald-700" : entry.score >= 70 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                            {entry.score}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{entry.section || "—"}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{entry.notes || "—"}</td>
                        <td className="px-3 py-3">
                          <button onClick={() => removeScoreEntry(entry.id)} className="text-red-300 hover:text-red-500 transition-colors">&times;</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section Label: Sponsors */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
        </div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sponsors</h2>
      </div>

      {/* Sponsors */}
      <div className="space-y-6 mb-8">
        {sponsors.map((sponsor, si) => (
          <div key={si} className="glass-card rounded-2xl shadow-lg overflow-hidden animate-fade-in">
            <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-xs font-bold shadow-inner">
                  {si + 1}
                </div>
                <h2 className="font-bold text-lg">{sponsor.name ? sponsor.name : `Sponsor ${si + 1}`}</h2>
                {sponsor.sponsorId ? (
                  <button onClick={() => openTimeline(sponsor.sponsorId!)} className="text-[11px] font-semibold bg-emerald-400/20 text-emerald-200 border border-emerald-300/30 rounded-full px-2.5 py-0.5 hover:bg-emerald-400/30">In memory · timeline</button>
                ) : sponsor.name.trim() ? (
                  <span className="text-[11px] text-slate-300">Not in memory — upload a report to track promises</span>
                ) : null}
              </div>
              {sponsors.length > 1 && (
                <button onClick={() => removeSponsor(si)} className="text-red-300 text-sm hover:text-red-400 transition-colors flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Remove
                </button>
              )}
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sponsor Name</label>
                  <input type="text" value={sponsor.name}
                    onChange={e => updateSponsor(si, "name", e.target.value)}
                    placeholder="Full name"
                    className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Current Exam</label>
                  <select value={sponsor.exam}
                    onChange={e => updateSponsor(si, "exam", e.target.value)}
                    className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all">
                    <option value="SIE">SIE</option>
                    <option value="63">Series 63</option>
                    <option value="65">Series 65</option>
                    <option value="LAH">LAH</option>
                    <option value="VA">VA</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Exam Date</label>
                  <input type="date" value={sponsor.examDate}
                    onChange={e => updateSponsor(si, "examDate", e.target.value)}
                    className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all" />
                  <p className="text-[11px] text-slate-400 mt-1">Sets the &quot;book done 5&ndash;7 days before&quot; deadline.</p>
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Current Status / Scores</label>
                <textarea value={sponsor.status}
                  onChange={e => updateSponsor(si, "status", e.target.value)}
                  placeholder="Latest practice exam scores, % complete, progress..."
                  className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 h-32 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all border-l-4 border-l-indigo-200" />
              </div>

              <div className="mb-5">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Key Issues</label>
                <textarea value={sponsor.issues}
                  onChange={e => updateSponsor(si, "issues", e.target.value)}
                  placeholder="What's going wrong? Bad habits, not responsive, memorizing answers..."
                  className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 h-32 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all border-l-4 border-l-amber-200" />
              </div>

              <div className="mb-5">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Daily Action Plan</label>
                {days.map((day, di) => {
                  const tasks = sponsor.actions[di] ? sponsor.actions[di].split("; ").filter(t => t.trim()) : [];
                  return (
                    <div key={di} className="rounded-2xl border border-slate-200/60 mb-4 overflow-hidden shadow-sm">
                      <div className="bg-gradient-to-r from-slate-100 to-slate-50 px-5 py-3 border-b border-slate-200/60">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-slate-700">{day}</span>
                          <span className="text-xs text-slate-400 font-medium">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
                        </div>
                      </div>
                      <div className="p-4">
                        {tasks.length > 0 ? tasks.map((task, ti) => (
                          <div key={ti} className="flex items-start gap-3 py-2.5 px-4 mb-2 bg-slate-50/80 rounded-xl group hover:bg-indigo-50/30 transition-colors">
                            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{ti + 1}</span>
                            <span className="text-sm text-slate-800 flex-1 break-words leading-relaxed">{task}</span>
                            <button onClick={() => {
                              const newTasks = tasks.filter((_, i) => i !== ti);
                              updateAction(si, di, newTasks.join("; "));
                            }} className="text-red-300 hover:text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-all shrink-0">&times;</button>
                          </div>
                        )) : (
                          <p className="text-xs text-slate-400 italic px-3 py-2">No tasks yet</p>
                        )}
                        <div className="flex gap-2 mt-3">
                          <input type="text" placeholder={`+ Add task for ${day}...`}
                            className="flex-1 border border-dashed border-slate-300/60 rounded-xl px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none transition-all"
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                const input = e.currentTarget;
                                const val = input.value.trim();
                                if (!val) return;
                                updateAction(si, di, tasks.length > 0 ? [...tasks, val].join("; ") : val);
                                input.value = "";
                              }
                            }} />
                          <button onClick={e => {
                            const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                            const val = input.value.trim();
                            if (!val) return;
                            updateAction(si, di, tasks.length > 0 ? [...tasks, val].join("; ") : val);
                            input.value = "";
                          }} className="px-4 py-2.5 bg-gradient-to-r from-slate-700 to-slate-600 text-white text-sm font-medium rounded-xl hover:from-slate-800 hover:to-slate-700 transition-all shrink-0 btn-press">+ Add</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">What I Need from DM</label>
                <textarea value={sponsor.dmNeeds}
                  onChange={e => updateSponsor(si, "dmNeeds", e.target.value)}
                  placeholder="Talk to them about study habits, check in Wednesday..."
                  className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 h-32 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all border-l-4 border-l-emerald-200" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addSponsor}
        className="w-full border-2 border-dashed border-slate-300/60 rounded-2xl py-5 text-slate-400 font-medium hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/20 transition-all duration-300 mb-8 btn-press">
        + Add Another Sponsor
      </button>

      {/* Section Label: Generate */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
        </div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Generate Emails</h2>
      </div>

      {/* Generate Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8">
        <button onClick={generateEmail}
          disabled={loading || loadingSponsorEmails || sponsors.every(s => !s.name.trim())}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-5 rounded-2xl font-bold text-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl btn-press">
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <span className="loading-dots"><span /><span /><span /></span>
              Generating...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              Generate Team Email
            </span>
          )}
        </button>
        <button onClick={generateSponsorEmails}
          disabled={loading || loadingSponsorEmails || sponsors.every(s => !s.name.trim())}
          className="bg-gradient-to-r from-slate-800 to-slate-700 text-white py-5 rounded-2xl font-bold text-lg hover:from-slate-900 hover:to-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl btn-press">
          {loadingSponsorEmails ? (
            <span className="flex items-center justify-center gap-3">
              <span className="loading-dots"><span /><span /><span /></span>
              Generating...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              Generate Sponsor Emails
            </span>
          )}
        </button>
      </div>

      {/* Team Email Output */}
      {generatedEmail && (
        <div className="glass-card rounded-2xl shadow-xl overflow-hidden mb-8 animate-fade-in">
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 text-white px-6 py-4 flex justify-between items-center">
            <h2 className="font-bold flex items-center gap-2 text-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              {teamIsPrompt ? "Team Email — prompt for the Claude app" : "Team Email"}
            </h2>
            <button onClick={copyEmail}
              className="bg-white/20 hover:bg-white/30 text-white px-5 py-2 rounded-xl text-sm font-medium transition-all btn-press flex items-center gap-2">
              {copied ? (
                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
              ) : (
                <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>Copy to Clipboard</>
              )}
            </button>
          </div>
          {teamIsPrompt && (
            <div className="bg-emerald-50/70 border-b border-emerald-100 px-6 py-3 text-sm text-emerald-800">
              Copy this, paste it into a new chat in the Claude app, and it writes the email. Every number inside is already computed — no API credits used.
            </div>
          )}
          <div className="border-l-4 border-l-emerald-200">
            <pre className="whitespace-pre-wrap text-sm text-slate-800 p-8 font-sans leading-loose">
              {generatedEmail}
            </pre>
          </div>
        </div>
      )}

      {/* Sponsor Email Outputs */}
      {generatedSponsorEmails.length > 0 && (
        <div className="space-y-6 mb-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </div>
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sponsor Emails</h2>
          </div>
          {generatedSponsorEmails.map((se, i) => (
            <div key={i} className="glass-card rounded-2xl shadow-xl overflow-hidden animate-fade-in">
              <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-4 flex justify-between items-center">
                <h3 className="font-bold flex items-center gap-2 text-lg">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-xs font-bold">{i + 1}</div>
                  {se.isPrompt ? `Prompt for ${se.name}'s email` : `Email to ${se.name}`}
                </h3>
                <button onClick={() => copySponsorEmail(i)}
                  className="bg-white/20 hover:bg-white/30 text-white px-5 py-2 rounded-xl text-sm font-medium transition-all btn-press flex items-center gap-2">
                  {copiedSponsor === i ? (
                    <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>Copy to Clipboard</>
                  )}
                </button>
              </div>
              {se.isPrompt && (
                <div className="bg-slate-50 border-b border-slate-100 px-6 py-3 text-sm text-slate-600">
                  Copy this into a new chat in the Claude app — it writes the email. The promise below is already saved, so the next upload grades it.
                </div>
              )}
              {se.checkpoint && (
                <div className="bg-indigo-50/70 border-b border-indigo-100 px-6 py-3 text-sm text-indigo-800">
                  <span className="font-semibold">Promise this email sets:</span> {se.checkpoint}
                </div>
              )}
              <div className="border-l-4 border-l-indigo-200">
                <pre className="whitespace-pre-wrap text-sm text-slate-800 p-8 font-sans leading-loose">
                  {se.email}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
