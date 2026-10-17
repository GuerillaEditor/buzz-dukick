# SDD ledger — plan: BAN_GIAO_CODEX_BUZZ_DUKICK_v2_20261017.md

- BASE: `58f55615d` on `dukick/main`; B1 `5c1504857` is already complete.
- Pre-flight: S1 produces the dock host consumed by S2–S5; S2 produces browser-tab/profile primitives consumed by S5; S3 produces terminal-tab primitives consumed by S5; S4 produces path-guard/preview primitives consumed by S5.
- Safety: no production Buzz paths, credentials, keys, tokens, nsec, cookies, or browser profiles.

## Tasks

- Task 1 (S1): complete (commit `e6b50b856`; focused WorkbenchDock test 3/3, desktop typecheck PASS)
- Task 2 (S2): complete (initial `f013c3fc2`, completion/security `bbebe159f`; frontend 5/5, Rust 3/3, capability 1/1, typecheck PASS)
- Task 3 (S3): pending
- Task 4 (S4): pending
- Task 5 (S5): pending
- Final review: pending

## §V invariants

- V1: Closing or leaving the Browser workbench surface unmounts `BrowserPanel`, which hides every native child webview.
- V2: A terminal-mode transition from open to closed also closes the Terminal workbench dock; it must not leave an empty visible dock.

## §B backprop log

- B1|2026-10-17|Workbench kept BrowserPanel mounted behind a hidden parent, so native child webviews could remain visible|V1
- B2|2026-10-17|Terminal store close was not synchronized back to Workbench open state, leaving an empty dock|V2
