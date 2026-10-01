import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database, defaultDatabasePath } from "../db/database.js";
import { readModelCatalog } from "../agent/model-selection.js";
import { createAsset } from "../scout/assets.js";
import { AnalysisWorker, newRunId } from "../scout/worker.js";
import { DataLock } from "./lock.js";
import { PUBLIC_FILE_ROUTES, resolvePublicPage } from "./public-pages.js";

const cwd = process.cwd();
const port = Number(process.env.PORT ?? 47831);
let sessionToken = randomBytes(32).toString("hex");
const pairingToken = randomBytes(32).toString("hex");
let pairingConsumed = false;
const csrfToken = randomBytes(24).toString("hex");
const subscribers = new Map<string, Set<(event: any) => void>>();

function loadSessionToken(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const tokenPath = join(dataDir, ".scout-session-token");
  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (!/^[a-f0-9]{64}$/i.test(existing)) throw new Error("SESSION_TOKEN_INVALID");
    chmodSync(tokenPath, 0o600);
    return existing;
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, token, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return token;
}

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0].replace(/^\[/, "").replace(/\]$/, "");
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try { return new URL(origin).hostname === host?.split(":")[0].replace(/^\[/, "").replace(/\]$/, ""); }
  catch { return false; }
}

function auth(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!sameSecret(cookieValue(request.headers.cookie, "scout_session"), sessionToken)) {
    void reply.code(401).send({ error: "AUTH_REQUIRED" });
    return false;
  }
  return true;
}

function mutateAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!auth(request, reply)) return false;
  if (!sameSecret(request.headers["x-csrf-token"] as string | undefined, csrfToken)) {
    void reply.code(403).send({ error: "CSRF_REQUIRED" });
    return false;
  }
  return true;
}

function broadcast(event: any): void {
  for (const subscriber of subscribers.get(event.runId) ?? []) subscriber(event);
}

function publicRun(run: any): any {
  return {
    id: run.id, assetId: run.asset_id, status: run.status,
    model: { provider: run.provider, modelId: run.model_id, thinkingLevel: run.thinking_level },
    sessionId: run.session_id ? "owned" : null, latestText: run.latest_text ?? null,
    error: run.error_code ? { code: run.error_code, message: run.error_message } : null,
    createdAt: run.created_at, updatedAt: run.updated_at,
  };
}

