export type IdentityStatus = "confirmed" | "probable" | "unknown";
export type CountStatus = "confirmed" | "estimated" | "unknown";
export type PriceStatus = "supported" | "estimated" | "unavailable";

export interface Evidence {
  id: string; url: string; retailer: string; retrievedAt: string;
  sourceKind: "product_page" | "search_snippet" | "category_page" | "user_provided";
  excerpt: string; snapshotArtifactId: string | null; listedAmountMinor: number | null;
  currency: string | null; productMatch: "exact" | "partial" | "mismatch";
  variantMatch: "exact" | "partial" | "unknown" | "mismatch";
  availability: "in_stock" | "out_of_stock" | "unknown";
}
export interface ScoutItem {
  id: string; name: string; brand: string | null; category: string;
  variant: { size: string | null; colorOrScent: string | null; packSize: number | null };
  bbox: [number, number, number, number];
  identity: { status: IdentityStatus; confidence: number; visibleEvidence: string[]; uncertainty: string[] };
  quantity: { observedSaleUnits: number | null; saleUnitDescription: string; countStatus: CountStatus };
  condition: "unknown" | "apparently_sealed" | "opened" | "damaged";
  price: { status: PriceStatus; amountMinor: number | null; currency: string; basis: "per_sale_unit"; kind: "current_retail" | "sale" | "msrp" | "clearance" | "estimate"; evidenceIds: string[]; checkedAt: string | null };
  evidence: Evidence[]; duplicateOf: string | null; reviewerNote: string | null;
}
export interface Manifest {
  schemaVersion: 1; runId: string; assetId: string; normalizedImageSha256: string;
  coordinateSpace: { width: number; height: number; units: "pixels" };
  title: string; currency: string; items: ScoutItem[];
}

export interface ValidationResult { manifest: Manifest | null; errors: string[]; warnings: string[] }
export interface Valuation { supportedMinor: number; estimatedMinor: number; currency: string; recordCount: number; confirmedSaleUnits: number; unknownQuantityCount: number; excludedCount: number }

