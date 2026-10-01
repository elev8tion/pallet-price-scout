# Proposed Integration Contracts

These are implementation targets, not existing endpoints. Pi API behavior is grounded in the installed 0.85.1 sources; application interfaces are new.

## 1. Authority and ownership

- Browser talks only to the local application API.
- Backend owns uploads, DB, artifact publication, and worker lifecycle.
- A dedicated Node child process owns one live Pi runtime/session at a time. Use Node IPC, not stdout parsing; extension logs must not corrupt control messages.
- Start with one active analysis globally; other runs queue. Multiple browser tabs share state, not additional agent writers.
- Each run maps to a Pi session ID/file. Keep effective cwd at `/Users/kcdacre8tor/pallet-price-scout`.
- Resolve installed Pi through the configured executable/package realpath and import its public entrypoint. Do not add an independently drifting Pi installation to the application.
- Never accept executable paths, working directories, raw Pi session file paths, or shell commands through browser API fields. No embedded terminal, separate agent CLI, provider-specific image transport, or alternate-agent fallback is in scope.
- Uploads are attached using Pi's native image input alongside the skill prompt; Pi owns inference and tool execution.

## 2. Safe browser DTOs

### Model selection

```ts
type ModelChoice = {
  provider: string;
  modelId: string;
  name: string;
  input: Array<"text" | "image">;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  inScope: boolean;
  scopedThinkingLevel?: string;
  isCurrent: boolean;
  isDefault: boolean;
  authStatus: "configured" | "unconfigured" | "error";
};
```

This is an allowlisted projection, not serialized `ModelRuntime`, provider config, auth objects, model headers, or environment variables. Availability/auth configuration is not proof of a successful live request. Preserve Pi model identifiers without rewriting suffixes. Derive supported thinking choices from the active session, not a fixed dropdown.

Selection rules:

1. Default to the same scoped/all mode as the CLI for the effective settings.
2. Resolve patterns with Pi's exported resolver, preserving scope-specific thinking settings and diagnostics.
3. Show current model first, default next, then provider ordering consistent with the CLI.
4. Display cached models immediately; refresh asynchronously with deadline and stale/error status.
5. Allow all Pi-available models, including text-only models for chat/review. For image analysis, require a model supporting image input according to Pi; explain incompatibility without hiding models or switching agents.
6. Serialize model mutations; apply only when the session is idle. Read actual model/thinking state back after changes.
7. Ordinary model selection must not implicitly rewrite global defaults. Audit installed `setModel` behavior; if necessary, use supported settings/session controls to preserve this distinction.
8. “Save as Pi default” and “Save Pi enabled models” are explicit shared-configuration changes using Pi's settings manager; warn that the CLI also observes them.
9. Never silently select a fallback model. Report a restored-session model fallback before any paid inference.

### Run

```ts
type ScoutRun = {
  id: string;
  assetId: string;
  sessionId: string | null;
  status: "queued" | "normalizing" | "ready" | "running" |
    "awaiting_input" | "validating" | "rendering" |
    "completed" | "needs_review" | "failed" | "cancelled" | "interrupted";
  model: { provider: string; modelId: string; thinkingLevel: string };
  activeStage: "inspection" | "research" | "manifest" | null;
  latestRevision: number | null;
  lastEventId: number;
  error: { code: string; message: string; retryable: boolean } | null;
};
```

Internal records additionally contain native session references, canonical asset paths, digests, timestamps, attempt IDs, worker lease, and version diagnostics. Do not expose arbitrary local paths as resource URLs.

## 3. Proposed local API

All data/control endpoints require authenticated local browser access. `Idempotency-Key` is required for run creation and retry to prevent duplicate billed work.

