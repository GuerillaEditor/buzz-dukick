# Buzz Dukick journal — 2026-10-16

- Scope: B1 only. Claude Thái and the official `C:\GithubRepo\buzz` checkout were not modified.
- Preflight: linked worktree `C:\GithubRepo\buzz-dukick` on `dukick/main`; baseline `93ffc37cb`. No other active `buzz-dukick` process or thread was found.
- B1 RED/GREEN: added and passed identity/keyring separation tests for Dukick deep-link, config nest, CLI name, migration marker, and keyring service.
- Changed files: `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/tauri.dev.conf.json`, `desktop/src-tauri/build.rs`, `desktop/src-tauri/src/build_identity.rs`, `desktop/src-tauri/src/app_state_keyring.rs`.
- Identity decisions: product `Buzz Dukick`; identifier `xyz.dukick.buzz.app`; deep-link `buzz-dukick`; keyring `buzz-desktop-dukick` (debug `buzz-desktop-dukick-dev`); config nest `.buzz-dukick`; child config root `%APPDATA%\\buzz-dukick`.
- Updater: build script no longer enables the updater cfg even when upstream updater environment variables are present.
- Sidecars: built real Windows release binaries with MSVC and bundled them process-locally under `desktop/src-tauri/binaries` (ignored build inputs; no stubs committed).
- Release packaging: PASS — `Buzz Dukick_0.5.28_x64-setup.exe` and `buzz-desktop.exe` built successfully with NSIS.
- Distinct icon: PASS — generated Dukick badge-D assets and configured `dukick-*.png` plus `dukick.ico`; the bundle build accepted them.
- Parallel smoke: PASS — Dukick release process ran simultaneously with the existing desktop process; no identity/key/token/cookie was read or imported. Official installer mtime was observed before/after unchanged.
- Verification: `cargo fmt --all -- --check` PASS; build-identity tests PASS (5 passed, 1 ignored); `dukick_builds_use_a_distinct_keyring_service` PASS (1 passed); `pnpm --dir desktop typecheck` PASS; `pnpm --dir desktop test` PASS; Tauri NSIS build PASS.
- The Tauri test config used to bypass only the missing external-binary list was process-local and has been removed; no test-only config remains in the checkout.
- B1 DONE 5c1504857 (identity separation, updater-off, distinct icon, release/NSIS smoke build).
- B2/B3/B4: not started; this journal must not claim READY FOR AUDIT until those slices are implemented and verified.
- No push or PR.

BLOCKED: B2/B3/B4 chưa triển khai trong lượt này; chưa đủ điều kiện `READY FOR AUDIT`.

## Buzz Dukick v2 — S1 → S5 (2026-10-17)

- Ruling: giữ nguyên baseline B1 `5c1504857`; chỉ sửa worktree Dukick trên nhánh `dukick/main`.
- Ruling: thực hiện S1 → S5 tuần tự; không chạy hai build lớn đồng thời để tránh Kernel-Power 41.
- Ruling: không đọc/in/chép credential, key, token, nsec, cookie hoặc browser profile; không sửa Buzz production.
- Baseline trước S1: `58f55615d`.

### S1

- Added `desktop/src/features/workbench/WorkbenchDock.tsx`, `workbenchStore.ts`, `workbench.css`, and `WorkbenchDock.test.mjs`.
- Integrated the dock into `desktop/src/app/AppShell.tsx`; the existing channel/thread surface and Ctrl+J terminal shortcut remain intact.
- TDD: WorkbenchDock tests were authored first and passed with direct Node test runner: 3/3.
- Note: the repo's `pnpm` shim is currently blocked by a package-manager mismatch (configured 11.4.0, installed 12.3.4); direct Node test execution was used for the focused test.
- S1 DONE `e6b50b856`

### S2

- Native browser implementation: Tauri 2 child webviews (no iframe), per-tab native labels, tabs/back/forward/reload/URL/external controls, local URL/profile/tab persistence, and editable Settings presets for ComfyUI, Penpot, FlowPix, and Super-i.
- Isolation: profile roots are created only under Dukick local data (`BuzzDukick\\workbench\\profiles`); allowed profiles are `default`, `superi-chrome`, `superi-firefox`, `flowpix`, `higgsfield`, and `pinterest`. No existing browser profile or cookie was read/copied.
- IPC/CDP: external webviews match `workbench-browser-*` and receive an explicit empty capability; the trusted default capability now targets only `main`/`huddle-*` webviews. All Rust browser commands reject non-workbench labels. CDP accepts only literal `127.0.0.1`.
- Restart behavior: URL/profile/tab state is persisted locally; runtime native labels are deliberately stripped so restart cannot restore stale webview handles.
- TDD RED: browser store lacked native-label/tab helpers; empty capability file was absent; native-label classifier was absent; editable preset save/load was absent; restart test proved stale native labels were restored.
- GREEN: focused browser tests 5/5; desktop TypeScript check PASS; Rust workbench tests 3/3 under `vcvars64` with `CC=cl`, `CXX=cl`, `CARGO_BUILD_JOBS=6`; capability isolation test 1/1 PASS; targeted Biome check PASS.
- Shared files touched: `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/capabilities/default.json`, and `desktop/src/features/settings/ui/SettingsPanels.tsx` for command/capability/Settings registration only.
- Initial implementation commit: `f013c3fc2`; completion/security follow-up commit: `bbebe159f`.
- S2 DONE `bbebe159f`

### S3

- Reused the existing `TerminalBootstrap`, `TerminalSubstrate`, `terminalPanelStore`, native terminal commands, and `buzz-terminal` crate; no second PTY/runtime was created.
- Added a stable `buzz-terminal-dock-host` in the Workbench Terminal tab and portals the existing substrate into that host. Multiple sessions, active tab, output buffers, close/stop, focus, and resize continue through the existing runtime.
- Ctrl/Cmd+J still owns terminal open/close. Terminal store state opens the right dock on Terminal; switching panels or closing hides the substrate without destroying PTY sessions. `requestTerminalSession()` is the UI-only adapter for later agent/MCP commands and always requests a new visible tab.
- TDD RED: the session-request API was absent and terminal mode did not select the Workbench Terminal tab.
- Review backprop RED: closing Workbench kept BrowserPanel mounted behind `hidden`, and terminal close left an empty dock. Added V1/V2 regression tests and synchronized both lifecycles.
- GREEN: combined Terminal store/Bootstrap/Workbench tests 19/19; TerminalSubstrate regression tests 25/25; desktop TypeScript check PASS; targeted Biome PASS; diff check PASS.
- Shared files touched: WorkbenchDock and existing terminal UI/store only; no Rust terminal engine changes.
- S3 DONE `b77738bb8`

### S4

PENDING

### S5

PENDING

### Final verification

PENDING
