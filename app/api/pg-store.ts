import { neon } from "@neondatabase/serverless";
import type {
  Store, SponsorRow, SnapshotRow, RealSitRow, EmailRow, NoteRow, SponsorSummary,
  NewSponsor, NewSnapshot, NewRealSit, NewEmail, NewNote, SnapshotStamp,
} from "./store-model.ts";
import { nameKey } from "./store-model.ts";

// The schema lives here so serverless bundles always ship it; tables are created on first use.
export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS sponsors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    name_key text NOT NULL,
    achievable_uuid text UNIQUE,
    exam text,
    exam_date date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sponsors_name_key ON sponsors (name_key)`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
    report_date date NOT NULL,
    pages_read integer,
    pages_total integer,
    readiness double precision,
    calibrated double precision,
    phase integer,
    primary_mode text,
    dot text,
    data jsonb NOT NULL,
    kaplan jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS snapshots_by_sponsor ON snapshots (sponsor_id, report_date DESC, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS real_sits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
    exam_type text NOT NULL,
    date date NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'PENDING')),
    score double precision,
    predicted_at_sit double precision,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS emails (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('sponsor', 'team')),
    body text NOT NULL,
    phase integer,
    checkpoint jsonb,
    checkpoint_result jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS emails_by_sponsor ON emails (sponsor_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
    body text NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function sponsor(r: Row): SponsorRow {
  return {
    id: r.id, name: r.name, nameKey: r.name_key, achievableUuid: r.achievable_uuid, exam: r.exam,
    examDate: r.exam_date, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

function snapshot(r: Row): SnapshotRow {
  return {
    id: r.id, sponsorId: r.sponsor_id, reportDate: r.report_date, pagesRead: r.pages_read, pagesTotal: r.pages_total,
    readiness: r.readiness, calibrated: r.calibrated, phase: r.phase, primaryMode: r.primary_mode, dot: r.dot,
    data: r.data, kaplan: r.kaplan, createdBy: r.created_by, createdAt: iso(r.created_at),
  };
}

function sit(r: Row): RealSitRow {
  return {
    id: r.id, sponsorId: r.sponsor_id, examType: r.exam_type, date: r.date, outcome: r.outcome, score: r.score,
    predictedAtSit: r.predicted_at_sit, createdBy: r.created_by, createdAt: iso(r.created_at),
  };
}

function email(r: Row): EmailRow {
  return {
    id: r.id, sponsorId: r.sponsor_id, kind: r.kind, body: r.body, phase: r.phase, checkpoint: r.checkpoint,
    checkpointResult: r.checkpoint_result, createdBy: r.created_by, createdAt: iso(r.created_at),
  };
}

function note(r: Row): NoteRow {
  return { id: r.id, sponsorId: r.sponsor_id, body: r.body, createdBy: r.created_by, createdAt: iso(r.created_at) };
}

// Date columns come back as text so a YYYY-MM-DD never shifts across time zones.
const SPONSOR_COLS = `id, name, name_key, achievable_uuid, exam, exam_date::text AS exam_date, created_at, updated_at`;
const SNAPSHOT_COLS = `id, sponsor_id, report_date::text AS report_date, pages_read, pages_total, readiness, calibrated, phase, primary_mode, dot, data, kaplan, created_by, created_at`;
const SIT_COLS = `id, sponsor_id, exam_type, date::text AS date, outcome, score, predicted_at_sit, created_by, created_at`;

export class PgStore implements Store {
  readonly kind = "postgres" as const;
  private sql: ReturnType<typeof neon>;
  private ready: Promise<void> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private async q(text: string, params: unknown[] = []): Promise<Row[]> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const stmt of SCHEMA_SQL) await this.sql.query(stmt);
      })().catch(err => {
        this.ready = null; // retry schema creation on the next call
        throw err;
      });
    }
    await this.ready;
    return (await this.sql.query(text, params)) as Row[];
  }

  async findSponsor(qy: { achievableUuid?: string | null; name?: string | null }) {
    if (qy.achievableUuid) {
      const rows = await this.q(`SELECT ${SPONSOR_COLS} FROM sponsors WHERE achievable_uuid = $1 LIMIT 1`, [qy.achievableUuid]);
      if (rows[0]) return sponsor(rows[0]);
    }
    if (qy.name) {
      // A name match must not steal a sponsor already tied to a different Achievable account.
      const rows = await this.q(
        `SELECT ${SPONSOR_COLS} FROM sponsors WHERE name_key = $1 AND ($2::text IS NULL OR achievable_uuid IS NULL) ORDER BY created_at LIMIT 1`,
        [nameKey(qy.name), qy.achievableUuid ?? null]
      );
      if (rows[0]) return sponsor(rows[0]);
    }
    return null;
  }

  async createSponsor(s: NewSponsor) {
    const rows = await this.q(
      `INSERT INTO sponsors (name, name_key, achievable_uuid, exam, exam_date) VALUES ($1, $2, $3, $4, $5::date) RETURNING ${SPONSOR_COLS}`,
      [s.name.trim(), nameKey(s.name), s.achievableUuid ?? null, s.exam ?? null, s.examDate || null]
    );
    return sponsor(rows[0]);
  }

  async updateSponsor(id: string, patch: Partial<NewSponsor>) {
    const cur = await this.getSponsor(id);
    if (!cur) return null;
    const name = patch.name ?? cur.name;
    const rows = await this.q(
      `UPDATE sponsors SET name = $2, name_key = $3, achievable_uuid = $4, exam = $5, exam_date = $6::date, updated_at = now()
       WHERE id = $1 RETURNING ${SPONSOR_COLS}`,
      [id, name.trim(), nameKey(name), patch.achievableUuid !== undefined ? patch.achievableUuid : cur.achievableUuid,
        patch.exam !== undefined ? patch.exam : cur.exam, (patch.examDate !== undefined ? patch.examDate : cur.examDate) || null]
    );
    return rows[0] ? sponsor(rows[0]) : null;
  }

  async getSponsor(id: string) {
    const rows = await this.q(`SELECT ${SPONSOR_COLS} FROM sponsors WHERE id = $1`, [id]);
    return rows[0] ? sponsor(rows[0]) : null;
  }

  async listSponsors(): Promise<SponsorSummary[]> {
    const rows = await this.q(`
      SELECT s.id, s.name, s.name_key, s.achievable_uuid, s.exam, s.exam_date::text AS exam_date, s.created_at, s.updated_at,
             ls.report_date::text AS last_report_date, ls.pages_read, ls.pages_total, ls.phase, ls.dot, ls.primary_mode,
             (SELECT count(*)::int FROM snapshots x WHERE x.sponsor_id = s.id) AS snapshot_count
      FROM sponsors s
      LEFT JOIN LATERAL (
        SELECT * FROM snapshots WHERE sponsor_id = s.id ORDER BY report_date DESC, created_at DESC LIMIT 1
      ) ls ON true
      ORDER BY s.exam_date ASC NULLS LAST, s.name ASC`);
    return rows.map(r => ({
      ...sponsor(r), lastReportDate: r.last_report_date, pagesRead: r.pages_read, pagesTotal: r.pages_total,
      phase: r.phase, dot: r.dot, primaryMode: r.primary_mode, snapshotCount: r.snapshot_count,
    }));
  }

  async addSnapshot(s: NewSnapshot) {
    const rows = await this.q(
      `INSERT INTO snapshots (sponsor_id, report_date, pages_read, pages_total, readiness, calibrated, phase, primary_mode, dot, data, kaplan, created_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12) RETURNING ${SNAPSHOT_COLS}`,
      [s.sponsorId, s.reportDate, s.pagesRead, s.pagesTotal, s.readiness, s.calibrated, s.phase, s.primaryMode, s.dot,
        JSON.stringify(s.data), s.kaplan ? JSON.stringify(s.kaplan) : null, s.createdBy]
    );
    return snapshot(rows[0]);
  }

  async restampSnapshot(id: string, s: SnapshotStamp) {
    await this.q(`UPDATE snapshots SET calibrated = $2, phase = $3, primary_mode = $4, dot = $5 WHERE id = $1`, [id, s.calibrated, s.phase, s.primaryMode, s.dot]);
  }

  async snapshots(sponsorId: string, limit = 50) {
    const rows = await this.q(
      `SELECT ${SNAPSHOT_COLS} FROM snapshots WHERE sponsor_id = $1 ORDER BY report_date DESC, created_at DESC LIMIT $2`,
      [sponsorId, limit]
    );
    return rows.map(snapshot);
  }

  async addRealSit(a: NewRealSit) {
    const rows = await this.q(
      `INSERT INTO real_sits (sponsor_id, exam_type, date, outcome, score, predicted_at_sit, created_by)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7) RETURNING ${SIT_COLS}`,
      [a.sponsorId, a.examType, a.date, a.outcome, a.score, a.predictedAtSit, a.createdBy]
    );
    return sit(rows[0]);
  }

  async realSits(sponsorId: string) {
    const rows = await this.q(`SELECT ${SIT_COLS} FROM real_sits WHERE sponsor_id = $1 ORDER BY date DESC, created_at DESC`, [sponsorId]);
    return rows.map(sit);
  }

  async addEmail(e: NewEmail) {
    const rows = await this.q(
      `INSERT INTO emails (sponsor_id, kind, body, phase, checkpoint, checkpoint_result, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) RETURNING *`,
      [e.sponsorId, e.kind, e.body, e.phase, e.checkpoint ? JSON.stringify(e.checkpoint) : null,
        e.checkpointResult ? JSON.stringify(e.checkpointResult) : null, e.createdBy]
    );
    return email(rows[0]);
  }

  async emails(sponsorId: string, limit = 20) {
    const rows = await this.q(`SELECT * FROM emails WHERE sponsor_id = $1 ORDER BY created_at DESC LIMIT $2`, [sponsorId, limit]);
    return rows.map(email);
  }

  async addNote(n: NewNote) {
    const rows = await this.q(`INSERT INTO notes (sponsor_id, body, created_by) VALUES ($1, $2, $3) RETURNING *`, [n.sponsorId, n.body, n.createdBy]);
    return note(rows[0]);
  }

  async notes(sponsorId: string, limit = 10) {
    const rows = await this.q(`SELECT * FROM notes WHERE sponsor_id = $1 ORDER BY created_at DESC LIMIT $2`, [sponsorId, limit]);
    return rows.map(note);
  }
}
