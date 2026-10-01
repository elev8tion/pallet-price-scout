import assert from "node:assert/strict";
import test from "node:test";

type Product = {
  id: string;
  qty: number;
  price: number | null;
  sold: number;
  days: number | null;
  stock: number;
  match: string;
  condition: string;
};

type DemoState = {
  pulls: Record<string, number>;
  transfer: unknown;
  pallets: Array<{ items: Record<string, number> }>;
  draft: { tier: number; items: Record<string, number> };
};

type DemoModule = {
  PRODUCTS: Product[];
  TIERS: number[];
  retailTarget: (tier: number) => number;
  initialState: () => DemoState;
  recommended: (product: Product) => number;
  eligible: (product: Product | undefined) => boolean;
  available: (state: DemoState, id: string) => number;
  setPull: (state: DemoState, id: string, qty: number) => void;
  setDraftQty: (state: DemoState, id: string, qty: number) => void;
  autoFill: (state: DemoState) => void;
  value: (items: Record<string, number>) => number;
  pack: (state: DemoState) => void;
  sendTransfer: (state: DemoState) => { items: Record<string, number>; status: string };
  validState: (state: unknown) => boolean;
  totalQty: (items: Record<string, number>) => number;
};

// @ts-expect-error demo.js is an untyped browser fixture served at /routing/
const demo = await import("../../web/routing/demo.js");
const {
  PRODUCTS, TIERS, retailTarget, initialState, recommended, eligible,
  available, setPull, setDraftQty, autoFill, value, pack, sendTransfer,
  validState, totalQty,
} = demo as DemoModule;

test("30% above sale is retail ×1.30, not a 30% discount", () => {
  assert.deepEqual(TIERS.map(retailTarget), [52000, 78000, 117000, 182000]);
});

test("seven-day cover minus on-hand, capped by batch, only exact fast matches", () => {
  assert.equal(recommended(PRODUCTS[0]), 10);
  assert.equal(recommended(PRODUCTS[4]), 6);
  assert.equal(recommended(PRODUCTS[14]), 0);
  assert.equal(recommended(PRODUCTS[6]), 0);
  assert.ok(PRODUCTS.every((product) => recommended(product) <= product.qty));
});

test("all tiers autofill to target without allocating held or reserved inventory", () => {
  for (const tier of TIERS) {
    const state = initialState();
    state.draft.tier = tier;
    autoFill(state);
    assert.equal(value(state.draft.items), retailTarget(tier));
    for (const [id, qty] of Object.entries(state.draft.items)) {
      assert.ok(qty <= available(state, id));
      assert.ok(eligible(PRODUCTS.find((product) => product.id === id)));
    }
  }
});

test("packing consecutive pallets conserves all stock and never double-allocates", () => {
  const state = initialState();
  for (const tier of TIERS) {
    state.draft.tier = tier;
    autoFill(state);
    pack(state);
  }
  assert.equal(state.pallets.length, 4);
  assert.deepEqual(state.draft.items, {});
  for (const product of PRODUCTS) {
    assert.equal(available(state, product.id) + state.pulls[product.id] + state.pallets.reduce((sum, pallet) => sum + (pallet.items[product.id] || 0), 0), product.qty);
  }
  assert.ok(validState(state));
});

test("manual pull validates quantities and clamps a conflicting draft", () => {
  const state = initialState();
  setDraftQty(state, "NIN-101", 4);
  setPull(state, "NIN-101", 14);
  assert.equal(state.draft.items["NIN-101"], 0);
  for (const qty of [-1, 1.5, 15, Number.NaN]) assert.throws(() => setPull(state, "NIN-101", qty));
  assert.throws(() => setPull(state, "UNK-01", 1));
  assert.throws(() => setPull(state, "BEL-15", 1));
});

test("draft rejects overstock and held products; underfilled pallet cannot pack", () => {
  const state = initialState();
  assert.throws(() => pack(state));
  assert.throws(() => setDraftQty(state, "NIN-101", 5));
  assert.throws(() => setDraftQty(state, "DY-V8", 1));
});

test("sending a transfer is simulated, locks pulls, and cannot be repeated", () => {
  const state = initialState();
  const before = totalQty(state.pulls);
  const transfer = sendTransfer(state);
  assert.equal(totalQty(transfer.items), before);
  assert.equal(transfer.status, "Sent (simulated)");
  assert.throws(() => sendTransfer(state));
  assert.throws(() => setPull(state, "NIN-101", 0));
  assert.ok(validState(state));
});

test("exhaustion reports shortage without changing the draft", () => {
  const state = initialState();
  let built = 0;
  while (true) {
    try {
      autoFill(state);
      pack(state);
      built++;
    } catch (error) {
      assert.match((error as Error).message, /Not enough|No unallocated/);
      break;
    }
  }
  assert.ok(built > 0);
  assert.ok(validState(state));
  assert.deepEqual(state.draft.items, {});
});

test("restored data rejects malformed, overallocated and unsafe states", () => {
  assert.ok(validState(initialState()));
  assert.equal(validState(null), false);
  const state = initialState();
  state.pulls["NIN-101"] = 100;
  assert.equal(validState(state), false);
  state.pulls["NIN-101"] = 0;
  state.draft.items["UNK-01"] = 1;
  assert.equal(validState(state), false);
});
