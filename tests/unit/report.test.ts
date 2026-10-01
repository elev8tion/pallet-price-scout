import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Database } from "../../src/db/database.js";
import { publishFindings } from "../../src/scout/report.js";

function makeImage(dir: string): string {
  const path = join(dir, "normalized.png");
  execFileSync("python3", ["-c", `from PIL import Image; Image.new('RGB',(100,100),(255,0,0)).save('${path}')`], { stdio: "pipe" });
  return path;
}

test("published findings include decodable crop data URIs", () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-report-"));
  const db = new Database(join(root, "scout.sqlite"));
  const now = new Date().toISOString();
  const imagePath = makeImage(root);
  db.insertAsset({ id: "asset-1", originalName: "fixture.png", mimeType: "image/png", originalPath: imagePath, normalizedPath: imagePath, previewPath: imagePath, sha256: "sha", width: 100, height: 100, createdAt: now });
  db.insertRun({ id: "run-1", assetId: "asset-1", status: "ready", provider: "test", modelId: "model-1", thinkingLevel: "off", sessionId: null, createdAt: now, updatedAt: now });
  const input = {
    title: "Test lot",
    subtitle: "Test subtitle",
    coord_scale_w: 100,
    coord_scale_h: 100,
    items: [
      { id: "i1", name: "Bottle", brand: "Brand", category: "Home", coords: [10, 10, 50, 50], price: 12.99, status: "Recorded", retailer: "Example", source_url: "https://example.com", description: "A bottle" },
      { id: "i2", name: "Box", brand: "Other", category: "General", coords: [50, 50, 90, 90], price: null, status: "Needs review", retailer: "", source_url: "", description: "A box" },
    ],
  };
  const result = publishFindings({ db, dataDir: root, runId: "run-1", imagePath, input });
  assert.ok(result.artifactId, "artifact ID returned");
  const report = JSON.parse(readFileSync(join(root, "runs", "run-1", "findings.json"), "utf8"));
  assert.equal(report.type, "pallet-findings");
  assert.equal(report.totalLabel, "Unverified reference sum (not quantity-adjusted)");
  assert.equal(report.items.length, 2);
  // The first item (higher price) should be sorted first.
  assert.equal(report.items[0].id, "i1");
  assert.equal(report.items[0].price, 12.99);
  // Crop data URI should be present and decodable.
  assert.ok(typeof report.items[0].image_b64 === "string", "image_b64 is a string");
  assert.ok(report.items[0].image_b64.startsWith("data:image/jpeg;base64,"), "crop is a JPEG data URI");
  // Unknown-price item should still have a crop.
  assert.ok(typeof report.items[1].image_b64 === "string", "unknown-price item has crop");
  assert.ok(report.items[1].image_b64.startsWith("data:image/jpeg;base64,"), "unknown-price crop is a JPEG data URI");
  assert.equal(report.totalValue, 12.99);
  assert.equal(report.pricedCount, 1);
  assert.equal(report.unknownPriceCount, 1);
  db.close();
});

test("report without items produces a valid empty report", () => {
  const root = mkdtempSync(join(tmpdir(), "pallet-scout-empty-"));
  const db = new Database(join(root, "scout.sqlite"));
  const now = new Date().toISOString();
  const imagePath = makeImage(root);
  db.insertAsset({ id: "asset-2", originalName: "fixture.png", mimeType: "image/png", originalPath: imagePath, normalizedPath: imagePath, previewPath: imagePath, sha256: "sha", width: 100, height: 100, createdAt: now });
  db.insertRun({ id: "run-2", assetId: "asset-2", status: "ready", provider: "test", modelId: "model-1", thinkingLevel: "off", sessionId: null, createdAt: now, updatedAt: now });
  const result = publishFindings({ db, dataDir: root, runId: "run-2", imagePath, input: { items: [] } });
  const report = JSON.parse(readFileSync(join(root, "runs", "run-2", "findings.json"), "utf8"));
  assert.equal(report.items.length, 0);
  assert.equal(report.totalValue, 0);
  assert.equal(report.pricedCount, 0);
  assert.equal(report.unknownPriceCount, 0);
  assert.equal(report.totalLabel, "Unverified reference sum (not quantity-adjusted)");
  db.close();
});
