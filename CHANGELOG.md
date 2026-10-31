# Changelog

## 1.19.0 — 2026-10-31

- Add eight guided Radio Apps: aircraft tracking, ship tracking, DAB+, FM Radio,
  APRS, weather balloons, aircraft messages and supported weather sensors. Apps
  share receiver settings, explicit Start/Stop, fitted information views and a
  shortcut back from Receiver. Browsing and returning remain passive.
- Allow capture-center exploration beyond the listening channel. Keep fitting
  channels; otherwise warn and switch to Spectrum only while preserving the old
  recording. Keep source/input limits and fixed replay context explicit.
- Use one compact layout, remove the retired density/dock size buttons, migrate
  saved layout preferences and retain Collapse/Expand in local and remote views.
- Avoid hidden Receiver/capture presentation work and prepare common development
  modules during startup. Receiver, decoder and recording ownership stay shared.

## 1.18.1 — 2026-10-30

- Fix Airspy APRS and other digital channel recordings being rejected during library finalization and replay. Validate the filtered decoder clock while preserving the stored I/Q sample rate, bytes and timing.

## 1.18.0 — 2026-10-28

- Add experimental Airspy R2 / Mini reception with firmware-advertised sample rates, full Linearity/Sensitivity gain presets, manual LNA/mixer/VGA stages, independent AGC, explicit bias-tee power, 12-bit USB packing and frequency correction.
- Add standard and Sharp real-ADC conversion filters and filtered decimation through 64, with precise device/ADC/output clocks and converted 16-bit I/Q capture, SigMF export and replay.
- Keep 10 MS/s processing bounded with SIMD channel resampling and coordinated USB/worker handoff; preserve filter response and expose failures instead of silently discarding input.
- Load optional USB receiver drivers on demand while preserving the USB chooser gesture, cancellation and startup size budget.

## 1.17.0 — 2026-10-27

- Add an optional persistence spectrum with a rolling frequency/level occurrence display, saved history windows through one minute, compact Display settings, adjustable colour saturation and observed-spectrum hover guides. Preserve compatible channel history while tuning. Keep the current trace visible and support Canvas2D without WebGPU.

- Add switchable 3D spectrum history with perspective controls, direct frequency picking and channel markers that move while compatible RF history stays visible.
- Keep the 3D history duration frozen when pausing while a GPU draw is still pending.
- Add the Graphite Studio theme and matching instrument controls.
- Expand the German band guide with sourced frequency-use entries and documented coverage limits.
- Validate HackRF VGA gain drafts before applying settings, retaining the supported 0–62 dB range in 2 dB steps.

## 1.16.0 — 2026-10-24

- Simplify Receiver setup with on-demand health, RF input/power and Display dialogs; move Antenna guide to the header and make tuning utilities and live metadata more compact.
- Keep reception health synchronized with current decoder results, preserve visible input state and clarify capture-center and stopped/replay guidance.

- Add matching source-tool buttons, more comfortable padding and button-origin popup motion with responsive placement and reduced-motion support. Align tuning actions and retain the original channel-frequency typography.

## 1.15.0 — 2026-10-24

- Add reception health metrics and explicit, bounded gain setup using fresh input samples.
- Add a second local AM/NBFM/SSB/CW audio VFO inside the captured RF window, with independent controls and selected recording ownership.
- Add a Watch workspace for channel listening, activity alerts and bounded pre/post-event native I/Q captures with SigMF exports.
- Add declared compatible RTL Q-branch HF input and converter-aware tuning, recording and replay provenance.
- Add explicit compatible RTL/HackRF antenna-power controls, acknowledged recording settings and default-OFF saved preferences.
- Match receiver-tool typography and themed switches, place VFO B under Tune & demodulate, and move quiet display status into the header health popup.
- Keep closed RF-health tools passive, prepare the selected native input path before reception, and fit recording-channel selection into the existing capture options.

## 1.14.0 — 2026-10-23

- Redesign Explorer around a spectrum-led workspace with editable monitoring controls, clearer signal inspection, theme consistency and responsive layouts.
- Remember scan drafts and display preferences, and save complete named scan setups without starting acquisition.
- Add bounded signal refinement and silent FM pilot/RDS analysis, with measured progress, retained dated evidence and explicit receiver handoff.
- Alternate repeated discovery sweeps with individual candidate analyses until paused, preserving receiver ownership, cleanup and history.
- Start reception when explicitly investigating a signal in a connected, paused receiver; stabilize monitoring status layout and theme its switches.
- Increase high-rate channel-recording headroom while preserving filter output and bounded capture safeguards.

## 1.13.0 — 2026-10-21

- Add POCSAG paging reception and recording replay at 512, 1200 and 2400 bit/s, with message details, framing and correction evidence, filters and text/JSON exports.
- Preserve POCSAG settings in recordings and SigMF metadata, with bounded worker queues and explicit partial-message endings.
- Improve acquisition with short preambles and carrier offsets while retaining conservative framing validation.
- Catch up overdue recording-replay blocks at every supported rate within existing work and memory limits, so delayed browser timers do not leave replay needlessly behind.

