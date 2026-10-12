import { openApplicationView } from "./application-navigation";
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const pageErrors = new WeakMap<Page, Error[]>();

test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

async function gotoApp(page: Page): Promise<void> {
  await page.goto("/?browser-test=1");
  await expect(
    page.getByRole("tab", { name: "Receiver", exact: true }),
  ).toBeVisible();
}

async function selectSyntheticAndStart(page: Page): Promise<void> {
  await page
    .locator('select[aria-label="Signal source"]')
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
}

async function prepareSyntheticSigmf(page: Page): Promise<void> {
  await selectSyntheticAndStart(page);
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await page.getByLabel("Recording export format").selectOption("sigmf");
  await page.getByRole("button", { name: "Start I/Q recording" }).click();
  await expect
    .poll(async () => {
      const text = await page.locator(".recording-state").textContent();
      return Number(text?.match(/([0-9.]+) \/ (?:32|2048) MiB/)?.[1] ?? 0);
    })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(
    page.getByRole("heading", { name: "Save to SigIntAtlas" }),
  ).toBeVisible();
}

interface AtlasMockOptions {
  deferVerification?: boolean;
  failFirstPart?: boolean;
  gateFirstCapabilities?: Promise<void>;
  expireFirstSession?: boolean;
  offline?: boolean;
}

async function installAtlasMock(page: Page, options: AtlasMockOptions = {}) {
  const uploads = new Map<
    string,
    {
      id: string;
      role: "data" | "metadata";
      byteLength: string;
      sha256: string;
      expectedParts: number;
      state: "created" | "uploading" | "completing" | "complete";
      parts: Array<{
        upload_id: string;
        part_number: number;
        byte_length: string;
        sha256: string;
        etag: string;
        accepted_at: string;
      }>;
    }
  >();
  let uploadNumber = 0;
  let firstPart = options.failFirstPart ?? false;
  let firstCapabilities = true;
  let firstSession = options.expireFirstSession ?? false;
  let recordingCreates = 0;
  let loginRequests = 0;
  const partSize = 65_536;
  const recordingId = "30000000-0000-4000-8000-000000000001";
  const revisionId = "40000000-0000-4000-8000-000000000001";
  const runId = "50000000-0000-4000-8000-000000000001";

  await page.route("**/api/v1/**", async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    if (options.offline) {
      await route.abort("connectionrefused");
      return;
    }
    if (path === "/capabilities") {
      if (firstCapabilities && options.gateFirstCapabilities) {
        firstCapabilities = false;
        await options.gateFirstCapabilities;
      }
      await route.fulfill({
        status: 200,
        json: {
          schema_version: "1.0.0",
          supported_sigmf_versions: ["1.2.6"],
          supported_datatypes: ["cu8", "ci8", "ci16_le", "cf32_le"],
          max_data_bytes: "34340864",
          max_metadata_bytes: "1048576",
          upload_part_bytes: String(partSize),
          max_inflight_parts: 2,
          storage_configured: true,
          analysis: {
            schema_version: "signal-atlas-analysis-capabilities-v1",
            available: true,
            operations: ["analyze", "identify"],
            profiles: ["legacy-http-v1", "offline-bounded-v1"],
            supported_datatypes: ["cu8", "ci16_le", "cf32_le"],
            unavailable_reason: null,
          },
        },
      });
      return;
    }
    if (path === "/me") {
      await route.fulfill({
        status: 200,
        json: {
          id: "browser-test",
          display_name: "Browser test",
          role: "operator",
          token_id: null,
          bootstrap: false,
        },
      });
      return;
    }
    if (path === "/session") {
      if (request.method() === "DELETE") {
        await route.fulfill({ status: 204 });
        return;
      }
      loginRequests++;
      if (firstSession) {
        firstSession = false;
        await route.fulfill({
          status: 401,
          json: {
            error: { code: "session_expired", message: "Session expired." },
          },
        });
        return;
      }
      await route.fulfill({
        status: 201,
        headers: {
          "Set-Cookie": "signal_atlas_session=test; HttpOnly; SameSite=Strict",
        },
        json: {
          operator_id: "browser-test",
          expires_at: "2030-01-01T00:00:00Z",
          csrf_token: "browser-test-csrf",
        },
      });
      return;
    }
    if (path === "/uploads" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        role: "data" | "metadata";
        byte_length: string;
        sha256: string;
      };
      const id = `10000000-0000-4000-8000-${String(++uploadNumber).padStart(12, "0")}`;
      const upload = {
        id,
        role: body.role,
        byteLength: body.byte_length,
        sha256: body.sha256,
        expectedParts: Math.ceil(Number(body.byte_length) / partSize),
        state: "created" as const,
        parts: [],
      };
      uploads.set(id, upload);
      await route.fulfill({ status: 201, json: uploadView(upload) });
      return;
    }
    const part = path.match(/^\/uploads\/([^/]+)\/parts\/(\d+)$/);
    if (part) {
      if (firstPart) {
        firstPart = false;
        await route.abort("connectionreset");
        return;
      }
      const upload = uploads.get(part[1]!)!;
      if (!["created", "uploading"].includes(upload.state)) {
        await route.fulfill({
          status: 409,
          json: {
            error: {
              code: "conflict",
              message: "upload no longer accepts parts",
            },
          },
        });
        return;
      }
      const bytes = request.postDataBuffer()!;
      const receipt = {
        upload_id: upload.id,
        part_number: Number(part[2]),
        byte_length: String(bytes.byteLength),
        sha256: request.headers()["content-sha256"]!,
        etag: `etag-${part[2]}`,
        accepted_at: "2026-09-27T00:00:00Z",
      };
      upload.parts.push(receipt);
      upload.state = "uploading";
      await route.fulfill({ status: 200, json: receipt });
      return;
    }
    const complete = path.match(/^\/uploads\/([^/]+)\/complete$/);
    if (complete) {
      uploads.get(complete[1]!)!.state = options.deferVerification
        ? "completing"
        : "complete";
      await route.fulfill({
        status: 202,
        json: {
          id: "20000000-0000-4000-8000-000000000001",
          kind: "upload-complete",
          status: "complete",
          attempt: 1,
          failure_code: null,
          result: null,
        },
      });
      return;
    }
    if (path.startsWith("/jobs/")) {
      await route.fulfill({
        status: 200,
        json: {
          id: path.split("/").at(-1),
          status: options.deferVerification ? "pending" : "complete",
        },
      });
      return;
    }
    const uploadRead = path.match(/^\/uploads\/([^/]+)$/);
    if (uploadRead) {
      const upload = uploads.get(uploadRead[1]!)!;
      if (upload.state === "completing" && !options.deferVerification)
        upload.state = "complete";
      await route.fulfill({
        status: 200,
        json: uploadView(uploads.get(uploadRead[1]!)!),
      });
      return;
    }
    if (path === "/recordings" && request.method() === "POST") {
      recordingCreates += 1;
      await route.fulfill({
        status: 202,
        json: {
          id: "60000000-0000-4000-8000-000000000001",
          state: "complete",
          recording_id: recordingId,
          failure_code: null,
        },
      });
      return;
    }
    if (path === `/recordings/${recordingId}`) {
      await route.fulfill({
        status: 200,
        json: {
          id: recordingId,
          current_revision_id: revisionId,
          import_status: "complete",
        },
      });
      return;
    }
    if (path === `/recordings/${recordingId}/analysis-runs`) {
      await route.fulfill({
        status: 202,
        json: {
          id: runId,
          recording_id: recordingId,
          recording_revision_id: revisionId,
          status: "queued",
          recording_url: `/#/recordings/${recordingId}`,
          result_url: `/#/runs/${runId}`,
        },
      });
      return;
    }
    if (path === `/runs/${runId}`) {
      await route.fulfill({
        status: 200,
        json: {
          id: runId,
          recording_id: recordingId,
          recording_revision_id: revisionId,
          status: "partial",
          recording_url: `/#/recordings/${recordingId}`,
          result_url: `/#/runs/${runId}`,
        },
      });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: path } },
    });
  });

  function uploadView(
    upload: typeof uploads extends Map<string, infer T> ? T : never,
  ) {
    return {
      id: upload.id,
      state: upload.state,
      role: upload.role,
      byte_length: upload.byteLength,
      accepted_bytes: String(
        upload.parts.reduce(
          (total, item) => total + Number(item.byte_length),
          0,
        ),
      ),
      part_size: String(partSize),
      expected_parts: upload.expectedParts,
      expires_at: "2026-09-28T00:00:00Z",
      parts: upload.parts,
      failure_code: null,
    };
  }

  return {
    uploads,
    recordingCreates: () => recordingCreates,
    loginRequests: () => loginRequests,
  };
}

