import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildRoutingBatch } from "../../src/routing/adapter.js";

const report = {
  type: "pallet-findings",
  items: [
    { id: "known-1", name: "Known speaker", brand: "Acme", category: "Electronics", price: 250, status: "Recorded" },
    { id: "known-2", name: "Known kettle", brand: "Acme", category: "Kitchen", price: 200, status: "Recorded" },
    { id: "unknown-1", name: "Unidentified item", brand: "Unknown", category: "General", price: null, status: "Needs review" },
  ],
};

test("vision findings become a deterministic routing batch", () => {
  const first = buildRoutingBatch("run-1", report);
  const second = buildRoutingBatch("run-1", report);
  assert.equal(first.label, "SIMULATED STORE DATA");
  assert.deepEqual(first.products, second.products);
  assert.equal(first.products.length, 3);
  assert.ok(first.products.every((product) => product.simulationLabel === "SIMULATED STORE DATA"));
  assert.ok(first.products.filter((product) => product.match === "exact").length === 2);
});

test("imported routing inventory conserves singles and pallet allocations", async () => {
  const batch = buildRoutingBatch("run-3", {
    items: [
      { id: "a", name: "A", price: 250 },
      { id: "b", name: "B", price: 250 },
      { id: "c", name: "C", price: 250 },
      { id: "d", name: "D", price: 250 },
    ],
  });
  // @ts-expect-error demo.js is an untyped browser fixture served at /routing/
  const demo = await import("../../web/routing/demo.js");
  demo.setProducts(batch.products.map((product: any) => ({ ...product, sold: 0, days: null })));
  try {
    const state = demo.initialState();
    state.draft.tier = 400;
    demo.autoFill(state);
    demo.pack(state);
    for (const product of demo.PRODUCTS) {
      const packed = state.pallets.reduce((sum: number, pallet: any) => sum + (pallet.items[product.id] || 0), 0);
      assert.equal(demo.available(state, product.id) + state.pulls[product.id] + packed, product.qty);
    }
    assert.equal(demo.validState(state), true);
  } finally {
    demo.resetProducts();
  }
});

test("simulated routing data is visibly labeled and scan results link by run ID", () => {
  const app = readFileSync(join(process.cwd(), "web/routing/app.js"), "utf8");
  const page = readFileSync(join(process.cwd(), "web/routing/index.html"), "utf8");
  const scanApp = readFileSync(join(process.cwd(), "web/app.js"), "utf8");
  assert.match(app, /SIMULATED STORE DATA/);
  assert.match(page, /routing-source/);
  assert.match(scanApp, /\/routing\/\?run=\$\{encodeURIComponent\(runId\)\}/);
});

test("canonical manifest findings preserve cents, observed units, and review status", () => {
  const batch = buildRoutingBatch("run-canonical", {
    items: [{
      id: "manifest-1",
      name: "Kettle",
      brand: "Acme",
      category: "Kitchen",
      identity: { status: "confirmed" },
      quantity: { observedSaleUnits: 3, countStatus: "confirmed" },
      condition: "apparently_sealed",
      price: { amountMinor: 2499, status: "supported" },
    }],
  });
  const product = batch.products[0];
  assert.equal(product.price, 24.99);
  assert.equal(product.observedQuantity, 3);
  assert.equal(product.priceStatus, "supported");
  assert.equal(product.quantityStatus, "confirmed");
  assert.equal(product.match, "exact");
});

test("unknown quantities and prices stay unknown", () => {
  const batch = buildRoutingBatch("run-2", {
    items: [{
      id: "unknown",
      name: "Unidentified item",
      identity: { status: "unknown" },
      quantity: { observedSaleUnits: null, countStatus: "unknown" },
      price: { amountMinor: null, status: "unavailable" },
    }],
  });
  const product = batch.products[0];
  assert.equal(product.price, null);
  assert.equal(product.priceStatus, "unknown");
  assert.equal(product.observedQuantity, null);
  assert.equal(product.quantityStatus, "unknown");
  assert.equal(product.match, "review");
  assert.equal(product.condition, "Review");
});
