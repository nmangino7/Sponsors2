/** pdf.js text in content-stream order (≈ the page's DOM order), one visual line per y.
 *  Pieces on the same line are joined with a space only when there's a visible gap between
 *  them: Chrome-printed reports split words at ligatures ("fi" in ".../finra-sie/") into
 *  touching pieces that must not be spaced apart. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function pageText(page: any): Promise<string> {
  const tc = await page.getTextContent();
  let out = "";
  let lastY: number | null = null;
  let lastEnd = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const it of tc.items as any[]) {
    if (typeof it.str !== "string") continue;
    const x = it.transform?.[4] ?? 0;
    const y = it.transform?.[5] ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > 2) out += "\n";
    else if (lastY !== null && it.str && !/\s$/.test(out) && !/^\s/.test(it.str) && x - lastEnd > Math.max(1, (it.height || 0) * 0.2)) out += " ";
    out += it.str;
    if (it.hasEOL) { out += "\n"; lastY = null; } else { lastY = y; lastEnd = x + (it.width || 0); }
  }
  return out;
}
