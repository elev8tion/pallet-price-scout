# Pi compatibility report

Generated: 2026-09-11T07:00:05.363Z

## Result

- Installed Pi: **0.85.1**
- Executable: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`
- Project cwd: `/Users/kcdacre8tor/pallet-price-scout`
- SDK available models: **421**
- CLI available models: **421**
- SDK image-capable models: **269**
- SDK/CLI model set parity: **PASS**
- Global companion bridge filtered in worker: **yes**

## Effective settings

- Default: `openrouter/google/gemini-3.8-flash`
- Thinking: **high**
- Enabled model patterns: **18**
- Resolved scoped models: **18**

## Resources

- Extensions loaded: **19**
- Skills loaded: **206**
- Scout skill present: **yes**
- Extension load errors: **0**
- Active tools: `read, bash, edit, write, ui_ask, scout_submit_findings, ui_display_artifact, dodis_browser, go_htmx_scaffold_project, go_htmx_scaffold_feature, go_htmx_validate_contract, go_htmx_verify_targets, go_htmx_verify_migrations, go_htmx_run_checks, go_htmx_feature_manifest, web_search, source_check, fetch_content, get_search_content, subagent, bg_wait, web_scrape, web_extract, web_tools, mcpScript, mcp, mcp__vnodes, subagent_supervisor`
- Companion tools in worker: **2** (one app-local pair expected)

## Differences

SDK-only models: none
CLI-only models: none

## Limits

- This spike verifies installed package discovery, resource loading, model scope projection, worker-safe companion filtering, and native image attachment shape.
- It does not make a provider inference request or claim that credentials are live.
- It does not mutate global settings, auth, skills, extensions, or native sessions.
- Native image input is represented as Pi-compatible `{ type: "image", data, mimeType }`; end-to-end upload is gated for Phase 4.
