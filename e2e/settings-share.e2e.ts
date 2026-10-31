import {
  openDisplaySettings,
  closeDisplaySettings,
} from "./display-settings-navigation";
import { expect, test } from "@playwright/test";
// Independent wire fixtures keep browser checks separate from the runtime validator.
const SETTINGS_SHARE_SCHEMA = "browsersdr-settings-v1";
const srdfixture = {
  channelBandwidthHz: 32000,
  modulation: "ook",
  protocol: "none",
  threshold: {
    mode: "manual",
    carrierLevel: 0.35,
    minimumCarrierMargin: 0.025,
    carrierNoiseRatio: 3,
    carrierHysteresis: 0.01,
    discriminatorHz: 0,
    discriminatorHysteresisHz: 500,
  },
  burst: { minimumDurationUs: 500, maximumDurationUs: 250000, endGapUs: 4000 },
  trace: {
    decimation: 8,
    maximumPoints: 512,
    publicationIntervalInputSamples: 102400,
  },
  bitSlice: {
    enabled: false,
    symbolUs: 500,
    encoding: "nrz",
    polarity: "inverted",
  },
};
const widths: Record<string, number> = {
  OFF: 1,
  WBFM: 150000,
  NBFM: 12500,
  AM: 10000,
  USB: 3000,
  LSB: 3000,
  CW: 500,
  DAB: 1536000,
  "ADS-B": 2000000,
  AIS: 100000,
  SRD: 32000,
};
const RECEIVER_MODES = Object.keys(widths);
function defaultModeSettings(mode: string): {
  mode: string;
  bandwidthHz: number;
  squelch: number;
  beatToneHz?: number;
  srd?: typeof srdfixture;
} {
  return {
    mode,
    bandwidthHz: widths[mode]!,
    squelch: 0,
    ...(mode === "CW" ? { beatToneHz: 875 } : {}),
    ...(mode === "SRD" ? { srd: structuredClone(srdfixture) } : {}),
  };
}
interface SharedSettings {
  schema: string;
  frequencyHz: number;
  settings: ReturnType<typeof defaultModeSettings>;
  display: { compact: boolean; floorDb: number; rangeDb: number };
}
const preset = (frequencyHz = 100_000_001): SharedSettings => ({
  schema: SETTINGS_SHARE_SCHEMA,
  frequencyHz,
  settings: { ...defaultModeSettings("CW"), beatToneHz: 875 },
  display: { compact: true, floorDb: -99, rangeDb: 73 },
});
const fragment = (value: unknown) =>
  `#settings=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;

test("settings share generates a clean link and restores CW/display with no hardware and manual Start", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: /^Mode/ }).selectOption("CW");
  await openDisplaySettings(page);
  await page.getByRole("slider", { name: "Spectrum floor" }).press("Home");
  await page
    .getByRole("slider", { name: "Spectrum floor" })
    .press("ArrowRight");
  await closeDisplaySettings(page);
  await page.getByRole("tab", { name: "Session", exact: true }).click();
  await page
    .getByRole("button", { name: "Share settings", exact: true })
    .click();
  const outgoing = page.getByRole("dialog", {
    name: "Share settings",
    exact: true,
  });
  await expect(outgoing).toBeVisible();
  const link = await outgoing
    .getByRole("textbox", { name: "Settings link" })
    .inputValue();
  const decoded = JSON.parse(
    Buffer.from(
      new URL(link).hash.slice("#settings=".length),
      "base64url",
    ).toString(),
  ) as SharedSettings;
  expect(decoded.settings.mode).toBe("CW");
  expect(decoded.display).toEqual({
    compact: true,
    floorDb: -119,
    rangeDb: 90,
  });
  expect(new URL(link).search).toBe("");
  // Clipboard rejection is recoverable without an extra permission request.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    }),
  );
  await outgoing
    .getByRole("button", { name: "Copy link", exact: true })
    .click();
  await expect(
    outgoing.getByText("Select and copy the link below."),
  ).toBeVisible();
  await expect(
    outgoing.getByRole("textbox", { name: "Settings link" }),
  ).toBeFocused();

  const recipient = await context.newPage();
  await recipient.addInitScript(() => {
    localStorage.setItem("browsersdr.selectedSource", "rtl-sdr");
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: {
        getDevices: async () => {
          (window as unknown as { usbReads: number }).usbReads =
            ((window as unknown as { usbReads: number }).usbReads ?? 0) + 1;
          return location.hash.startsWith("#settings=")
            ? [
                {
                  vendorId: 0x0bda,
                  productId: 0x2838,
                  opened: false,
                  open: async () => {
                    (window as unknown as { usbOpens: number }).usbOpens =
                      ((window as unknown as { usbOpens: number }).usbOpens ??
                        0) + 1;
                    throw new Error("Unexpected device open");
                  },
                },
              ]
            : [];
        },
      },
    });
  });
  await recipient.goto(link);
  const received = recipient.getByRole("dialog", {
    name: "Shared settings",
    exact: true,
  });
  await expect(received).toBeVisible();
  expect(
    await recipient.evaluate(
      () => (window as unknown as { usbOpens?: number }).usbOpens ?? 0,
    ),
  ).toBe(0);
  await received.getByRole("button", { name: "Apply shared settings" }).click();
  await expect(received).toBeHidden();
  await expect(
    recipient.getByRole("combobox", { name: "Signal source", exact: true }),
  ).toHaveValue("rtl-sdr");
  await expect(recipient.getByRole("combobox", { name: /^Mode/ })).toHaveValue(
    "CW",
  );
  await expect(
    recipient.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeDisabled();
  expect(new URL(recipient.url()).hash).toBe("");
  expect(
    await recipient.evaluate(
      () => (window as unknown as { usbOpens?: number }).usbOpens ?? 0,
    ),
  ).toBe(0);
  await recipient.reload();
  await expect(received).toBeHidden();
  await expect(recipient.getByRole("combobox", { name: /^Mode/ })).toHaveValue(
    "CW",
  );
  await expect(recipient.locator(".app-shell")).toHaveClass(/density-compact/);
  await openDisplaySettings(recipient);
  await expect(
    recipient.getByRole("slider", { name: "Spectrum floor" }),
  ).toHaveValue("-119");
  await recipient.screenshot({
    path: testInfo.outputPath("shared-settings-restored.png"),
  });
});

test("shared settings preflight rejects incompatible source without changing tuning or display", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("browsersdr.selectedSource", "synthetic"),
  );
  await page.goto(fragment(preset(6_000_000_000)));
  const dialog = page.getByRole("dialog", {
    name: "Shared settings",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Apply shared settings" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role="status"]')).not.toBeEmpty();
  await dialog.getByRole("button", { name: "Close settings share" }).click();
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue("100.000");
  await expect(page.getByRole("combobox", { name: /^Mode/ })).toHaveValue(
    "WBFM",
  );
  await expect(page.locator(".app-shell")).toHaveClass(/density-compact/);
});

test("malformed/unknown links show recoverable errors and cannot apply; narrow modal stays reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const hash of [
    "#settings=%%%",
    fragment({ ...preset(), schema: "browsersdr-settings-v999" }),
  ]) {
    await page.goto(`/${hash}`);
    const dialog = page.getByRole("dialog", {
      name: "Shared settings",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Apply shared settings" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    await dialog
      .getByRole("button", { name: "Close settings share" })
      .press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("shared settings support every mode using compatible recipient routes and complete decoder settings", async ({
  page,
}) => {
  for (const mode of RECEIVER_MODES) {
    const value = { ...preset(), settings: defaultModeSettings(mode) };
    if (mode === "CW") value.settings.beatToneHz = 875;
    if (value.settings.srd) {
      value.settings.srd.threshold.mode = "manual";
      value.settings.srd.threshold.carrierLevel = 0.35;
      value.settings.srd.bitSlice.polarity = "inverted";
    }
    await page.goto(`/${fragment(value)}`);
    await page.getByRole("button", { name: "Apply shared settings" }).click();
    await expect(
      page.getByRole("dialog", { name: "Shared settings", exact: true }),
    ).toBeHidden();
    await expect(page.getByRole("combobox", { name: /^Mode/ })).toHaveValue(
      mode,
    );
    const stored = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("browsersdr.source.v1.rtl-sdr")!)
          .modeSettings,
    );
    expect(stored).toEqual(value.settings);
  }
});

test("an in-page shared proposal requires Stop and preserves an active/retained capture", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, fragment(preset()));
  const dialog = page.getByRole("dialog", {
    name: "Shared settings",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Apply shared settings" }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("Stop reception before applying shared settings."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close settings share" }).click();
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start I/Q recording", exact: true })
    .click();
  // A retained capture requires samples, not just an armed recorder. Wait for
  // the synthetic source to deliver bytes before testing the retention guard.
  await expect
    .poll(async () => {
      const text = await page.locator(".recording-state").textContent();
      return Number(text?.match(/([0-9.]+) \/ (?:32|2048) MiB/)?.[1] ?? 0);
    })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("tab", { name: "Session", exact: true }).click();
  await page.getByRole("button", { name: "Review shared settings" }).click();
  await expect(
    dialog.getByRole("button", { name: "Apply shared settings" }),
  ).toBeDisabled();
  await expect(dialog.getByText(/retained capture/)).toBeVisible();
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue("100.000");
});