async function installWorkerInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const state = { created: 0, terminated: 0, active: 0 };
    class InstrumentedWorker extends NativeWorker {
      private counted = true;
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        state.created += 1;
        state.active += 1;
      }
      override terminate(): void {
        if (this.counted) {
          this.counted = false;
          state.terminated += 1;
          state.active -= 1;
        }
        super.terminate();
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: InstrumentedWorker,
    });
    (
      window as Window & { __workerLifecycle?: typeof state }
    ).__workerLifecycle = state;
  });
}

function highRateReplayFiles() {
  const sampleRateHz = 2_400_000;
  const sampleCount = 400_000;
  const metadata = {
    format: "browsersdr-cu8-v1",
    sampleEncoding: "unsigned-8-bit",
    sampleOrder: "interleaved-iq",
    bytesPerComplexSample: 2,
    normalization: "float = (byte - 127.5) / 128",
    sampleRateHz,
    centerFrequencyHz: 200_000_000,
    selectedChannelFrequencyHz: 200_000_000,
    captureStartedAt: "2026-09-24T00:00:00.000Z",
    sampleCount,
    durationSeconds: sampleCount / sampleRateHz,
    source: "synthetic",
    mode: "WBFM",
    channelBandwidthHz: 150_000,
    squelch: 0,
    gainDb: null,
    knownGaps: [
      {
        afterSample: 200_000,
        // Keep the route fixture alive through this 20-second UI test.
        // EOF/flush behavior is exercised separately by packet-decoders.e2e.ts.
        missingSamples: 72_000_000,
        reason: "Deterministic test pause",
      },
    ],
    stopReason: "user",
    provenance:
      "Playwright deterministic high-rate replay fixture; no hardware capture.",
  };
  return {
    data: {
      name: "high-rate.cu8",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(sampleCount * 2, 128),
    },
    metadata: {
      name: "high-rate.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(metadata)),
    },
  };
}

function sigmfReplayFiles() {
  const sampleRateHz = 48_000;
  // Keep the running state observable even under the slower development
  // StrictMode lifecycle while retaining a short, bounded replay.
  const sampleCount = 96_000;
  const data = Buffer.alloc(sampleCount * 2, 128);
  const metadata = {
    global: {
      "core:datatype": "cu8",
      "core:version": "1.2.6",
      "core:sample_rate": sampleRateHz,
      "core:sha512": createHash("sha512").update(data).digest("hex"),
      "core:description":
        "The annotation below is deliberately untrusted by the importer.",
    },
    captures: [
      {
        "core:sample_start": 0,
        "core:global_index": 0,
        "core:frequency": 10_000_000,
        "core:datetime": "2026-09-24T00:00:00.000Z",
      },
      {
        "core:sample_start": 12_000,
        "core:global_index": 16_800,
        "core:frequency": 10_000_000,
      },
    ],
    annotations: [
      {
        "core:sample_start": 0,
        "core:label": "DAB",
        "core:comment": "Do not use this as a mode.",
      },
    ],
  };
  return {
    data: {
      name: "paced.sigmf-data",
      mimeType: "application/octet-stream",
      buffer: data,
    },
    metadata: {
      name: "paced.sigmf-meta",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(metadata)),
    },
  };
}

type ZipEntry = { name: string; data: Uint8Array };

function readStoredZip(archive: Uint8Array): ZipEntry[] {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const files: ZipEntry[] = [];
  let offset = 0;
  while (
    offset + 30 <= archive.byteLength &&
    view.getUint32(offset, true) === 0x04034b50
  ) {
    expect(view.getUint16(offset + 8, true)).toBe(0);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    files.push({
      name: new TextDecoder().decode(
        archive.subarray(nameStart, nameStart + nameLength),
      ),
      data: archive.slice(dataStart, dataStart + size),
    });
    offset = dataStart + size;
  }
  return files;
}