const currencies = /^[A-Z]{3}$/;
const httpUrl = /^https?:\/\/[^\s]+$/i;
const isObject = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function required(object: Record<string, any>, field: string, errors: string[], path: string): any {
  if (!(field in object)) errors.push(`${path}.${field} is required`);
  return object[field];
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

export function validateManifest(value: unknown, expected: { runId: string; assetId: string; sha256: string; width: number; height: number; currency?: string }): ValidationResult {
  const errors: string[] = [], warnings: string[] = [];
  if (!isObject(value)) return { manifest: null, errors: ["manifest must be an object"], warnings };
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  for (const [field, expectedValue] of [["runId", expected.runId], ["assetId", expected.assetId], ["normalizedImageSha256", expected.sha256]] as const) if (value[field] !== expectedValue) errors.push(`${field} does not match the active run`);
  if (!isObject(value.coordinateSpace) || value.coordinateSpace.width !== expected.width || value.coordinateSpace.height !== expected.height || value.coordinateSpace.units !== "pixels") errors.push("coordinateSpace must match the normalized asset in pixels");
  if (typeof value.title !== "string" || !value.title.trim()) errors.push("title must be a non-empty string");
  if (typeof value.currency !== "string" || !currencies.test(value.currency)) errors.push("currency must be an ISO 4217 code");
  if (expected.currency && value.currency !== expected.currency) errors.push("currency does not match the run market");
  if (!Array.isArray(value.items)) errors.push("items must be an array");
  const ids = new Set<string>();
  for (const [index, item] of (Array.isArray(value.items) ? value.items : []).entries()) {
    const path = `items[${index}]`;
    if (!isObject(item)) { errors.push(`${path} must be an object`); continue; }
    const id = required(item, "id", errors, path);
    if (typeof id !== "string" || !id) errors.push(`${path}.id must be non-empty`);
    else if (ids.has(id)) errors.push(`${path}.id must be unique`); else ids.add(id);
    for (const field of ["name", "category"] as const) if (typeof required(item, field, errors, path) !== "string") errors.push(`${path}.${field} must be a string`);
    if (!Array.isArray(item.bbox) || item.bbox.length !== 4 || item.bbox.some((v: unknown) => !finite(v))) errors.push(`${path}.bbox must contain four finite numbers`);
    else { const [x1, y1, x2, y2] = item.bbox; if (!(0 <= x1 && x1 < x2 && x2 <= expected.width && 0 <= y1 && y1 < y2 && y2 <= expected.height)) errors.push(`${path}.bbox is outside the normalized image`); }
    if (!isObject(item.identity) || !["confirmed", "probable", "unknown"].includes(item.identity.status) || !finite(item.identity.confidence) || item.identity.confidence < 0 || item.identity.confidence > 1) errors.push(`${path}.identity is invalid`);
    if (!isObject(item.quantity) || !["confirmed", "estimated", "unknown"].includes(item.quantity.countStatus) || typeof item.quantity.saleUnitDescription !== "string") errors.push(`${path}.quantity is invalid`);
    if (item.quantity?.observedSaleUnits !== null && (!Number.isInteger(item.quantity?.observedSaleUnits) || item.quantity.observedSaleUnits < 0)) errors.push(`${path}.quantity.observedSaleUnits must be a non-negative integer or null`);
    if (!isObject(item.price) || !["supported", "estimated", "unavailable"].includes(item.price.status) || item.price.basis !== "per_sale_unit" || typeof item.price.currency !== "string" || !currencies.test(item.price.currency)) errors.push(`${path}.price is invalid`);
    if (item.price?.amountMinor !== null && (!Number.isInteger(item.price?.amountMinor) || item.price.amountMinor < 0)) errors.push(`${path}.price.amountMinor must be a non-negative integer or null`);
    if (item.price?.status === "supported" && (!Number.isInteger(item.price.amountMinor) || item.price.amountMinor < 0)) errors.push(`${path}.price.supported requires amountMinor`);
    if (!Array.isArray(item.evidence)) errors.push(`${path}.evidence must be an array`);
    else for (const [eIndex, evidence] of item.evidence.entries()) {
      const ePath = `${path}.evidence[${eIndex}]`;
      if (!isObject(evidence) || typeof evidence.id !== "string" || !httpUrl.test(evidence.url ?? "") || typeof evidence.retailer !== "string" || !currencies.test(evidence.currency ?? "")) errors.push(`${ePath} is invalid`);
      if (evidence?.sourceKind === "search_snippet" || evidence?.sourceKind === "category_page") warnings.push(`${ePath} cannot independently support a price`);
      if (evidence?.productMatch !== "exact" || evidence?.variantMatch !== "exact") warnings.push(`${ePath} is not an exact product/variant match`);
    }
    if (item.price?.currency !== value.currency) errors.push(`${path}.price.currency must match manifest currency`);
    if (item.price?.status === "supported" && (item.identity?.status !== "confirmed" || item.quantity?.countStatus !== "confirmed")) warnings.push(`${path} supported price excluded because identity or count is not confirmed`);
    if (item.duplicateOf !== null && typeof item.duplicateOf !== "string") errors.push(`${path}.duplicateOf must be a string or null`);
  }
  return { manifest: errors.length ? null : value as Manifest, errors, warnings };
}

export function calculateValuation(manifest: Manifest): Valuation {
  let supportedMinor = 0, estimatedMinor = 0, confirmedSaleUnits = 0, unknownQuantityCount = 0, excludedCount = 0;
  const ids = new Set(manifest.items.map((item) => item.id));
  for (const item of manifest.items) {
    const duplicate = item.duplicateOf !== null && ids.has(item.duplicateOf);
    const units = item.quantity?.observedSaleUnits ?? null;
    // Duplicates are excluded from all totals including confirmed sale units.
    if (!duplicate && item.quantity?.countStatus === "confirmed" && units !== null) confirmedSaleUnits += units;
    if (units === null || item.quantity?.countStatus === "unknown") unknownQuantityCount++;
    // Supported value requires at least one exact product-page evidence whose listed amount and currency match the claimed price.
    const matchingEvidence = item.evidence.some((evidence) =>
      evidence.productMatch === "exact" &&
      evidence.variantMatch === "exact" &&
      evidence.sourceKind === "product_page" &&
      evidence.listedAmountMinor === item.price.amountMinor &&
      evidence.currency === item.price.currency,
    );
    const supported = !duplicate && item.identity?.status === "confirmed" && item.quantity?.countStatus === "confirmed" && units !== null && item.price.status === "supported" && item.price.amountMinor !== null && matchingEvidence;
    const estimated = !duplicate && !supported && units !== null && item.price.amountMinor !== null && item.price.status !== "unavailable";
    if (supported) supportedMinor += item.price.amountMinor! * units!;
    else if (estimated) estimatedMinor += item.price.amountMinor! * units!;
    else excludedCount++;
  }
  return { supportedMinor, estimatedMinor, currency: manifest.currency, recordCount: manifest.items.length, confirmedSaleUnits, unknownQuantityCount, excludedCount };
}