| Method / path | Request | Result |
|---|---|---|
| `GET /api/health` | None | Minimal application health; no filesystem/config details |
| `GET /api/runtime` | None | Pi version, safe resource/capability diagnostics, startup/trust readiness |
| `GET /api/models` | None | Available/scoped models, current/default, refresh status |
| `POST /api/models/refresh` | Empty | Start refresh; events publish fresh snapshot/errors |
| `GET /api/providers` | None | Safe auth status and available login mechanisms |
| `POST /api/providers/:id/login` | Supported auth method | Pi-owned auth flow ID; dialogs/URLs via safe events |
| `POST /api/providers/:id/logout` | Explicit confirmation | Pi logout, then updated catalog |
| `PUT /api/settings/default-model` | Provider/model/thinking | Explicit shared-default update |
| `PUT /api/settings/model-scope` | Pi model patterns | Validated resolver diagnostics and saved scope |
| `POST /api/assets` | One multipart image | Asset ID, canonical dimensions, orientation/digest, preview URL |
| `POST /api/runs` | Asset ID, provider/model/thinking, optional instructions | `202`, run ID; upload-ready UI calls this automatically after first-run consent |
| `GET /api/runs` | Cursor | Paginated run history |
| `GET /api/runs/:id` | None | Current run, latest manifest revision, capabilities |
| `GET /api/runs/:id/events` | SSE Last-Event-ID | Ordered durable event stream and heartbeat |
| `POST /api/runs/:id/messages` | Text + mode `prompt/steer/followUp` | Accepted/queued message ID |
| `PUT /api/runs/:id/model` | Provider/model/thinking | Idle-only mutation and authoritative readback |
| `POST /api/runs/:id/abort` | Empty | Abort requested; status terminal only after settlement/exit |
| `POST /api/runs/:id/retry` | Approved retry scope | New attempt linked to prior results; no hidden restart |
| `POST /api/runs/:id/dialogs/:dialogId` | Typed response or cancellation | Single-use response acknowledgement |
| `PATCH /api/runs/:id/items/:itemId` | Expected revision + allowed corrections | New revision or `409` conflict; recomputed totals |
| `POST /api/runs/:id/render` | Expected revision | Regenerate deterministic report without model invocation |
| `GET /api/assets/:id/preview` | None | Safe decoded derivative only |
| `GET /api/runs/:id/artifacts/:artifactId` | None | Registered preview/download; no arbitrary path lookup |
| `DELETE /api/runs/:id` | Confirmation; idle only | App records/artifacts removed under retention policy |

Deletion must disclose that native Pi conversation logs may still contain prompts, images, tool outputs, and prices. Offer a separately confirmed cleanup only for native sessions owned by this app. Do not remove unrelated CLI sessions or globally deduplicated assets still referenced by another run.

Provider credentials stay server-side. Where Pi requires a user-supplied code/key, forward it once to Pi over the authenticated local connection, never echo it, cache it in browser storage, or record it in events. OAuth implementation reuses Pi/provider auth callbacks; exact callback capabilities are a Phase 1/2 test gate. For login mechanisms unavailable through the browser adapter, explain that the user can configure them in their existing Pi setup and then refresh. Do not embed a terminal or introduce another agent/auth implementation.

## 4. Worker protocol and event projection

```ts
type WorkerRequest = {
  id: string;
  type: "initialize" | "inventory" | "refreshModels" | "setModel" |
    "prompt" | "steer" | "followUp" | "abort" | "answerDialog" |
    "newSession" | "resumeSession" | "dispose";
  payload: unknown; // each type has its own runtime-validated schema
};

type AppEvent = {
  schemaVersion: 1;
  id: number;            // durable, monotonically increasing per run
  runId: string;
  attemptId: string;
  createdAt: string;
  type: string;
  payload: unknown;     // allowlisted per event type
};
```

Allowlisted event types: `run.state`, `model.changed`, `catalog.updated`, `catalog.error`, `assistant.delta`, `assistant.message`, `assistant.thinking`, `tool.start`, `tool.update`, `tool.end`, `queue.updated`, `dialog.requested`, `dialog.closed`, `manifest.accepted`, `manifest.rejected`, `artifact.ready`, `usage.updated`, `runtime.warning`, `run.error`, `run.settled`.

