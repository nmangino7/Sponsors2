import type {
  Store, SponsorRow, SnapshotRow, RealSitRow, EmailRow, NoteRow, SponsorSummary,
  NewSponsor, NewSnapshot, NewRealSit, NewEmail, NewNote, SnapshotStamp,
} from "./store-model.ts";
import { nameKey, matchSponsor } from "./store-model.ts";

// In-memory store: tests, and local dev without DATABASE_URL. Data dies with the process.
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private sponsors: SponsorRow[] = [];
  private snaps: SnapshotRow[] = [];
  private sits: RealSitRow[] = [];
  private mails: EmailRow[] = [];
  private noteRows: NoteRow[] = [];
  private seq = 0;

  private stamp(): string {
    // Strictly increasing so "newest first" is deterministic even within one millisecond.
    return new Date(Date.now() + this.seq++).toISOString();
  }

  private id(): string {
    return crypto.randomUUID();
  }

  async findSponsor(q: { achievableUuid?: string | null; name?: string | null }) {
    return matchSponsor(this.sponsors, q);
  }

  async createSponsor(s: NewSponsor) {
    const now = this.stamp();
    const row: SponsorRow = {
      id: this.id(), name: s.name.trim(), nameKey: nameKey(s.name), achievableUuid: s.achievableUuid ?? null,
      exam: s.exam ?? null, examDate: s.examDate ?? null, createdAt: now, updatedAt: now,
    };
    this.sponsors.push(row);
    return row;
  }

  async updateSponsor(id: string, patch: Partial<NewSponsor>) {
    const row = this.sponsors.find(r => r.id === id);
    if (!row) return null;
    if (patch.name !== undefined) { row.name = patch.name.trim(); row.nameKey = nameKey(patch.name); }
    if (patch.achievableUuid !== undefined) row.achievableUuid = patch.achievableUuid;
    if (patch.exam !== undefined) row.exam = patch.exam;
    if (patch.examDate !== undefined) row.examDate = patch.examDate;
    row.updatedAt = this.stamp();
    return row;
  }

  async getSponsor(id: string) {
    return this.sponsors.find(r => r.id === id) ?? null;
  }

  async listSponsors(): Promise<SponsorSummary[]> {
    return this.sponsors
      .map(s => {
        const mine = this.snaps.filter(x => x.sponsorId === s.id).sort(newestSnapshot);
        const last = mine[0];
        return {
          ...s, lastReportDate: last?.reportDate ?? null, pagesRead: last?.pagesRead ?? null, pagesTotal: last?.pagesTotal ?? null,
          phase: last?.phase ?? null, dot: last?.dot ?? null, primaryMode: last?.primaryMode ?? null, snapshotCount: mine.length,
        };
      })
      .sort(byExamDateThenName);
  }

  async addSnapshot(s: NewSnapshot) {
    const row: SnapshotRow = { ...s, id: this.id(), createdAt: this.stamp() };
    this.snaps.push(row);
    return row;
  }

  async snapshots(sponsorId: string, limit = 50) {
    return this.snaps.filter(x => x.sponsorId === sponsorId).sort(newestSnapshot).slice(0, limit);
  }

  async restampSnapshot(id: string, stamp: SnapshotStamp) {
    const row = this.snaps.find(x => x.id === id);
    if (row) Object.assign(row, stamp);
  }

  async addRealSit(a: NewRealSit) {
    const row: RealSitRow = { ...a, id: this.id(), createdAt: this.stamp() };
    this.sits.push(row);
    return row;
  }

  async realSits(sponsorId: string) {
    return this.sits.filter(x => x.sponsorId === sponsorId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  async addEmail(e: NewEmail) {
    const row: EmailRow = { ...e, id: this.id(), createdAt: this.stamp() };
    this.mails.push(row);
    return row;
  }

  async emails(sponsorId: string, limit = 20) {
    return this.mails.filter(x => x.sponsorId === sponsorId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async addNote(n: NewNote) {
    const row: NoteRow = { ...n, id: this.id(), createdAt: this.stamp() };
    this.noteRows.push(row);
    return row;
  }

  async notes(sponsorId: string, limit = 10) {
    return this.noteRows.filter(x => x.sponsorId === sponsorId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
}

function newestSnapshot(a: SnapshotRow, b: SnapshotRow): number {
  return b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt);
}

export function byExamDateThenName(a: SponsorRow, b: SponsorRow): number {
  if (a.examDate && b.examDate) return a.examDate.localeCompare(b.examDate) || a.name.localeCompare(b.name);
  if (a.examDate) return -1;
  if (b.examDate) return 1;
  return a.name.localeCompare(b.name);
}
