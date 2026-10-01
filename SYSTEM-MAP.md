# System Map — Pallet Price Scout

Inspection date: 2026-09-09. Target: `/Users/kcdacre8tor/pallet-price-scout`.

## 1. Executive findings

The pricing workflow already exists as a Pi skill plus a Python report renderer. What is missing is an application-owned workspace that reliably connects uploads, the installed Pi runtime, human input, durable progress, structured evidence, and report delivery.

Pi offers both SDK and RPC integrations. The SDK exposes the services needed for the CLI's fuller model-management behavior; RPC exposes basic model enumeration/switching but not the complete interactive selector management surface. Use the installed SDK in an isolated worker. This reuses Pi's agent, not merely the same model providers.

**Scope of evidence:** documentation and source inspection, installed-version checks, and local Python dependency checks. No SDK session, provider inference, live authentication, or end-to-end browser prototype was executed during this planning pass. Compatibility assertions below distinguish observed implementation from required runtime tests.

## 2. Observed local inventory

| Component | Observed location / state | Role |
|---|---|---|
| Target project | `/Users/kcdacre8tor/pallet-price-scout` was empty before these documents | New application only |
| Pi executable | `/opt/homebrew/bin/pi` | Resolve the user's installed Pi runtime |
| Installed package | `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`, version **0.85.1** | SDK, CLI, runtime, sessions, tool execution |
| Node | **v24.7.0** | Available host runtime; verify package engine requirements when implementing |
| Python/Pillow | `python3`, Pillow **12.0.0** | Normalization, image decoding, crops |
| Agent directory | `/Users/kcdacre8tor/.pi/agent` | Existing user resources and configuration |
| Settings | `~/.pi/agent/settings.json` | Defaults, packages, paths, enabled model patterns |
| Custom models | `~/.pi/agent/models.json` | Custom/local provider/model definitions |
| Credentials | `~/.pi/agent/auth.json` | Pi-owned secrets; never copy into browser data |
| Skill | `~/.pi/agent/skills/pallet-price-scout/SKILL.md` | Image → identification → research → report workflow |
| Renderer | `~/.pi/agent/skills/pallet-price-scout/scripts/crop_and_report.py` | Pillow crops, base64 packaging, interactive HTML |
| Companion extension | `~/.pi/agent/extensions/pi-ui-bridge.ts` | Existing `ui_display_artifact`, `ui_ask`, event/prompt bridge |
| Companion application | `/Users/kcdacre8tor/piDocs` | Existing patterns to study, not a required service for the new app |

Observed settings specify default provider `openrouter`, model `google/gemini-3.8-flash`, and thinking `high`. These are **configuration values**, not verified live availability. Never make them application constants.

`enabledModels` contains user-configured provider/model patterns, including thinking/batch qualifiers. Consume these through Pi without adding, replacing or independently integrating providers. Custom models include local text and vision choices. Additional skill/prompt discovery includes `.opencode/skills` and the user's darkmanx directories.

Installed Pi packages observed: `pi-web-access`, `pi-subagents`, `pi-scraper`, `graphify-pi`, `pi-mcp-adapter`, `pi-xai-oauth`, and `@grammeaway/pi-provider-sakana-fugu`. Installation is not proof that all packages function in a non-TUI session.

## 3. Layer map and ownership

| Layer | Existing owner | Application responsibility | Change policy |
|---|---|---|---|
| Provider inference/auth | Pi `ModelRuntime`, provider extensions | Select models through Pi; expose safe status | Keep; no direct provider client replacement |
| Agent/tool loop | Pi `AgentSession` | Subscribe, prompt, steer, abort, supervise lifecycle | Keep |
| Resource discovery | Pi resource loader/settings/project trust | Set explicit cwd/agentDir; surface diagnostics | Keep; no copy of the global configuration |
| Native conversation history | Pi `SessionManager` and session runtime | Index owned session IDs and reconnect | Keep native JSONL format |
| Product workflow | Existing scout skill | Supply uploaded image, output paths, quality contract | Keep skill invocation; append run-specific instructions |
| Search | Existing `web_search` extension | Require tool availability and headless workflow | Keep configured provider resolution |
| Crop/report logic | Existing Python script | Validate input; adapt rendering for secure web delivery | App-local adapter/copy; original stays functional |
| Companion UI tools | Existing bridge to piDocs | Worker-local browser bridge with acknowledged delivery | Scoped replacement only in app worker |
| UI/storage/security | Not present | Browser workspace, event log, app DB, upload/artifact handling | Add |

