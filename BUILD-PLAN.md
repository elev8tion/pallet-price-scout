# Change Blueprint — Pallet Price Scout

**Goal:** build a local web interface in `/Users/kcdacre8tor/pallet-price-scout` that uses the user's existing Pi agent and model configuration to run the installed pallet-pricing skill on uploaded images.

**Status:** ready for implementation, subject to Phase 1 runtime compatibility gates. No app has been built yet.

## 1. Architecture decision

### Selected: installed Pi SDK in a supervised worker

Recommended stack:

- **Backend:** Node/TypeScript + Fastify; local HTTP, validated input, process supervision, SQLite metadata, SSE.
- **Frontend:** React + Vite + TypeScript; model picker, conversation/tool activity, image inspection, structured item editor, report history. No separate LLM SDK/client in the frontend or backend.
- **Agent worker:** public exports from the user's installed `@earendil-works/pi-coding-agent` **0.85.1**, using `createAgentSessionServices`, `createAgentSessionFromServices`, session runtime, model runtime, native settings and resource loader.
- **Storage:** SQLite for runs/assets/revisions/events/leases, files for image/evidence/report payloads, native Pi JSONL for agent conversations. Choose a maintained SQLite driver compatible with the verified Node version during scaffold; keep DB access behind a small repository module.
- **Imaging:** existing Python/Pillow technique, `sips` for HEIC on this Mac; app-local secure renderer derived from the current script.
- **Images:** use Pi's native image input with the uploaded normalized image and skill prompt. Pi already supports images; no separate vision runtime is needed.
- **Scope:** Pi only. No separate agent CLI, embedded terminal, provider-specific transport adapter, or alternate-agent fallback.

Do not introduce Go, another agent orchestration service, provider-specific chat clients, cloud storage, Redis, a queue server, or a second credentials store for this local single-user workload.

### Options evaluated

| Option | Strength | Limitation | Decision |
|---|---|---|---|
| Installed Pi SDK worker | Same agent services; full model/auth/settings controls; direct extension/event integration | Must bind browser UI and prove discovery parity | **Primary** |
| `pi --mode rpc` child | Runs actual executable; simple event protocol | Model snapshot/switch support is narrower than full selector management | Viable smaller-scope alternative, not primary |
| Fork/extend existing piDocs | Familiar event/artifact concepts already exist | Separate app destination requested; bridge/tool transport and security need adaptation | Reference selected patterns, do not require it |
| Embedded terminal | Reproduces terminal interfaces | Unrequested scope; unnecessary for Pi image/skill/model workflow | Excluded |
| Direct OpenAI-compatible provider calls | Easy basic chat | Loses Pi tools, skills, providers, settings, sessions and semantics | Rejected |

**Parity statement:** preserve Pi's model selectability, native image input, tools, skills and agent runtime behavior. This is a web interface to Pi, not another agent integration. Reproducing every terminal widget is outside scope; label unsupported UI requests rather than adding a terminal or alternate CLI.

## 2. Scope classification

### What stays

- Existing Pi executable/package and `~/.pi/agent` as the agent source of truth.
- Current auth, global defaults, provider extensions, model patterns and local model definitions.
- Pi's agent loop, tools, prompts, skills, sessions, retries/compaction/queues.
- Existing `pallet-price-scout` skill and original global report script, still usable from CLI.
- Existing piDocs and its normal CLI companion behavior.

### What changes

| ID | Change | Type | Risk | Proposed files | Acceptance |
|---|---|---|---|---|---|
| C1 | Installed-runtime discovery/model parity adapter | Add | HIGH | `src/agent/*`, `tests/integration/pi-parity.test.ts` | Same effective model/resource sets as CLI |
| C2 | Authenticated local server, persistence, worker supervision | Add | HIGH | `src/server/*`, `src/db/*`, `src/shared/*` | No unauthenticated control; durable recovery |
| C3 | App-local companion/SDK UI bindings | Transform in worker only | HIGH | `src/agent/ui-context.ts`, `extensions/scout-web-bridge.ts` | Questions round-trip; artifacts acknowledged; no duplicate global bridge |
| C4 | Image/run skill orchestration | Add | MED | `src/scout/*`, `scripts/normalize_image.py` | Canonical image reaches selected Pi model/tool pipeline |
| C5 | Evidence/quantity schema and valuation | Add | HIGH | `src/scout/manifest.ts`, `valuation.ts`, `evidence.ts` | Unsupported records excluded from supported totals |
| C6 | Safe report adaptation | Add / adapt copy | MED | `scripts/render_report.py`, report tests | Headless, escaped, correct crops/totals, self-contained export |
| C7 | Browser workspace/model controls/history | Add | MED | `web/src/*` | Full upload→inspect→correct→export journey |

