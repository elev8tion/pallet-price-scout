import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const sqlite = await import("node:sqlite") as any;

export class Database {
  private readonly db: any;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new sqlite.DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        original_path TEXT NOT NULL,
        normalized_path TEXT NOT NULL,
        preview_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id),
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        thinking_level TEXT NOT NULL,
        session_id TEXT,
        latest_text TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id),
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_run_id_id ON events(run_id, id);
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id),
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const applied = this.db.prepare("SELECT version FROM schema_migrations WHERE version = 1").get();
    if (!applied) this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(new Date().toISOString());
  }

  insertAsset(asset: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO assets(id, original_name, mime_type, original_path, normalized_path, preview_path, sha256, width, height, created_at)
      VALUES(@id, @originalName, @mimeType, @originalPath, @normalizedPath, @previewPath, @sha256, @width, @height, @createdAt)`).run(asset);
  }

  getAsset(id: string): any {
    return this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id);
  }

  insertRun(run: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO runs(id, asset_id, status, provider, model_id, thinking_level, session_id, created_at, updated_at)
      VALUES(@id, @assetId, @status, @provider, @modelId, @thinkingLevel, @sessionId, @createdAt, @updatedAt)`).run(run);
  }

  updateRun(id: string, fields: Record<string, unknown>): void {
    const entries = Object.entries(fields);
    if (!entries.length) return;
    const sql = `UPDATE runs SET ${entries.map(([key]) => `${key} = @${key}`).join(", ")} WHERE id = @id`;
    this.db.prepare(sql).run({ ...fields, id });
  }

  getRun(id: string): any {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
  }

  deleteRun(id: string): { assetId: string; assetDeleted: boolean } | null {
    const run = this.getRun(id);
    if (!run) return null;
    const assetId = String(run.asset_id);
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM artifacts WHERE run_id = ?").run(id);
      this.db.prepare("DELETE FROM events WHERE run_id = ?").run(id);
      this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
      const stillReferenced = this.db.prepare("SELECT 1 FROM runs WHERE asset_id = ? LIMIT 1").get(assetId);
      const assetDeleted = !stillReferenced;
      if (assetDeleted) this.db.prepare("DELETE FROM assets WHERE id = ?").run(assetId);
      this.db.exec("COMMIT");
      return { assetId, assetDeleted };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  interruptNonTerminalRuns(): string[] {
    const active = this.db.prepare("SELECT id FROM runs WHERE status IN ('queued', 'ready', 'running', 'awaiting_input', 'validating', 'rendering')").all() as Array<{ id: string }>;
    if (!active.length) return [];
    const now = new Date().toISOString();
    const update = this.db.prepare("UPDATE runs SET status='interrupted', error_code='WORKER_EXITED', error_message='Run interrupted when the worker restarted', updated_at=? WHERE id=?");
    const event = this.db.prepare("INSERT INTO events(run_id, type, payload_json, created_at) VALUES(?, 'run.state', ?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const run of active) {
        update.run(now, run.id);
        event.run(run.id, JSON.stringify({ status: "interrupted", reason: "worker_restarted" }), now);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return active.map((run) => run.id);
  }

  listRuns(): any[] {
    return this.db.prepare(`SELECT runs.*, assets.original_name, assets.preview_path, assets.width, assets.height
      FROM runs JOIN assets ON assets.id = runs.asset_id ORDER BY runs.created_at DESC LIMIT 50`).all();
  }

  addEvent(runId: string, type: string, payload: unknown): number {
    const result = this.db.prepare("INSERT INTO events(run_id, type, payload_json, created_at) VALUES(?, ?, ?, ?)").run(runId, type, JSON.stringify(payload), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  getEvents(runId: string, afterId = 0): any[] {
    return this.db.prepare("SELECT id, run_id, type, payload_json, created_at FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC").all(runId, afterId);
  }

  insertArtifact(artifact: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO artifacts(id, run_id, title, kind, path, created_at) VALUES(@id, @runId, @title, @kind, @path, @createdAt)").run(artifact);
  }

  getArtifact(id: string): any {
    return this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id);
  }

  close(): void {
    this.db.close();
  }
}

export function defaultDatabasePath(cwd: string): string {
  return join(cwd, "data", "scout.sqlite");
}
