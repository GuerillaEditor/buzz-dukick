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

PENDING

### S3

PENDING

### S4

PENDING

### S5

PENDING

### Final verification

PENDING