async function installRtlAdapter(
  page: Page,
  mode: "normal" | "pending-connect" | "close-fails-once",
): Promise<void> {
  await page.addInitScript((adapterMode) => {
    const state: {
      providerGets: number;
      closeAttempts: number;
      audioCloseAttempts: number;
      rateChanges: number[];
      audioSuspends: number;
      resolveConnect?: () => void;
    } = {
      providerGets: 0,
      closeAttempts: 0,
      audioCloseAttempts: 0,
      rateChanges: [],
      audioSuspends: 0,
    };
    (window as Window & { __rtlTestState?: typeof state }).__rtlTestState =
      state;
    Object.defineProperty(navigator, "usb", { configurable: true, value: {} });

    const createSource = () => ({
      setSampleRate: async (rate: number) => {
        state.rateChanges.push(rate);
        return rate;
      },
      setCenterFrequency: async (frequency: number) => frequency,
      setParameter: async <V>(_parameter: string, value: V) => value,
      startReceiving: async () => undefined,
      // Drain a pending read on Stop without pretending to deliver RF samples.
      readSamples: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                frequency: 0,
                I: new Float32Array(0),
                Q: new Float32Array(0),
                data: new ArrayBuffer(0),
              }),
            50,
          ),
        ),
      close: async () => {
        state.closeAttempts += 1;
        if (adapterMode === "close-fails-once" && state.closeAttempts === 1)
          throw new Error("Injected USB close failure");
      },
    });

    const createAudioContext = () => {
      let audioState = "suspended";
      return {
        get state() {
          return audioState;
        },
        sampleRate: 48_000,
        currentTime: 0,
        destination: {},
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        resume: async () => {
          audioState = "running";
        },
        suspend: async () => {
          state.audioSuspends += 1;
          audioState = "suspended";
        },
        close: async () => {
          state.audioCloseAttempts += 1;
          audioState = "closed";
        },
      };
    };

    (
      window as Window & { __BROWSERSDR_TEST_CONFIG__?: unknown }
    ).__BROWSERSDR_TEST_CONFIG__ = {
      rtlDependencies: {
        createAudioContext,
        createSourceProvider: (permissionGranted: () => void) => ({
          get: async () => {
            state.providerGets += 1;
            if (adapterMode === "pending-connect") {
              await new Promise<void>((resolve) => {
                state.resolveConnect = resolve;
              });
            }
            permissionGranted();
            return createSource();
          },
        }),
      },
    };
  }, mode);
}

test("live RTL rate selection preserves USB and audio ownership and resumes automatically", async ({
  page,
}) => {
  await installRtlAdapter(page, "normal");
  await gotoApp(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiving WBFM",
  );
  await page.getByText("Device details & settings", { exact: true }).click();
  const rate = page.getByLabel("Sample rate", { exact: true });
  await expect(rate).toBeEnabled();
  await rate.selectOption("2400000");
  await expect(rate).toHaveValue("2400000");
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiving WBFM",
  );
  await rate.selectOption("1024000");
  await expect(rate).toHaveValue("1024000");
  await expect(rate).toBeEnabled();
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiving WBFM",
  );
  expect(
    await page.evaluate(() => {
      const state = (
        window as Window & {
          __rtlTestState?: {
            providerGets: number;
            closeAttempts: number;
            audioSuspends: number;
            rateChanges: number[];
          };
        }
      ).__rtlTestState!;
      return {
        gets: state.providerGets,
        closes: state.closeAttempts,
        suspends: state.audioSuspends,
        rates: state.rateChanges,
      };
    }),
  ).toEqual({
    gets: 1,
    closes: 0,
    suspends: 0,
    rates: [1024000, 1024000, 2400000, 1024000],
  });
  await page
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
  await expect(page.locator(".receiver-status")).toContainText(
    "remains connected",
  );
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiving WBFM",
  );
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiver disconnected",
  );
});

test("synthetic processing survives StrictMode, stop/restart, source switch, and unmount", async ({
  page,
}, testInfo) => {
  await installWorkerInstrumentation(page);
  await gotoApp(page);

  await selectSyntheticAndStart(page);
  await openApplicationView(page, "Diagnostics");
  const analysisBlocks = page
    .getByText("Analysis blocks", { exact: true })
    .locator("xpath=following-sibling::dd");
  await expect
    .poll(async () =>
      Number((await analysisBlocks.textContent())?.replaceAll(",", "") ?? 0),
    )
    .toBeGreaterThan(0);

  const workerState = () =>
    page.evaluate(
      () =>
        (
          window as Window & {
            __workerLifecycle?: { created: number; active: number };
          }
        ).__workerLifecycle,
    );
  await expect.poll(async () => (await workerState())?.active).toBe(1);
  if (testInfo.project.name === "chromium-dev") {
    await expect
      .poll(async () => (await workerState())?.created)
      .toBeGreaterThanOrEqual(2);
  }

  await page.getByRole("tab", { name: /Receiver/ }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiver stopped",
  );
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
  await page
    .locator('select[aria-label="Signal source"]')
    .selectOption("replay");
  await expect(page.locator('select[aria-label="Signal source"]')).toHaveValue(
    "replay",
  );
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiver disconnected",
  );

  await page.evaluate(() =>
    (
      window as Window & { __BROWSERSDR_TEST_RUNTIME__?: { unmount(): void } }
    ).__BROWSERSDR_TEST_RUNTIME__?.unmount(),
  );
  await expect(page.locator("#root")).toBeEmpty();
  await expect.poll(async () => (await workerState())?.active).toBe(0);
});

