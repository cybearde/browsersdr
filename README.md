# BrowserSDR

Software-defined radio in your browser: live spectrum and waterfall, audio and digital decoding, I/Q recording, replay, and field surveys.

**Source version: 1.1.2.** Stable desktop support covers RTL-SDR and HackRF Pro on Chrome. About shows the installed version and exact build; website deployment is tracked separately. See [changes and version policy](CHANGELOG.md).

**Stable desktop receivers:** RTL-SDR and HackRF Pro, using WebUSB over HTTPS or localhost. Chrome is the validated desktop browser baseline. Other Chromium browsers, bladeRF/USRP, remote receivers and unverified mode combinations remain available for further testing and community feedback; experimental hardware/rate labels still apply. A hardware-free demo and replay are available. WebGPU rendering has a Canvas2D fallback. Help and the wiki distinguish tested configurations from feature availability.

The DSP filter uses a standard-SIMD compatibility kernel when the browser cannot compile relaxed SIMD, allowing the interface to load on affected Safari configurations.

**Appearance:** Choose Midnight Observatory, Amber Field Deck or Vice Afterglow from Settings → Theme. Your choice stays in this browser and applies while receiving or replaying.

**Community tests:** Compatibility & tests in the ? menu includes version tabs, a shared hardware × decoder matrix, separate platform checks, and exact-build engine evidence. Report only the functions you tested; duration-qualified reports contribute immediately, and two distinct participation tokens confirm a compatible feature cell. Tokens help deduplicate reports; they do not prove independent physical tests. Live reporting needs the [optional collector and proxy routes](deploy/report-service/README.md); development builds can download reports for review.

Unchanged features can retain earlier compatibility evidence through explicitly recorded build equivalence and integration checks. The matrix labels it **carried**, shows its original build/dates/expiry, and keeps fresh counts separate. Relevant issues, withdrawals and expiry still apply; changed processing or display paths need their own checks. See the [carry-forward procedure](deploy/report-service/README.md#carrying-unchanged-feature-evidence-between-releases).

![BrowserSDR receiving WBFM with an RTL-SDR, showing the spectrum, waterfall and RDS station data](assets/receiver.jpg)

[Open BrowserSDR](https://browsersdr.com) · [Wiki](https://github.com/cybearde/browsersdr/wiki) · [Getting started](https://github.com/cybearde/browsersdr/wiki/Getting-started) · [Build & test](https://github.com/cybearde/browsersdr/wiki/Development) · [Issues](https://github.com/cybearde/browsersdr/issues)

[PolyForm Perimeter 1.0.1](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
