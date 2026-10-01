import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "../db/database.js";
import { createNativeImageContent, createPhase1Runtime, type Phase1Runtime } from "../agent/runtime.js";
import { publishFindings, type FindingsInput } from "./report.js";

function messageText(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
}

function compactMessage(message: any): any {
  return { role: message?.role, text: messageText(message).slice(-12000) };
}

export function requestErrorCode(message: string): string {
  if (/402|credit|in_flight_budget_exhausted|billing/i.test(message)) return "PROVIDER_CREDITS_EXHAUSTED";
  if (/auth|401|403|unauthorized|forbidden/i.test(message)) return "AUTH_REQUIRED";
  if (/connection error|ECONNRESET|EPIPE|socket hang up|fetch failed|UND_ERR/i.test(message)) return "PROVIDER_CONNECTION_FAILED";
  return "PI_REQUEST_FAILED";
}

function failRun(db: Database, runId: string, code: string, message: string): void {
  db.updateRun(runId, { status: "failed", error_code: code, error_message: message.slice(0, 1000), updated_at: new Date().toISOString() });
}

/** Compute the streaming text delta from the previous snapshot. */
export function computeDelta(lastText: string, currentText: string): { delta: string; snapshot: boolean } | null {
  if (!currentText || currentText === lastText) return null;
  if (currentText.startsWith(lastText)) return { delta: currentText.slice(lastText.length), snapshot: false };
  return { delta: "", snapshot: true };
}

// Long edge of the copy sent to the model. A full-resolution phone photo is ~6 MB of base64 resent on
// every turn; providers downscale it anyway, and large bodies turn provider rejections into bare
// "Connection error." failures.
const AGENT_IMAGE_MAX_EDGE = 2048;

/** Downscaled copy of the canonical image for model input; crops are still cut from the full-resolution image. */
export function prepareAgentImage(normalizedPath: string, width: number, height: number, cwd: string): { path: string; width: number; height: number; error?: string } {
  if (Math.max(width, height) <= AGENT_IMAGE_MAX_EDGE) return { path: normalizedPath, width, height };
  const path = join(dirname(normalizedPath), "agent.jpg");
  try {
    const output = execFileSync("python3", [join(cwd, "scripts", "agent_image.py"), normalizedPath, path, String(AGENT_IMAGE_MAX_EDGE)], { encoding: "utf8", timeout: 60_000, stdio: "pipe" });
    const size = JSON.parse(output) as { width: number; height: number };
    return { path, width: size.width, height: size.height };
  } catch (error: any) {
    const detail = String(error?.stderr ?? "").trim().split("\n").pop() || (error instanceof Error ? error.message : String(error));
    return { path: normalizedPath, width, height, error: detail.slice(0, 300) };
  }
}

/** Models often omit the coordinate scale; default it to the image they were shown so every box is not rejected. */
export function withCoordScale(input: FindingsInput, width: number, height: number): FindingsInput {
  const base = input && typeof input === "object" ? input : {};
  const valid = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
  return { ...base, coord_scale_w: valid(base.coord_scale_w) ? base.coord_scale_w : width, coord_scale_h: valid(base.coord_scale_h) ? base.coord_scale_h : height };
}

export class AnalysisWorker {
  private runtimePromise: ReturnType<typeof createPhase1Runtime> | undefined;
  private active = false;
  private stopping = false;
  private readonly queued: Array<{ runId: string; onEvent: (event: any) => void }> = [];
  private readonly pendingDialogs = new Map<string, { runId: string; resolve: (answer: string | undefined) => void; timer: NodeJS.Timeout }>();

  constructor(
    private readonly db: Database,
    private readonly dataDir: string,
    private readonly cwd: string,
    private readonly runtimeFactory?: () => Promise<Phase1Runtime>,
  ) {}

