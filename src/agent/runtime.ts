import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertSupportedVersion, resolvePiInstallation, type PiInstallation } from "./installation.js";
import { readModelCatalog, resolveScopedModels } from "./model-selection.js";

export interface NativeImageContent {
  type: "image";
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export interface WebBridge {
  ask?: (question: string, choices?: string[]) => Promise<string | undefined>;
  artifact?: (input: { title: string; kind: string; content: string }) => Promise<{ artifactId: string }>;
  submitFindings?: (input: Record<string, unknown>) => Promise<{ artifactId: string }>;
}

export interface Phase1Runtime {
  api: any;
  installation: PiInstallation;
  services: any;
  settings: any;
  sessionManager: any;
  session: any;
  diagnostics: Array<{ type: string; message: string }>;
  bridge: WebBridge;
  newSession: () => Promise<void>;
  dispose: () => Promise<void>;
}

const BRIDGE_BASENAME = "pi-ui-bridge.ts";
const MIME_BY_EXTENSION: Record<string, NativeImageContent["mimeType"]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function createNativeImageContent(filePath: string): NativeImageContent {
  const mimeType = MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
  if (!mimeType) throw new Error("PI_IMAGE_INPUT_INVALID: supported native attachments are JPEG, PNG, GIF, or WebP");
  const bytes = readFileSync(filePath);
  if (bytes.byteLength === 0) throw new Error("PI_IMAGE_INPUT_INVALID: image attachment is empty");
  return { type: "image", data: bytes.toString("base64"), mimeType };
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function filterCompanionBridge(result: any): { result: any; filteredPaths: string[] } {
  const filteredPaths = (result.extensions ?? [])
    .filter((extension: any) => extension.path === BRIDGE_BASENAME || extension.resolvedPath?.endsWith(`/${BRIDGE_BASENAME}`) || extension.path?.endsWith(`/${BRIDGE_BASENAME}`))
    .map((extension: any) => extension.resolvedPath ?? extension.path);
  return {
    result: {
      ...result,
      extensions: (result.extensions ?? []).filter((extension: any) => !filteredPaths.includes(extension.resolvedPath ?? extension.path)),
      errors: (result.errors ?? []).filter((error: any) => !filteredPaths.includes(error.path)),
    },
    filteredPaths,
  };
}

function browserUiContext(): any {
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    editor: async () => undefined,
    notify: () => undefined,
    onTerminalInput: () => () => undefined,
    setStatus: () => undefined,
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setHiddenThinkingLabel: () => undefined,
    setWidget: () => undefined,
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: () => undefined,
    custom: async () => undefined,
    pasteToEditor: () => undefined,
    setEditorText: () => undefined,
    getEditorText: () => "",
    addAutocompleteProvider: () => undefined,
    setEditorComponent: () => undefined,
    getEditorComponent: () => undefined,
    theme: undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Browser theme switching is not implemented in Phase 1" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => undefined,
  };
}

export async function createPhase1Runtime(options: { cwd: string; agentDir?: string; persistent?: boolean; bindExtensions?: boolean } ): Promise<Phase1Runtime> {
  const installation = resolvePiInstallation();
  const bridge: WebBridge = {};
  (globalThis as any).__palletScoutWebBridge = bridge;
  assertSupportedVersion(installation);
  const api = await import(pathToFileURL(installation.moduleEntry).href);
  const agentDir = options.agentDir ?? process.env.PI_AGENT_DIR ?? join(homedir(), ".pi/agent");
  const settings = api.SettingsManager.create(options.cwd, agentDir, { projectTrusted: true });
  const filteredPaths = new Set<string>();
  let scopedDiagnostics: any[] = [];
  // Extensions capture a handle bound to the session they were loaded for, and disposing that session
  // invalidates it. Pi's session runtime rebuilds cwd-bound services for every session (and sends the old
  // extensions session_shutdown); reusing services across sessions left every extension tool, web_search
  // included, failing with "This extension ctx is stale after session replacement".
  const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }: any) => {
    const services = await api.createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager: settings,
      modelRuntimeSignal: AbortSignal.timeout(15000),
      resourceLoaderOptions: {
        additionalExtensionPaths: [`${options.cwd}/extensions/scout-web-bridge.ts`],
        extensionsOverride: (base: any) => {
          const filtered = filterCompanionBridge(base);
          for (const path of filtered.filteredPaths) filteredPaths.add(path);
          return filtered.result;
        },
      },
    });
    const scoped = await resolveScopedModels(api, services.modelRuntime, settings);
    scopedDiagnostics = scoped.diagnostics;
    const created = await api.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, scopedModels: scoped.scopedModels });
    return { ...created, services, diagnostics: services.diagnostics };
  };
  const sessionManager = options.persistent === false ? api.SessionManager.inMemory(options.cwd) : api.SessionManager.create(options.cwd);
  const sessionRuntime = await api.createAgentSessionRuntime(createRuntime, { cwd: options.cwd, agentDir, sessionManager });
  const bindExtensions = options.bindExtensions !== false;
  const bindCurrentSession = async () => {
    if (bindExtensions) await sessionRuntime.session.bindExtensions({ mode: "rpc", uiContext: browserUiContext() });
  };
  await bindCurrentSession();
  const diagnostics = [
    ...sessionRuntime.services.diagnostics,
    ...scopedDiagnostics.map((item: any) => ({ type: item.type, message: item.message })),
    ...sessionRuntime.services.resourceLoader.getExtensions().errors.map((item: any) => ({ type: "error", message: `Failed to load extension ${item.path}: ${item.error}` })),
    ...(filteredPaths.size ? [{ type: "info", message: `Filtered the global companion bridge from this worker: ${[...filteredPaths].join(", ")}` }] : []),
  ];
  let disposed = false;
  return {
    api,
    installation,
    get services() { return sessionRuntime.services; },
    settings,
    get sessionManager() { return sessionRuntime.session.sessionManager; },
    get session() { return sessionRuntime.session; },
    diagnostics,
    bridge,
    newSession: async () => {
      const result = await sessionRuntime.newSession();
      if (result?.cancelled) throw new Error("PI_SESSION_REPLACEMENT_CANCELLED: an extension cancelled the new scan session");
      await bindCurrentSession();
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await sessionRuntime.dispose();
      if ((globalThis as any).__palletScoutWebBridge === bridge) delete (globalThis as any).__palletScoutWebBridge;
      await settings.flush();
    },
  };
}