No upstream/global source mutation is planned. C1/C3/C5 have dedicated acceptance gates because they touch load-bearing behavior despite being additive.

## 3. Proposed directory layout

```text
pallet-price-scout/
  README.md
  SYSTEM-MAP.md
  BUILD-PLAN.md
  CONTRACTS.md
  package.json
  tsconfig.json
  .gitignore
  src/
    server/       # bootstrap, routes, security, SSE, worker leases
    agent/        # installed package resolution, SDK lifecycle/model/UI adapters
    db/           # schema/migrations/repositories
    scout/        # run orchestration, validation, evidence, valuation, artifacts
    shared/       # runtime-validated DTOs and event contracts
  extensions/
    scout-web-bridge.ts
  scripts/
    normalize_image.py
    render_report.py
  web/
    src/
      model-picker/
      workspace/
      inspector/
      history/
  tests/
    unit/
    integration/
    fixtures/     # synthetic/public fixtures only, no private uploads
    browser/      # documented journey cases and results
  data/           # private, ignored; created at runtime
```

Paths above are planned, not yet created. Keep business logic independent of React views and Pi transcript formatting. Avoid an elaborate plugin framework: one runtime adapter, one UI adapter, one workflow service are sufficient.

## 4. Safe execution order

1. **Prove Pi parity first** — no expensive UI build before confirming the actual runtime/provider/extension seams.
2. **Create protected local foundations** — browser controls must never expose a raw user-authority agent without authentication.
3. **Prove UI/companion transport** — no production skill runs until questions, approvals, aborts and artifacts work.
4. **Wire upload and the existing skill** — canonical images, selected model and durable run ownership.
5. **Gate evidence and produce safe reports** — independently validate the model's output.
6. **Finish the Pi web workspace** — deliver the complete image/model/skill/report workflow without another agent or terminal integration.
7. **Verify, document and release** — real-browser journey plus synthetic/security/runtime tests.

Sequential gates are deliberate. Do not parallelize writers in this cwd; isolated read-only reviews can be delegated if useful. Do not introduce an alternative agent execution path to work around a failed runtime test without an explicit architecture decision.

## 5. Implementation phases

### Phase 1 — Installed Pi compatibility spike

**Goal:** prove the central promise: this is the user's Pi agent in another interface, not an approximate replacement.

**Files:** `src/agent/installation.ts`, `runtime.ts`, `model-selection.ts`, `tests/integration/pi-parity.test.ts`, `docs/COMPATIBILITY.md`.

Tasks:

- Resolve the installed executable/package path and public exports. Check version before import/use; report a clear unsupported-version diagnostic rather than downloading another Pi version.
- Create services with explicit project cwd and existing agent directory; retain default discovery of packages, prompts, skills and provider extensions. Record redacted inventory and load/trust errors.
- Resolve configured scope/default/model/thinking through the same public Pi resolver/services used by CLI boot. Implement cached-first refresh and safe catalog projection.
- Bind a minimal non-TUI UI context and runtime replacement handlers; verify extension modes and session disposal.
- Compare the CLI running in this **same project cwd and environment** with the worker. Record differences caused by project trust or deliberate companion replacement; do not compare unrelated cwd sessions as if equivalent.
- Verify application image attachment and Pi `read` image delivery using a known synthetic fixture and an image-capable model selected in Pi. Test MIME type, image encoding and orientation; do not use the uncertain old manifest as ground truth or build another transport.
- Check browser-relevant Pi UI requests, login support, batch/deferred model behavior, required tool availability and errors. Unsupported terminal-only widgets are outside scope. Do not launch other agents as part of the image workflow.

**Do NOT break:** global provider/auth registration, CLI model patterns, CLI defaults, shared session files.

**Acceptance gate:**

- [ ] Captured parity report lists available provider/model IDs, resolved scoped entries/qualifiers, active/default model and thinking choices on both sides.
- [ ] No unexplained provider/model omissions; known unconfigured/failed providers show diagnostics, not hardcoded replacements.
- [ ] Scope selection, all-model selection, cycling, refresh failure/cache behavior and model mutation match CLI semantics.
- [ ] Source skill and required tools (`read`, `bash`, `web_search`, plus app bridge equivalents later) are identified by actual load results.
- [ ] A known image fixture reaches Pi through both native attachment input and the existing `read` tool; the selected Pi model supports image input. No separate agent CLI is launched by the app.
- [ ] App startup/dispose leaves no unwanted live worker or piDocs poller.
- [ ] No global settings/auth edits occur during read-only parity tests. Explicit persistence/auth tests use temporary fixture stores or an owner-approved shared change.