## 1.12.0 — 2026-10-21

- Shared RF frequency Search now uses SigIntAtlas’s reviewed public catalog. Choose Automatic, Live or Saved, with a dated offline fallback and explicit unavailable states. Live updates and new protocol families appear without rebuilding BrowserSDR.
- Validate and save catalog updates in a worker while preserving high-rate reception and capture.

## 1.11.0 — 2026-10-20

- Prepare the installed app for offline startup, including receiver tools, local recordings and replay. Settings shows preparation progress and cache readiness.
- Verify every cached application file and keep each cached build consistent. Failed or incomplete updates preserve the ready version.
- Hold updates until all app windows and tabs close, preserving ongoing reception and recording.
- Improve high-rate recording headroom while preserving filter response and bounded capture safeguards.
- Preserve the selected tool and keyboard focus while the remote receiver finishes loading.

## 1.10.0 — 2026-10-19

- Add an integrated antenna guide with reception tips, selectable antenna diagrams and frequency-based element lengths.
- Add telescopic monopole and dipole presets, including ANT500, ANT700, RTL-SDR Blog and RaTLSnake profiles, physical length limits and optional eighth-wave guidance.
- Save named custom antenna presets locally with editing, duplication and delete/undo controls.

## 1.9.0 — 2026-10-18

- Add opt-in experimental RTL-SDR 3.2 MS/s acquisition, live rate switching, native/channel capture and replay, with explicit loss caveats and bounded delivered-input diagnostics. Preserve existing defaults and other receiver rate choices.
- Extend narrow decoder profiles to 3.2 MS/s, qualify ADS-B sampling phases, and count complete reduced-sample intervals in sensor pulse durations while retaining CRC/checksum validation.

- Add continuous Explorer monitoring with custom frequency targets, watchlists, repeated band sweeps, bounded signal history, coverage, pause/resume and exports.
- Add the compact Explorer workbench, guided setup, measured band spectrum and selectable detection markers linked to results and inspection.
- Group detections adaptively with supported bandwidths, stable middle frequencies and component evidence; alternate scan grids to revisit window boundaries.
- Add invitation-key live audio and spectrum sharing for one guest, with independent volume, authenticated TURN fallback, connection-path status and cleanup that preserves host reception.
- Improve Favorites recall and detailed-map responsiveness; bundle UI fonts locally for reliable startup.
- Preserve installation prompts during lazy receiver startup and keep Session tools compact.
- Guard complete browser-test coverage and split CI checks across four development/production shards.
- Preserve decoded-record selection and frozen review when a replay ends.
- Reduce channel-recording worker allocation, copying and zero-coefficient half-band filtering while preserving borrowed live input and bounded overload protection.

## 1.8.0 — 2026-10-17

- Improve tuning drafts, whole-Hz readouts, explicit recentering and regional click-to-tune channel snapping, with an Alt-click free-tuning override.
- Enable FM stereo with mono fallback and a stable Stereo/Mono/Intermittent pilot reception summary. Add raw input-clipping guidance.
- Accelerate high-rate channel filtering with bounded WASM processing while preserving channel response, rates and recording guards.
- Improve recording/replay prerequisites, retained-capture mode changes, replay bounds, newest-first recordings and deletion confirmation.
- Add cooperating same-origin USB tab ownership and guarded RTL tuner-family information.
- Refine Search and Explorer suggestions, spectrum scaling/ticks, responsive controls, decoder summaries, DAB format/protection details and map context/retry.
- Add explicit Fine Offset WH2 / TFA 30.3157 OOK temperature/humidity decoding with CRC validation. Physical reception remains separate acceptance work.
- The reported RTL DAB EEP 2-B reception issue remains under investigation; this release does not claim a fix.

## 1.7.1 — 2026-10-16

- Align trailing SDR icons across community hardware rows.
- Open Community tests on Analog audio each time.

## 1.7.0 — 2026-10-15

- Add receive-only WEFAX weather charts and SSTV Martin M1/M2 color images with bounded progressive rendering, automatic synchronization, manual reception, alignment/slant corrections and PNG/provenance exports.
- Add opt-in CW + text with adjustable Morse speed/threshold, tentative transcription and the existing CW audio monitor. Preserve ordinary CW listening and the default quick modes.
- Add independent PySSTV encoder reference audio and generated image/CW checks; physical reception and independent WEFAX/CW recordings remain separate acceptance work.

- Add bounded decoded-audio WAV recording and opt-in 60-second rewind for local/replay listening, DAB+ and processed remote audio; preserve export at source boundaries and rewind after replay completion.
- Add a standalone web-app manifest, branded app icons and browser-driven installation from Settings. Offline startup remains separate.

