# Pallet Price Scout

One localhost web project. Scan and routing share a single `npm start`.

**Status: Phase 1 compatibility spike and first local workspace slice implemented, including sorted findings publication in the Scout UI.**

Upload an inventory photograph, run the `pallet-price-scout` skill through the installed Pi agent, then open `/routing/` for the singles-vs-pallets workspace. This folder is the whole app. Oracle deployment follows the shared osoance topology in [docs/ORACLE-DEPLOY.md](docs/ORACLE-DEPLOY.md).

## Planning documents

1. [SYSTEM-MAP.md](SYSTEM-MAP.md) — installed system, source evidence, integration trace, and compatibility boundaries.
2. [BUILD-PLAN.md](BUILD-PLAN.md) — architecture decision, safe implementation phases, file targets, acceptance gates, and risks.
3. [CONTRACTS.md](CONTRACTS.md) — proposed browser/worker interfaces, manifest, state machine, security, and valuation rules.

## Core decision

Use the **installed Pi SDK in a dedicated Node worker**, with the same global agent directory, resource discovery, model runtime, authentication storage, and native session manager as the CLI. Do not build another LLM orchestration loop or hardcode a provider catalog.

Current application stack: Node/TypeScript, Fastify, vanilla browser UI, Node's built-in SQLite driver, filesystem assets, and SSE for durable progress delivery. React/Vite is not required for the current slice.

**Pi-only scope:** send uploaded images through Pi's native image input, use Pi's existing model catalog and agent runtime, and run the installed skill. No separate agent CLI, embedded terminal, provider-specific image transport, or alternate-agent fallback. Terminal-only widgets are outside this web application's scope.

## Non-negotiables

- Existing global skills, provider extensions, credentials, and CLI behavior remain intact.
- Model selection includes CLI-equivalent available/scoped lists, refresh, cycling, thinking levels, explicit default saving, and provider diagnostics.
- Uploads use Pi's native image input with an image-capable model selected from Pi. Test this application-to-Pi wiring; do not add another vision runtime.
- Search uses the configured `web_search` tool with `workflow: "none"`.
- Unknown product identities, quantities, and prices remain unknown, not “verified.”
- No extrapolation from the visible photograph to an unseen full pallet.
- Localhost-only deployment; the agent retains the user's local-machine authority.

## Run it

```bash
npm install
npm run typecheck
npm test
npm run phase1
npm start
```

Open the pairing URL printed by `npm start` in a browser. That is the combined localhost workspace:

- `/` — scan and Pi analysis (entry)
- `/routing/` — inventory routing demo (singles vs pallets)

Same process, same origin. Completed vision findings can open directly in `/routing/?run=<runId>`; store sales, stock, and routing decisions are deterministic simulated data and are labeled in the UI. The server binds to `127.0.0.1`, exchanges the one-time pairing token for an HttpOnly session cookie, loads the installed Pi runtime, and queues image analysis through Pi's native image attachment. The selected model must advertise image input. Only one `npm start` at a time (`data/.scout.lock`).

## Short-lived shared demo (people you know)

No codes and no scan caps. Anyone with the URL uses **this machine's** Pi and provider keys. History is shared. Stop the process when the demo is over.

```bash
brew install cloudflared   # once
SCOUT_OPEN=1 npm start
# in another terminal:
cloudflared tunnel --url http://127.0.0.1:47831
```

Send them the `https://….trycloudflare.com` address (Scan and `/routing/` are on it). Default `SCOUT_OPEN=1` allows `*.trycloudflare.com`. For a named host: `SCOUT_HOSTS=demo.example.com SCOUT_OPEN=1 npm start`. The app still listens on loopback only; the tunnel is the HTTPS front door.

Phase 1 parity evidence is written to [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) and [`docs/phase1-parity.json`](docs/phase1-parity.json). The worker filters only the global `pi-ui-bridge.ts` so it does not open a piDocs poller; app-local dialog/artifact bridging and structured report publication remain later phases.

## Oracle deployment

Use the existing host ops kit; do not create a second Pi installation or expose the Node port:

```bash
/Users/kcdacre8tor/osoance-host/add-app.sh pallet-price-scout /Users/kcdacre8tor/pallet-price-scout
```

See [docs/ORACLE-DEPLOY.md](docs/ORACLE-DEPLOY.md) for the host contract and verification commands.

## Next action

Continue the evidence and quantity validation work in [BUILD-PLAN.md](BUILD-PLAN.md). The app-local findings bridge now creates a sorted, cropped findings artifact and renders it in the existing Scout UI; full structured manifest validation and manual correction remain future work.

The previous photo/report may be reused as an explicitly unverified regression fixture. Its claimed $208.67 valuation is **not** a ground-truth expected result.
