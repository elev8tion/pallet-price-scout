import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectPhase1Snapshot, createPhase1Runtime } from "./runtime.js";

const cwd = process.cwd();

type CliModels = { models: string[]; error?: string };

function cliModelKeys(): CliModels {
  try {
    const output = execFileSync("/opt/homebrew/bin/pi", ["--list-models"], { cwd, encoding: "utf8", timeout: 60000, env: process.env });
    const models = output.split(/\r?\n/).slice(1).flatMap((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2 || parts[0] === "provider" || /^-+$/.test(parts[0])) return [];
      return [`${parts[0]}/${parts[1]}`];
    });
    return { models: [...new Set(models)].sort() };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function markdown(snapshot: any, cli: CliModels): string {
  const sdkKeys = snapshot.catalog.models.map((model: any) => `${model.provider}/${model.modelId}`).sort();
  const sdkSet = new Set(sdkKeys);
  const cliSet = new Set(cli.models);
  const onlySdk = sdkKeys.filter((key: string) => !cliSet.has(key));
  const onlyCli = cli.models.filter((key) => !sdkSet.has(key));
  const parity = onlySdk.length === 0 && onlyCli.length === 0 ? "PASS" : "DIFFERENCE — investigate";
  const differences = cli.error
    ? `CLI comparison error: ${cli.error}`
    : `SDK-only models: ${onlySdk.length ? onlySdk.join(", ") : "none"}\nCLI-only models: ${onlyCli.length ? onlyCli.join(", ") : "none"}`;
  const bridgeFiltered = snapshot.diagnostics.some((item: any) => item.message.includes("companion bridge"));
  const imageModels = snapshot.catalog.models.filter((model: any) => model.input.includes("image")).length;
  const scopedModels = snapshot.catalog.models.filter((model: any) => model.inScope).length;
  return [
    "# Pi compatibility report",
    "",
    `Generated: ${snapshot.generatedAt}`,
    "",
    "## Result",
    "",
    `- Installed Pi: **${snapshot.installation.version}**`,
    `- Executable: \`${snapshot.installation.executable}\``,
    `- Project cwd: \`${snapshot.cwd}\``,
    `- SDK available models: **${sdkKeys.length}**`,
    `- CLI available models: **${cli.models.length}**`,
    `- SDK image-capable models: **${imageModels}**`,
    `- SDK/CLI model set parity: **${parity}**`,
    `- Global companion bridge filtered in worker: **${bridgeFiltered ? "yes" : "no"}**`,
    "",
    "## Effective settings",
    "",
    `- Default: \`${snapshot.settings.defaultProvider ?? "unset"}/${snapshot.settings.defaultModel ?? "unset"}\``,
    `- Thinking: **${snapshot.settings.defaultThinkingLevel ?? "unset"}**`,
    `- Enabled model patterns: **${snapshot.settings.enabledModels.length}**`,
    `- Resolved scoped models: **${scopedModels}**`,
    "",
    "## Resources",
    "",
    `- Extensions loaded: **${snapshot.resources.extensions.count}**`,
    `- Skills loaded: **${snapshot.resources.skills.count}**`,
    `- Scout skill present: **${snapshot.resources.skills.names.includes("pallet-price-scout") ? "yes" : "NO"}**`,
    `- Extension load errors: **${snapshot.resources.extensions.errors.length}**`,
    `- Active tools: \`${snapshot.session.activeTools.join(", ")}\``,
    `- Companion tools in worker: **${snapshot.session.allTools.filter((name: string) => name === "ui_ask" || name === "ui_display_artifact").length}** (one app-local pair expected)`,
    "",
    "## Differences",
    "",
    differences,
    "",
    "## Limits",
    "",
    "- This spike verifies installed package discovery, resource loading, model scope projection, worker-safe companion filtering, and native image attachment shape.",
    "- It does not make a provider inference request or claim that credentials are live.",
    "- It does not mutate global settings, auth, skills, extensions, or native sessions.",
    '- Native image input is represented as Pi-compatible `{ type: "image", data, mimeType }`; end-to-end upload is gated for Phase 4.',
    "",
  ].join("\n");
}

const runtime = await createPhase1Runtime({ cwd, persistent: false, bindExtensions: true });
try {
  const snapshot = await collectPhase1Snapshot(runtime);
  const cli = cliModelKeys();
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, "docs/phase1-parity.json"), JSON.stringify({ ...snapshot, cli }, null, 2) + "\n");
  writeFileSync(join(cwd, "docs/COMPATIBILITY.md"), markdown(snapshot, cli));
  console.log(JSON.stringify({
    version: snapshot.installation.version,
    sdkModels: snapshot.catalog.models.length,
    cliModels: cli.models.length,
    scopedModels: snapshot.catalog.models.filter((model: any) => model.inScope).length,
    imageModels: snapshot.catalog.models.filter((model: any) => model.input.includes("image")).length,
    skills: snapshot.resources.skills.count,
    extensions: snapshot.resources.extensions.count,
    activeTools: snapshot.session.activeTools.length,
    cliError: cli.error ?? null,
  }, null, 2));
} finally {
  await runtime.dispose();
}