**Load-bearing components:** Pi runtime/services, native resource discovery, provider/auth registry, session ownership, image-coordinate identity, evidence/quantity valuation rules.

**Replaceable components:** visual layout, report card styling, upload affordances, filtering controls, app metadata storage implementation.

## 4. Current workflow trace

1. The user provides a local photograph.
2. The skill converts HEIC through `sips` and normalizes orientation with Pillow `ImageOps.exif_transpose()`.
3. The agent uses image-capable `read` to inspect labels and identify bounding boxes.
4. The agent invokes `web_search` with multiple queries and `workflow: "none"` to avoid a separate search-curator window.
5. It writes a JSON manifest with a declared coordinate scale and item records.
6. `crop_and_report.py` maps those coordinates to original image pixels, crops items, resizes crops to at most 650 pixels on their longest edge, embeds JPEG data URLs, and generates HTML.
7. The script's executable entrypoint opens the report in the desktop browser; the skill also requests `ui_display_artifact` for companion delivery.

### Current manifest contract

Top level: `title`, `subtitle`, `coord_scale_w`, `coord_scale_h`, `items`.

Per item: `id`, `name`, `brand`, `category`, `coords`, `price`, `status`, `retailer`, `source_url`, `description`.

The renderer currently sums `price` once per entry and counts entries, not physical units. It has no enforceable evidence schema, quantity arithmetic, confidence gate, or verified-versus-estimated totals. It interpolates supplied content into HTML and links; output must not be mounted as trusted application DOM.

### Previous fixture limitations

- `/tmp/IMG_7990_norm.jpg`: previously normalized 3024×4032 photograph; temporary and not guaranteed to survive.
- `/tmp/items.json`: previous 20-entry prototype using 1500×2000 coordinates.
- `/Users/kcdacre8tor/Downloads/pallet_report_IMG_7990.html`: previously generated ~2.66 MB report with embedded crops.
- Some records represent bundles; twenty records does not mean twenty physical units.
- Several identities, variants, quantities, prices, and source matches were uncertain despite `Verified Retail` labels.
- The $208.67 sum and any 15×–30× full-pallet multiplier must not become expected valuation behavior.

## 5. Proposed end-to-end trace

```text
Browser: image upload + current model/thinking + optional instructions
  → local authenticated HTTP API
  → validate/decode/normalize image; persist original and canonical image
  → create run record and acquire its single Pi-session writer lease
  → Pi worker using installed SDK + existing global resources
      → resolve current/default/scoped models with Pi's resolver
      → attach normalized image through Pi's native image input
      → invoke /skill:pallet-price-scout with controlled run paths
      → Pi tools inspect image, search, and emit progress
      → browser dialogs bridge ctx.ui and ui_ask; never auto-approve
      → scout_submit_manifest validates and persists structured output
  → independent evidence/quantity validation + deterministic totals
  → safe crop/report rendering and revision publication
  → browser shows item crops, source evidence, uncertainty and totals
  → native Pi JSONL + app DB + artifact files survive browser disconnection
```

Image normalization and report validation are deterministic application services. Identification and research remain Pi skill/tool work. A completed assistant turn does not by itself constitute a completed valuation.

## 6. Pi integration findings

### Supported source surfaces

All paths below are relative to the installed package root unless otherwise stated.

