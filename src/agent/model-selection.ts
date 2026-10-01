export interface ModelChoice {
  provider: string;
  modelId: string;
  name: string;
  input: Array<"text" | "image">;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  inScope: boolean;
  scopedThinkingLevel?: string;
  isCurrent: boolean;
  isDefault: boolean;
  authStatus: "configured" | "unconfigured" | "error";
}

export interface ModelCatalog {
  models: ModelChoice[];
  scopePatterns: string[];
  diagnostics: Array<{ type: string; code?: string; message: string; pattern?: string }>;
  refreshedAt: string;
}

function key(model: any): string {
  return `${String(model.provider)}/${String(model.id)}`;
}

function authStatus(runtime: any, provider: string): ModelChoice["authStatus"] {
  try {
    const status = runtime.getProviderAuthStatus(provider);
    if (typeof status === "string") {
      if (/error|failed/i.test(status)) return "error";
      if (/configured|authenticated|available|oauth|api.?key/i.test(status)) return "configured";
      return "unconfigured";
    }
    if (status?.error) return "error";
    if (status?.configured || status?.authenticated || status?.hasApiKey) return "configured";
    return "unconfigured";
  } catch {
    return "error";
  }
}

export function projectModel(model: any, options: { inScope?: boolean; scopedThinkingLevel?: string; current?: any; defaultProvider?: string; defaultModel?: string; auth?: ModelChoice["authStatus"] } = {}): ModelChoice {
  return {
    provider: String(model.provider),
    modelId: String(model.id),
    name: String(model.name ?? model.id),
    input: Array.isArray(model.input) ? model.input.filter((value: unknown): value is "text" | "image" => value === "text" || value === "image") : ["text"],
    reasoning: Boolean(model.reasoning),
    contextWindow: Number(model.contextWindow) || 0,
    maxTokens: Number(model.maxTokens) || 0,
    inScope: options.inScope ?? false,
    ...(options.scopedThinkingLevel ? { scopedThinkingLevel: options.scopedThinkingLevel } : {}),
    isCurrent: options.current ? key(options.current) === key(model) : false,
    isDefault: options.defaultProvider === model.provider && options.defaultModel === model.id,
    authStatus: options.auth ?? "unconfigured",
  };
}

export async function resolveScopedModels(api: any, runtime: any, settings: any): Promise<{ scopedModels: any[]; diagnostics: any[]; patterns: string[] }> {
  const patterns = settings.getEnabledModels?.() ?? [];
  if (!patterns.length) return { scopedModels: [], diagnostics: [], patterns };
  const result = await api.resolveModelScopeWithDiagnostics(patterns, runtime, { signal: AbortSignal.timeout(15000) });
  return { scopedModels: result.scopedModels, diagnostics: result.diagnostics, patterns };
}

export async function readModelCatalog(api: any, services: any, session?: any): Promise<ModelCatalog> {
  const { scopedModels, diagnostics, patterns } = await resolveScopedModels(api, services.modelRuntime, services.settingsManager);
  const scoped = new Map(scopedModels.map((entry: any) => [key(entry.model), entry]));
  const available = services.modelRuntime.getAvailableSnapshot();
  const current = session?.model;
  const settings = services.settingsManager;
  return {
    models: available.map((model: any) => {
      const entry = scoped.get(key(model));
      return projectModel(model, {
        inScope: patterns.length === 0 || Boolean(entry),
        scopedThinkingLevel: entry?.thinkingLevel,
        current,
        defaultProvider: settings.getDefaultProvider?.(),
        defaultModel: settings.getDefaultModel?.(),
        auth: authStatus(services.modelRuntime, model.provider),
      });
    }),
    scopePatterns: patterns,
    diagnostics: diagnostics.map((diagnostic: any) => ({ type: diagnostic.type, code: diagnostic.code, message: diagnostic.message, pattern: diagnostic.pattern })),
    refreshedAt: new Date().toISOString(),
  };
}

export function imageCapableModels(catalog: ModelCatalog): ModelChoice[] {
  return catalog.models.filter((model) => model.input.includes("image"));
}