export async function startServer(options: { listen?: boolean } = {}): Promise<{ app: any; url: string; close: () => Promise<void> }> {
  const dataDir = join(cwd, "data");
  const lock = new DataLock(dataDir);
  lock.acquire();
  try {
  sessionToken = loadSessionToken(dataDir);
  // Open SSE streams never go idle; without forced closing, shutdown waits on them indefinitely.
  const app = Fastify({ logger: false, forceCloseConnections: true });
  await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024, files: 1 } });
  const db = new Database(defaultDatabasePath(cwd));
  const worker = new AnalysisWorker(db, dataDir, cwd);
  await worker.initialize();

  app.addHook("onRequest", async (request, reply) => {
    if (!hostAllowed(request.headers.host) || !originAllowed(request.headers.origin, request.headers.host)) {
      await reply.code(403).send({ error: "HOST_ORIGIN_REJECTED" });
      return;
    }
  });

  for (const pathname of Object.keys(PUBLIC_FILE_ROUTES)) {
    app.get(pathname, async (_request, reply) => {
      const page = resolvePublicPage(pathname);
      if (!page || page.kind !== "file") return reply.code(404).send("Not found");
      return reply.type(page.type).send(readFileSync(join(cwd, page.file)));
    });
  }
  app.get("/routing", async (_request, reply) => reply.redirect("/routing/"));

  app.get<{ Querystring: { pair?: string } }>("/api/bootstrap", async (request, reply) => {
    const pairAccepted = request.query.pair ? sameSecret(request.query.pair, pairingToken) : false;
    if (pairAccepted && pairingConsumed) return reply.code(401).send({ error: "PAIRING_EXPIRED" });
    const sessionAccepted = sameSecret(cookieValue(request.headers.cookie, "scout_session"), sessionToken);
    if (!pairAccepted && !sessionAccepted) return reply.code(401).send({ error: request.query.pair ? "PAIRING_INVALID" : "AUTH_REQUIRED" });
    if (pairAccepted) pairingConsumed = true;
    reply.header("Set-Cookie", [`scout_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`, `scout_csrf=${csrfToken}; SameSite=Strict; Path=/`]);
    return { ok: true, csrfToken };
  });

  app.get("/api/health", async (_request, reply) => reply.send({ ok: true }));
  app.get("/api/runtime", async (request, reply) => {
    if (!auth(request, reply)) return;
    return { piVersion: "0.85.1", workerReady: worker.ready, workerBusy: worker.busy, cwd };
  });
  app.get("/api/models", async (request, reply) => {
    if (!auth(request, reply)) return;
    const runtime = await (worker as any).runtimePromise;
    const catalog = await readModelCatalog(runtime.api, runtime.services, runtime.session);
    return catalog;
  });
  app.post("/api/assets", async (request, reply) => {
    if (!mutateAuth(request, reply)) return;
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: "UPLOAD_INVALID" });
    try {
      const bytes = await part.toBuffer();
      const asset = createAsset(db, join(cwd, "data"), { name: part.filename, mimeType: part.mimetype, bytes });
      return reply.code(201).send({ id: asset.id, name: asset.originalName, mimeType: asset.mimeType, width: asset.width, height: asset.height, sha256: asset.sha256, previewUrl: `/api/assets/${asset.id}/preview` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message.includes("TOO_LARGE") ? 413 : 400).send({ error: message.split(":")[0], message });
    }
  });
  app.get<{ Params: { id: string } }>("/api/assets/:id/preview", async (request, reply) => {
    if (!auth(request, reply)) return;
    const asset = db.getAsset(request.params.id);
    if (!asset) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.type("image/jpeg").send(readFileSync(asset.preview_path));
  });
  app.get("/api/runs", async (request, reply) => {
    if (!auth(request, reply)) return;
    return reply.header("Cache-Control", "no-store").send(db.listRuns().map(publicRun));
  });
  app.delete<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    if (!mutateAuth(request, reply)) return;
    const run = db.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: "NOT_FOUND" });
    if (!["completed", "needs_review", "failed", "cancelled", "interrupted"].includes(run.status)) {
      return reply.code(409).send({ error: "RUN_NOT_TERMINAL", message: "Wait for the session to settle before deleting it" });
    }
    const deleted = db.deleteRun(request.params.id);
    if (!deleted) return reply.code(404).send({ error: "NOT_FOUND" });
    rmSync(join(cwd, "data", "runs", request.params.id), { recursive: true, force: true });
    if (deleted.assetDeleted) rmSync(join(cwd, "data", "assets", deleted.assetId), { recursive: true, force: true });
    return { ok: true, id: request.params.id };
  });
  app.post<{ Body: { assetId?: string; provider?: string; modelId?: string; thinkingLevel?: string } }>("/api/runs", async (request, reply) => {
    if (!mutateAuth(request, reply)) return;
    const { assetId, provider, modelId, thinkingLevel } = request.body ?? {};
    const asset = assetId ? db.getAsset(assetId) : undefined;
    if (!asset || !provider || !modelId) return reply.code(400).send({ error: "RUN_INVALID" });
    const runtime = await (worker as any).runtimePromise;
    const model = runtime.services.modelRuntime.getModel(provider, modelId);
    if (!model) return reply.code(400).send({ error: "MODEL_UNAVAILABLE" });
    if (!model.input.includes("image")) return reply.code(400).send({ error: "MODEL_IMAGE_INPUT_UNSUPPORTED" });
    const id = newRunId();
    const now = new Date().toISOString();
    db.insertRun({ id, assetId, status: worker.busy ? "queued" : "ready", provider, modelId, thinkingLevel: thinkingLevel ?? "medium", sessionId: null, createdAt: now, updatedAt: now });
    worker.enqueue(id, broadcast);
    return reply.code(202).send(publicRun(db.getRun(id)));
  });
  app.get<{ Params: { id: string }; Headers: { "last-event-id"?: string } }>("/api/runs/:id/events", async (request, reply) => {
    if (!auth(request, reply)) return;
    const run = db.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: "NOT_FOUND" });
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (event: any) => reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    for (const event of db.getEvents(run.id, Number(request.headers["last-event-id"] ?? 0))) send({ ...event, payload: JSON.parse(event.payload_json) });
    const listeners = subscribers.get(run.id) ?? new Set();
    listeners.add(send); subscribers.set(run.id, listeners);
    const cleanup = () => { listeners.delete(send); if (!listeners.size) subscribers.delete(run.id); };
    request.raw.on("close", cleanup);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15000);
    request.raw.on("close", () => clearInterval(heartbeat));
  });
  app.post<{ Params: { id: string; dialogId: string }; Body: { answer?: string; cancelled?: boolean } }>("/api/runs/:id/dialogs/:dialogId", async (request, reply) => {
    if (!mutateAuth(request, reply)) return;
    const accepted = worker.answerDialog(request.params.id, request.params.dialogId, request.body?.cancelled ? undefined : request.body?.answer);
    return accepted ? { ok: true } : reply.code(409).send({ error: "DIALOG_EXPIRED" });
  });
  app.get<{ Params: { runId: string; artifactId: string } }>("/api/runs/:runId/artifacts/:artifactId", async (request, reply) => {
    if (!auth(request, reply)) return;
    const artifact = db.getArtifact(request.params.artifactId);
    if (!artifact || artifact.run_id !== request.params.runId) return reply.code(404).send({ error: "NOT_FOUND" });
    const contentType = artifact.kind === "markdown" ? "text/markdown" : artifact.kind === "svg" ? "image/svg+xml" : artifact.kind === "table" ? "application/json" : "text/html";
    return reply.type(contentType).header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'").header("Content-Disposition", `attachment; filename=\"scout-${artifact.id}.${artifact.kind === "markdown" ? "md" : artifact.kind === "svg" ? "svg" : artifact.kind === "table" ? "json" : "html"}\"`).send(readFileSync(artifact.path, "utf8"));
  });
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    if (!auth(request, reply)) return;
    const run = db.getRun(request.params.id);
    return run ? publicRun(run) : reply.code(404).send({ error: "NOT_FOUND" });
  });

  if (options.listen !== false) {
    try {
      await app.listen({ host: "127.0.0.1", port });
    } catch (error) {
      lock.release();
      throw error;
    }
    console.log(`Pallet Price Scout: http://127.0.0.1:${port}/?pair=${pairingToken}`);
    console.log(`  Scan     http://127.0.0.1:${port}/`);
    console.log(`  Routing  http://127.0.0.1:${port}/routing/`);
  }
  return { app, url: `http://127.0.0.1:${port}/?pair=${pairingToken}`, close: async () => { await app.close(); await worker.dispose(); db.close(); lock.release(); } };
  } catch (error) {
    lock.release();
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Record fatal errors before Node's default crash handling runs, so an unexpected exit leaves a reason in the log.
  process.on("uncaughtExceptionMonitor", (error, origin) => console.error(`${new Date().toISOString()} fatal ${origin}:`, error));
  startServer().then(({ close }) => {
    let closing = false;
    const shutdown = (reason: string) => {
      if (closing) return;
      closing = true;
      console.log(`${new Date().toISOString()} server shutting down (${reason})`);
      // An in-flight analysis keeps worker.dispose() waiting; cap it. The run is marked interrupted on next start.
      setTimeout(() => process.exit(0), 5000).unref();
      close().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
