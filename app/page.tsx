"use client";
import { useState } from "react";

interface Sponsor {
  name: string;
  exam: string;
  status: string;
  issues: string;
  actions: string[];
  dmNeeds: string;
  mondayResult: string;
}

const emptySponsor = (): Sponsor => ({
  name: "",
  exam: "SIE",
  status: "",
  issues: "",
  actions: ["", "", "", ""],
  dmNeeds: "",
  mondayResult: "",
});

export default function Home() {
  const [dayType, setDayType] = useState<"monday" | "thursday">("monday");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  const [dmName, setDmName] = useState("");
  const [sponsors, setSponsors] = useState<Sponsor[]>([emptySponsor()]);
  const [notes, setNotes] = useState("");
  const [generatedEmail, setGeneratedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [copied, setCopied] = useState(false);

  const days = dayType === "monday"
    ? ["Monday", "Tuesday", "Wednesday", "Thursday (Check-in)"]
    : ["Thursday", "Friday", "Saturday", "Sunday"];

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

  const parseNotes = async () => {
    if (!notes.trim()) return;
    setParsing(true);
    try {
      const res = await fetch("/api/parse-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, dayType }),
      });
      const data = await res.json();
      if (data.sponsors?.length > 0) {
        setSponsors(data.sponsors.map((s: Sponsor) => ({
          ...emptySponsor(),
          ...s,
          actions: s.actions?.length === 4 ? s.actions : ["", "", "", ""],
        })));
      }
    } catch (e) {
      console.error("Parse error:", e);
    }
    setParsing(false);
  };

  const generateEmail = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayType, date, sponsors, dmName }),
      });
      const data = await res.json();
      setGeneratedEmail(data.email);
    } catch (e) {
      console.error("Generate error:", e);
    }
    setLoading(false);
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(generatedEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="bg-[#2E5A88] text-white rounded-lg p-6 mb-6">
        <h1 className="text-2xl font-bold">GFA Sponsorship Email Generator</h1>
        <p className="text-blue-200 mt-1">At-Risk Sponsor Action Plan Emails</p>
      </div>

      {/* Day Toggle */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex gap-4 items-center">
          <span className="font-semibold text-gray-700">Email Type:</span>
          <button
            onClick={() => setDayType("monday")}
            className={`px-4 py-2 rounded-md font-medium transition ${
              dayType === "monday" ? "bg-[#2E5A88] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Monday (Mon-Thu)
          </button>
          <button
            onClick={() => setDayType("thursday")}
            className={`px-4 py-2 rounded-md font-medium transition ${
              dayType === "thursday" ? "bg-[#2E5A88] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Thursday (Thu-Sun)
          </button>
        </div>
      </div>

      {/* Email Header */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="font-semibold text-gray-700 mb-3">Email Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Date</label>
            <input
              type="text"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">District Manager Name</label>
            <input
              type="text"
              value={dmName}
              onChange={e => setDmName(e.target.value)}
              placeholder="Enter DM name"
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">To: Nicholas Mangino, Lexi, {dmName || "[District Manager]"}</p>
      </div>

      {/* AI Notes Parser */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 border-l-4 border-purple-400">
        <h2 className="font-semibold text-gray-700 mb-2">AI Notes Parser</h2>
        <p className="text-sm text-gray-500 mb-3">Paste your raw notes from the tracker below. AI will extract sponsor info and pre-fill the form.</p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Paste notes here... e.g., 'Roy Clayton - SIE - 63% best score, bad study habits, doesn't review after quizzes. Aaron - SIE - hasn't studied, only 20 questions in queue bank...'"
          className="w-full border rounded-md px-3 py-2 text-sm h-32 resize-y"
        />
        <button
          onClick={parseNotes}
          disabled={parsing || !notes.trim()}
          className="mt-2 bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {parsing ? "Parsing with AI..." : "Parse Notes & Fill Form"}
        </button>
      </div>

      {/* Sponsors */}
      {sponsors.map((sponsor, si) => (
        <div key={si} className="bg-white rounded-lg shadow p-4 mb-4 border-l-4 border-[#2E5A88]">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-bold text-[#2E5A88]">SPONSOR {si + 1}</h2>
            {sponsors.length > 1 && (
              <button onClick={() => removeSponsor(si)} className="text-red-500 text-sm hover:text-red-700">Remove</button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Sponsor Name</label>
              <input
                type="text"
                value={sponsor.name}
                onChange={e => updateSponsor(si, "name", e.target.value)}
                placeholder="Full name"
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Current Exam</label>
              <select
                value={sponsor.exam}
                onChange={e => updateSponsor(si, "exam", e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="SIE">SIE</option>
                <option value="63">Series 63</option>
                <option value="65">Series 65</option>
                <option value="LAH">LAH</option>
                <option value="VA">VA</option>
              </select>
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-sm text-gray-600 mb-1">Current Status / Scores</label>
            <textarea
              value={sponsor.status}
              onChange={e => updateSponsor(si, "status", e.target.value)}
              placeholder="Latest practice exam scores, % complete in study material, Achievable/Kaplan progress..."
              className="w-full border rounded-md px-3 py-2 text-sm h-16 resize-y"
            />
          </div>

          <div className="mb-3">
            <label className="block text-sm text-gray-600 mb-1">Key Issues</label>
            <textarea
              value={sponsor.issues}
              onChange={e => updateSponsor(si, "issues", e.target.value)}
              placeholder="What's going wrong? Not studying, bad habits, not responsive, memorizing answers..."
              className="w-full border rounded-md px-3 py-2 text-sm h-16 resize-y"
            />
          </div>

          {dayType === "thursday" && (
            <div className="mb-3">
              <label className="block text-sm text-gray-600 mb-1">Monday Action Plan Result</label>
              <textarea
                value={sponsor.mondayResult}
                onChange={e => updateSponsor(si, "mondayResult", e.target.value)}
                placeholder="Did they complete Mon-Thu tasks? What scores? What improved?"
                className="w-full border rounded-md px-3 py-2 text-sm h-16 resize-y"
              />
            </div>
          )}

          {/* Daily Action Plan */}
          <div className="mb-3">
            <label className="block text-sm font-semibold text-[#2E5A88] mb-2">Daily Action Plan</label>
            {days.map((day, di) => (
              <div key={di} className={`flex gap-2 items-start mb-2 ${di % 2 === 0 ? "bg-gray-50" : ""} p-2 rounded`}>
                <span className="text-sm font-medium text-gray-600 w-36 pt-1 shrink-0">{day}:</span>
                <input
                  type="text"
                  value={sponsor.actions[di]}
                  onChange={e => updateAction(si, di, e.target.value)}
                  placeholder="Specific task: e.g., Complete 2 simulated exams, watch Ch. 3 review video..."
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">What I Need from DM</label>
            <textarea
              value={sponsor.dmNeeds}
              onChange={e => updateSponsor(si, "dmNeeds", e.target.value)}
              placeholder="e.g., Talk to them about study habits, check in Wednesday, confirm tasks done..."
              className="w-full border rounded-md px-3 py-2 text-sm h-16 resize-y"
            />
          </div>
        </div>
      ))}

      <button
        onClick={addSponsor}
        className="w-full border-2 border-dashed border-gray-300 rounded-lg py-3 text-gray-500 hover:border-[#2E5A88] hover:text-[#2E5A88] transition mb-4"
      >
        + Add Another Sponsor
      </button>

      {/* Generate Button */}
      <button
        onClick={generateEmail}
        disabled={loading || sponsors.every(s => !s.name.trim())}
        className="w-full bg-[#2E5A88] text-white py-3 rounded-lg font-semibold text-lg hover:bg-[#1d3d5c] disabled:opacity-50 disabled:cursor-not-allowed transition mb-4"
      >
        {loading ? "Generating Email with AI..." : "Generate Email"}
      </button>

      {/* Generated Email Output */}
      {generatedEmail && (
        <div className="bg-white rounded-lg shadow p-4 mb-6 border-l-4 border-green-500">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-bold text-green-700">Generated Email</h2>
            <button
              onClick={copyEmail}
              className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700"
            >
              {copied ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-4 rounded-md border font-sans leading-relaxed">
            {generatedEmail}
          </pre>
        </div>
      )}
    </div>
  );
}