| Requirement | Observed source/API | Integration consequence |
|---|---|---|
| Shared cwd-bound services | `dist/core/agent-session-services.d.ts`: `createAgentSessionServices`, `createAgentSessionFromServices` | Reuse coherent settings, model runtime, resource loader |
| Session lifecycle | `examples/sdk/13-session-runtime.ts`, `dist/core/agent-session-runtime.*` | New/resume/fork through runtime; rebind subscriptions/UI after replacement |
| Prompt/tool stream | `docs/sdk.md`, `dist/core/agent-session.d.ts` | Subscribe to actual Pi events; do not parse terminal output for normal UI |
| Resource inventory | `dist/core/resource-loader.d.ts`: `getExtensions/getSkills/getPrompts/getAgentsFiles` | Show loaded source paths and errors; retain discovery |
| Model availability | `dist/core/model-runtime.d.ts`: `getAvailableSnapshot`, `getAvailable`, `getModel` | Dynamic, auth-aware catalog from same loaded provider runtime |
| Refresh/auth | Same file: `refresh`, `getProviderAuthStatus`, `login/logout` | No separate auth store; sanitize all browser responses |
| Model scope | `dist/index.d.ts`: `resolveModelScopeWithDiagnostics` export | Use Pi resolution; never split pattern strings heuristically |
| Current model/thinking | `dist/core/agent-session.d.ts`: `setModel`, `setScopedModels`, `getAvailableThinkingLevels` | Runtime is authoritative after each mutation |
| Defaults/scope persistence | `dist/core/settings-manager.d.ts`: `setDefaultModelAndProvider`, `setDefaultThinkingLevel`, `setEnabledModels` | Explicit shared-setting actions, not raw JSON writes |
| Interactive selector behavior | `dist/modes/interactive/components/model-selector.js` | Scoped/all toggle, current/default priority, provider sorting, search, cached display + refresh |
| Extension UI binding | `dist/core/agent-session.d.ts`: `bindExtensions`; `dist/core/extensions/types.d.ts`: `ExtensionUIContext` | Implement browser-supported UI methods; arbitrary `custom()` is not automatically portable |
| RPC baseline | `docs/rpc.md`, `dist/modes/rpc/rpc-mode.js` | Basic list/switch/state/commands/UI events exist but do not fully expose selector management |
| Structured output tool pattern | `examples/extensions/structured-output.ts` | Add app-local submission tool without replacing the agent loop |

The CLI model selector refreshes catalogs in the background with a 15-second timeout and retains cached models on failure. Its refresh helper is internal: study its behavior and use the public runtime API, rather than importing a private TUI helper into the application.

### Why not RPC alone?

RPC source supports `get_available_models`, `set_model`, `cycle_model`, `get_available_thinking_levels`, `set_thinking_level`, session state, prompts, aborts, and extension UI requests. `get_available_models` returns the current available snapshot. It does not itself reproduce the selector's scope editor, catalog-refresh UI, save-as-default action, or complete provider login workflow.

RPC is a valid simpler embedding for a smaller feature set, but adding another private control protocol to obtain parity is less direct than using the exported SDK services. If RPC is later used, parse LF-delimited JSON bytes correctly, correlate response IDs, separate stderr, and do not mistake command acknowledgement for agent completion.

### CLI parity boundary

The browser can reproduce model selection and agent behavior, but terminal keybindings, arbitrary `ctx.ui.custom()` components, and every extension's terminal integration are not native web controls. Pi extension modes are `tui`, `rpc`, `json`, and `print`; there is no documented `web` mode. Use an explicitly declared non-TUI binding (proposed `rpc`) and test affected extensions.

Terminal-only widgets are outside this web application's scope. Do not add an embedded terminal or another agent CLI to support them. Implement the browser controls needed for Pi model selection and the scout workflow; label unsupported UI requests and safely cancel rather than auto-confirming. Retain one writer per native Pi session.

## 7. Existing companion bridge: important seam