**Risk: HIGH.** If this fails, document the exact runtime/API/extension error before continuing. A static model dropdown is not an acceptable workaround.

### Phase 2 — Local server, durable state and authority boundary

**Goal:** safely host a single-user, user-authority agent process with recoverable work state.

**Files:** `package.json`, `src/server/{index,security,workers,events,routes}.ts`, `src/db/*`, `src/shared/*`, `.gitignore`.

Tasks:

- Scaffold TypeScript server/frontend tooling and lock application dependencies, without adding another Pi installation.
- Implement loopback binding, pairing/cookie/CSRF controls, Host/Origin validation and safe DTOs.
- Add DB migrations for assets, runs, attempts, manifest revisions, artifact references, durable events, and session ownership leases.
- Supervise worker IPC, startup deadlines, graceful abort/disposal, backpressure and stale-worker recovery. Limit initial concurrency to one active run.
- Implement SSE replay, browser reconnect, safe resource routes and retention settings.

**Do NOT break:** Pi's native history format; credential ownership; unrelated CLI processes/sessions.

**Acceptance gate:**

- [ ] Fresh DB migration succeeds; restart preserves run/event/artifact references.
- [ ] Requests from another Origin, forged Host, unauthenticated control clients and missing CSRF credentials fail.
- [ ] Browser reconnect produces no duplicate tool/message rows or duplicate agent invocation.
- [ ] Killing the worker marks the attempt interrupted; restart does not automatically rebill/replay prompts.
- [ ] Two tabs cannot acquire independent writers for one session; only one queued run begins at a time.
- [ ] Event/JSON/browser payload tests contain no auth tokens, provider headers or full environment objects.

**Risk: HIGH.** Infrastructure must be secure before connecting real tool execution to browser controls.

### Phase 3 — SDK UI and companion-tool adaptation

**Goal:** keep all task interaction inside this app without rewriting the user's global companion extension.

**Files:** `src/agent/ui-context.ts`, `extensions/scout-web-bridge.ts`, `src/server/dialogs.ts`, bridge integration tests.

Tasks:

- Build a runtime-scoped extension override for the one canonical piDocs bridge, preserving all other resources. Verify load-time versus bind-time behavior from the installed loader.
- Register equivalent `ui_display_artifact` and `ui_ask` tools backed by worker IPC and app persistence.
- Bind SDK select/confirm/input/editor/status/notification methods with abortable, correlated browser requests.
- Show unsupported custom terminal interfaces clearly and safely cancel rather than guessing approval.
- Rebind subscriptions/UI after new/resume/fork and prevent cross-session response delivery.

**Do NOT break:** existing CLI companion tool behavior, loaded safety/approval extensions, tool registration uniqueness.

**Acceptance gate:**

- [ ] Exactly one `ui_ask` and one `ui_display_artifact` in worker inventory; CLI inventory is unchanged.
- [ ] No piDocs service is required or opened for an app question/report.
- [ ] Select, confirm, text entry, edit, cancel, timeout and abort each return the expected result without hangs.
- [ ] A delayed response from a prior session is rejected.
- [ ] Artifact delivery returns success only after a durable artifact exists and is visible in the browser.
- [ ] Oversized artifact and failed persistence produce tool errors, not a false “displayed” result.

**Risk: HIGH.** If resource filtering cannot prevent original bridge side effects, stop and revise this seam explicitly.

### Phase 4 — Upload-to-skill execution

**Goal:** uploading a valid photograph starts the installed skill using the user's selected Pi model.

**Files:** `src/server/assets.ts`, `src/scout/{images,runs,prompt}.ts`, `scripts/normalize_image.py`, imaging/run tests.

Tasks:

- Validate image content/size/pixels, preserve original privately, normalize orientation and record image digest/dimensions.
- Establish canonical crop coordinates; generate bounded agent previews without losing the transform to original resolution.
- Create a run with an immutable initial model/config snapshot and native Pi session reference.
- Attach the normalized image through Pi's native image input and invoke `/skill:pallet-price-scout` with canonical image path, run paths and workflow addendum. Keep search provider selection inside the existing extension and require `workflow: "none"`.
- Capture transcript/tool progress, steering/follow-up, waiting-input state and actual settled lifecycle. Add a draft structured submission tool for the manifest contract.
- Once first-run privacy consent and a suitable model are selected, valid upload automatically queues analysis. Expose cancel and an option to review before starting.