- Add receive-only RTTY, BPSK31, NAVTEX/SITOR-B and single-channel VHF ACARS to the mode chooser, Search guides, Decoder and compatibility report catalog.
- Add DWD/amateur RTTY presets, fine tuning, polarity/framing controls, bounded live/replay workers, integrity diagnostics and text/JSON exports. Preserve modem settings in recordings, favorites and settings links.
- Add generated I/Q and independent ACARS audio checks. Physical off-air acceptance and independent HF reference captures remain pending.

- Add an optional spectrum/waterfall hover frequency guide with trace-relative level, channel offset, paused/stale context and saved display preference. Hover remains passive; waterfall levels describe the latest spectrum.
- Keep decoded PCM and WAV capture at their established sample rate when an audio device runs at 44.1 kHz, preserving complete replay recordings and rewind.
- Restore the condensed Audio & decode dock by keeping the collapsed audio recorder in the status row; expanded controls remain keyboard-accessible on laptops and phones.
- Recover DAB carrier/quadrature synchronization after sustained FIC failure while retaining discovered service selection. Sustained physical acceptance remains separate.
- Qualify ADS-B DF18 addresses/origins and guard surface position, altitude, velocity and version-dependent reported quality.
- Cover new image/CW features independently in community reports and preserve explicit untested engine evidence.

## 1.6.1 — 2026-10-15

- Enable mouse-wheel map zoom in both directions while preserving page scrolling outside the map, browser pinch zoom and Fit reset.

## 1.6.0 — 2026-10-15

- Show detailed local geography automatically in geographic decoder views; remove the detail switch.
- Improve map contrast and visible raster resolution within the existing pixel-memory limits.
- Add button and keyboard zoom alongside panning and Fit targets, with a retry action when geography cannot load.
- Retain the searchable decoder chooser and saved quick modes introduced in 1.5.0.

## 1.5.0 — 2026-10-15

- Short, customizable quick-mode dropdown and adjacent More modes decoder chooser with search and categories.
- Saved, bounded quick-mode pins with explicit replacement and a visible unpinned current mode.
- Passive browsing, explicit source-compatible selection, configuration preview and shared recording/transition guards; responsive dialog with keyboard focus return.

## 1.4.0 — 2026-10-14

- Add account-free shared RF search for worldwide mesh presets, LoRaWAN regional plans, Bluetooth LE advertising, GNSS carriers, personal radio, NOAA weather and HF amateur dial conventions.
- Group large channel plans and load the frequency catalog when Search opens.
- Preserve channel directions, regional differences and explicit USB dial semantics; preview and Apply remain deliberate.

- Apply HackRF LNA/IF, VGA and RF amplifier changes during reception without restarting the receiver or decoder.
- Switch Pro sample rates while receiving, finishing the old recording and retaining USB/audio ownership through the transition.
- Present owner-accepted Pro 19.2 MS/s without an experimental suffix; retain experimental One support and guarded remote actions.

## 1.3.0 — 2026-10-14

- Add a compact, stationary Band guide between spectrum and waterfall, with a saved visible switch and grouped country/profile selection.
- Include Germany, a common CEPT European reference and twelve additional national profiles, retaining national boundaries, shared uses, source editions and honest gaps.
- Keep inspection separate from tuning and align the guide to accepted display coordinates in both local renderers.

## 1.2.0 — 2026-10-14

- Add experimental HackRF One reception alongside Pro in one automatically detected HackRF One / Pro source option. The initial One profile requires USB API 0x0110 (official v2026.01.3 baseline), uses native 9.6 MS/s CI8 and filters a 2.4 MS/s channel in the host.
- Apply One-specific gain and frequency limits, preserve native bytes and One identity through recording/export/replay, and keep One community evidence separate from Pro.
- Validate receive requests against actual compiled upstream libhackrf vectors and strict simulated USB/browser workflows. Physical HackRF One reception remains unverified; older/custom firmware is outside the initial profile.

## 1.1.3 — 2026-10-14

- Migrate anonymous Atlas station search to v2 station headers and lazy reference pages with exact counts.
- Preserve filters, UUID reference links and deliberate tuning; recheck references before applying and recover explicitly from stale cursors or request failures.

## 1.1.2 — 2026-10-14

- Fix the blue-background startup failure on Safari configurations that reject relaxed-SIMD WASM instructions. Select a standard-SIMD DSP filter when the original kernel is unsupported, while retaining the existing kernel on supporting browsers.
- Apply the compatibility path to optimized development imports and module workers, with numerical and browser startup/processing regression coverage.

## 1.1.1 — 2026-10-14

- Carry compatibility evidence across unchanged feature paths through reviewed dependency fingerprints and explicit build equivalence checks. Show original build/date/expiry and separate fresh counts; issues, corrections, exclusions and withdrawals continue to apply.
- Keep carried engine checks separate from exact-build results and provide collector administration/fingerprint tooling. Existing themes and utility overlays are retained.

- Prevent retained-recording replay/download/delete from competing with the library refresh lock; coalesce overlapping refreshes.

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