export async function collectPhase1Snapshot(runtime: Phase1Runtime): Promise<any> {
  const { services, session, settings, api, installation } = runtime;
  const extensions = services.resourceLoader.getExtensions();
  const skills = services.resourceLoader.getSkills();
  const prompts = services.resourceLoader.getPrompts();
  const catalog = await readModelCatalog(api, services, session);
  return {
    generatedAt: new Date().toISOString(),
    installation: { executable: installation.executable, packageRoot: installation.packageRoot, version: installation.version },
    cwd: services.cwd,
    agentDir: services.agentDir,
    settings: {
      defaultProvider: settings.getDefaultProvider(),
      defaultModel: settings.getDefaultModel(),
      defaultThinkingLevel: settings.getDefaultThinkingLevel(),
      enabledModels: settings.getEnabledModels() ?? [],
    },
    catalog,
    resources: {
      extensions: { count: extensions.extensions.length, paths: extensions.extensions.map((extension: any) => extension.resolvedPath ?? extension.path), errors: extensions.errors },
      skills: { count: skills.skills.length, names: skills.skills.map((skill: any) => skill.name), diagnostics: skills.diagnostics },
      prompts: { count: prompts.prompts.length, names: prompts.prompts.map((prompt: any) => prompt.name), diagnostics: prompts.diagnostics },
    },
    session: {
      id: session.sessionId,
      model: session.model ? { provider: session.model.provider, modelId: session.model.id, input: session.model.input } : null,
      thinkingLevel: session.thinkingLevel,
      activeTools: session.getActiveToolNames(),
      allTools: session.getAllTools().map((tool: any) => tool.name),
      sessionFile: session.sessionFile,
    },
    diagnostics: runtime.diagnostics,
  };
}
