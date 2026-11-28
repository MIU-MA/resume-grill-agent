import { DatabaseSync } from "node:sqlite";
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export type ToolAuditRecord = {
  id: number;
  traceId: string;
  caller: string;
  toolName: string;
  readOnly: boolean;
  status: "ok" | "error";
  errorCode?: string;
  durationMs: number;
  summary: Record<string, unknown>;
  createdAt: number;
};

const MAX_TOOL_AUDIT_ROWS = 5000;

export class Store {
  readonly db: DatabaseSync;
  readonly home: string;
  private closed = false;
  constructor(home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.home = realpathSync(resolve(home));
    this.db = new DatabaseSync(resolve(this.home, "workspace.db"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS objects_kind ON objects(kind);
      CREATE UNIQUE INDEX IF NOT EXISTS application_digest ON objects(json_extract(data,'$.digest')) WHERE kind='application';
      CREATE UNIQUE INDEX IF NOT EXISTS batch_request ON objects(json_extract(data,'$.requestHash')) WHERE kind='batch';
      CREATE TABLE IF NOT EXISTS approvals(application_id TEXT PRIMARY KEY, digest TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, application_id TEXT NOT NULL REFERENCES objects(id), created_at INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_application ON events(application_id);
      CREATE TABLE IF NOT EXISTS tool_audit(
        id INTEGER PRIMARY KEY,
        trace_id TEXT NOT NULL,
        caller TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        read_only INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        duration_ms INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tool_audit_trace ON tool_audit(trace_id);
      CREATE INDEX IF NOT EXISTS application_active_job ON objects(json_extract(data,'$.jobId'))
        WHERE kind='application' AND json_extract(data,'$.status') IN ('sent','sending','uncertain');`);
  }
  put<T extends { id: string }>(kind: string, value: T) {
    this.db
      .prepare(
        "INSERT INTO objects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE objects.kind=excluded.kind",
      )
      .run(value.id, kind, JSON.stringify(value));
  }
  get<T>(kind: string, id: string): T {
    const row = this.db
      .prepare("SELECT data FROM objects WHERE id=? AND kind=?")
      .get(id, kind);
    if (!row) throw new Error("记录不存在。");
    return JSON.parse(String(row.data)) as T;
  }
  list<T>(kind: string, limit = -1): T[] {
    return this.db
      .prepare("SELECT data FROM objects WHERE kind=? ORDER BY rowid DESC LIMIT ?")
      .all(kind, limit)
      .map((row) => JSON.parse(String(row.data)));
  }
  applicationByDigest<T>(digest: string): T | undefined {
    const row = this.db.prepare(
      "SELECT data FROM objects WHERE kind='application' AND json_extract(data,'$.digest')=?",
    ).get(digest);
    return row ? JSON.parse(String(row.data)) as T : undefined;
  }
  applicationEvents() {
    const events = new Map<string, Array<{ created_at: number; type: string; detail: string }>>();
    for (const row of this.db.prepare(`
      SELECT e.application_id,e.created_at,e.type,e.detail
      FROM events e JOIN objects o ON o.id=e.application_id
      WHERE o.kind='application' ORDER BY e.id
    `).iterate()) {
      const id = String(row.application_id);
      const history = events.get(id) ?? [];
      history.push({ created_at: Number(row.created_at), type: String(row.type), detail: String(row.detail) });
      events.set(id, history);
    }
    return events;
  }
  activeApplicationJobs<T>(): T[] {
    return this.db.prepare(`
      SELECT j.data FROM objects j JOIN (
        SELECT DISTINCT json_extract(data,'$.jobId') AS job_id
        FROM objects WHERE kind='application' AND json_extract(data,'$.status') IN ('sent','sending','uncertain')
      ) a ON j.id=a.job_id WHERE j.kind='job'
    `).all().map(({ data }) => JSON.parse(String(data)) as T);
  }
  event(id: string, type: string, detail: string) {
    this.db
      .prepare(
        "INSERT INTO events(application_id,created_at,type,detail) VALUES(?,?,?,?)",
      )
      .run(id, Date.now(), type, detail);
  }
  recordToolAudit(entry: Omit<ToolAuditRecord, "id" | "createdAt">) {
    if (this.closed) return;
    const inserted = this.db
      .prepare(
        "INSERT INTO tool_audit(trace_id,caller,tool_name,read_only,status,error_code,duration_ms,summary,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        entry.traceId,
        entry.caller,
        entry.toolName,
        entry.readOnly ? 1 : 0,
        entry.status,
        entry.errorCode ?? null,
        Math.max(0, Math.round(entry.durationMs)),
        JSON.stringify(entry.summary),
        Date.now(),
      );
    // Trigger pruning via monotonic primary key so short-lived CLI processes also prune reliably.
    if (Number(inserted.lastInsertRowid) % 200 === 0) {
      this.db
        .prepare(
          "DELETE FROM tool_audit WHERE id <= (SELECT id FROM tool_audit ORDER BY id DESC LIMIT 1 OFFSET ?)",
        )
        .run(MAX_TOOL_AUDIT_ROWS);
    }
  }
  listToolAudits(limit = 100): ToolAuditRecord[] {
    const bounded = Math.min(500, Math.max(1, Math.trunc(Number(limit) || 100)));
    return this.db
      .prepare(
        "SELECT id,trace_id,caller,tool_name,read_only,status,error_code,duration_ms,summary,created_at FROM tool_audit ORDER BY id DESC LIMIT ?",
      )
      .all(bounded)
      .map((row) => ({
        id: Number(row.id),
        traceId: String(row.trace_id),
        caller: String(row.caller),
        toolName: String(row.tool_name),
        readOnly: Number(row.read_only) === 1,
        status: String(row.status) === "error" ? "error" : "ok",
        ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
        durationMs: Number(row.duration_ms),
        summary: JSON.parse(String(row.summary)) as Record<string, unknown>,
        createdAt: Number(row.created_at),
      }));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
