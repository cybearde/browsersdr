import {
  openDeviceSettings,
  closeDeviceSettings,
} from "./device-settings-navigation";
import { openApplicationView } from "./application-navigation";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installHackrfUsb } from "./hackrf-usb-fixture";
import { unzipSync } from "fflate";

async function openPro(page: Page) {
  await page.goto("/?browser-test=1");
  await page
    .locator('select[aria-label="Signal source"]')
    .selectOption("hackrf");
  await page
    .getByRole("combobox", { name: "Mode", exact: true })
    .selectOption("AM");
  await openDeviceSettings(page);

  await page
    .getByRole("combobox", { name: "Sample rate" })
    .selectOption("1024000");
  await closeDeviceSettings(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

test("HackRF real pipeline with mocked USB supports controls, CI8 capture, survey and source replacement", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installHackrfUsb(page);
  await openPro(page);
  await expect(page.locator(".receiver-status")).toContainText("connected");
  await openDeviceSettings(page);
  await expect(page.getByLabel("RX LNA state")).toHaveValue("16");
  await expect(
    page.getByRole("checkbox", { name: "RF amplifier", exact: true }),
  ).not.toBeChecked();
  await closeDeviceSettings(page);
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(page.locator(".receiver-session-details")).toContainText(
    "native 1,024,000 samples/s CI8",
  );
  await page
    .getByLabel("Channel frequency", { exact: false })
    .fill("4300.000001");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(page.locator(".receiver-session-details")).toContainText(
    "precise channel 4300.000001 MHz",
  );
  await openDeviceSettings(page);
  await page.getByLabel("RX LNA state").selectOption("33");
  await page.getByLabel("RX VGA gain (dB)").fill("62");
  await page
    .getByRole("checkbox", { name: "RF amplifier", exact: true })
    .check();
  await expect(page.locator(".receiver-session-details")).toContainText(
    "accepted LNA code 33, VGA 62 dB, RF amplifier on",
  );
  await closeDeviceSettings(page);
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await page.getByRole("button", { name: "Start I/Q recording" }).click();
  await expect(page.locator(".recording-state")).toContainText(
    /(?:0\.[1-9]\d|[1-9]\d*\.\d{2}) \/ (?:32|2048) MiB/,
  );
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(
    page.getByRole("button", { name: "Download ZIP" }),
  ).toBeEnabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP" }).click();
  const capture = await download;
  expect(capture.suggestedFilename()).toMatch(/\.zip$/);
  const files = unzipSync(await readFile((await capture.path())!));
  expect(Object.keys(files).some((name) => name.endsWith(".ci8"))).toBe(true);
  const sidecar = JSON.parse(
    new TextDecoder().decode(
      Object.entries(files).find(([name]) => name.endsWith(".json"))![1],
    ),
  );
  expect(sidecar.format).toBe("browsersdr-ci8-v2");
  await page.getByRole("button", { name: "Discard prepared capture" }).click();

  await page.getByRole("tab", { name: /Explorer/ }).click();
  await page.getByText("Edit profile bands", { exact: true }).click();
  await page.getByLabel("Start frequency").fill("4300");
  await page.getByLabel("End frequency").fill("4300.5");
  await page
    .getByRole("button", { name: "Scan current window", exact: true })
    .click();
  await expect(page.getByText(/Survey complete:/)).toBeVisible({
    timeout: 15_000,
  });
  await page
    .locator('.candidate-select input[type="checkbox"]')
    .first()
    .check();
  await page.getByRole("button", { name: /Capture selected \(/ }).click();
  // Explorer owns this capture. The hidden Receiver presentation is frozen;
  // observe the shared live status and actual delivered/retained samples.
  await expect(page.locator(".receiver-status-menu > summary")).toHaveAttribute(
    "aria-label",
    /^Receiver status: Recording/,
  );
  await page.evaluate(async () => {
    const device = (
      window as unknown as {
        __hackrf: {
          device: {
            pendingReads: { result: { promise: Promise<unknown> } }[];
          };
        };
      }
    ).__hackrf.device;
    let timer: number | undefined;
    try {
      await Promise.race([
        (async () => {
          for (let block = 0; block < 4; block++) {
            const read = device.pendingReads[0];
            if (!read)
              throw new Error("Active capture has no pending USB read");
            await read.result.promise;
          }
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = window.setTimeout(
            () =>
              reject(new Error("Capture made no USB progress within 7000 ms")),
            7000,
          );
        }),
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  });
  const partialDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Cancel capture", exact: true })
    .click();
  await expect(
    page.locator(".explorer-results .diagnostic-message"),
  ).toContainText("Candidate capture cancelled");
  const partial = unzipSync(
    await readFile((await (await partialDownload).path())!),
  );
  const sigmf = JSON.parse(
    new TextDecoder().decode(
      Object.entries(partial).find(([name]) =>
        name.endsWith(".sigmf-meta"),
      )![1],
    ),
  );
  expect(sigmf.global["core:datatype"]).toBe("ci8");
  const partialSamples = Object.entries(partial).find(([name]) =>
    name.endsWith(".sigmf-data"),
  )![1];
  expect(partialSamples.byteLength).toBeGreaterThanOrEqual(0.1 * 1024 * 1024);
  expect(partialSamples.byteLength).toBeLessThanOrEqual(2048 * 1024 * 1024);
  await page.getByRole("tab", { name: /Receiver/ }).click();
  await expect(page.locator(".receiver-session-details")).toContainText(
    "precise channel 4300.000001 MHz",
  );
  await page
    .locator('select[aria-label="Signal source"]')
    .selectOption("synthetic");
  await expect(page.getByRole("button", { name: "Start demo" })).toBeEnabled();
  const state = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __hackrf: {
          chooserCalls: number;
          gesture: boolean;
          device: { opened: boolean; pendingReads: unknown[] };
        };
      }
    ).__hackrf;
    return {
      chooserCalls: state.chooserCalls,
      gesture: state.gesture,
      opened: state.device.opened,
      reads: state.device.pendingReads.length,
    };
  });
  expect(state).toEqual({
    chooserCalls: 1,
    gesture: true,
    opened: false,
    reads: 0,
  });
  expect(errors).toEqual([]);
});

test("HackRF unsupported firmware fails with compatibility details before reception", async ({
  page,
}) => {
  await installHackrfUsb(page, true);
  await openPro(page);
  await page
    .getByRole("button", { name: "Recovery help", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/API|profile/);
  await expect(
    page.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Retry connection", exact: true }),
  ).toBeEnabled();
});

for (const rate of [4_800_000, 9_600_000, 19_200_000]) {
  test(`HackRF wideband keeps ${rate} samples/s and a 2.4 MS/s channel across offset tuning and restart`, async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await installHackrfUsb(page);
    await page.goto("/?browser-test=1");
    await page
      .getByRole("combobox", { name: "Signal source", exact: true })
      .selectOption("hackrf");
    await page
      .getByRole("combobox", { name: "Mode", exact: true })
      .selectOption("AM");
    await openDeviceSettings(page);

    await page
      .getByLabel("Sample rate", { exact: false })
      .selectOption(String(rate));
    await closeDeviceSettings(page);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.locator(".receiver-status")).toContainText("connected");
    await page
      .getByRole("button", { name: "Start receiving", exact: true })
      .click();
    await expect(page.locator(".receiver-status")).toContainText(
      "Receiving AM",
    );
    await expect(page.locator(".receiver-session-details")).toContainText(
      "channel DSP rate 2,400,000",
    );
    await expect(page.locator(".receiver-session-details")).toContainText(
      `native ${rate.toLocaleString("en-US")}`,
    );
    await expect(
      page.getByRole("meter", { name: "Current channel quality" }),
    ).not.toHaveAttribute("aria-valuenow", "0");
    await openApplicationView(page, "Diagnostics");
    await page.getByText("Raw counters & performance", { exact: true }).click();
    await expect(page.getByText("USB callback", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Spectrum copy", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Channel copy", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Main-thread normalization", { exact: true }),
    ).toHaveCount(0);
    // AM and its live squelch meter have remained active through startup and
    // diagnostics rendering. Meter telemetry must not starve analysis credits.
    await expect(
      page
        .getByText("Input blocks skipped", { exact: true })
        .locator("..")
        .locator("dd"),
    ).toContainText("0 · 0 samples");
    await page.getByRole("tab", { name: "Receiver", exact: true }).click();
    await page.getByLabel("Channel frequency", { exact: false }).fill("101.7");
    await page.getByRole("button", { name: "Tune", exact: true }).click();
    await expect(page.locator(".receiver-session-details")).toContainText(
      "Precise center 100.000000 MHz · precise channel 101.700000 MHz",
    );
    await closeDeviceSettings(page);
    await page.getByRole("tab", { name: "Capture & replay" }).click();
    await page
      .getByRole("button", { name: "Start I/Q recording", exact: true })
      .click();
    await expect(page.locator(".recording-state")).toContainText(
      /(?:0\.[1-9]\d|[1-9]\d*\.\d{2}) \/ (?:32|2048) MiB/,
    );
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download ZIP", exact: true })
      .click();
    const entries = unzipSync(await readFile((await (await download).path())!));
    const metadata = JSON.parse(
      new TextDecoder().decode(
        Object.entries(entries).find(([name]) => name.endsWith(".json"))![1],
      ),
    );
    expect(metadata).toMatchObject({
      sampleRateHz: rate,
      effectiveSampleRateHz: 2_400_000,
      selectedChannelFrequencyHz: 101_700_000,
      hostResampling: {
        kind:
          rate === 4_800_000
            ? "channel-fir-decimate-2-v1"
            : rate === 9_600_000
              ? "channel-fir-decimate-4-v1"
              : "channel-fir-decimate-8-v1",
        denominator: rate / 2_400_000,
      },
    });
    await page
      .getByRole("button", { name: "Stop receiving", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start receiving", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Start receiving", exact: true })
      .click();
    await expect(page.locator(".receiver-status")).toContainText(
      "Receiving AM",
    );
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.locator(".receiver-status")).toContainText(
      "disconnected",
    );
  });
}