`~/.pi/agent/extensions/pi-ui-bridge.ts` uses `PIDOCS_PORT` (default 4000), registration/event POSTs, and polling:

- `/api/sessions/register`
- `/api/sessions/:id/event`
- `/api/sessions/:id/poll`
- `/api/health`

`ui_display_artifact` sends full content to piDocs, then returns only title/kind metadata. `ui_ask` waits on its own pending answer map. Merely subscribing to Pi tool-end events **does not** reproduce the complete artifact/answer transport.

Plan a worker-local substitution for this one canonical extension, registering the same two tool contracts against authenticated worker IPC. Keep all other discovered resources. Prove the loader override removes its handlers/tools before session binding; loading-time side effects must be checked. No global edit and no blanket `--no-extensions`. Do not point an unauthenticated compatibility listener at the user's browser API or run two conflicting copies of these tools.

Other extension UI calls go through the SDK UI adapter. Companion tool results are acknowledged only after app persistence succeeds; failed delivery must be an error, not “displayed.”

## 8. Native Pi image input — explicit scope

Pi already accepts images. The app supplies the uploaded, normalized image through Pi's native image input alongside the skill invocation. The skill can also inspect the canonical local image through Pi's `read` tool. No separate vision agent, agent CLI, or provider-specific transport is needed.

The app uses Pi's existing model catalog and lets the user select an image-capable model for image analysis. Verify the application's attachment encoding, MIME type, orientation, coordinate mapping and Pi submission with a known image fixture. This is an integration test of the app's wiring, not a requirement to build or audit another CLI.

Existing user-configured providers remain managed by Pi. The app does not launch, repair, configure or fall back to a separate agent CLI.

## 9. Trust, safety, and session implications

- Project resource trust matters: noninteractive contexts cannot assume an unanswered trust prompt grants approval. Surface the decision; do not launch with blanket `--approve`.
- Effective cwd should remain the project root; per-run output folders are paths, not changing working directories. This preserves predictable discovery and native session location.
- SDK sessions live in Pi's native JSONL storage under `~/.pi/agent/sessions/`; application SQLite stores references and presentation/workflow state, not a replacement conversation format.
- Loaded tools/extensions have user-level filesystem/network/process authority. Localhost authentication protects access to that authority, not a sandbox around it.
- Browser uploads are local initially, but model requests and search may send their content to configured external services. Display this plainly before a first run.

## 10. Principal risks and test gates

| Risk | Impact | Required proof |
|---|---|---|
| Different discovery/model scope in SDK | Violates primary requirement | Compare CLI and SDK under same cwd/environment/trust |
| App submits malformed/missing image | Failed or unsupported inventory analysis | Known image fixture through native Pi input |
| Companion tool duplication or off-app delivery | Missing reports / hung questions | Tool inventory, acknowledged artifact, round-trip answer test |
| Unsupported extension UI | Deadlock or skipped approval | Browser support matrix + safely cancelled unsupported requests |
| Long tool work mistaken for agent completion | Premature final report | Pi settled lifecycle plus validated artifact publication gate |
| Native session concurrent writers | Corrupted/diverging history | Worker ownership lease and reconnect tests |
| Model/config upgrades | API drift | Startup version check and compatibility tests |
| Uncertain quantities/variant mismatch | Inflated valuations | Schema validation and separate supported/estimated totals |
| Generated HTML or source URLs | XSS/local authority exposure | Escaping, isolated preview, CSP, URL checks |

## 11. Documentation consulted

Installed `README.md`; `docs/sdk.md`, `rpc.md`, `extensions.md`, `models.md`, `custom-provider.md`, `skills.md`, `settings.md`, `session-format.md`, `packages.md`, `tui.md`; SDK and extension examples cited above; local scout skill/renderer; companion bridge; installed `pi-web-access/index.ts` for headless search behavior.

No credentials are reproduced in these documents. Local source/configuration observations are not claims of authenticated provider availability.