test("replay routes supported analog and digital mode transitions at 2.4 MS/s", async ({
  page,
}) => {
  await gotoApp(page);
  await page
    .locator('select[aria-label="Signal source"]')
    .selectOption("replay");
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  const fixture = highRateReplayFiles();
  const fileInputs = page.locator(".file-picker-input");
  await fileInputs.nth(0).setInputFiles(fixture.data);
  await fileInputs.nth(1).setInputFiles(fixture.metadata);
  await page.getByRole("button", { name: "Load files" }).click();
  await expect(page.locator(".file-message")).toContainText(
    "Loaded 400,000 samples",
  );
  await page.getByRole("button", { name: "Start replay" }).click();
  await expect(page.locator(".receiver-session-details")).toContainText(
    "effective rate 2,400,000 samples/s",
  );

  for (const mode of [
    "AIS",
    "DAB",
    "ADS-B",
    "SRD",
    "APRS",
    "RS41",
    "AM",
  ] as const) {
    await page.getByRole("combobox", { name: /^Mode/ }).selectOption(mode);
    await expect(page.locator(".receiver-session-details")).toContainText(
      `· ${mode} ·`,
    );
    if (mode === "SRD") {
      await expect(
        page.locator("label", { hasText: /^\s*Modulation/ }).locator("select"),
      ).toHaveValue("ook");
      await expect(
        page.locator("label", { hasText: /^\s*Decoder/ }).locator("select"),
      ).toHaveValue("none");
      await page.getByRole("tab", { name: "Audio & decode" }).click();
      await expect(
        page.getByRole("heading", { name: "Short-range devices" }),
      ).toBeVisible();
      await page.locator(".decoder-details > summary").click();
      await expect(
        page.getByText("Unknown signals appear in the inspector.", {
          exact: false,
        }),
      ).toBeVisible();
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export device data (JSON)" })
        .click();
      expect((await download).suggestedFilename()).toContain("srd");
    }
    if (mode === "APRS" || mode === "RS41") {
      await page.getByRole("tab", { name: "Audio & decode" }).click();
      await expect(
        page.getByRole("heading", {
          name: mode === "APRS" ? "APRS stations" : "RS41 radiosondes",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: `Export ${mode} data (JSON)` }),
      ).toBeEnabled();
    }
    if (mode === "AM") {
      await page.getByRole("tab", { name: "Receiver" }).click();
      await expect(
        page.getByRole("meter", { name: "Current channel quality" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Auto set" }),
      ).toBeEnabled();
    }
  }
  await page.getByRole("tab", { name: "Audio & decode" }).click();
  await expect(
    page.getByRole("heading", { name: "Radio Data System" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start replay" }),
  ).toBeEnabled();
});

test("imports a bounded SigMF pair into paced replay without requesting USB", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { requests: 0 };
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: {
        requestDevice: async () => {
          state.requests += 1;
          throw new Error("USB must not be requested by replay");
        },
      },
    });
    (window as Window & { __sigmfUsbState?: typeof state }).__sigmfUsbState =
      state;
  });
  await gotoApp(page);
  await page
    .locator('select[aria-label="Signal source"]')
    .selectOption("replay");
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await page.getByLabel("Replay pair format").selectOption("sigmf");
  await page.getByLabel("SigMF replay mode").selectOption("AM");
  await expect(page.getByLabel("SigMF replay channel")).toHaveValue("center");
  const fixture = sigmfReplayFiles();
  const fileInputs = page.locator(".file-picker-input");
  await fileInputs.nth(0).setInputFiles(fixture.data);
  await fileInputs.nth(1).setInputFiles(fixture.metadata);
  await page.getByRole("button", { name: "Load SigMF pair" }).click();
  await expect(page.locator(".file-message")).toContainText(
    "Loaded SigMF replay: 96,000 samples",
  );

  await page.getByRole("button", { name: "Start replay" }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Replaying AM capture",
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiver stopped",
  );
  await page.getByRole("button", { name: "Start replay" }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Replay reached end of file",
    { timeout: 5_000 },
  );
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __sigmfUsbState?: { requests: number } })
          .__sigmfUsbState?.requests,
    ),
  ).toBe(0);
});

test("survey measurements progress without animation callbacks and freeze provenance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let identifier = 0;
    window.requestAnimationFrame = () => ++identifier;
    window.cancelAnimationFrame = () => undefined;
  });
  await gotoApp(page);
  await selectSyntheticAndStart(page);
  await page.getByRole("tab", { name: /Explorer/ }).click();
  await page.getByText("Site & profile", { exact: true }).click();
  await page.getByText("Edit profile bands", { exact: true }).click();
  await page.getByText("Detector settings", { exact: true }).click();

  await page
    .getByRole("textbox", { name: "Profile name" })
    .fill("Acquisition profile");
  await page
    .getByRole("textbox", { name: "Site label" })
    .fill("Acquisition site");
  await page.getByRole("spinbutton", { name: /Start frequency/ }).fill("99.9");
  await page.getByRole("spinbutton", { name: /End frequency/ }).fill("100.1");
  const surveySliders = page.locator('.explorer-controls input[type="range"]');
  await surveySliders.nth(0).fill("150");
  await surveySliders.nth(1).fill("1");
  await page.getByRole("button", { name: "Scan current window" }).click();

  await expect(
    page.locator(".explorer-results .diagnostic-message"),
  ).toContainText("Survey complete");
  await expect(
    page.getByRole("progressbar", { name: "Spectrum scan progress" }),
  ).toHaveAttribute("value", "2");
  await page
    .getByRole("textbox", { name: "Profile name" })
    .fill("Edited later");
  await page.getByRole("textbox", { name: "Site label" }).fill("Edited site");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Manifest JSON" }).click();
  const download = await downloadPromise;
  const manifest = JSON.parse(
    (await readFile(await download.path())).toString(),
  ) as {
    status: string;
    profile: {
      name: string;
      site: { label: string };
      bands: Array<{
        startFrequencyHz: number;
        endFrequencyHz: number;
        dwellMs: number;
        thresholdDb: number;
      }>;
    };
  };
  expect(manifest.status).toBe("completed");
  expect(manifest.profile.name).toBe("Acquisition profile");
  expect(manifest.profile.site.label).toBe("Acquisition site");
  expect(manifest.profile.bands[0]).toMatchObject({
    startFrequencyHz: 99_590_400,
    endFrequencyHz: 100_409_600,
    dwellMs: 150,
    thresholdDb: 1,
  });

  const firstMarker = page.locator(".candidate-marker").first();
  const firstCard = page.locator(".candidate-review-card").first();
  await expect(firstMarker).toBeVisible();
  await firstMarker.click();
  await expect(firstCard).toHaveClass(/candidate-review-card-highlighted/);
  await firstCard
    .getByRole("textbox", { name: "Label" })
    .fill("Persistent carrier");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | undefined>((resolve, reject) => {
            const open = indexedDB.open("browsersdr-surveys", 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const request = open.result
                .transaction("survey-runs", "readonly")
                .objectStore("survey-runs")
                .get("latest");
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                resolve(request.result?.records?.[0]?.annotation?.label);
                open.result.close();
              };
            };
          }),
      ),
    )
    .toBe("Persistent carrier");

  await page.reload();
  await page.getByRole("tab", { name: /Explorer/ }).click();
  await page.getByText("Site & profile", { exact: true }).click();
  await page.getByText("Edit profile bands", { exact: true }).click();
  await page.getByText("Detector settings", { exact: true }).click();
  await expect(
    page.locator(".explorer-results .diagnostic-message"),
  ).toContainText("Restored");
  await page
    .locator(".candidate-review-card")
    .first()
    .locator("summary")
    .click();
  await expect(
    page.locator(".candidate-review-card").first().getByRole("textbox", {
      name: "Label",
    }),
  ).toHaveValue("Persistent carrier");
});

test("survey cancellation preserves progress and restores controls", async ({
  page,
}) => {
  await gotoApp(page);
  await selectSyntheticAndStart(page);
  await page.getByRole("tab", { name: /Explorer/ }).click();
  await page.getByText("Site & profile", { exact: true }).click();
  await page.getByText("Edit profile bands", { exact: true }).click();
  await page.getByText("Detector settings", { exact: true }).click();
  await page.getByLabel("Scan scope").selectOption("band-plan");
  await page.getByRole("spinbutton", { name: /Start frequency/ }).fill("98");
  await page.getByRole("spinbutton", { name: /End frequency/ }).fill("102");
  await page
    .locator('.explorer-controls input[type="range"]')
    .nth(0)
    .fill("150");
  await page.getByRole("button", { name: "Save band" }).click();
  await page.getByRole("button", { name: "Run band plan" }).click();
  const progress = page.getByRole("progressbar", {
    name: "Spectrum scan progress",
  });
  await expect
    .poll(async () => Number(await progress.getAttribute("value")))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause scan" }).click();
  await expect(
    page.locator(".explorer-results .diagnostic-message"),
  ).toContainText("Survey paused");
  await expect
    .poll(async () => Number(await progress.getAttribute("value")))
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Run band plan" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "Profile name" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: /Receiver/ }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
});

