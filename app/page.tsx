"use client";
import { useState, useRef } from "react";

interface Sponsor {
  name: string;
  exam: string;
  status: string;
  issues: string;
  actions: string[];
  dmNeeds: string;
}

interface UploadedFile {
  name: string;
  type: string;
  base64: string;
  preview?: string;
}

interface AiSuggestion {
  name: string;
  exam: string;
  status: string;
  issues: string;
  actions: string[][];
  dmNeeds: string;
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

const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const emptySponsor = (): Sponsor => ({
  name: "",
  exam: "SIE",
  status: "",
  issues: "",
  actions: ["", "", "", ""],
  dmNeeds: "",
});

function getDays(startDay: string): string[] {
  const idx = ALL_DAYS.indexOf(startDay);
  return [0, 1, 2, 3].map(i => ALL_DAYS[(idx + i) % 7]);
}

export default function Home() {
  const [startDay, setStartDay] = useState("Monday");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  const [sponsors, setSponsors] = useState<Sponsor[]>([emptySponsor()]);

  const [parserName, setParserName] = useState("");
  const [parserExam, setParserExam] = useState("SIE");
  const [notes, setNotes] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion | null>(null);
  const [suggestionChecks, setSuggestionChecks] = useState<SuggestionChecks>({ status: true, issues: true, actions: [[], [], [], []], dmNeeds: true });
  const [customActions, setCustomActions] = useState<string[]>(["", "", "", ""]);

  const [generatedEmail, setGeneratedEmail] = useState("");
  const [generatedSponsorEmails, setGeneratedSponsorEmails] = useState<{ name: string; email: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSponsorEmails, setLoadingSponsorEmails] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSponsor, setCopiedSponsor] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [scoreEntries, setScoreEntries] = useState<ScoreEntry[]>([]);
  const [scoreForm, setScoreForm] = useState({ sponsor: "", platform: "Achievable", scoreType: "Simulated Exam", score: "", section: "", notes: "" });
  const [showScoreTracker, setShowScoreTracker] = useState(false);

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

  const pdfToImages = async (file: File): Promise<UploadedFile[]> => {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const results: UploadedFile[] = [];
    const maxPages = Math.min(pdf.numPages, 30);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page.render({ canvasContext: ctx, viewport } as any)).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      const base64 = dataUrl.split(",")[1];
      results.push({ name: `${file.name} (page ${i})`, type: "image/jpeg", base64 });
    }
    if (pdf.numPages > 30) {
      setError(`PDF has ${pdf.numPages} pages — only first 30 were processed.`);
    }
    return results;
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files) return;
    const newFiles: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      if (file.type === "application/pdf") {
        try {
          const pdfImages = await pdfToImages(file);
          newFiles.push(...pdfImages);
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
    setParsing(true);
    setError("");
    try {
      const images = uploadedFiles.map(f => ({ base64: f.base64, mediaType: f.type }));
      const res = await fetch("/api/parse-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, startDay, sponsorName: parserName, exam: parserExam, images, scoreEntries: scoreEntries.filter(s => !parserName.trim() || s.sponsor.toLowerCase().includes(parserName.toLowerCase())) }),
      });
      const data = await res.json();
      if (data.error) { setError(`AI Error: ${data.error}`); setParsing(false); return; }
      if (data.sponsors?.length > 0) {
        const s = data.sponsors[0];
        let normalizedActions: string[][] = [[], [], [], []];
        if (s.actions?.length === 4) {
          normalizedActions = s.actions.map((a: string | string[]) => Array.isArray(a) ? a : [a]);
        }
        setAiSuggestions({
          name: s.name || parserName, exam: s.exam || parserExam,
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
    const sponsor: Sponsor = {
      name: aiSuggestions.name, exam: aiSuggestions.exam,
      status: suggestionChecks.status ? aiSuggestions.status : "",
      issues: suggestionChecks.issues ? aiSuggestions.issues : "",
      actions: aiSuggestions.actions.map((dayTasks, i) => {
        return dayTasks.filter((_, j) => suggestionChecks.actions[i]?.[j]).join("; ");
      }),
      dmNeeds: suggestionChecks.dmNeeds ? aiSuggestions.dmNeeds : "",
    };
    setSponsors(prev => {
      const hasEmpty = prev.length === 1 && !prev[0].name.trim();
      return hasEmpty ? [sponsor] : [...prev, sponsor];
    });
    setAiSuggestions(null);
    setParserName(""); setParserExam("SIE"); setNotes(""); setUploadedFiles([]);
  };

  const discardSuggestions = () => { setAiSuggestions(null); setCustomActions(["", "", "", ""]); };

  const generateEmail = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDay, date, sponsors, scoreEntries }),
      });
      const data = await res.json();
      if (data.error) setError(`Email generation error: ${data.error}`);
      else setGeneratedEmail(data.email);
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
      const results: { name: string; email: string }[] = [];
      for (const sponsor of namedSponsors) {
        const res = await fetch("/api/generate-sponsor-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDay, date, sponsor }),
        });
        const data = await res.json();
        if (data.error) { setError(`Sponsor email error: ${data.error}`); break; }
        results.push({ name: sponsor.name, email: data.email });
      }
      setGeneratedSponsorEmails(results);
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 sm:px-6 lg:px-8">

      {/* Header */}
      <div className="header-gradient text-white rounded-2xl p-10 mb-10 shadow-xl animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-lg font-bold">G</div>
              <h1 className="text-3xl font-bold tracking-tight">GFA Sponsorship</h1>
            </div>
            <p className="text-indigo-200 text-lg font-light">At-Risk Sponsor Action Plan Generator</p>
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
          <div className="flex-1 min-w-[250px]">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl px-4 py-3 border border-indigo-100">
              <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">Plan Days</span>
              <p className="text-sm font-semibold text-slate-700 mt-0.5 flex items-center gap-1.5">
                {days.map((d, i) => (
                  <span key={d} className="flex items-center gap-1.5">
                    <span>{d}</span>
                    {i < 3 && <span className="text-indigo-300">&rarr;</span>}
                  </span>
                ))}
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

      {/* Section Label: AI Parser */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
        </div>
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">AI Notes Parser</h2>
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
            <select value={parserExam} onChange={e => setParserExam(e.target.value)}
              className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all">
              <option value="SIE">SIE</option>
              <option value="63">Series 63</option>
              <option value="65">Series 65</option>
              <option value="LAH">LAH</option>
              <option value="VA">VA</option>
            </select>
          </div>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Notes from Tracker</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Paste the notes column from the tracker here..."
            className="w-full border border-slate-200/60 rounded-xl px-4 py-3 text-sm bg-slate-50/80 h-28 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all" />
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
            <p className="text-xs text-slate-400 mt-1">PNG, JPG, PDF — up to 30MB per file</p>
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
                  <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-600 text-sm ml-1 transition-colors">&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={parseNotes}
          disabled={parsing || (!parserName.trim() && !notes.trim() && uploadedFiles.length === 0)}
          className="bg-gradient-to-r from-indigo-600 to-indigo-500 text-white px-7 py-3 rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md btn-press">
          {parsing ? (
            <span className="flex items-center gap-3">
              <span className="loading-dots"><span /><span /><span /></span>
              Analyzing...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              Get AI Suggestions
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
          <p className="text-xs text-slate-400 mb-5 bg-slate-50/80 rounded-lg px-3 py-2">Edit text directly, check/uncheck to include, add your own tasks. Click &quot;Add to Action Plan&quot; when done.</p>

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
              Team Email
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
                  Email to {se.name}
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
