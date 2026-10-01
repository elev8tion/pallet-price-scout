import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Database } from "../../src/db/database.js";
import { AnalysisWorker, computeDelta, prepareAgentImage, withCoordScale } from "../../src/scout/worker.js";

/** Minimal fake runtime that records calls without invoking Pi. */
function fakeRuntime(model: any, sessionId: string) {
  const calls: string[] = [];
  const subscribers: Array<(event: any) => void> = [];
  const bridge: any = {};
  const session: any = {
    sessionId,
    setModel: async (m: any) => { calls.push(`setModel:${m.id}`); },
    setThinkingLevel: (level: string) => { calls.push(`setThinkingLevel:${level}`); },
    subscribe: (fn: (event: any) => void) => { subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); }; },
    prompt: async () => { calls.push("prompt"); for (const fn of subscribers) fn({ type: "message_end", message: { role: "assistant", content: "done" } }); },
    abort: async () => { calls.push("abort"); },
  };
  return {
    api: {},
    installation: { version: "0.85.1" },
    services: { modelRuntime: { getModel: () => model } },
    settings: {},
    sessionManager: {},
    session,
    diagnostics: [],
    bridge,
    newSession: async () => { calls.push("newSession"); },
    dispose: async () => { calls.push("dispose"); },
    _calls: calls,
    _subscribers: subscribers,
  };
}

function insertReadyRun(db: Database, runId: string, assetId = "asset-1", normalizedPath = "", modelId = "model-1", provider = "test") {
  const now = new Date().toISOString();
  db.insertAsset({ id: assetId, originalName: "fixture.jpg", mimeType: "image/jpeg", originalPath: "/tmp/original.jpg", normalizedPath, previewPath: "/tmp/preview.jpg", sha256: "sha", width: 10, height: 10, createdAt: now });
  db.insertRun({ id: runId, assetId, status: "ready", provider, modelId, thinkingLevel: "high", sessionId: null, createdAt: now, updatedAt: now });
}

test("computeDelta emits only the new suffix when text extends", () => {
  assert.deepEqual(computeDelta("", "H"), { delta: "H", snapshot: false });
  assert.deepEqual(computeDelta("H", "Hi"), { delta: "i", snapshot: false });
  assert.deepEqual(computeDelta("Hi", "Hi"), null);
  assert.deepEqual(computeDelta("Hi", "Hello"), { delta: "", snapshot: true });
  assert.deepEqual(computeDelta("", ""), null);
});

test("missing image file is durably failed without throwing", async () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-worker-"));
  const db = new Database(join(root, "scout.sqlite"));
  const now = new Date().toISOString();
  // Insert asset with a normalized path that does not exist on disk.
  db.insertAsset({ id: "asset-1", originalName: "fixture.jpg", mimeType: "image/jpeg", originalPath: "/tmp/original.jpg", normalizedPath: "/nonexistent/normalized.jpg", previewPath: "/tmp/preview.jpg", sha256: "sha", width: 10, height: 10, createdAt: now });
  db.insertRun({ id: "ghost", assetId: "asset-1", status: "ready", provider: "test", modelId: "model-1", thinkingLevel: "medium", sessionId: null, createdAt: now, updatedAt: now });
  const model = { provider: "test", id: "model-1", input: ["text", "image"] };
  const runtime = fakeRuntime(model, "session-1");
  const worker = new AnalysisWorker(db, root, root, async () => runtime as any);
  await worker.initialize();
  worker.enqueue("ghost", () => {});
  await new Promise((resolve) => setTimeout(resolve, 200));
  const run = db.getRun("ghost");
  assert.equal(run.status, "failed");
  assert.ok(run.error_code, "error_code set");
  db.close();
});

