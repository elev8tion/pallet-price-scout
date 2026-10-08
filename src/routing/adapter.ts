export interface RoutingProduct {
  id: string;
  sourceFindingId: string;
  name: string;
  detail: string;
  category: string;
  mark: string;
  price: number | null;
  priceStatus: "supported" | "estimated" | "unknown";
  qty: number;
  observedQuantity: number | null;
  quantityStatus: "confirmed" | "estimated" | "unknown";
  sold: number;
  days: number | null;
  stock: number;
  match: "exact" | "new" | "review";
  confidence: number;
  condition: "Ready" | "Review";
  trend: [number, number, number, number];
  simulationLabel: "SIMULATED STORE DATA";
}

export interface RoutingBatch {
  schemaVersion: 1;
  runId: string;
  mode: "simulated-routing";
  label: "SIMULATED STORE DATA";
  source: "vision-findings";
  products: RoutingProduct[];
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function initials(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
  return (letters || "??").toUpperCase();
}

function simulatedSales(seed: string, eligible: boolean): Pick<RoutingProduct, "sold" | "days" | "stock" | "trend"> {
  if (!eligible) return { sold: 0, days: null, stock: 0, trend: [0, 0, 0, 0] };
  const value = hash(seed);
  const sold = 8 + (value % 43);
  const days = Number((3 + ((value >>> 8) % 220) / 10).toFixed(1));
  const stock = value % 7;
  const trend: [number, number, number, number] = [
    Math.max(0, sold - 18 - (value % 5)),
    Math.max(0, sold - 10 - (value % 4)),
    Math.max(0, sold - 4 - (value % 3)),
    sold,
  ];
  return { sold, days, stock, trend };
}

export function buildRoutingBatch(runId: string, report: unknown): RoutingBatch {
  const source = report && typeof report === "object" && !Array.isArray(report) ? report as Record<string, unknown> : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const usedIds = new Set<string>();
  const products: RoutingProduct[] = [];

  rawItems.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const item = raw as Record<string, unknown>;
    const sourceFindingId = text(item.id, `finding-${index + 1}`);
    let id = `SIM-${sourceFindingId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);

    const name = text(item.name, "Unknown item");
    const brand = text(item.brand, "Unknown brand");
    const category = text(item.category, "General");
    const priceRecord = item.price && typeof item.price === "object" && !Array.isArray(item.price) ? item.price as Record<string, unknown> : null;
    const quantityRecord = item.quantity && typeof item.quantity === "object" && !Array.isArray(item.quantity) ? item.quantity as Record<string, unknown> : null;
    const canonicalPrice = priceRecord ? nonNegativeNumber(priceRecord.amountMinor) : null;
    const observedQuantity = quantityRecord ? nonNegativeInteger(quantityRecord.observedSaleUnits) : nonNegativeInteger(item.quantity);
    const canonicalIdentityConfirmed = !item.identity || (typeof item.identity === "object" && !Array.isArray(item.identity) && (item.identity as Record<string, unknown>).status === "confirmed");
    const canonicalConditionReady = !item.condition || item.condition === "apparently_sealed";
    const rawPriceStatus = priceRecord ? text(priceRecord.status, "") : text(item.status, "");
    const priceUnavailable = rawPriceStatus.toLowerCase().includes("unavailable");
    const price = priceRecord ? (priceUnavailable || canonicalPrice === null ? null : canonicalPrice / 100) : finiteNumber(item.price);
    const priceStatus = price === null ? "unknown" : rawPriceStatus.toLowerCase().includes("estimate") ? "estimated" : "supported";
    const eligible = price !== null && canonicalIdentityConfirmed && canonicalConditionReady;
    const sales = simulatedSales(`${runId}:${sourceFindingId}`, eligible);
    const simulatedQuantity = 1 + (hash(`${runId}:${sourceFindingId}:quantity`) % 4);

    products.push({
      id,
      sourceFindingId,
      name,
      detail: `${brand} · ${category}`,
      category,
      mark: initials(name),
      price,
      priceStatus,
      qty: simulatedQuantity,
      observedQuantity,
      quantityStatus: observedQuantity === null ? "unknown" : "confirmed",
      ...sales,
      match: eligible ? "exact" : "review",
      confidence: eligible ? 92 : 62,
      condition: eligible ? "Ready" : "Review",
      simulationLabel: "SIMULATED STORE DATA",
    });
  });

  return {
    schemaVersion: 1,
    runId,
    mode: "simulated-routing",
    label: "SIMULATED STORE DATA",
    source: "vision-findings",
    products,
  };
}