**Do NOT break:** skill discovery, selected model identity, image orientation/coordinates, existing tool safety hooks.

**Acceptance gate:**

- [ ] JPEG, PNG and HEIC fixtures produce correctly oriented canonical images with reproducible dimensions/digests.
- [ ] Bboxes around known test targets produce matching crops after every EXIF orientation case.
- [ ] Selected provider/model/thinking appears in actual Pi state before the prompt, not only in UI state.
- [ ] A text-only model receives a clear image-input incompatibility message; the app neither silently switches models nor launches another agent.
- [ ] Search executes headlessly through the existing Pi tool; no manual curator window appears.
- [ ] Cancel, provider failure, conversion failure and dialog waiting preserve actionable partial run state.
- [ ] Upload/retry idempotency prevents duplicate inference from double clicks/reconnects.

**Risk: MED**, dependent on the completed high-risk runtime/UI gates.

### Phase 5 — Evidence-backed valuation and safe report generation

**Goal:** publish a useful report without repeating the prototype's false verification or bundle-count arithmetic.

**Files:** `src/scout/{manifest,evidence,valuation,artifacts}.ts`, `scripts/render_report.py`, `tests/unit/*`, report/evidence fixtures.

Tasks:

- Enforce manifest v1 from `CONTRACTS.md`; provide precise structured repair errors.
- Independently check product/variant/pack/retailer/amount against captured evidence. Retain unavailable prices where retrieval fails; do not let the model self-certify through a status string.
- Calculate supported subtotal, separate estimated subtotal, record count, confirmed sale units, duplicates and excluded items server-side.
- Adapt the existing crop/report code locally for escaped output, headless rendering, explicit quantity/price basis, safe links, no external font requirement and atomic publication.
- Produce revisioned JSON, crops, self-contained HTML and an app-native item view. Keep global script untouched.
- Support manual corrections with revision conflicts and evidence invalidation on variant change.

**Do NOT break:** original-resolution crop fidelity, global CLI renderer, disclosed uncertainty, arithmetic determinism.

**Acceptance gate:**

- [ ] Wrong-variant listing, mismatched retailer, snippet-only price, missing price, unknown quantity and duplicate fixtures cannot increase the supported total.
- [ ] Four units × one unit price and one sealed multi-pack × one pack price produce distinct correct results.
- [ ] Unknown is not represented as zero, and all sums use integer money with currency checks.
- [ ] No hidden-pallet multiplier or unsupported resale estimate is present.
- [ ] Malformed coordinates/digests fail before cropping; HTML/script/URL payloads cannot escape report sandbox or reach local APIs.
- [ ] Report export works offline, with crops, filters and source labels; renderer starts no desktop browser.
- [ ] Renderer-only retry and manual correction do not invoke a model.
- [ ] `completed`/`needs_review` occurs only after validated manifest and successful report publication.

**Risk: HIGH** for the evidence/quantity contract; isolate this gate from cosmetic work.

### Phase 6 — Complete Pi web workspace

**Goal:** make Pi's native upload-to-skill workflow usable in the browser with its existing model selection.

**Files:** `web/src/{model-picker,workspace,inspector,history}/*`, browser journey cases.

Proposed desktop layout (based on the existing Pi selector and local companion/report workflow, not a claimed external design study):

```text
[Scout]  [Scoped / All model search] [Thinking] [Run status] [Stop]
+----------------------+------------------------+-----------------------+
| Run history/upload   | Image + bounding boxes | Conversation/activity |
|                      | Selected item crop     | Questions/approvals   |
+----------------------+------------------------+-----------------------+
| Supported subtotal | Additional estimates | Records / sale units     |
| Item table: identity | quantity | price | evidence | uncertainty      |
| [Inspect/correct]                         [JSON] [HTML report]        |
+---------------------------------------------------------------------+
```

Tasks:

- Build searchable scoped/all model picker, current/default distinction, thinking control, catalog refresh diagnostics, explicit default/scope saving, and safe login links/dialogs.
- Add upload/progress/history views, collapsible real tool activity, streaming transcript, image bbox highlighting, crop inspection, source evidence panels, filters and corrections.
- Keep uncertainty and missing evidence as primary data, not buried tooltips. Show counts and monetary bases distinctly.
- Add keyboard navigation, readable focus states, accessible dialogs, reduced-motion behavior and a usable narrow-screen layout.
- Keep all analysis in Pi's runtime. Do not add terminal views, PTY dependencies, separate agent CLI launchers or provider-specific vision integrations.
- On browser reconnect, reload persisted Pi/app state without creating a second session writer.