test("setModel is called before setThinkingLevel and newSession per scan", async () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-order-"));
  const db = new Database(join(root, "scout.sqlite"));
  const normalizedPath = join(root, "normalized.jpg");
  writeFileSync(normalizedPath, Buffer.from("89504e470d0a1a0a", "hex"));
  insertReadyRun(db, "run-1", "asset-1", normalizedPath);
  const model = { provider: "test", id: "model-1", input: ["text", "image"] };
  const runtime = fakeRuntime(model, "session-1");
  const worker = new AnalysisWorker(db, root, root, async () => runtime as any);
  await worker.initialize();
  worker.enqueue("run-1", () => {});
  await new Promise((resolve) => setTimeout(resolve, 200));
  const order = runtime._calls;
  const newSessionIdx = order.indexOf("newSession");
  const setModelIdx = order.indexOf("setModel:model-1");
  const setThinkingIdx = order.indexOf("setThinkingLevel:high");
  assert.ok(newSessionIdx >= 0, "newSession called");
  assert.ok(setModelIdx > newSessionIdx, "setModel after newSession");
  assert.ok(setThinkingIdx > setModelIdx, "setThinkingLevel after setModel");
  const run = db.getRun("run-1");
  assert.equal(run.status, "needs_review");
  db.close();
});

test("two sequential scans use independent sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-sessions-"));
  const db = new Database(join(root, "scout.sqlite"));
  const normalizedPath = join(root, "normalized.jpg");
  writeFileSync(normalizedPath, Buffer.from("89504e470d0a1a0a", "hex"));
  insertReadyRun(db, "run-a", "asset-1", normalizedPath);
  insertReadyRun(db, "run-b", "asset-2", normalizedPath);
  let sessionCounter = 0;
  const model = { provider: "test", id: "model-1", input: ["text", "image"] };
  const runtime = fakeRuntime(model, "session-1");
  let newSessionCount = 0;
  runtime.newSession = async () => { newSessionCount++; sessionCounter++; runtime.session.sessionId = `session-${sessionCounter}`; runtime._calls.push("newSession"); };
  const worker = new AnalysisWorker(db, root, root, async () => runtime as any);
  await worker.initialize();
  worker.enqueue("run-a", () => {});
  await new Promise((resolve) => setTimeout(resolve, 200));
  const sessionIdA = db.getRun("run-a").session_id;
  worker.enqueue("run-b", () => {});
  await new Promise((resolve) => setTimeout(resolve, 200));
  const sessionIdB = db.getRun("run-b").session_id;
  assert.equal(newSessionCount, 2, "newSession called twice");
  assert.notEqual(sessionIdA, sessionIdB, "sessions differ");
  db.close();
});

async function runWithPrompt(prefix: string, prompt: (runtime: any) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const db = new Database(join(root, "scout.sqlite"));
  const normalizedPath = join(root, "normalized.jpg");
  writeFileSync(normalizedPath, Buffer.from("89504e470d0a1a0a", "hex"));
  insertReadyRun(db, "run-1", "asset-1", normalizedPath);
  const runtime = fakeRuntime({ provider: "test", id: "model-1", input: ["text", "image"] }, "session-1");
  runtime.session.prompt = async () => { runtime._calls.push("prompt"); await prompt(runtime); };
  const worker = new AnalysisWorker(db, root, root, async () => runtime as any);
  await worker.initialize();
  worker.enqueue("run-1", () => {});
  await new Promise((resolve) => setTimeout(resolve, 200));
  const events = db.getEvents("run-1", 0).map((event: any) => ({ type: event.type, payload: JSON.parse(event.payload_json) }));
  return { db, runtime, run: db.getRun("run-1"), events };
}

