import { NextRequest, NextResponse } from "next/server";
import { getStore } from "../../store";
import { requireUser } from "../../guard";
import { friendlyError } from "../../anthropic";
import { diagnosisSummary, loadDiagnosis, refreshDiagnosis } from "../../diagnose";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The sponsor's timeline: every report, email (with its promise and grade), real exam, note. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const store = getStore();
    const sponsor = await store.getSponsor(id);
    if (!sponsor) return NextResponse.json({ error: "Sponsor not found" }, { status: 404 });
    const [snapshots, emails, sits, notes, d] = await Promise.all([
      store.snapshots(id, 50), store.emails(id, 50), store.realSits(id), store.notes(id, 50), loadDiagnosis(store, id),
    ]);
    return NextResponse.json({
      sponsor,
      diagnosis: d ? diagnosisSummary(d) : null,
      snapshots: snapshots.map(s => ({
        id: s.id, reportDate: s.reportDate, pagesRead: s.pagesRead, pagesTotal: s.pagesTotal, readiness: s.readiness,
        calibrated: s.calibrated, phase: s.phase, dot: s.dot, primaryMode: s.primaryMode, createdBy: s.createdBy, createdAt: s.createdAt,
      })),
      emails: emails.map(e => ({
        id: e.id, kind: e.kind, phase: e.phase, createdAt: e.createdAt, createdBy: e.createdBy, body: e.body,
        checkpoint: e.checkpoint ? { text: e.checkpoint.text, due: e.checkpoint.due } : null,
        lastResult: e.checkpointResult ? { status: e.checkpointResult.status, text: e.checkpointResult.text } : null,
      })),
      sits,
      notes,
      memory: store.kind,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const body = await req.json();
    const patch: { name?: string; exam?: string | null; examDate?: string | null } = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name;
    if (body.exam !== undefined) patch.exam = body.exam || null;
    if (body.examDate !== undefined) {
      if (body.examDate && !ISO.test(body.examDate)) return NextResponse.json({ error: "examDate must be YYYY-MM-DD" }, { status: 400 });
      patch.examDate = body.examDate || null;
    }
    const updated = await getStore().updateSponsor(id, patch);
    if (!updated) return NextResponse.json({ error: "Sponsor not found" }, { status: 404 });
    if (patch.exam !== undefined || patch.examDate !== undefined) await refreshDiagnosis(getStore(), id);
    return NextResponse.json({ sponsor: updated });
  } catch (err: unknown) {
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  }
}