Rules:

- Persist events before broadcasting. Reconnection replays after the last event ID; deduplicate client-side.
- Batch text deltas briefly to limit disk/DOM work. Bound message/event size, history, and subscriptions. Large images/artifacts go to files with opaque IDs, not repeated SSE base64 payloads.
- Retain native Pi session as conversation authority; app event log is a presentation/progress projection.
- Use actual Pi settled lifecycle, including queues, compaction, retries and deferred work; `agent_end` or prompt acceptance alone must not finalize the run.
- Tool completion and tool success are distinct. Preserve `isError` and tool-call identity.
- Record model identity changes so mixed-model sessions and usage are attributable.
- Do not fabricate a percentage from tool count. Display observed stages, activity and elapsed time.
- Ordinary browser disconnect leaves work running. Answer-required dialogs remain pending until their deadline; timeout cancels/denies, never approves.
- Abort propagates to Pi and app-owned subprocesses. Escalate worker termination after a grace period, mark interruption, and preserve partial results. Do not kill unrelated provider/system processes. Provider-side jobs may continue; report unconfirmed cancellation rather than claiming otherwise.
- Restart marks stale active leases interrupted and requires an explicit recovery decision before more inference.

## 5. Extension/UI bridge contract

### Standard SDK UI

Support `select`, `confirm`, `input`, `editor`, notifications, status, string widgets, and editor text where supported by the inspected interface. Correlate request IDs, honor timeouts/abort signals, reject duplicate/stale responses. Rebind after every session replacement.

`custom()` rendering, terminal keybindings and terminal-only editors are outside the web application's scope. Advertise unsupported requests and return a safe cancellation/error where possible. Do not add an embedded terminal or another agent runtime. Never fabricate successful approval.

### Existing companion tools

Worker-local `ui_display_artifact` preserves `{title, kind, content}`; persist bounded content, validate kind, emit `artifact.ready`, and return the existing title/kind details plus an app artifact reference. No requirement for piDocs on port 4000.

Worker-local `ui_ask` preserves `{question, choices?}`; correlate browser answers via IPC and use the run cancellation signal. Never return “user approved” on timeout.

Filter only the original `pi-ui-bridge.ts` from the worker's effective extension result before binding, then register these app-local equivalents. Verify there is exactly one registration per tool and no piDocs polling side effect. If the installed loader cannot safely support that filter, stop and resolve the adapter seam explicitly; do not silently disable all extensions or edit global files.

### Structured manifest submission

Add `scout_submit_manifest` with a strict schema matching section 6. Its execute handler validates, persists a candidate revision, and returns precise repairable validation errors. The backend owns final valuation and rendering. A tool result can terminate the agent's turn only when appropriate; terminal publication still depends on backend validation and artifact success.

Invoke the existing `/skill:pallet-price-scout` with the normalized image attached through Pi's native image input. Provide a run-specific addendum: canonical image path/dimensions for Pi's `read` tool, required manifest fields, run output directory, headless searches, no desktop `open`, uncertainty rules, and submission tool. Preserve the source skill file unchanged. No second agent CLI handles the image.

## 6. Canonical manifest v1