**Do NOT break:** primary upload flow, shared model semantics, approval safety, native session single-writer ownership.

**Acceptance gate:**

- [ ] User uploads, watches inspection/search, answers a question, checks evidence, corrects count and downloads a report without a separate piDocs window.
- [ ] All Pi-available/scoped models remain reachable; image runs use Pi models that support image input.
- [ ] Catalog failure retains cached choices; auth failure supplies recovery rather than switching providers.
- [ ] The application has no terminal endpoint, separate agent CLI launcher or alternate-agent fallback.
- [ ] Browser disconnect/restart cannot create simultaneous writers to one native Pi session.
- [ ] Report preview cannot invoke local API actions through HTML, links or messages.

**Risk: MED.** Keep the scope to the Pi web workflow; unsupported terminal widgets do not justify another execution path.

### Phase 7 — Verification, documentation and local release

**Goal:** deliver a reproducible local app with demonstrated behavior and explicit limits.

**Files:** tests, package scripts, `README.md` runtime sections, `docs/COMPATIBILITY.md`, `docs/VERIFICATION.md`.

Tasks:

- Add documented typecheck, unit/integration test, build and start scripts. Verify a clean local checkout/setup path, dependency checks and port collision errors.
- Run fake-worker tests for deterministic failures/replay/security without paid calls. Run separately opt-in real Pi smoke tests for resources, model changes, vision, search, session persistence and UI bridge.
- Use **`dodis_browser` for every live interactive coding-browser action**: upload, dialogs, model picker, evidence editing, downloads, reconnect and screenshots.
- Use synthetic/public image and retail fixtures for deterministic assertions. Mark live price results time-sensitive and never require exact current retailer amounts in repeatable tests.
- Exercise corrupt uploads, malicious filenames/HTML/links, private-network retrieval attempts in app-owned fetches, no auth, no model, search outage, worker death, browser reload, stale dialogs and partial report generation.
- Document selected dependencies, Pi version/API expectations, browser-supported Pi interactions, native image input, cost/privacy, data locations, deletion/retention and recovery.

**Acceptance gate:**

- [ ] Typecheck, automated tests and production build pass; commands/output are recorded.
- [ ] Real browser evidence shows at least one complete upload→report run through Pi's native image input, installed skill and user-selected image-capable Pi model.
- [ ] Restore after app restart passes without duplicate inference or damaged history.
- [ ] Security and valuation negative cases pass, not merely the happy path.
- [ ] Existing CLI scout workflow, original global script and companion still work; no unintended global file modifications.
- [ ] README explicitly lists anything unverified; no claim of universal provider/TUI support without evidence.

## 6. Decisions and dependencies still requiring runtime proof

These are bounded implementation gates, not reasons for more open-ended research:

1. **SDK resource parity:** observed exported APIs support it, but the user's complete extension set has not yet run in the proposed worker.
2. **Companion override:** verify safe removal before binding and absence of import-time side effects.
3. **Native Pi image wiring:** test attachment encoding/MIME, image orientation and `read` behavior with a known fixture. No separate CLI/vision integration is needed.
4. **Provider auth UX:** use Pi's installed provider callbacks where browser-supported. For other login methods, explain setup in the user's existing Pi environment; do not embed a terminal. No credentials copied into app storage.
5. **Scope/default semantics:** verify `setModel` persistence behavior and qualifier resolution against this installed version before defining UI actions.
6. **Deferred/batch work:** test selected provider behavior against Pi settled events and cancellation; show unsupported operations honestly.
7. **Market default:** initial plan assumes USD/US retail sources, matching the existing workflow. Expose this locally rather than silently converting currency.
8. **Pi-only boundary:** no separate agent CLI, terminal dependency, provider-specific image adapter or alternate-agent fallback. Reuse Pi's native capabilities rather than adding another execution system.

## 7. Release definition

A release is complete when an image upload invokes the **existing installed Pi skill**, the user can choose the **same effective CLI model set**, actual tool work and questions appear in the app, report evidence/quantities can be inspected and corrected, native history survives restarts, and supported versus estimated visible value is unmistakable.

A static dashboard around precomputed JSON, a hardcoded model list, a direct provider chat call, or a polished UI that silently loses image/tool content does not satisfy the request.

## 8. Handoff

Change Blueprint ready.

Run /sys-forge-implementer to begin Phase 1.