test("recording preparation retries and the paired archive remains truthfully downloadable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      override postMessage(
        message: unknown,
        transfer: Transferable[] | StructuredSerializeOptions = [],
      ) {
        const testWindow = window as Window & {
          __failNextPreparation?: boolean;
        };
        if (
          (message as { type?: string })?.type === "prepare" &&
          testWindow.__failNextPreparation
        ) {
          testWindow.__failNextPreparation = false;
          queueMicrotask(() =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  ok: false,
                  error: "Injected worker preparation failure",
                },
              }),
            ),
          );
          return;
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
    // Successful retry must hash inside the worker, not on the UI thread.
    Object.defineProperty(SubtleCrypto.prototype, "digest", {
      configurable: true,
      value: () => Promise.reject(new Error("Unexpected main-thread hashing")),
    });
  });
  await gotoApp(page);
  await selectSyntheticAndStart(page);
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await page.getByLabel("Recording export format").selectOption("sigmf");
  await page.getByRole("button", { name: "Start I/Q recording" }).click();
  const recordingControls = page.locator(".recording-state");
  await expect
    .poll(async () => {
      const text = await recordingControls.textContent();
      const match = text?.match(/([0-9.]+) \/ (?:32|2048) MiB/);
      return Number(match?.[1] ?? 0);
    })
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    (
      window as Window & { __failNextPreparation?: boolean }
    ).__failNextPreparation = true;
  });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator(".recording-error")).toContainText(
    "Injected worker preparation failure",
  );
  await expect(
    page.getByRole("button", { name: "Retry preparation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download files to disk" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry preparation" }).click();
  await expect(page.locator(".recording-state")).toContainText(
    "Recording ready",
  );

  const firstDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP" }).click();
  const archiveDownload = await firstDownload;
  const archive = new Uint8Array(await readFile(await archiveDownload.path()));
  const entries = readStoredZip(archive);
  expect(entries).toHaveLength(2);
  expect(entries.map((entry) => entry.name)).toEqual([
    expect.stringMatching(/\.sigmf-data$/),
    expect.stringMatching(/\.sigmf-meta$/),
  ]);
  expect(entries[0]!.name.replace(/\.sigmf-data$/, "")).toBe(
    entries[1]!.name.replace(/\.sigmf-meta$/, ""),
  );
  expect(entries[0]!.data.byteLength).toBeGreaterThan(0);
  const metadata = JSON.parse(new TextDecoder().decode(entries[1]!.data)) as {
    global: Record<string, unknown>;
  };
  expect(metadata.global).toMatchObject({
    "core:datatype": "cu8",
    "core:version": "1.2.6",
  });
  expect(metadata.global["core:sha512"]).toMatch(/^[a-f0-9]{128}$/);
  expect(metadata.global["core:sha512"]).toBe(
    createHash("sha512").update(entries[0]!.data).digest("hex"),
  );
  await expect(page.locator(".recording-message")).toContainText(
    "do not confirm that the file was stored",
  );
  await expect(
    page.locator("#record-panel > .display-note:not(.capture-guidance)"),
  ).toContainText("Download requested");

  const repeatedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP" }).click();
  await repeatedDownload;
  await expect(
    page.getByRole("button", { name: "Download ZIP" }),
  ).toBeEnabled();
});

test("explicit SigIntAtlas save retries a lost part and exposes verified recording and analysis links", async ({
  page,
}) => {
  // Settings login plus three capture/reload rounds exceed the single-capture budget.
  test.setTimeout(45_000);
  const atlas = await installAtlasMock(page, { failFirstPart: true });
  await gotoApp(page);
  await openApplicationView(page, "Settings");
  await page.getByLabel("Settings SigIntAtlas user token").fill("t".repeat(32));
  await page.getByRole("button", { name: "Save token", exact: true }).click();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(
    page.getByText("Connected as Browser test", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Receiver", exact: true }).click();
  await prepareSyntheticSigmf(page);

  await expect(
    page.getByText(
      "Prepared locally. Nothing has been sent for this recording.",
    ),
  ).toBeVisible();
  await page
    .getByLabel("SigIntAtlas recording title")
    .fill("Deterministic browser acceptance");
  await expect(page.getByLabel("SigIntAtlas user token")).toHaveValue(
    "t".repeat(32),
  );
  await page.getByLabel(/Analyze after save when the live capability/).check();
  const save = page.getByRole("button", { name: "Save to SigIntAtlas" });
  await save.dblclick();

  await expect(
    page.getByText("Saved and verified by SigIntAtlas."),
  ).toBeVisible();
  await expect(
    page.getByText("Analysis is queued or running in SigIntAtlas."),
  ).toBeVisible();
  await expect(page.getByText(/completed with limits/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open saved recording" }),
  ).toHaveAttribute("href", /#\/recordings\/30000000-/);
  await expect(
    page.getByRole("link", { name: "Open analysis result" }),
  ).toHaveAttribute("href", /#\/runs\/50000000-/);
  expect(atlas.recordingCreates()).toBe(1);
  expect(atlas.loginRequests()).toBe(1);
  await expect(
    page.getByRole("link", { name: "Confirm reception in SigIntAtlas" }),
  ).toHaveAttribute("href", /reception=1/);

  await expect(
    page.getByRole("button", { name: "Download ZIP" }),
  ).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("link", { name: "Open saved recording" }),
  ).toBeVisible();
  expect(
    await page
      .locator(".atlas-save-panel")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Record next station" }).click();
  await expect(
    page.getByRole("link", { name: "Previous saved recording" }),
  ).toHaveAttribute("href", /#\/recordings\/30000000-/);
  await expect(
    page.getByRole("button", { name: "Start I/Q recording", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await prepareSyntheticSigmf(page);
  await expect(page.getByLabel("SigIntAtlas user token")).toHaveValue(
    "t".repeat(32),
  );
  expect(atlas.recordingCreates()).toBe(1);
  await page.getByRole("button", { name: "Forget token" }).click();
  await expect(page.getByLabel("SigIntAtlas user token")).toHaveValue("");
  await page.reload();
  await prepareSyntheticSigmf(page);
  await expect(page.getByLabel("SigIntAtlas user token")).toHaveValue("");
});

test("SigIntAtlas cancellation rejects late work, auth expiry retries, and receiver stays usable", async ({
  page,
}) => {
  let releaseCapabilities!: () => void;
  const capabilityGate = new Promise<void>((resolve) => {
    releaseCapabilities = resolve;
  });
  const atlas = await installAtlasMock(page, {
    gateFirstCapabilities: capabilityGate,
    expireFirstSession: true,
  });
  await gotoApp(page);
  await prepareSyntheticSigmf(page);
  await page.getByLabel("SigIntAtlas user token").fill("t".repeat(32));
  await page.getByRole("button", { name: "Save to SigIntAtlas" }).click();
  await expect(page.getByText(/Checking the same-origin/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel transfer" }).click();
  releaseCapabilities();
  await expect(page.getByText(/Transfer cancelled/)).toBeVisible();
  await page.waitForTimeout(100);
  await expect(
    page.getByRole("link", { name: "Open saved recording" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByText(/session_expired/)).toBeVisible();
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(
    page.getByText("Saved and verified by SigIntAtlas."),
  ).toBeVisible();
  expect(atlas.recordingCreates()).toBe(1);

  await page.getByRole("tab", { name: "Audio & decode" }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
});

test("SigIntAtlas offline failure leaves local download fallback available", async ({
  page,
}) => {
  await installAtlasMock(page, { offline: true });
  await gotoApp(page);
  await prepareSyntheticSigmf(page);
  await page.getByLabel("SigIntAtlas user token").fill("t".repeat(32));
  await page.getByRole("button", { name: "Save to SigIntAtlas" }).click();
  await expect(page.getByText(/Transfer failed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry save" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Download ZIP" }),
  ).toBeEnabled();
  await page.getByText("More options", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download separate files" }),
  ).toBeEnabled();
});

test("pending permission is cancelled on unmount and late ownership is released", async ({
  page,
}) => {
  await installRtlAdapter(page, "pending-connect");
  await gotoApp(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Choose an RTL-SDR device",
  );
  await page.evaluate(() =>
    (
      window as Window & { __BROWSERSDR_TEST_RUNTIME__?: { unmount(): void } }
    ).__BROWSERSDR_TEST_RUNTIME__?.unmount(),
  );
  await expect(page.locator("#root")).toBeEmpty();
  await page.evaluate(() =>
    (
      window as Window & { __rtlTestState?: { resolveConnect?: () => void } }
    ).__rtlTestState?.resolveConnect?.(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __rtlTestState?: { closeAttempts: number } })
            .__rtlTestState?.closeAttempts,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __rtlTestState?: { audioCloseAttempts: number };
            }
          ).__rtlTestState?.audioCloseAttempts,
      ),
    )
    .toBe(1);
});

test("failed device close retains the single owner until retry succeeds", async ({
  page,
}) => {
  await installRtlAdapter(page, "close-fails-once");
  await gotoApp(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "RTL-SDR connected",
  );
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("button", { name: "Recovery help", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Injected USB close failure",
  );
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __rtlTestState?: { providerGets: number } })
            .__rtlTestState?.providerGets,
      ),
    )
    .toBe(1);

  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiver disconnected",
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "RTL-SDR connected",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __rtlTestState?: { providerGets: number } })
            .__rtlTestState?.providerGets,
      ),
    )
    .toBe(2);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Receiver disconnected",
  );
});

test("WebGPU absence is an actionable fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, "gpu");
  });
  await gotoApp(page);
  await expect(
    page.getByLabel("Canvas2D RF spectrum and waterfall plot; click to tune", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".graphics-panel .status-pill")).toHaveText(
    "ready",
  );
  await openApplicationView(page, "Diagnostics");
  await expect(
    page
      .getByText("WebGPU API", { exact: true })
      .locator("xpath=following-sibling::small"),
  ).toContainText("Canvas2D compatibility display will be used");
});