```ts
type Manifest = {
  schemaVersion: 1;
  runId: string;
  assetId: string;
  normalizedImageSha256: string;
  coordinateSpace: { width: number; height: number; units: "pixels" };
  title: string;
  currency: string;
  items: ScoutItem[];
};

type ScoutItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  variant: { size: string | null; colorOrScent: string | null; packSize: number | null };
  bbox: [number, number, number, number];
  identity: {
    status: "confirmed" | "probable" | "unknown";
    confidence: number;
    visibleEvidence: string[];
    uncertainty: string[];
  };
  quantity: {
    observedSaleUnits: number | null;
    saleUnitDescription: string; // e.g. one bottle, one sealed two-pack
    countStatus: "confirmed" | "estimated" | "unknown";
  };
  condition: "unknown" | "apparently_sealed" | "opened" | "damaged";
  price: {
    status: "supported" | "estimated" | "unavailable";
    amountMinor: number | null;
    currency: string;
    basis: "per_sale_unit";
    kind: "current_retail" | "sale" | "msrp" | "clearance" | "estimate";
    evidenceIds: string[];
    checkedAt: string | null;
  };
  evidence: Array<{
    id: string;
    url: string;
    retailer: string;
    retrievedAt: string;
    sourceKind: "product_page" | "search_snippet" | "category_page" | "user_provided";
    excerpt: string;
    snapshotArtifactId: string | null;
    listedAmountMinor: number | null;
    currency: string | null;
    productMatch: "exact" | "partial" | "mismatch";
    variantMatch: "exact" | "partial" | "unknown" | "mismatch";
    availability: "in_stock" | "out_of_stock" | "unknown";
  }>;
  duplicateOf: string | null;
  reviewerNote: string | null;
};
```

### Validation and valuation invariants

- Match canonical image digest and dimensions; reject stale-coordinate submissions for a different image.
- Require unique IDs; finite bbox values; `0 <= x1 < x2 <= width`, `0 <= y1 < y2 <= height`. No silent invalid crop repair.
- Use integer minor-unit prices and ISO currency. USD is the proposed initial market; do not silently mix or convert currencies.
- Confidence is the model's declared estimate, not calibrated proof. A high confidence score cannot establish a supported price.
- Supported price requires an exact product/variant direct listing with recorded price evidence and retrieval time. Category pages, search snippets, mismatched packs, and unsupported amounts cannot qualify. Schema checks verify structure, not truth: independently compare the retrieved passage/snapshot with the claim; unreadable or ambiguous sources remain estimated/unavailable or require human review.
- Retailer identity must agree with the linked source; links accept only HTTP(S). No `javascript:`, `file:`, `data:` product sources.
- `supported visible retail total` sums `amountMinor × observedSaleUnits` only for confirmed identities/counts with supported matching prices and no duplicate flag.
- `additional estimated visible value` is a separate subtotal of priced, non-duplicate entries excluded from the supported subtotal for identity/count/price uncertainty. An item never contributes to both. Unknown quantities/prices are excluded and counted visibly.
- Count product records, confirmed sale units and unknown quantities separately. A four-bottle bundle cannot become four times a bundle price; match the priced sale unit before multiplication.
- Do not infer contents of occluded containers or the unseen pallet. No pallet extrapolation multiplier.
- Retail reference value is not expected resale revenue. Opened/damaged/unknown condition, shipping, tax and sales channel economics remain explicit limitations.
- Do not blindly sum MSRP, sale and current prices without labeling the basis per item. Totals describe the selected reference basis, not a guaranteed realizable value.
- Every manual edit creates a revision with actor/time/reason. Editing identity/variant invalidates incompatible price evidence; editing count/price recomputes totals server-side.

## 7. Images, output and storage

Proposed layout:

```text
data/                         # ignored, private local application data
  scout.sqlite
  assets/<asset-id>/
    original.<validated-ext>
    normalized.jpg
    preview.jpg
    metadata.json
  runs/<run-id>/
    attempts/<attempt-id>/
    revisions/<revision>/manifest.json
    revisions/<revision>/report.html
    revisions/<revision>/crops/<item-id>.jpg
    evidence/<artifact-id>
```

Native Pi session files stay in Pi's normal location, referenced internally by the DB. Do not keep active application data under `/tmp` or automatically overwrite `~/Downloads`.

