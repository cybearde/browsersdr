# Changelog

## 1.1.2 — 2026-10-14

- Fix the blue-background startup failure on Safari configurations that reject relaxed-SIMD WASM instructions. Select a standard-SIMD DSP filter when the original kernel is unsupported, while retaining the existing kernel on supporting browsers.
- Apply the compatibility path to optimized development imports and module workers, with numerical and browser startup/processing regression coverage.

## 1.1.1 — 2026-10-14

- Carry compatibility evidence across unchanged feature paths through reviewed dependency fingerprints and explicit build equivalence checks. Show original build/date/expiry and separate fresh counts; issues, corrections, exclusions and withdrawals continue to apply.
- Keep carried engine checks separate from exact-build results and provide collector administration/fingerprint tooling. Existing themes and utility overlays are retained.

## 1.1.0 — 2026-10-13

- Add Amber Field Deck and Vice Afterglow, selected from Settings → Theme alongside Midnight Observatory.
- Save the theme per browser and recolor local/remote spectra and retained waterfall history without restarting reception or replay.
- Include Vice sunset, palm, wordmark and Good Signals Only artwork, with full-header coverage and a poster fitted to its panel.
- Preserve the framed utility overlays introduced in 1.0.2 and support narrow screens, keyboard navigation and forced colors.

## 1.0.2 — 2026-10-13

- Open Settings, Help & setup, Compatibility & tests and About in a framed overlay above the current workspace.
- Keep acquisition, capture, remote listening and unsaved Settings drafts while visiting utility pages.
- Add fixed utility navigation and close/return controls, internal scrolling, a blurred backdrop and keyboard focus handling.

## 1.0.1 — 2026-10-13

- Count duration-qualified community test reports immediately, including existing pending reports, without maintainer approval.
- Replace pending-review messages with direct contribution and duration guidance; keep duplicate handling, issue visibility, withdrawal and tools for later misuse investigation.
- Consolidate USRP B205mini-i community rows while keeping historical setup evidence separate.

## 1.0.0 — 2026-10-13

First stable desktop release for RTL-SDR and HackRF Pro on Chrome, including the Decoder workspace, account-free Search, recording recovery and bounded file replay introduced in the candidates. Other hardware, browser and mode combinations retain their scoped available/experimental status.

- Separate Compatibility & tests from passive Help & setup and remove the field-guide banner.
- Consolidate RTL-SDR community rows and new reports into one receiver family, with legacy model identifiers still accepted.
- Keep one community report form, add tuning and private receiver/browser troubleshooting context, and retain JSON copy/download.
- Add small trailing device silhouettes, aligned matrix controls and a styled receipt-based withdrawal dialog.

## 1.0.0-rc.2 — 2026-10-12

- Align local recording library buttons with compact controls, remove the HackRF sample-rate explainer and theme GUI scrollbars.

- Community compatibility reporting in Help: version tabs, shared hardware/decoder evidence, separate platform/runtime checks and exact-build engine records.
- Structured per-feature reports with duration, reviewed two-positive confirmation, persistent problem visibility and downloadable withdrawal receipts. Legacy reports remain separate.
- Recover transient HackRF USB interface reclaim failures during gain/rate reconfiguration with bounded, cancellable retries; initial permission and persistent contention failures remain actionable.
- Declare RTL-SDR and HackRF Pro the stable desktop receiver scope, with Chrome as the validated browser baseline and per-mode/configuration evidence retained.
- Update support evidence with native 2 GiB capture, bounded replay and interrupted-capture recovery acceptance; clarify wall-clock capture timing versus received sample duration.

## 1.0.0-rc.1 — 2026-10-12

Source checkpoint for the next website release. Committing this version does not deploy it.

- Dedicated Decoder workspace with map/results review, aircraft symbols, optional traffic tracks, map panning, held framing, selection and exports.
- Account-free station Search with local guides, favorites and deliberate application of public catalog references.
- Recoverable browser-storage recording library, explicit retention/deletion, quota information and navigation protection.
- File-backed replay up to 2 GiB, pause/resume and stopped range selection, with guarded and cancellable imports.
- Worker hashing, bounded packet-buffer reuse, deferred workspaces and progressive map detail, with build byte budgets.
- Accessible tuning controls, improved phone ordering, visible survey-save/recovery status and dated support evidence in Help.

Remaining acceptance includes current physical receiver/mode/browser coverage, audible output, longer loaded-host runs and large-file/storage limits. Browser storage can be evicted; interrupted captures recover committed samples only. Some constrained map actions exceed the 200 ms target. Generated tests do not establish RF reception or universal device support.

## Version policy

`package.json` is the application version; the lockfile must match it. About displays that version alongside the independent build identity. Release metadata records the version from the frozen source.

Use `MAJOR.MINOR.PATCH`: major for incompatible supported behavior or format changes, minor for compatible features, patch for compatible fixes. Before stable 1.0, use `1.0.0-rc.N` for successive candidates. Stable `1.0.0` requires an explicit release decision after reviewing the candidate's software checks and scoped independent acceptance. Experimental hardware/modes retain their labels.

Record each released version here. Release IDs, source hashes and deployment records continue to identify exact artifacts. Existing data, wire and export schema versions remain independently versioned. Released version numbers are immutable; changed releases receive a new version. An intentional rollback may reactivate a previously verified artifact.
