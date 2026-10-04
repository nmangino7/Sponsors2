import { NextRequest, NextResponse } from "next/server";
import { getStore } from "../../../store";
import { requireUser } from "../../../guard";
import { friendlyError } from "../../../anthropic";
import { loadDiagnosis, refreshDiagnosis } from "../../../diagnose";

type Ctx = { params: Promise<{ id: string }> };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const OUTCOMES = ["PASS", "FAIL", "PENDING"] as const;

/** Record a REAL exam sit. The readiness we'd computed at the time is stamped on it — that's
 *  what lets a future fail at a high practice score discount this sponsor's platform scores. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const { examType, date, outcome, score } = await req.json();
    if (!examType || typeof examType !== "string") return NextResponse.json({ error: "examType is required" }, { status: 400 });
    if (!ISO.test(date ?? "")) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    if (!OUTCOMES.includes(outcome)) return NextResponse.json({ error: "outcome must be PASS, FAIL or PENDING" }, { status: 400 });
    const s = score === null || score === undefined || score === "" ? null : Number(score);
    if (s !== null && (!Number.isFinite(s) || s < 0 || s > 100)) return NextResponse.json({ error: "score must be 0-100" }, { status: 400 });

    const store = getStore();
    if (!(await store.getSponsor(id))) return NextResponse.json({ error: "Sponsor not found" }, { status: 404 });
    const d = await loadDiagnosis(store, id);
    // Prefer timed-exam evidence; fall back to the calibrated composite.
    const predictedAtSit = d ? d.readiness.trailing3 ?? d.readiness.calibrated : null;

    const sit = await store.addRealSit({ sponsorId: id, examType, date, outcome, score: s, predictedAtSit, createdBy: user.email });
    await refreshDiagnosis(store, id); // calibration and "result missing" change with a real result
    return NextResponse.json({ sit });
  } catch (err: unknown) {
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  }
}
