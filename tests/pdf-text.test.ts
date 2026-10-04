import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageText } from "../app/pdf-text.ts";
import { extractReport } from "../app/api/report-extract.ts";

// The PDFs are the text fixtures printed from Chromium with Chrome's own print header/footer
// (date + title on top, URL + page counter at the bottom) — the furniture a real
// "Save as PDF" Achievable report carries. This runs the same pdf.js text path the browser does.
async function pdfToText(path: string): Promise<string> {
  // @ts-expect-error — no type declarations for the legacy build path
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), disableFontFace: true, useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(await pageText(await doc.getPage(i)));
  return pages.join("\n");
}

const FIELDS = [
  "name", "email", "achievableUuid", "course", "studyMin", "readingMin", "quizMin", "examMin", "pagesRead", "pagesTotal",
  "readingMinutesLeft", "fullLengthCounter", "readiness", "planStatus", "overdueMinutes",
] as const;

for (const [pdf, txt] of [
  ["tests/fixtures/report-phase1-print.pdf", "tests/fixtures/report-phase1-stacked.txt"],
  ["tests/fixtures/report-attempts-print.pdf", "tests/fixtures/report-attempts-inline.txt"],
]) {
  test(`pdf.js text of ${pdf} extracts the same as the text fixture`, async () => {
    const fromPdf = extractReport(await pdfToText(pdf));
    const fromTxt = extractReport(readFileSync(txt, "utf8"));
    for (const f of FIELDS) assert.deepEqual(fromPdf[f], fromTxt[f], f);
    assert.deepEqual(fromPdf.attempts, fromTxt.attempts, "attempts");
    assert.deepEqual(fromPdf.daily.map(d => [d.date, d.totalMin]), fromTxt.daily.map(d => [d.date, d.totalMin]), "daily");
    assert.ok(fromPdf.pagesRead != null && fromPdf.pagesTotal != null);
  });
}
