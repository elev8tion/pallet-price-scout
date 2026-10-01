# Heal Report

## Run summary

- **Task:** find bugs and heal this codebase
- **Started:** 2026-09-11T07:35:15Z
- **Finished:** 2026-09-11T07:51:27Z
- **Findings:** 5
- **Fixed:** 4
- **Deferred:** 1
- **Skipped:** 0
- **Failed:** 0

## Verification

| Check | Phase 1 baseline | After fixes | Result |
|---|---|---|---|
| Automated tests | 8 passed | 10 passed | PASS |
| Typecheck | Passed | Passed | PASS |
| JavaScript syntax check | Not part of baseline | `node --check web/app.js` passed | PASS |
| Linter | Not configured | Not configured | SKIPPED |
| Touched-file regression scan | No markers; no empty catches in applicable source scan | No new markers or unhandled empty catches; intentional best-effort cleanup remains documented | PASS |

The project has no Git history, so verification used the recorded phase-1 baseline and direct source checks. The private/generated `data/`, `.vnodes/`, and `node_modules/` trees were excluded.

## Findings

| ID | Finding | Decision | Outcome | Verification |
|---|---|---|---|---|
| B1 | Pi connection errors were recorded but the live session continued retrying and launching more searches. | fix | fixed | `src/scout/worker.ts` now classifies assistant/provider errors and calls `session.abort()` once; full test suite and typecheck pass. |
| B2 | Worker restart left database runs in active states without a live owner. | fix | fixed | `Database.interruptNonTerminalRuns()` transactionally marks stale runs interrupted and records recovery events; regression test passes. |
| B3 | Delayed artifact loading used mutable `currentRun.id`. | fix | fixed | SSE handlers capture the connected run ID before asynchronous artifact loading; JavaScript syntax check passes. |
| B4 | Legacy report path does not yet enforce the full evidence and quantity valuation contract. | defer | deferred | Intentionally unchanged; remains the next valuation-validation work item. |
| B5 | Failed normalization left orphaned upload directories. | fix | fixed | Asset directory cleanup added on normalization failure; failure-path test passes. |

## Follow-up list

1. **B4 — evidence and quantity validation:** replace the legacy one-price-per-finding total path with the full manifest/evidence/quantity validation before treating values as supported.
2. **Live runtime smoke test:** exercise a real provider connection failure and confirm the new abort path stops additional model turns without relying only on unit/integration checks. No paid provider request was made during this verification.

## Residual notes

- The source scan still contains an intentional best-effort cleanup catch in `src/scout/assets.ts` and a fallback catch around legacy artifact conversion in `src/scout/worker.ts`; neither was introduced by Phase 3, and neither caused a test regression. The latter should preserve/log its conversion error in a future report-hardening pass.
- No code was changed during Phase 4 verification.