test("HackRF gains and rate changes apply during reception without USB reopen", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installHackrfUsb(page);
  await openPro(page);
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(page.locator(".receiver-status")).toContainText(/receiving/i);
  await expect(page.locator(".remote-entry-hint")).toHaveCount(0);
  await expect(
    page
      .getByLabel("Sample rate", { exact: true })
      .locator('option[value="19200000"]'),
  ).toHaveText("19.200 MS/s");
  await expect(
    page
      .getByRole("combobox", { name: "Signal source" })
      .locator('option[value="remote"]'),
  ).toHaveAttribute("disabled", "");
  const ownership = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __hackrf: {
          device: {
            lifecycle: string[];
            calls: { setup: { request: number } }[];
          };
        };
      }
    ).__hackrf.device;
    return { lifecycle: [...d.lifecycle], calls: d.calls.length };
  });
  await openDeviceSettings(page);
  await page.getByLabel("RX LNA state").selectOption("33");
  await expect(page.locator(".receiver-session-details")).toContainText(
    "accepted LNA code 33",
  );
  await page.getByLabel("RX VGA gain (dB)").fill("32");
  await expect(page.locator(".receiver-session-details")).toContainText(
    "VGA 32 dB",
  );
  await page
    .getByRole("checkbox", { name: "RF amplifier", exact: true })
    .check();
  await expect(page.locator(".receiver-session-details")).toContainText(
    "RF amplifier on",
  );
  await expect(
    page.getByRole("button", { name: "Apply RX settings" }),
  ).toHaveCount(0);
  await closeDeviceSettings(page);
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await page.getByRole("button", { name: "Start I/Q recording" }).click();
  await expect(page.locator(".recording-state")).toContainText(
    /(?:0\.[1-9]\d|[1-9]\d*\.\d{2}) \/ (?:32|2048) MiB/,
  );
  await openDeviceSettings(page);
  for (const rate of [2_400_000, 4_800_000, 9_600_000, 19_200_000, 1_024_000]) {
    await page
      .getByRole("combobox", { name: "Sample rate" })
      .selectOption(String(rate));
    await expect(page.locator(".receiver-session-details")).toContainText(
      `native ${rate.toLocaleString("en-US")} samples/s CI8`,
    );
    await expect(page.locator(".receiver-status")).toContainText(/receiving/i);
    await expect(page.locator(".receiver-session-details")).toContainText(
      "accepted LNA code 33, VGA 32 dB, RF amplifier on",
    );
  }
  await closeDeviceSettings(page);
  const after = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __hackrf: {
          device: {
            lifecycle: string[];
            calls: { setup: { request: number } }[];
          };
        };
      }
    ).__hackrf.device;
    return {
      lifecycle: [...d.lifecycle],
      requests: d.calls.map((c) => c.setup.request),
    };
  });
  expect(after.lifecycle).toEqual(ownership.lifecycle);
  expect(
    after.requests
      .slice(ownership.calls)
      .some((request) => [1, 54].includes(request)),
  ).toBe(false);
  await expect(
    page.getByRole("button", { name: "Download ZIP" }),
  ).toBeEnabled();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP" }).click();
  const path = await (await downloadEvent).path();
  const files = unzipSync(new Uint8Array(await readFile(path!)));
  const metadata = JSON.parse(
    new TextDecoder().decode(
      Object.entries(files).find(([name]) => name.endsWith(".json"))![1],
    ),
  );
  expect(metadata).toMatchObject({
    sampleRateHz: 1_024_000,
    stopReason: "metadata-change",
    captureSettings: {
      rxLnaGainCode: 33,
      rxVgaGainDb: 32,
      rfAmplifierEnabled: true,
    },
  });
  await page
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(page.locator(".receiver-status")).toContainText(/receiving/i);
});
