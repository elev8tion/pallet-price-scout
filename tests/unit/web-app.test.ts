import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

/** Minimal DOM element: enough of the surface web/app.js touches. */
class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  listeners: Record<string, Array<(event?: any) => any>> = {};
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name), contains: (name: string) => this.classes.has(name) };
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  textContent = "";
  className = "";
  value = "";
  selected = false;
  disabled = false;
  scrollTop = 0;
  scrollHeight = 0;
  [key: string]: any;
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter((child) => child.selected); }
  append(...nodes: FakeElement[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: FakeElement[]) { this.children = []; this.append(...nodes); }
  addEventListener(type: string, listener: (event?: any) => any) { (this.listeners[type] ??= []).push(listener); }
  removeAttribute(name: string) { delete this[name]; }
  querySelector() { return null; }
  closest(selector: string) { let node: FakeElement | null = this; while (node) { if (selector === `.${node.className}`) return node; node = node.parent; } return null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  focus() {}
}

const runs = [
  { id: "run-new", assetId: "asset-new", status: "completed", model: { modelId: "model" }, createdAt: "2026-09-11T13:14:33Z" },
  { id: "run-old", assetId: "asset-old", status: "completed", model: { modelId: "model" }, createdAt: "2026-09-11T13:02:59Z" },
];

async function loadApp() {
  const elements = new Map<string, FakeElement>();
  const requests: string[] = [];
  const streams: string[] = [];
  const context: any = {
    console, setTimeout, clearTimeout, URLSearchParams,
    location: { search: "" },
    history: { replaceState() {} },
    document: {
      getElementById: (id: string) => { if (!elements.has(id)) elements.set(id, new FakeElement()); return elements.get(id); },
      createElement: () => new FakeElement(),
      querySelector: () => new FakeElement(),
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    EventSource: class { constructor(url: string) { streams.push(url); } addEventListener() {} close() {} },
    fetch: async (path: string, init: any = {}) => {
      requests.push(`${init.method ?? "GET"} ${path}`);
      const body = path.startsWith("/api/bootstrap") ? { ok: true, csrfToken: "csrf" }
        : path === "/api/runtime" ? { workerReady: true, workerBusy: false }
        : path === "/api/models" ? { models: [], scopePatterns: [] }
        : path === "/api/runs" ? runs
        : path.startsWith("/api/runs/") ? runs.find((run) => path.endsWith(run.id))
        : {};
      return { ok: true, status: 200, json: async () => body };
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(join(process.cwd(), "web", "app.js"), "utf8"), context);
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 10)); };
  await settle();
  return { context, elements, requests, streams, settle };
}

test("launch starts a new-analysis workspace without opening history", async () => {
  const app = await loadApp();
  assert.equal(app.requests.some((request) => request.includes("/api/runs/run-")), false, "launch does not fetch a run for the workspace");
  assert.deepEqual(app.streams, [], "launch does not replay a historical run");
  assert.equal(app.elements.get("history")!.children.length, runs.length, "history remains available for explicit selection");
  assert.equal(app.elements.get("empty-state")!.classes.has("hidden"), false, "the new-analysis empty state is visible");
});

test("clicking a History entry opens that run", async () => {
  const app = await loadApp();
  const entry = app.elements.get("history")!.children.find((item) => item.children[0].children[0].textContent === "run-old".slice(0, 8))!;
  entry.children[0].listeners.click[0]();
  await app.settle();
  assert.equal(app.streams.at(-1), "/api/runs/run-old/events", "a History click loads the run instead of stopping after the first request");
  assert.ok(app.requests.includes("GET /api/assets/asset-old/preview"));
});

