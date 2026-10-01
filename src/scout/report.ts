import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "../db/database.js";

export interface LegacyFinding {
  id: string;
  name: string;
  brand: string;
  category: string;
  coords: [number, number, number, number];
  price: number | null;
  status: string;
  retailer: string;
  source_url: string;
  description: string;
  image_b64?: string;
}

export interface FindingsInput {
  title?: unknown;
  subtitle?: unknown;
  coord_scale_w?: unknown;
  coord_scale_h?: unknown;
  items?: unknown;
}

const MAX_ITEMS = 100;
const MAX_ARTIFACT_BYTES = 8_000_000;
const REPORT_SCRIPT = join(homedir(), ".pi", "agent", "skills", "pallet-price-scout", "scripts", "crop_and_report.py");

function stringValue(value: unknown, fallback: string, max = 500): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeFindings(input: FindingsInput): { title: string; subtitle: string; coord_scale_w: number; coord_scale_h: number; items: LegacyFinding[] } {
  const coordScaleW = finite(input.coord_scale_w) && input.coord_scale_w > 0 ? input.coord_scale_w : 1;
  const coordScaleH = finite(input.coord_scale_h) && input.coord_scale_h > 0 ? input.coord_scale_h : 1;
  if (!Array.isArray(input.items)) throw new Error("REPORT_INVALID: findings.items must be an array");
  if (input.items.length > MAX_ITEMS) throw new Error(`REPORT_INVALID: at most ${MAX_ITEMS} findings are allowed`);

  const items = input.items.map((raw, index): LegacyFinding => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`REPORT_INVALID: finding ${index + 1} is not an object`);
    const item = raw as Record<string, unknown>;
    const coords = item.coords;
    if (!Array.isArray(coords) || coords.length !== 4 || coords.some((value) => !finite(value))) {
      throw new Error(`REPORT_INVALID: finding ${index + 1} needs four numeric coordinates`);
    }
    const [x1, y1, x2, y2] = coords as number[];
    if (!(0 <= x1 && x1 < x2 && x2 <= coordScaleW && 0 <= y1 && y1 < y2 && y2 <= coordScaleH)) {
      throw new Error(`REPORT_INVALID: finding ${index + 1} coordinates are outside the image scale`);
    }
    return {
      id: stringValue(item.id, `finding-${index + 1}`, 100),
      name: stringValue(item.name, "Unknown item"),
      brand: stringValue(item.brand, "Unknown brand", 160),
      category: stringValue(item.category, "General", 120),
      coords: [x1, y1, x2, y2],
      price: numberValue(item.price),
      status: stringValue(item.status, "Needs review", 120),
      retailer: stringValue(item.retailer, "No retailer recorded", 160),
      source_url: typeof item.source_url === "string" && /^https?:\/\/[^\s]+$/i.test(item.source_url) ? item.source_url : "",
      description: stringValue(item.description, "No description recorded.", 600),
    };
  });
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`REPORT_INVALID: duplicate finding id ${item.id}`);
    ids.add(item.id);
  }
  return {
    title: stringValue(input.title, "Pallet Price Scout", 200),
    subtitle: stringValue(input.subtitle, "Sorted visible inventory findings", 300),
    coord_scale_w: coordScaleW,
    coord_scale_h: coordScaleH,
    items,
  };
}

function sortFindings(items: LegacyFinding[]): LegacyFinding[] {
  return [...items].sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name));
}

export function publishFindings(options: {
  db: Database;
  dataDir: string;
  runId: string;
  imagePath: string;
  input: FindingsInput;
}): { artifactId: string; report: Record<string, unknown> } {
  const normalized = normalizeFindings(options.input);
  const runDir = join(options.dataDir, "runs", options.runId);
  mkdirSync(runDir, { recursive: true });
  const itemsPath = join(runDir, "items.json");
  const generatedReportPath = join(runDir, "legacy-report.html");
  const scriptInput = {
    title: normalized.title,
    subtitle: normalized.subtitle,
    coord_scale_w: normalized.coord_scale_w,
    coord_scale_h: normalized.coord_scale_h,
    items: normalized.items.map((item) => ({ ...item, price: item.price ?? 0 })),
  };
  writeFileSync(itemsPath, JSON.stringify(scriptInput, null, 2), { encoding: "utf8", flag: "w" });
  // Generate crop data URIs and write them back into items.json before the HTML renderer reads it.
  try {
    execFileSync("python3", [join(process.cwd(), "scripts", "generate_crops.py"), options.imagePath, itemsPath], { cwd: runDir, encoding: "utf8", timeout: 60_000, stdio: "pipe" });
  } catch {
    // Crops are optional; the report remains useful without them.
  }
  try {
    execFileSync("python3", [REPORT_SCRIPT, options.imagePath, itemsPath, generatedReportPath, "--no-open"], {
      cwd: runDir,
      encoding: "utf8",
      timeout: 120_000,
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(`REPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }

  let renderedItems: LegacyFinding[] = normalized.items;
  try {
    const rendered = JSON.parse(readFileSync(itemsPath, "utf8")) as { items?: LegacyFinding[] };
    if (Array.isArray(rendered.items)) renderedItems = normalized.items.map((item) => ({ ...item, image_b64: rendered.items?.find((candidate) => candidate.id === item.id)?.image_b64 }));
  } catch {
    // The report remains useful without crop data; the browser still shows the finding details.
  }

  const items = sortFindings(renderedItems);
  const priced = items.filter((item) => item.price !== null);
  const totalValue = priced.reduce((sum, item) => sum + (item.price ?? 0), 0);
  const report = {
    schemaVersion: 1,
    type: "pallet-findings",
    title: normalized.title,
    subtitle: normalized.subtitle,
    sortedBy: "price_descending",
    totalValue: Number(totalValue.toFixed(2)),
    totalLabel: "Unverified reference sum (not quantity-adjusted)",
    pricedCount: priced.length,
    unknownPriceCount: items.length - priced.length,
    generatedAt: new Date().toISOString(),
    items,
  };
  const content = JSON.stringify(report);
  if (Buffer.byteLength(content, "utf8") > MAX_ARTIFACT_BYTES) throw new Error("REPORT_FAILED: findings artifact exceeds the browser limit");
  const artifactId = `${options.runId}-findings`;
  const artifactPath = join(runDir, "findings.json");
  writeFileSync(artifactPath, content, { encoding: "utf8", flag: "w" });
  options.db.insertArtifact({ id: artifactId, runId: options.runId, title: normalized.title, kind: "table", path: artifactPath, createdAt: new Date().toISOString() });
  return { artifactId, report };
}
