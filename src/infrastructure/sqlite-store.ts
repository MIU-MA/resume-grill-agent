import { DatabaseSync } from "node:sqlite";
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export class Store {
  readonly db: DatabaseSync;
  readonly home: string;
  constructor(home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.home = realpathSync(resolve(home));
    this.db = new DatabaseSync(resolve(this.home, "workspace.db"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS application_digest ON objects(json_extract(data,'$.digest')) WHERE kind='application';
      CREATE UNIQUE INDEX IF NOT EXISTS batch_request ON objects(json_extract(data,'$.requestHash')) WHERE kind='batch';
      CREATE TABLE IF NOT EXISTS approvals(application_id TEXT PRIMARY KEY, digest TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, application_id TEXT NOT NULL REFERENCES objects(id), created_at INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL);`);
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
  list<T>(kind: string): T[] {
    return this.db
      .prepare("SELECT data FROM objects WHERE kind=? ORDER BY rowid DESC")
      .all(kind)
      .map((row) => JSON.parse(String(row.data)));
  }
  event(id: string, type: string, detail: string) {
    this.db
      .prepare(
        "INSERT INTO events(application_id,created_at,type,detail) VALUES(?,?,?,?)",
      )
      .run(id, Date.now(), type, detail);
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
    this.db.close();
  }
}
