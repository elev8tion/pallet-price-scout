import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolvePiInstallation } from "../../src/agent/installation.js";
import { filterCompanionBridge, createNativeImageContent, createPhase1Runtime } from "../../src/agent/runtime.js";
import { imageCapableModels, readModelCatalog } from "../../src/agent/model-selection.js";

const cwd = "/Users/kcdacre8tor/pallet-price-scout";

test("resolves the installed Pi package without installing a copy", () => {
  const installation = resolvePiInstallation();
  assert.equal(installation.version, "0.85.1");
  assert.match(installation.packageRoot, /pi-coding-agent$/);
  assert.match(installation.moduleEntry, /dist\/index\.js$/);
});

test("companion filtering preserves other extensions and removes only pi-ui-bridge", () => {
  const result = filterCompanionBridge({
    extensions: [
      { path: "/agent/extensions/pi-ui-bridge.ts", resolvedPath: "/agent/extensions/pi-ui-bridge.ts" },
      { path: "/agent/extensions/other.ts", resolvedPath: "/agent/extensions/other.ts" },
    ],
    errors: [],
    runtime: {},
  });
  assert.deepEqual(result.filteredPaths, ["/agent/extensions/pi-ui-bridge.ts"]);
  assert.deepEqual(result.result.extensions.map((extension: any) => extension.path), ["/agent/extensions/other.ts"]);
});

test("worker loads the real skill/resources and binds without the global piDocs poller", async () => {
  const runtime = await createPhase1Runtime({ cwd, persistent: false, bindExtensions: true });
  try {
    const skills = runtime.services.resourceLoader.getSkills().skills;
    assert.ok(skills.some((skill: any) => skill.name === "pallet-price-scout"));
    assert.ok(runtime.session.getAllTools().some((tool: any) => tool.name === "read"));
    const names = runtime.session.getAllTools().map((tool: any) => tool.name);
    assert.equal(names.filter((name: string) => name === "ui_ask").length, 1);
    assert.equal(names.filter((name: string) => name === "ui_display_artifact").length, 1);
    assert.ok(runtime.diagnostics.some((item) => item.message.includes("companion bridge")));
  } finally {
    await runtime.dispose();
  }
});

test("model catalog and enabled-model scope come from Pi runtime", async () => {
  const runtime = await createPhase1Runtime({ cwd, persistent: false, bindExtensions: false });
  try {
    const catalog = await readModelCatalog(runtime.api, runtime.services, runtime.session);
    assert.ok(catalog.models.length > 0);
    assert.ok(catalog.models.some((model) => model.isCurrent));
    assert.ok(catalog.models.some((model) => model.isDefault));
    assert.ok(catalog.scopePatterns.length > 0);
    assert.ok(imageCapableModels(catalog).length > 0);
    assert.equal(catalog.diagnostics.length, 0);
  } finally {
    await runtime.dispose();
  }
});

test("native image attachment has Pi's image content shape and preserves bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pallet-scout-"));
  const path = join(dir, "fixture.png");
  const bytes = Buffer.from("89504e470d0a1a0a", "hex");
  writeFileSync(path, bytes);
  const image = createNativeImageContent(path);
  assert.deepEqual(image, { type: "image", data: bytes.toString("base64"), mimeType: "image/png" });
});
