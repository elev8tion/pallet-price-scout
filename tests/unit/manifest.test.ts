import assert from "node:assert/strict";
import test from "node:test";
import { calculateValuation, validateManifest } from "../../src/scout/manifest.js";

const base = {
  schemaVersion: 1, runId: "run", assetId: "asset", normalizedImageSha256: "sha",
  coordinateSpace: { width: 100, height: 100, units: "pixels" }, title: "Visible lot", currency: "USD", items: [],
};
function item(overrides: any = {}): any {
  return { id: "item-1", name: "Bottle", brand: "Brand", category: "Home", variant: { size: null, colorOrScent: null, packSize: 1 }, bbox: [1, 1, 20, 20], identity: { status: "confirmed", confidence: 0.9, visibleEvidence: ["label"], uncertainty: [] }, quantity: { observedSaleUnits: 4, saleUnitDescription: "one bottle", countStatus: "confirmed" }, condition: "apparently_sealed", price: { status: "supported", amountMinor: 1299, currency: "USD", basis: "per_sale_unit", kind: "current_retail", evidenceIds: ["e1"], checkedAt: new Date().toISOString() }, evidence: [{ id: "e1", url: "https://retailer.example/product", retailer: "Example", retrievedAt: new Date().toISOString(), sourceKind: "product_page", excerpt: "$12.99", snapshotArtifactId: null, listedAmountMinor: 1299, currency: "USD", productMatch: "exact", variantMatch: "exact", availability: "in_stock" }], duplicateOf: null, reviewerNote: null, ...overrides };
}

test("supported total multiplies confirmed sale units by per-unit price", () => {
  const result = validateManifest({ ...base, items: [item()] }, { runId: "run", assetId: "asset", sha256: "sha", width: 100, height: 100 });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(calculateValuation(result.manifest!), { supportedMinor: 5196, estimatedMinor: 0, currency: "USD", recordCount: 1, confirmedSaleUnits: 4, unknownQuantityCount: 0, excludedCount: 0 });
});

test("uncertain or mismatched evidence cannot enter supported total", () => {
  const probable = item({ identity: { ...item().identity, status: "probable" } });
  const snippet = item({ evidence: [{ ...item().evidence[0], sourceKind: "search_snippet" }] });
  const result = validateManifest({ ...base, items: [probable, { ...snippet, id: "item-2" }] }, { runId: "run", assetId: "asset", sha256: "sha", width: 100, height: 100 });
  assert.equal(result.errors.length, 0);
  const valuation = calculateValuation(result.manifest!);
  assert.equal(valuation.supportedMinor, 0);
  assert.equal(valuation.estimatedMinor, 10392);
});

test("unknown quantity, duplicate, stale coordinates, and malformed links are excluded or rejected", () => {
  const unknown = item({ id: "unknown", quantity: { observedSaleUnits: null, saleUnitDescription: "unknown", countStatus: "unknown" } });
  const duplicate = item({ id: "duplicate", duplicateOf: "item-1" });
  const invalid = item({ id: "bad", bbox: [0, 0, 101, 20], evidence: [{ ...item().evidence[0], url: "javascript:alert(1)" }] });
  const result = validateManifest({ ...base, items: [item(), unknown, duplicate, invalid] }, { runId: "run", assetId: "asset", sha256: "sha", width: 100, height: 100 });
  assert.ok(result.errors.some((error) => error.includes("outside")));
  assert.ok(result.errors.some((error) => error.includes("invalid")));
});

test("null identity does not throw and returns structured errors", () => {
  const nullIdentity = item({ id: "null-id", identity: null as any });
  const nullQuantity = item({ id: "null-qty", quantity: null as any });
  const result = validateManifest({ ...base, items: [nullIdentity, nullQuantity] }, { runId: "run", assetId: "asset", sha256: "sha", width: 100, height: 100 });
  assert.ok(result.errors.some((error) => error.includes("identity is invalid")));
  assert.ok(result.errors.some((error) => error.includes("quantity is invalid")));
  assert.equal(result.manifest, null);
});

test("unlinked or mismatched evidence cannot establish supported value", () => {
  const mismatchedCurrency = item({ id: "mismatch-currency", evidence: [{ ...item().evidence[0], currency: "EUR" }] });
  const mismatchedAmount = item({ id: "mismatch-amount", evidence: [{ ...item().evidence[0], listedAmountMinor: 1 }] });
  const result = validateManifest({ ...base, items: [mismatchedCurrency, { ...mismatchedAmount, id: "mismatch-amount-2" }] }, { runId: "run", assetId: "asset", sha256: "sha", width: 100, height: 100 });
  assert.equal(result.errors.length, 0);
  const valuation = calculateValuation(result.manifest!);
  assert.equal(valuation.supportedMinor, 0, "mismatched evidence excluded from supported");
  assert.ok(valuation.estimatedMinor > 0, "mismatched evidence still estimated");
});

test("duplicates are excluded from confirmed sale units", () => {
  const original = item();
  const duplicate = item({ id: "dup", duplicateOf: "item-1" });
  const result = validateManifest({ ...base, items: [original, duplicate] }, { runId: "run", assetId: "asset", sha256: "sha", width: 100, height: 100 });
  assert.equal(result.errors.length, 0);
  const valuation = calculateValuation(result.manifest!);
  // Duplicate units should not be counted in confirmedSaleUnits.
  assert.equal(valuation.confirmedSaleUnits, 4, "only original units counted");
  assert.equal(valuation.supportedMinor, 5196, "only original value counted");
});