const failedAttempt = { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Connection error." } };
const retryScheduled = { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "Connection error." };

test("a provider error that Pi retries successfully neither fails nor aborts the run", async () => {
  const { db, runtime, run, events } = await runWithPrompt("pallet-scout-retry-ok-", async (rt) => {
    for (const fn of [...rt._subscribers]) { fn(failedAttempt); fn(retryScheduled); fn({ type: "message_end", message: { role: "assistant", content: "done" } }); }
  });
  assert.equal(run.status, "needs_review");
  assert.ok(!runtime._calls.includes("abort"), "the worker must not cancel Pi's own retry");
  assert.ok(events.some((event) => event.type === "runtime.warning" && /retry 1\/3/.test(event.payload.message)), "retry surfaced as a warning");
  assert.ok(!events.some((event) => event.type === "run.error" && event.payload.code !== "REPORT_NOT_PUBLISHED"), "no provider error reported");
  assert.ok(!events.some((event) => event.type === "assistant.message" && !event.payload.text), "failed attempts do not publish empty notes");
  db.close();
});

test("a provider error that outlasts Pi's retries fails the run once with a connection code", async () => {
  const { db, run, events } = await runWithPrompt("pallet-scout-retry-fail-", async (rt) => {
    for (const fn of [...rt._subscribers]) fn(failedAttempt);
  });
  assert.equal(run.status, "failed");
  assert.equal(run.error_code, "PROVIDER_CONNECTION_FAILED");
  assert.equal(run.error_message, "Connection error.", "code is not repeated inside the message");
  assert.equal(events.filter((event) => event.type === "run.error").length, 1);
  db.close();
});

test("findings without a coordinate scale default to the image the model saw", () => {
  assert.deepEqual(withCoordScale({ items: [] }, 1536, 2048), { items: [], coord_scale_w: 1536, coord_scale_h: 2048 });
  assert.deepEqual(withCoordScale({ coord_scale_w: 1000, coord_scale_h: 800, items: [] }, 1536, 2048), { coord_scale_w: 1000, coord_scale_h: 800, items: [] });
  assert.deepEqual(withCoordScale(null as any, 10, 20), { coord_scale_w: 10, coord_scale_h: 20 });
});

test("large images are downscaled for the model; small or undecodable ones fall back to the original", () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-agent-image-"));
  const large = join(root, "normalized.jpg");
  execFileSync("python3", ["-c", "import sys; from PIL import Image; Image.new('RGB', (3000, 4000), (90, 120, 60)).save(sys.argv[1], 'JPEG')", large]);
  const scaled = prepareAgentImage(large, 3000, 4000, process.cwd());
  assert.equal(scaled.path, join(root, "agent.jpg"));
  assert.deepEqual([scaled.width, scaled.height], [1536, 2048]);
  assert.equal(scaled.error, undefined);
  assert.deepEqual(prepareAgentImage(large, 1600, 1200, process.cwd()), { path: large, width: 1600, height: 1200 });
  mkdirSync(join(root, "broken"));
  const broken = join(root, "broken", "normalized.jpg");
  writeFileSync(broken, "not an image");
  const fallback = prepareAgentImage(broken, 3000, 4000, process.cwd());
  assert.equal(fallback.path, broken);
  assert.ok(fallback.error, "fallback reports why");
});

test("the scan prompt names the skill file Pi resolved", async () => {
  const prompts: string[] = [];
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-skill-path-"));
  const realDb = new Database(join(root, "scout.sqlite"));
  const normalizedPath = join(root, "normalized.jpg");
  writeFileSync(normalizedPath, Buffer.from("89504e470d0a1a0a", "hex"));
  insertReadyRun(realDb, "run-1", "asset-1", normalizedPath);
  const runtime = fakeRuntime({ provider: "test", id: "model-1", input: ["text", "image"] }, "session-1");
  (runtime.services as any).resourceLoader = { getSkills: () => ({ skills: [{ name: "other", filePath: "/x/other/SKILL.md" }, { name: "pallet-price-scout", filePath: "/skills/pallet-price-scout/SKILL.md" }] }) };
  runtime.session.prompt = async (text: string) => { prompts.push(text); for (const fn of [...runtime._subscribers]) fn({ type: "message_end", message: { role: "assistant", content: "done" } }); };
  const worker = new AnalysisWorker(realDb, root, root, async () => runtime as any);
  await worker.initialize();
  worker.enqueue("run-1", () => {});
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(prompts[0]?.includes("The pallet-price-scout skill file is /skills/pallet-price-scout/SKILL.md"), "skill path stated in the first prompt");
  assert.ok(prompts[0]?.includes("List each physical item once"), "duplicate-listing rule stated in the first prompt");
  realDb.close();
});