  async initialize(): Promise<void> {
    this.db.interruptNonTerminalRuns();
    this.runtimePromise = this.runtimeFactory
      ? this.runtimeFactory()
      : createPhase1Runtime({ cwd: this.cwd, persistent: true, bindExtensions: true });
    await this.runtimePromise;
  }

  get ready(): boolean { return Boolean(this.runtimePromise); }
  get busy(): boolean { return this.active; }

  enqueue(runId: string, onEvent: (event: any) => void): void {
    this.queued.push({ runId, onEvent });
    this.emit(runId, "queue.updated", { position: this.queued.findIndex((item) => item.runId === runId) + 1, queued: this.queued.length }, onEvent);
    void this.drain();
  }

  answerDialog(runId: string, dialogId: string, answer: string | undefined): boolean {
    const pending = this.pendingDialogs.get(dialogId);
    if (!pending || pending.runId !== runId) return false;
    clearTimeout(pending.timer);
    this.pendingDialogs.delete(dialogId);
    pending.resolve(answer);
    return true;
  }

  async dispose(): Promise<void> {
    this.stopping = true;
    for (const pending of this.pendingDialogs.values()) { clearTimeout(pending.timer); pending.resolve(undefined); }
    this.pendingDialogs.clear();
    // Wait for any in-flight run to settle before disposing the runtime.
    while (this.active) await new Promise((resolve) => setTimeout(resolve, 100));
    const runtime = await this.runtimePromise;
    if (runtime) await runtime.dispose();
    this.runtimePromise = undefined;
  }

  private emit(runId: string, type: string, payload: unknown, onEvent: (event: any) => void): void {
    const id = this.db.addEvent(runId, type, payload);
    onEvent({ id, runId, type, payload, createdAt: new Date().toISOString() });
  }

  private async drain(): Promise<void> {
    if (this.active || this.stopping || !this.queued.length) return;
    this.active = true;
    const next = this.queued.shift()!;
    try { await this.run(next.runId, next.onEvent); }
    catch (error) {
      // run() should handle its own errors; this is a safety net for unexpected failures.
      const message = error instanceof Error ? error.message : String(error);
      failRun(this.db, next.runId, "WORKER_ERROR", message);
      this.emit(next.runId, "run.error", { code: "WORKER_ERROR", message: message.slice(0, 1000) }, next.onEvent);
      this.emit(next.runId, "run.state", { status: "failed", reportPublished: false }, next.onEvent);
    }
    finally { this.active = false; if (!this.stopping) void this.drain(); }
  }

  private async run(runId: string, onEvent: (event: any) => void): Promise<void> {
    try {
      await this.runAnalysis(runId, onEvent);
    } catch (error) {
      // Safety net: runAnalysis has its own catch, but guard against unexpected throws.
      const message = error instanceof Error ? error.message : String(error);
      const code = requestErrorCode(message);
      failRun(this.db, runId, code, message);
      this.emit(runId, "run.error", { code, message: message.slice(0, 1000) }, onEvent);
      this.emit(runId, "run.state", { status: "failed", reportPublished: false }, onEvent);
    }
  }