- Proposed defaults: one JPEG/PNG/HEIC/HEIF image per run, 30 MiB compressed limit, 60 megapixel decode limit, bounded dimensions and conversion time. Make limits visible and configurable locally.
- Check decoded content, not filename alone; reject SVG/HTML disguised as images and truncated/decompression-bomb inputs. Reject unsupported animated/multi-frame input rather than silently picking a frame.
- Use safe process argument arrays for `sips`/Python; strip metadata from derivatives, retain original privately. Normalize orientation exactly once and record resulting dimensions.
- Keep original-resolution canonical image for crops; smaller previews/agent inputs require declared coordinate transforms.
- Use temp files then atomic rename; associate DB publication with complete artifacts, not partially written reports.
- Preserve the original renderer globally. An app-local adapted renderer must escape text/attributes/JSON contexts, validate links, distinguish totals/counts, support no-open/headless operation, and use local/system assets rather than mandatory Google Fonts.
- Render trusted React item views from validated JSON. Preview generated HTML only in a restrictive sandbox without `allow-same-origin`; enforce CSP and no local API/network access. Prefer app-controlled source links outside the iframe.
- Download HTML as an attachment. Self-contained export has embedded crops and no external runtime dependencies; it is a snapshot with evidence dates and uncertainty labels, not live prices.

## 8. Local security and privacy boundary

- Bind to `127.0.0.1` only by default; reject unexpected Host and Origin values to reduce DNS rebinding/CSRF exposure. No permissive CORS.
- Pair browser through a one-time, expiring launch credential, exchange for an HttpOnly SameSite cookie, then remove the credential from URL/history. Protect mutations with CSRF checks. Never include provider tokens in URLs.
- Authenticate SSE as well as HTTP. Expose no terminal or raw agent-CLI control endpoint.
- Keep artifacts untrusted: no raw HTML in the application DOM, no inline SVG injection, no trusting iframe `postMessage` as a command channel.
- Allowlisted opaque file IDs resolve under canonical app roots; verify realpaths and symlinks. No file-read endpoint accepting user paths.
- App-owned URL retrieval, if added, must block loopback/private/link-local/metadata destinations and recheck redirects/DNS. Existing Pi search/network tools retain their normal authority; do not advertise a sandbox that the agent's bash can bypass.
- Bound upload bytes, event payloads, artifact bytes, worker concurrency and runtime. Inference costs/usage shown when supplied by Pi; unknown cost stays unknown.
- Redact known credential fields and bearer tokens from diagnostic logs; do not record auth responses. Raw tool logs can contain private information and should not be casually exported.
- First-run disclosure: this grants the installed Pi agent local user authority and sends images/context to the selected provider when required. Local model selection does not imply web searches are local.
- Project-resource trust is an explicit Pi-compatible decision; no global trust-policy rewrites or blanket approval.

## 9. Error codes and recovery

Minimum codes: `PI_NOT_FOUND`, `PI_VERSION_UNSUPPORTED`, `PROJECT_TRUST_REQUIRED`, `EXTENSION_LOAD_FAILED`, `REQUIRED_TOOL_MISSING`, `MODEL_UNAVAILABLE`, `MODEL_IMAGE_INPUT_UNSUPPORTED`, `PI_IMAGE_INPUT_INVALID`, `AUTH_REQUIRED`, `PROVIDER_CREDITS_EXHAUSTED`, `PI_REQUEST_FAILED`, `UPLOAD_INVALID`, `UPLOAD_TOO_LARGE`, `NORMALIZATION_FAILED`, `SEARCH_FAILED`, `MANIFEST_INVALID`, `EVIDENCE_INSUFFICIENT`, `REPORT_FAILED`, `DIALOG_EXPIRED`, `WORKER_EXITED`, `SESSION_BUSY`, `REVISION_CONFLICT`.

Preserve stage, attempt ID, safe diagnostics, and last good manifest on failure. A search outage can yield a needs-review inventory with unavailable prices; it must not produce invented prices. A renderer retry uses the existing manifest without rebilling inference. A model/provider retry is explicit and records the selected identity.
