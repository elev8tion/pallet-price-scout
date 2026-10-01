# Verification

## Phase 1 runtime

- `npm run phase1` — PASS
- Installed Pi: `0.85.1`
- SDK catalog: `415` models
- CLI catalog: `415` models
- Image-capable models: `263`
- Enabled/scoped models: `18`
- Installed skills: `205`
- Extension load errors: `0`
- Global `pi-ui-bridge.ts`: filtered from worker; app-local bridge registers exactly one `ui_ask` and one `ui_display_artifact`

## Automated checks

- `npm run typecheck` — PASS
- `npm test` — PASS, 8 tests
- `node --check web/app.js` — PASS

## Manual local API smoke

- Loopback server started on `127.0.0.1:47831`.
- Pairing exchanged for HttpOnly session and CSRF cookie.
- `/api/models` returned 415 models, including 263 image-capable models.
- Valid PNG upload normalized to JPEG with dimensions and SHA-256 metadata.
- Text-only model run rejected with `MODEL_IMAGE_INPUT_UNSUPPORTED` before inference.

## Explicitly unverified

- No paid/provider inference request was made.
- End-to-end native image inference, live search, and browser dialog response remain unverified.
- Deterministic sorted findings publication, crop generation, artifact persistence, and current-UI report data path are implemented and covered by a local smoke check.
- Dodis Browser was attempted for the local page, but the isolated browser reported no active browser tab; no visual acceptance claim is made.
