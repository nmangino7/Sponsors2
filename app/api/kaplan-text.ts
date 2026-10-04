// Kaplan numbers typed in by hand — the free writer can't read screenshots, so the team
// types what matters: questions answered of the bank, and each simulated exam.
//   "Answered 810 of 1000"   or   "810/1000 answered"
//   "Sim 1 74% 9/20 100/112"  (name, score, date, minutes used/allowed — date and time optional)

import type { KaplanData } from "./readiness.ts";

function isoFrom(md: string, refYear: number): string | null {
  const m = md.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : refYear;
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function parseKaplanText(text: string | null | undefined, refYear = new Date().getUTCFullYear()): KaplanData | null {
  if (!text || !text.trim()) return null;
  let answered: number | null = null;
  let total: number | null = null;
  const sims: KaplanData["sims"] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const bank = line.match(/answered\D*(\d+)\s*(?:of|\/)\s*(\d+)/i) || line.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:questions\s*)?answered/i);
    if (bank) { answered = +bank[1]; total = +bank[2]; continue; }
    const score = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (!score) continue;
    const name = line.slice(0, score.index).replace(/[,:\-–]+\s*$/, "").trim() || `Sim ${sims.length + 1}`;
    const rest = line.slice((score.index ?? 0) + score[0].length);
    const date = rest.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b(?!\s*m)/);
    const time = rest.match(/(\d+)\s*\/\s*(\d+)\s*(?:m|min)/i);
    sims.push({
      name, score: Math.round(+score[1]),
      date: date ? isoFrom(date[1], refYear) : null,
      minutesUsed: time ? +time[1] : null, minutesAllowed: time ? +time[2] : null,
    });
  }
  if (answered === null && !sims.length) return null;
  return { answered, total, avgScore: null, sims };
}