test("diagnostic reports default on and remain reviewable and downloadable", async ({
  page,
}) => {
  await gotoApp(page);
  await openApplicationView(page, "Diagnostics");
  await expect(
    page.getByRole("heading", { name: "Help improve BrowserSDR" }),
  ).toBeVisible();
  await expect(
    page.getByLabel(/Automatically send errors and recent diagnostic logs/),
  ).toBeChecked();
  await page.getByRole("button", { name: "Create diagnostic report" }).click();
  const dialog = page.getByRole("dialog", { name: /Diagnostic report/ });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.activeElement?.closest("dialog") !== null,
    ),
  ).toBe(true);
  // Native modal focus cannot reach the background even after wrapping at Cancel.
  await dialog.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => document.activeElement?.closest("dialog") !== null,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create diagnostic report" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Create diagnostic report" }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Send report" }),
  ).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = JSON.parse(await readFile(path!, "utf8")) as Record<
    string,
    unknown
  >;
  expect(report.schemaVersion).toBe(1);
  expect(report.reportId).toMatch(/^BR-/);
  expect(report.events).toEqual(expect.any(Array));
  expect(report.receiver).not.toHaveProperty("exactFrequencyHz");
  expect(report.redaction).toMatchObject({ exactFrequencyIncluded: false });
  expect((report.redaction as { omitted: string[] }).omitted).toContain(
    "ipAddress",
  );
});

test("About exposes licence, driver provenance, and privacy boundaries", async ({
  page,
}) => {
  await gotoApp(page);
  await openApplicationView(page, "About");
  await expect(
    page.getByRole("heading", { name: "Licences, privacy & provenance" }),
  ).toBeVisible();
  await expect(
    page
      .locator("#about-view")
      .getByText(/Automatic error reporting is on by default/),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /AD9364 receive driver/ }),
  ).toContainText("BSD-3-Clause");
  const applicationTerms = page.getByRole("region", {
    name: "BrowserSDR licence",
  });
  await expect(applicationTerms).toContainText(
    "PolyForm Perimeter License 1.0.1",
  );
  await applicationTerms
    .getByText("Read full application licence", { exact: true })
    .click();
  const licence = await readFile(
    new URL("../LICENSE", import.meta.url),
    "utf8",
  );
  await expect(applicationTerms.locator("pre").first()).toHaveText(licence);
  // Verify delivered terms as well as the visible notice on dev and production.
  for (const [asset, original] of [
    ["LICENSE.txt", "LICENSE"],
    ["NOTICE.txt", "NOTICE"],
    ["THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.md"],
  ] as const) {
    const response = await page.request.get(new URL(asset, page.url()).href);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/plain");
    expect(await response.text()).toBe(
      await readFile(new URL(`../${original}`, import.meta.url), "utf8"),
    );
  }
});

