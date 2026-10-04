// What the app remembers about each sponsor across uploads. Two implementations share
// this contract: Postgres (Neon, production) and in-memory (tests / local dev).

import type { ReportData } from "./report-extract.ts";
import type { KaplanData } from "./readiness.ts";
import type { Checkpoint, CheckpointResult } from "./checkpoint.ts";

export interface SponsorRow {
  id: string;
  name: string;
  nameKey: string;
  achievableUuid: string | null;
  exam: string | null;
  examDate: string | null; // YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotRow {
  id: string;
  sponsorId: string;
  reportDate: string; // YYYY-MM-DD — the report's own date, not the upload time
  pagesRead: number | null;
  pagesTotal: number | null;
  readiness: number | null; // Achievable's meter
  calibrated: number | null; // our calibrated % ready (team-facing only)
  phase: number | null;
  primaryMode: string | null;
  dot: string | null;
  data: ReportData;
  kaplan: KaplanData | null;
  createdBy: string;
  createdAt: string;
}

export interface RealSitRow {
  id: string;
  sponsorId: string;
  examType: string;
  date: string; // YYYY-MM-DD
  outcome: "PASS" | "FAIL" | "PENDING";
  score: number | null;
  predictedAtSit: number | null;
  createdBy: string;
  createdAt: string;
}

export interface EmailRow {
  id: string;
  sponsorId: string;
  kind: "sponsor" | "team";
  body: string;
  phase: number | null;
  checkpoint: Checkpoint | null;
  checkpointResult: CheckpointResult | null; // how the PREVIOUS checkpoint graded when this was written
  createdBy: string;
  createdAt: string;
}

export interface NoteRow {
  id: string;
  sponsorId: string;
  body: string;
  createdBy: string;
  createdAt: string;
}

export interface SponsorSummary extends SponsorRow {
  lastReportDate: string | null;
  pagesRead: number | null;
  pagesTotal: number | null;
  phase: number | null;
  dot: string | null;
  primaryMode: string | null;
  snapshotCount: number;
}

export type SnapshotStamp = Pick<SnapshotRow, "calibrated" | "phase" | "primaryMode" | "dot">;

export interface NewSponsor {
  name: string;
  achievableUuid?: string | null;
  exam?: string | null;
  examDate?: string | null;
}

export type NewSnapshot = Omit<SnapshotRow, "id" | "createdAt">;
export type NewRealSit = Omit<RealSitRow, "id" | "createdAt">;
export type NewEmail = Omit<EmailRow, "id" | "createdAt">;
export type NewNote = Omit<NoteRow, "id" | "createdAt">;

export interface Store {
  readonly kind: "postgres" | "memory";
  findSponsor(q: { achievableUuid?: string | null; name?: string | null }): Promise<SponsorRow | null>;
  createSponsor(s: NewSponsor): Promise<SponsorRow>;
  updateSponsor(id: string, patch: Partial<NewSponsor>): Promise<SponsorRow | null>;
  getSponsor(id: string): Promise<SponsorRow | null>;
  listSponsors(): Promise<SponsorSummary[]>;
  addSnapshot(s: NewSnapshot): Promise<SnapshotRow>;
  snapshots(sponsorId: string, limit?: number): Promise<SnapshotRow[]>; // newest first
  /** Re-stamp a snapshot's computed labels (the sponsor list reads them) after the inputs change. */
  restampSnapshot(id: string, stamp: SnapshotStamp): Promise<void>;
  addRealSit(a: NewRealSit): Promise<RealSitRow>;
  realSits(sponsorId: string): Promise<RealSitRow[]>; // newest first
  addEmail(e: NewEmail): Promise<EmailRow>;
  emails(sponsorId: string, limit?: number): Promise<EmailRow[]>; // newest first
  addNote(n: NewNote): Promise<NoteRow>;
  notes(sponsorId: string, limit?: number): Promise<NoteRow[]>; // newest first
}

/** "  Si-Lin  LI " -> "si lin li": the fallback identity when there's no Achievable UUID. */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Match by Achievable UUID first (stable), then by normalized name. */
export function matchSponsor(rows: SponsorRow[], q: { achievableUuid?: string | null; name?: string | null }): SponsorRow | null {
  if (q.achievableUuid) {
    const byId = rows.find(r => r.achievableUuid === q.achievableUuid);
    if (byId) return byId;
  }
  if (q.name) {
    const k = nameKey(q.name);
    // A name match must not steal a sponsor already tied to a DIFFERENT Achievable account.
    const byName = rows.find(r => r.nameKey === k && (!q.achievableUuid || !r.achievableUuid));
    if (byName) return byName;
  }
  return null;
}
