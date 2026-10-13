# Third-party notices

## Signals standard-SIMD convolver adaptation

`src/dsp/signalsConvolverBytes.ts` is adapted from the embedded convolver in
`@jtarrio/signals` **0.10.1**, copyright 2026 Jacobo Tarrio Barreiro,
licensed under the Apache License, Version 2.0:
<https://www.apache.org/licenses/LICENSE-2.0>.
The full license is retained at `src/dsp/signals-APACHE-LICENSE.txt` and
shipped as `SIGNALS-LICENSE.txt`. The original package remains pinned and
unmodified. Source project:
<https://github.com/jtarrio/signals>.

BrowserSDR replaces its four `f32x4.relaxed_madd` instructions with a helper
using standard `f32x4.mul` followed by `f32x4.add`. The adaptation retains
the kernel exports and memory layout. Browsers that validate the original
kernel continue using it; other browsers use this standard-SIMD kernel.
Floating-point rounding can differ within the original relaxed operation's
permitted semantics. FFT bytes are unchanged.

Original convolver SHA-256:
`5f00919c79db247f79d3f479264c455a469e804707f39c06b41893b77b2135db`.
Adapted convolver SHA-256:
`9d68c586b742a0afbe4d2b178ae2d0beccc8c44e9ee2513879d7af4c959312f9`.
Regenerate from the exact installed package bytes with
`scripts/build-signals-convolver-compat.mjs` and separately installed
**wabt 1.0.37**; no tool download or regeneration occurs during ordinary builds.
The script verifies the input hash and expected instruction count, and validates
its output with relaxed SIMD disabled. wabt is an Apache-2.0 build tool and is
not included in the application.

## Independent APRS modem-audio test fixture

`src/aprs/fixtures/picoSoundcard.s16le` is an unchanged PCM excerpt from
`eleccoder/raspi-pico-aprs-tnc` revision
`bc291e2ec9ccd0bf4829b5a75c486fd84b0d95e9`,
copyright (C) 2021–2023 Thomas Glau, DL3TG, under GPL-3.0-or-later.
The original license is retained in `src/aprs/fixtures/PICO-LICENSE.txt`;
source, hashes and extraction details are in
`src/aprs/fixtures/picoSoundcard.md`. This independent soundcard recording is
used only in tests and is not bundled into the application. Source:
<https://github.com/eleccoder/raspi-pico-aprs-tnc>.

## Natural Earth map data

The map assets under `src/assets/natural-earth-*` are derived from Natural
Earth Vector data downloaded from the Natural Earth Vector repository and
converted to equirectangular SVG and compact label JSON by
`scripts/generate-natural-earth-map.mjs`. The empty map uses the 1:110m land
overview. Auto-framed maps use the 1:10m land, lakes, national boundary,
state/province boundary and populated-place layers.

The source GeoJSON files used for the current conversion had these SHA-256
digests:

- `ne_110m_land`: `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`
- `ne_10m_land`: `1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416`
- `ne_10m_lakes`: `2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9`
- `ne_10m_rivers_lake_centerlines_scale_rank`: `65dca1bd1729a347dda0837f41b5d152252e33abd2d7ff3370a0539c33bdf89b`
- `ne_10m_admin_0_boundary_lines_land`: `74d9c16229c095fde65943a9919e337682f044bcebccb120764f38edf3b70f4a`
- `ne_10m_admin_1_states_provinces_lines`: `1a1f30ccaaf4cc9c4bde34266f0b8cbb955d3a4cf254b756912255f2ec7c75b6`
- `ne_10m_populated_places`: `9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b`

Natural Earth raster and vector map data is in the public domain. Permission
and attribution are not required. See
<https://www.naturalearthdata.com/about/terms-of-use/>.

## Browser libraries

BrowserSDR bundles `@jtarrio/webrtlsdr` 3.0.6 and `@jtarrio/signals`
0.10.1 under the Apache License 2.0. It also bundles React 19.2.8,
React DOM 19.2.8 and fflate 0.8.3 under the MIT License. The corresponding
licence files are retained with the pinned packages used to build the release.
The Apache License 2.0 text is available at
<https://www.apache.org/licenses/LICENSE-2.0> and the MIT licence text at
<https://opensource.org/license/mit>.

## Analog Devices no-OS AD9361/AD9364 driver

BrowserSDR includes a receive-only WebAssembly build from Analog Devices no-OS
commit `42d9893169f57b10c3d249a98633051e9ff037be`, plus a BrowserSDR-specific
bridge and B205 receive profile. The exact source closure and reproducible build
instructions are retained under `third_party/adi-no-os/`. This component is
separate from, and does not determine, the licence chosen for BrowserSDR.

Copyright 2013-2026 Analog Devices, Inc.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of Analog Devices, Inc. nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY ANALOG DEVICES, INC. “AS IS” AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
EVENT SHALL ANALOG DEVICES, INC. BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Emscripten runtime and musl libc

The AD9364 JavaScript/WebAssembly artifact is generated with Emscripten 4.0.22
and includes applicable Emscripten runtime and musl libc portions.

Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Copyright © 2005-2020 Rich Felker, et al.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Nuand bladeRF hosted FPGA images

BrowserSDR does not redistribute Nuand FPGA bitstreams. It links users to the
official versioned Nuand downloads and accepts a local `.rbf` import for
volatile device configuration. The supported xA4 source URLs, exact lengths,
versions and SHA-256 checksums are recorded in `src/radio/bladerfImages.ts`.
The original images and release notes are published at
<https://www.nuand.com/fpga_images/>.

## Ettus Research USRP B2xx firmware and FPGA images

BrowserSDR does not redistribute the pinned Ettus FX3 firmware or FPGA image.
It links to immutable official archives, accepts explicit local import, verifies
exact sizes and SHA-256 digests, and writes the images only to volatile device
RAM. Their exact UHD source, archive and member identities are recorded in
`public/assets/usrp-b205/uhd-4.9.0.0/` and the USRP protocol contract.

## DAB-Radio reference implementation

The DAB carrier mapping, puncturing and equal-error-protection constants in
`src/dab/dabChannelCoding.ts` and `src/dab/dabModeI.ts` are adapted from
[DAB-Radio](https://github.com/williamyang98/DAB-Radio), revision
`0a09ba34a40286cf77e0c48aa47cac64b86341ef`. The PAD and MOT reference
parsers in that revision were also consulted when implementing
`src/dab/dabPad.ts` and `src/dab/dabMot.ts`, alongside the ETSI specifications.

MIT License

Copyright (c) 2022 William Yang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Lucide UI icons

BrowserSDR bundles `lucide-react` 1.52.0. Its ISC licence and the MIT licence
for icons derived from Feather are reproduced below.

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