test("automatic diagnostics send by default, deduplicate errors, and respect a saved opt-out", async ({
  page,
}) => {
  const submissions: Array<{
    trigger: string;
    autoSubmitted: boolean;
    receiver: Record<string, unknown>;
  }> = [];
  await page.route("**/api/v1/diagnostic-reports", async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({ json: { reference: "BR-TEST-AUTOMATIC" } });
  });
  await gotoApp(page);
  await openApplicationView(page, "Diagnostics");
  const toggle = page.getByLabel(
    /Automatically send errors and recent diagnostic logs/,
  );
  await expect(toggle).toBeChecked();
  const emit = (message: string) =>
    page.evaluate((value) => {
      window.dispatchEvent(new ErrorEvent("error", { message: value }));
    }, message);
  await emit("Automatic diagnostic default regression");
  await expect(page.locator(".diagnostic-report-status")).toContainText(
    "BR-TEST-AUTOMATIC",
  );
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    trigger: "automatic",
    autoSubmitted: true,
  });
  expect(submissions[0]?.receiver).not.toHaveProperty("exactFrequencyHz");
  await emit("Automatic diagnostic default regression");
  expect(submissions).toHaveLength(1);
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await openApplicationView(page, "Diagnostics");
  await expect(toggle).not.toBeChecked();
  await emit("Opt-out diagnostic regression");
  await expect(
    page.getByText(/Last detected issue: uncaught exception/),
  ).toBeVisible();
  expect(submissions).toHaveLength(1);
});

test("compatibility reports capture reviewed service evidence and receiver state", async ({
  page,
}) => {
  await gotoApp(page);
  await openApplicationView(page, "Help");
  await page.getByRole("button", { name: "Share test result" }).click();
  const dialog = page.getByRole("dialog", { name: /Compatibility report/ });
  await expect(
    dialog.getByRole("button", { name: "Send report" }),
  ).toBeDisabled();
  await dialog.getByLabel("Device connection result").selectOption("working");
  await dialog
    .getByLabel("Spectrum & waterfall result")
    .selectOption("degraded");
  await expect(
    dialog.getByRole("button", { name: "Send report" }),
  ).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = JSON.parse(await readFile(path!, "utf8")) as Record<
    string,
    unknown
  >;
  expect(report.reportType).toBe("compatibility");
  expect(report.reportId).toMatch(/^BC-/);
  expect(report.observations).toEqual([
    { service: "connection", result: "working" },
    { service: "spectrum", result: "degraded" },
  ]);
  expect(report.receiver).not.toHaveProperty("exactFrequencyHz");
  expect(report.redaction).toMatchObject({ exactFrequencyIncluded: false });
});

test("current-channel capture downloads reduced I/Q and replays the exported pair", async ({
  page,
}) => {
  await gotoApp(page);
  await selectSyntheticAndStart(page);
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  const toggle = page.getByLabel("Capture current channel only");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator("#record-panel")).toContainText("Auto: 0.256 MS/s");
  await expect(page.locator("#record-panel")).toContainText("30.72 MB/min");
  await page.getByRole("button", { name: "Start I/Q recording" }).click();
  await expect(toggle).toBeDisabled();
  await expect
    .poll(async () =>
      Number(
        (await page.locator(".recording-state").textContent())?.match(
          /([0-9.]+) s/,
        )?.[1] ?? 0,
      ),
    )
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator(".recording-state")).toContainText(
    "Recording ready",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP" }).click();
  const download = await downloading;
  const entries = readStoredZip(
    new Uint8Array(await readFile(await download.path())),
  );
  const data = entries.find((entry) => entry.name.endsWith(".ci8"))!;
  const sidecar = entries.find((entry) => entry.name.endsWith(".json"))!;
  const metadata = JSON.parse(new TextDecoder().decode(sidecar.data));
  expect(metadata).toMatchObject({
    format: "browsersdr-channel-iq-v1",
    sampleRateHz: 256_000,
    source: "synthetic",
    channelCapture: { inputSampleRateHz: 1_024_000, decimation: 4 },
  });
  expect(data.data.length).toBe(metadata.sampleCount * 2);
  expect(metadata.durationSeconds).toBeGreaterThan(0.2);
  await page
    .locator('select[aria-label="Signal source"]')
    .selectOption("replay");
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await page
    .locator(".file-picker-input")
    .nth(0)
    .setInputFiles({
      name: data.name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(data.data),
    });
  await page
    .locator(".file-picker-input")
    .nth(1)
    .setInputFiles({
      name: sidecar.name,
      mimeType: "application/json",
      buffer: Buffer.from(sidecar.data),
    });
  await page.getByRole("button", { name: "Load files" }).click();
  await expect(page.locator(".file-message")).toContainText("Loaded");
  await page.getByRole("button", { name: "Start replay" }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Replaying WBFM capture",
  );
});

test("unwritable browser recording storage falls back to bounded memory and exports worker channel data", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, "getDirectory", {
      configurable: true,
      value: async () => {
        throw new DOMException("Storage quota exhausted", "QuotaExceededError");
      },
    });
  });
  await gotoApp(page);
  await selectSyntheticAndStart(page);
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page.getByLabel("Capture current channel only").check();
  await page
    .getByRole("button", { name: "Start I/Q recording", exact: true })
    .click();
  await expect(page.locator(".recording-state")).toContainText("/ 32 MiB");
  await expect
    .poll(async () => {
      const text = await page.locator(".recording-state").textContent();
      return Number(text?.match(/([0-9.]+) \/ 32 MiB/)?.[1] ?? 0);
    })
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download ZIP", exact: true }),
  ).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect((await readFile(path!)).byteLength).toBeGreaterThan(1024);
  await expect(
    page.getByText(/The recording remains in browser storage/),
  ).toHaveCount(0);
});

test("timed capture stops and keeps synthetic provenance explicit before save", async ({
  page,
}) => {
  await gotoApp(page);
  await selectSyntheticAndStart(page);
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await page.getByLabel("Recording export format").selectOption("sigmf");
  await page.getByLabel("Timed capture seconds").fill("1");
  await page.getByRole("button", { name: "Start I/Q recording" }).click();
  await expect(
    page.getByRole("heading", { name: "Save to SigIntAtlas" }),
  ).toBeVisible();
  await expect(page.getByLabel("SigIntAtlas capture origin")).toHaveValue(
    "synthetic",
  );
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toHaveCount(0);
});

