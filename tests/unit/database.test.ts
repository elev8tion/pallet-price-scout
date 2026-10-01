import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Database } from "../../src/db/database.js";

test("deleting a run removes its records and only removes an unreferenced asset", () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-db-delete-"));
  const db = new Database(join(root, "scout.sqlite"));
  const now = new Date().toISOString();
  db.insertAsset({ id: "asset", originalName: "fixture.jpg", mimeType: "image/jpeg", originalPath: "/tmp/original.jpg", normalizedPath: "/tmp/normalized.jpg", previewPath: "/tmp/preview.jpg", sha256: "sha", width: 10, height: 10, createdAt: now });
  for (const id of ["run-1", "run-2"]) {
    db.insertRun({ id, assetId: "asset", status: "completed", provider: "test", modelId: "test", thinkingLevel: "off", sessionId: "session", createdAt: now, updatedAt: now });
    db.addEvent(id, "run.state", { status: "completed" });
  }
  db.insertArtifact({ id: "artifact", runId: "run-1", title: "Report", kind: "table", path: "/tmp/report.json", createdAt: now });

  assert.deepEqual(db.deleteRun("run-1"), { assetId: "asset", assetDeleted: false });
  assert.equal(db.getRun("run-1"), undefined);
  assert.equal(db.getEvents("run-1").length, 0);
  assert.equal(db.getArtifact("artifact"), undefined);
  assert.ok(db.getAsset("asset"));

  assert.deepEqual(db.deleteRun("run-2"), { assetId: "asset", assetDeleted: true });
  assert.equal(db.getAsset("asset"), undefined);
  assert.equal(db.deleteRun("missing"), null);
  db.close();
});

test("worker restart marks non-terminal runs interrupted without replaying them", () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-db-"));
  const db = new Database(join(root, "scout.sqlite"));
  const now = new Date().toISOString();
  db.insertAsset({ id: "asset", originalName: "fixture.jpg", mimeType: "image/jpeg", originalPath: "/tmp/original.jpg", normalizedPath: "/tmp/normalized.jpg", previewPath: "/tmp/preview.jpg", sha256: "sha", width: 10, height: 10, createdAt: now });
  db.insertRun({ id: "active", assetId: "asset", status: "running", provider: "test", modelId: "test", thinkingLevel: "off", sessionId: "session", createdAt: now, updatedAt: now });
  db.insertRun({ id: "done", assetId: "asset", status: "completed", provider: "test", modelId: "test", thinkingLevel: "off", sessionId: "session", createdAt: now, updatedAt: now });

  assert.deepEqual(db.interruptNonTerminalRuns(), ["active"]);
  assert.equal(db.getRun("active").status, "interrupted");
  assert.equal(db.getRun("active").error_code, "WORKER_EXITED");
  assert.equal(db.getRun("done").status, "completed");
  assert.equal(db.getEvents("active")[0].type, "run.state");
  db.close();
});