  private async runAnalysis(runId: string, onEvent: (event: any) => void): Promise<void> {
    const runtime = await this.runtimePromise;
    if (!runtime) throw new Error("WORKER_EXITED: Pi runtime is not initialized");
    const run = this.db.getRun(runId);
    if (!run) throw new Error("RUN_NOT_FOUND: the run was deleted before analysis started");
    const asset = this.db.getAsset(run.asset_id);
    if (!asset) throw new Error("ASSET_NOT_FOUND: the uploaded image was removed before analysis started");
    const model = runtime.services.modelRuntime.getModel(run.provider, run.model_id);
    if (!model) {
      failRun(this.db, runId, "MODEL_UNAVAILABLE", "The selected model is not available in Pi's current catalog");
      this.emit(runId, "run.error", { code: "MODEL_UNAVAILABLE", message: "The selected model is not available in Pi's current catalog" }, onEvent);
      return;
    }
    if (!Array.isArray(model.input) || !model.input.includes("image")) {
      failRun(this.db, runId, "MODEL_IMAGE_INPUT_UNSUPPORTED", "The selected Pi model does not accept images");
      this.emit(runId, "run.error", { code: "MODEL_IMAGE_INPUT_UNSUPPORTED", message: "The selected Pi model does not accept images" }, onEvent);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let findingsPublished = false;
    let findingsArtifactId: string | undefined;
    // Error on the latest assistant message only: Pi retries transient provider errors itself,
    // so a failure that a later attempt recovered from must not fail the run.
    let agentError: { code: string; message: string } | undefined;
    let lastText = "";
    try {
      // Fresh session per scan: isolates conversation history and native session IDs.
      await runtime.newSession();
      // Select model first, then apply the requested thinking level — setModel resets thinking.
      await runtime.session.setModel(model);
      runtime.session.setThinkingLevel(run.thinking_level);

      const agentImage = prepareAgentImage(asset.normalized_path, asset.width, asset.height, this.cwd);
      const image = createNativeImageContent(agentImage.path);
      const runDir = join(this.dataDir, "runs", runId);
      const itemsPath = join(runDir, "items.json");
      mkdirSync(runDir, { recursive: true });
      this.db.updateRun(runId, { status: "running", session_id: runtime.session.sessionId, updated_at: new Date().toISOString() });
      this.emit(runId, "run.state", { status: "running", model: { provider: model.provider, modelId: model.id }, image: { mimeType: image.mimeType, sha256: asset.sha256, width: agentImage.width, height: agentImage.height } }, onEvent);
      if (agentImage.error) this.emit(runId, "runtime.warning", { message: `Could not downscale the image for the model (${agentImage.error}); sending the full-resolution original` }, onEvent);

      unsubscribe = runtime.session.subscribe((event: any) => {
        if (event.type === "agent_start") this.emit(runId, "run.state", { status: "running", activeStage: "inspection" }, onEvent);
        else if (event.type === "tool_execution_start") this.emit(runId, "tool.start", { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args }, onEvent);
        else if (event.type === "tool_execution_update") this.emit(runId, "tool.update", { toolCallId: event.toolCallId, toolName: event.toolName, partialResult: String(event.partialResult ?? "").slice(-4000) }, onEvent);
        else if (event.type === "tool_execution_end") this.emit(runId, "tool.end", { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError }, onEvent);
        else if (event.type === "message_update") {
          const text = messageText(event.message);
          const delta = computeDelta(lastText, text);
          if (delta) {
            lastText = text;
            this.db.updateRun(runId, { latest_text: text.slice(-20000), updated_at: new Date().toISOString() });
            if (delta.delta) this.emit(runId, "assistant.delta", { text: delta.delta.slice(-4000) }, onEvent);
          }
        } else if (event.type === "message_end" && event.message?.role === "assistant") {
          const errorMessage = event.message?.errorMessage ?? event.message?.error;
          const message = errorMessage ? String(errorMessage).slice(0, 1000) : "";
          agentError = message ? { code: requestErrorCode(message), message } : undefined;
          const text = messageText(event.message);
          // A failed attempt carries no text; publishing it would blank the run notes.
          if (!message || text) {
            lastText = text;
            this.db.updateRun(runId, { latest_text: lastText.slice(-20000), updated_at: new Date().toISOString() });
            this.emit(runId, "assistant.message", compactMessage(event.message), onEvent);
          }
        } else if (event.type === "auto_retry_start") {
          const reason = String(event.errorMessage ?? "unknown error").slice(0, 300);
          this.emit(runId, "runtime.warning", { message: `Provider request failed (${reason}); Pi retry ${event.attempt}/${event.maxAttempts} in ${Math.round(Number(event.delayMs) / 1000)}s` }, onEvent);
        } else if (event.type === "queue_update") this.emit(runId, "queue.updated", { steering: event.steering.length, followUp: event.followUp.length }, onEvent);
        else if (event.type === "agent_settled") this.emit(runId, "run.settled", {}, onEvent);
      });

      runtime.bridge.ask = async (question, choices) => new Promise<string | undefined>((resolve) => {
        const dialogId = randomUUID();
        const timer = setTimeout(() => { this.pendingDialogs.delete(dialogId); resolve(undefined); }, 5 * 60 * 1000);
        this.pendingDialogs.set(dialogId, { runId, resolve, timer });
        this.emit(runId, "dialog.requested", { dialogId, question, choices: choices ?? [] }, onEvent);
      });
      runtime.bridge.submitFindings = async (input) => {
        if (findingsArtifactId) return { artifactId: findingsArtifactId };
        const result = publishFindings({ db: this.db, dataDir: this.dataDir, runId, imagePath: asset.normalized_path, input: withCoordScale(input, agentImage.width, agentImage.height) });
        findingsPublished = true;
        findingsArtifactId = result.artifactId;
        this.emit(runId, "artifact.ready", { artifactId: result.artifactId, title: result.report.title, kind: "table", sortedBy: "price_descending" }, onEvent);
        return { artifactId: result.artifactId };
      };
      runtime.bridge.artifact = async (input) => {
        if (!findingsPublished && existsSync(itemsPath)) {
          try {
            const result = publishFindings({ db: this.db, dataDir: this.dataDir, runId, imagePath: asset.normalized_path, input: withCoordScale(JSON.parse(readFileSync(itemsPath, "utf8")), agentImage.width, agentImage.height) });
            findingsPublished = true;
            findingsArtifactId = result.artifactId;
            this.emit(runId, "artifact.ready", { artifactId: result.artifactId, title: result.report.title, kind: "table", sortedBy: "price_descending" }, onEvent);
            return { artifactId: result.artifactId };
          } catch {
            // Fall through to the normal artifact path so the original tool gets a useful error/result.
          }
        }
        const artifactId = randomUUID();
        const artifactDir = join(this.dataDir, "runs", runId, "artifacts");
        mkdirSync(artifactDir, { recursive: true });
        const extension = input.kind === "markdown" ? "md" : input.kind === "svg" ? "svg" : input.kind === "table" ? "json" : "html";
        const path = join(artifactDir, `${artifactId}.${extension}`);
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, input.content, { encoding: "utf8", flag: "wx" });
        renameSync(temporary, path);
        this.db.insertArtifact({ id: artifactId, runId, title: input.title.slice(0, 200), kind: input.kind, path, createdAt: new Date().toISOString() });
        this.emit(runId, "artifact.ready", { artifactId, title: input.title.slice(0, 200), kind: input.kind }, onEvent);
        return { artifactId };
      };

      // The /skill: line does not tell the model where the file lives, and some models guess wrong paths.
      const skillPath = runtime.services.resourceLoader?.getSkills?.().skills.find((skill: any) => skill.name === "pallet-price-scout")?.filePath;
      const instructions = [
        "/skill:pallet-price-scout",
        ...(skillPath ? [`The pallet-price-scout skill file is ${skillPath}; read it from that exact path.`] : []),
        "",
        `Analyze the attached image for this app run. It is ${agentImage.path} (${agentImage.width}x${agentImage.height}); if you need to look again, read that file, not the full-resolution original.`,
        `Run ID: ${runId}. Asset ID: ${asset.id}. Original resolution: ${asset.width}x${asset.height}.`,
        "Use Pi's native image input and read tool. Perform searches headlessly with workflow: none.",
        "This is an inventory-analysis task, not a coding task. Do not use vnodes, subagents, or project-development instructions; do not edit source files.",
        "Do not open desktop apps. Do not invent identities, quantities, prices, evidence, or unseen pallet contents.",
        "List each physical item once: one product seen from two angles, or partly hidden behind another item, is a single finding. Record separate units as separate findings only when you can see them as distinct objects.",
        `Create the legacy findings JSON at ${itemsPath} using the skill's items.json shape. Give coords as pixel boxes on the attached ${agentImage.width}x${agentImage.height} image and set coord_scale_w to ${agentImage.width} and coord_scale_h to ${agentImage.height}; the app crops from the full-resolution original. Sort items by descending price before submission.`,
        "After all visual inspection and headless price searches are complete, you MUST call scout_submit_findings with the complete sorted findings. The app will generate the crop report and display it in the current Scout UI. Do not finish without calling that tool unless the image or research failed.",
        "If using the bundled crop_and_report.py script, pass --no-open and write inside the run directory. Never open a desktop browser.",
        "Return a short final summary only after the findings submission succeeds.",
      ].join("\n");
      await runtime.session.prompt(instructions, { images: [image], expandPromptTemplates: true, source: "rpc" });
      const finalAgentError = agentError;
      if (finalAgentError) throw new Error(`${finalAgentError.code}: ${finalAgentError.message}`);
      if (!findingsPublished && !existsSync(itemsPath)) {
        this.emit(runId, "runtime.warning", { message: "Pi settled without a report; requesting the required findings submission once more" }, onEvent);
        await runtime.session.prompt([
          "The previous turn ended without publishing findings.",
          "Do not use vnodes, subagents, project files, or coding tools.",
          "Finish the pallet image analysis now and call scout_submit_findings with every finding, sorted by descending price.",
          "If no reliable findings can be made, submit an empty items array rather than ending without a report.",
        ].join("\n"), { images: [image], expandPromptTemplates: true, source: "rpc" });
        const retryAgentError = agentError;
        if (retryAgentError) throw new Error(`${retryAgentError.code}: ${retryAgentError.message}`);
      }
      if (!findingsPublished && existsSync(itemsPath)) {
        try {
          const legacyFindings = JSON.parse(readFileSync(itemsPath, "utf8"));
          const result = publishFindings({ db: this.db, dataDir: this.dataDir, runId, imagePath: asset.normalized_path, input: withCoordScale(legacyFindings, agentImage.width, agentImage.height) });
          findingsPublished = true;
          findingsArtifactId = result.artifactId;
          this.emit(runId, "artifact.ready", { artifactId: result.artifactId, title: result.report.title, kind: "table", sortedBy: "price_descending" }, onEvent);
        } catch (error) {
          this.emit(runId, "run.error", { code: "REPORT_FAILED", message: error instanceof Error ? error.message : String(error) }, onEvent);
        }
      }
      const status = findingsPublished ? "completed" : "needs_review";
      this.db.updateRun(runId, { status, error_code: findingsPublished ? null : "REPORT_NOT_PUBLISHED", error_message: findingsPublished ? null : "Pi settled without submitting findings", updated_at: new Date().toISOString() });
      if (!findingsPublished) this.emit(runId, "run.error", { code: "REPORT_NOT_PUBLISHED", message: "Pi settled without publishing sorted findings" }, onEvent);
      this.emit(runId, "run.state", { status, reportPublished: findingsPublished }, onEvent);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const code = agentError?.code ?? requestErrorCode(detail);
      // Agent errors are rethrown as "CODE: message"; keep the code out of the message so it is not shown twice.
      const message = detail.startsWith(`${code}: `) ? detail.slice(code.length + 2) : detail;
      failRun(this.db, runId, code, message);
      this.emit(runId, "run.error", { code, message: message.slice(0, 1000) }, onEvent);
      this.emit(runId, "run.state", { status: "failed", reportPublished: false }, onEvent);
    } finally {
      unsubscribe?.();
      runtime.bridge.ask = undefined;
      runtime.bridge.artifact = undefined;
      runtime.bridge.submitFindings = undefined;
    }
  }
}

export function newRunId(): string { return randomUUID(); }