test("Atlas requested WBFM bandwidth uses the applied profile and recording preferences survive reload", async ({
  page,
}) => {
  await page.goto(
    "/?browser-test=1&station_id=10000000-0000-4000-8000-000000000001&station_name=Retest&frequency_hz=100000000&bandwidth_hz=200000&mode=WBFM",
  );
  await expect(page.locator(".receiver-status-menu > summary")).toBeVisible();
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await expect(
    page.getByText(
      /Requested bandwidth 200,000 Hz; applied WBFM profile 150,000 Hz/,
    ),
  ).toBeVisible();
  await page.getByLabel("Recording export format").selectOption("sigmf");
  await page.getByLabel("Timed capture seconds").fill("1");
  await page.reload();
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await expect(page.getByLabel("Recording export format")).toHaveValue("sigmf");
  await expect(page.getByLabel("Timed capture seconds")).toHaveValue("1");
  await selectSyntheticAndStart(page);
  await page.getByRole("button", { name: "Start I/Q recording" }).click();
  await expect(
    page.getByRole("heading", { name: "Save to SigIntAtlas" }),
  ).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const download = await downloading;
  const entries = readStoredZip(
    new Uint8Array(await readFile((await download.path())!)),
  );
  const metadata = JSON.parse(
    new TextDecoder().decode(
      entries.find((entry) => entry.name.endsWith(".sigmf-meta"))!.data,
    ),
  );
  expect(metadata.global["browsersdr:reception"].candidate.bandwidth_hz).toBe(
    150000,
  );
  const annotation = metadata.annotations[0];
  expect(
    annotation["core:freq_upper_edge"] - annotation["core:freq_lower_edge"],
  ).toBe(150000);
  expect(
    (annotation["core:freq_upper_edge"] + annotation["core:freq_lower_edge"]) /
      2,
  ).toBe(100000000);
});

test("SigIntAtlas closed transfers recover after reload without a prepared capture", async ({
  page,
}) => {
  const options: AtlasMockOptions = { deferVerification: true };
  const atlas = await installAtlasMock(page, options);
  await gotoApp(page);
  await prepareSyntheticSigmf(page);
  await page.getByLabel("SigIntAtlas user token").fill("t".repeat(32));
  await page
    .getByRole("button", { name: "Save to SigIntAtlas", exact: true })
    .click();
  await expect(page.getByText(/Verification queued/)).toBeVisible();
  const parts = atlas.uploads.size;
  expect(parts).toBe(2);
  await page.reload();
  options.deferVerification = false;
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await expect(
    page.getByText("Recover SigIntAtlas transfers", { exact: true }),
  ).toBeVisible();
  // Recovery shares the token persisted by the original Save action.
  await page.getByRole("button", { name: /Continue verification for/ }).click();
  await expect(
    page.getByText("Recording saved and verified.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open recovered recording" }),
  ).toHaveAttribute("href", /recordings/);
  expect(atlas.uploads.size).toBe(parts);
  expect(atlas.recordingCreates()).toBe(1);
});

test("favorite recall preserves USB ownership and blocks active or retained recordings", async ({
  page,
}) => {
  await installRtlAdapter(page, "normal");
  await page.addInitScript(() =>
    localStorage.setItem(
      "browsersdr.bookmarks.v1",
      JSON.stringify({
        schema: "browsersdr-bookmarks-v1",
        bookmarks: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "CW fixture",
            frequencyHz: 101e6,
            settings: {
              mode: "CW",
              bandwidthHz: 500,
              squelch: 0,
              beatToneHz: 750,
            },
            tags: [],
            notes: "Synthetic test favorite",
          },
        ],
      }),
    ),
  );
  await gotoApp(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop receiving", exact: true }),
  ).toBeEnabled();
  const favorites = page.getByRole("dialog", {
    name: "Favorites",
    exact: true,
  });
  const previousFrequency = await page
    .getByLabel("Channel frequency", { exact: true })
    .inputValue();
  await page
    .getByRole("switch", { name: "Follow channel", exact: true })
    .uncheck();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await favorites.getByRole("button", { name: "Recall CW fixture" }).click();
  await expect(favorites).toContainText("Enable Follow channel");
  await expect(page.getByRole("combobox", { name: /^Mode/ })).toHaveValue(
    "WBFM",
  );
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue(previousFrequency);
  await favorites.getByRole("button", { name: "Close Favorites" }).click();
  await page.getByRole("tab", { name: "Session", exact: true }).click();
  await expect(
    page.locator("#session-panel").getByText("WBFM", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("switch", { name: "Follow channel", exact: true })
    .check();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await favorites.getByRole("button", { name: "Recall CW fixture" }).click();
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue("101.000");
  await expect(favorites).toBeHidden();
  await expect(page.getByRole("combobox", { name: /^Mode/ })).toHaveValue("CW");
  await expect(
    page.getByRole("slider", { name: "CW beat tone", exact: true }),
  ).toHaveValue("750");
  await page.getByText("Device details & settings", { exact: true }).click();
  const rate = page.getByLabel("Sample rate", { exact: true });
  await rate.selectOption("2400000");
  await expect(rate).toBeEnabled();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await favorites.getByRole("button", { name: "Recall CW fixture" }).click();
  await expect(favorites).toBeHidden();
  await expect(rate).toHaveValue("2400000");
  await rate.selectOption("1024000");
  await expect(rate).toBeEnabled();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await favorites.getByRole("button", { name: "Recall CW fixture" }).click();
  await expect(favorites).toBeHidden();
  await expect(rate).toHaveValue("1024000");
  await expect(
    page.getByRole("slider", { name: "CW beat tone", exact: true }),
  ).toHaveValue("750");
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __rtlTestState?: { providerGets: number } })
          .__rtlTestState?.providerGets,
    ),
  ).toBe(1);
  await page
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
  // Use actual demo samples for recording lifecycle coverage; the USB stub supplies no RF data.
  await page
    .locator('select[aria-label="Signal source"]')
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page.getByRole("button", { name: "Start I/Q recording" }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await expect(
    favorites.getByRole("button", { name: "Recall CW fixture" }),
  ).toBeDisabled();
  await favorites.getByRole("button", { name: "Close Favorites" }).click();
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Discard prepared capture", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await expect(
    favorites.getByRole("button", { name: "Recall CW fixture" }),
  ).toBeDisabled();
  await favorites.getByRole("button", { name: "Close Favorites" }).click();
  await page
    .getByRole("button", { name: "Discard prepared capture", exact: true })
    .click();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await expect(
    favorites.getByRole("button", { name: "Recall CW fixture" }),
  ).toBeEnabled();
  await favorites.getByRole("button", { name: "Close Favorites" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __rtlTestState?: { providerGets: number } })
          .__rtlTestState?.providerGets,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});
