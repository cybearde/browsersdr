import {
  openDeviceSettings,
  closeDeviceSettings,
} from "./device-settings-navigation";
import { expect, test } from "@playwright/test";

test("source dialogs preserve drafts, remain passive and return keyboard focus", async ({
  page,
}, info) => {
  await page.goto("/?browser-test=1");
  const launcher = page.getByRole("button", { name: /^RF input & power/ });
  await launcher.click();
  const dialog = page.getByRole("dialog", {
    name: "RF input & power",
    exact: true,
  });
  await dialog.getByLabel("Declared RTL board").selectOption("nesdr-smart-v5");
  await dialog.getByLabel("Converter offset (Hz)").fill("125000000");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(launcher).toBeFocused();
  await expect(launcher).toContainText("125,000,000 Hz");
  await launcher.click();
  await expect(dialog.getByLabel("Converter offset (Hz)")).toHaveValue(
    "125000000",
  );
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close RF input & power", exact: true })
    .focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Done", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
  await page.getByRole("button", { name: /^Reception health/ }).click();
  const health = page.getByRole("dialog", {
    name: "Reception health",
    exact: true,
  });
  await expect(health).toContainText("Not measured · Receiver stopped");
  await expect(
    health.getByRole("button", { name: "Set input headroom", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("health-desktop.png") });
});

test("header guide, compact tuning and local display settings preserve the workspace", async ({
  page,
}, info) => {
  await page.goto("/?browser-test=1");
  await expect(
    page.locator(".app-topbar #antenna-guide-trigger"),
  ).toBeVisible();
  await expect(
    page.locator("#channel-stage-body #antenna-guide-trigger"),
  ).toHaveCount(0);
  const buttons = page.locator(".channel-utility-actions");
  const search = await buttons
    .getByRole("button", { name: "Search", exact: true })
    .boundingBox();
  const favorites = await buttons
    .getByRole("button", { name: /^Favorites/ })
    .boundingBox();
  expect(Math.abs(search!.y - favorites!.y)).toBeLessThan(2);
  await expect(page.locator(".receiver-center-field")).toContainText(
    "Capture center",
  );
  await page
    .getByRole("button", { name: "Display settings", exact: true })
    .click();
  const display = page.getByRole("dialog", {
    name: "Display settings",
    exact: true,
  });
  await display.getByLabel("Spectrum floor", { exact: true }).fill("-85");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Display settings", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Display settings", exact: true })
    .click();
  await expect(
    display.getByLabel("Spectrum floor", { exact: true }),
  ).toHaveValue("-85");
  await display.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator("#antenna-guide-trigger").click();
  await expect(
    page.getByRole("dialog", { name: "Antenna guide", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#antenna-guide-trigger")).toBeFocused();
  await page.screenshot({ path: info.outputPath("workspace-desktop.png") });
});

test("opening tools preserves a running generated source and channel", async ({
  page,
}, info) => {
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  const original = await page
    .getByLabel("Channel frequency", { exact: true })
    .inputValue();
  await page.getByRole("button", { name: /^Reception health/ }).click();
  const health = page.getByRole("dialog", {
    name: "Reception health",
    exact: true,
  });
  await expect(health).toContainText(
    "Raw input levels unavailable for this source",
  );
  await expect(
    health.getByRole("button", { name: "Set input headroom", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue(original);
  await page.locator("#antenna-guide-trigger").click();
  await expect(
    page.getByRole("dialog", { name: "Antenna guide", exact: true }),
  ).toContainText(/demo/i);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath("workspace-running.png") });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("phone utilities and all themes retain bounded modal content and visible dismissal", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?browser-test=1");
  for (const theme of [
    "Midnight Observatory",
    "Amber Field Deck",
    "Vice Afterglow",
  ]) {
    await page.getByLabel("Settings", { exact: true }).click();
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption({ label: theme });
    await page.getByLabel("Settings", { exact: true }).click();
    await page.getByRole("button", { name: /^RF input & power/ }).click();
    const dialog = page.getByRole("dialog", {
      name: "RF input & power",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", {
        name: "Close RF input & power",
        exact: true,
      }),
    ).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
    const bounds = await dialog.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(374);
    await page.screenshot({
      path: info.outputPath("rf-phone-" + theme.split(" ")[0] + ".png"),
    });
    await page.keyboard.press("Escape");
  }
  await page.getByLabel("Help", { exact: true }).click();
  await page.locator("#antenna-help-trigger").click();
  await expect(
    page.getByRole("dialog", { name: "Antenna guide", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#help-menu-trigger")).toBeFocused();
});

test("device and site tools share the source stack and preserve editable device settings", async ({
  page,
}, info) => {
  await page.goto("/?browser-test=1");
  const device = page.locator(".device-settings-trigger");
  const site = page.getByRole("button", { name: "Antenna site", exact: true });
  await expect(
    page.locator("#source-stage-body .workspace-tool-trigger strong"),
  ).toHaveText([
    "Device details & settings",
    "Reception health",
    "RF input & power",
    "Antenna site",
  ]);
  await expect(device).toContainText("1.024 MS/s · Automatic gain");
  await expect(site).toContainText("Not set · optional");
  await openDeviceSettings(page);
  const dialog = page.getByRole("dialog", {
    name: "Device details & settings",
    exact: true,
  });
  await dialog
    .getByLabel("Sample rate", { exact: true })
    .selectOption("2400000");
  await closeDeviceSettings(page);
  await expect(device).toBeFocused();
  await expect(device).toContainText("2.400 MS/s · Automatic gain");
  await openDeviceSettings(page);
  await expect(dialog.getByLabel("Sample rate", { exact: true })).toHaveValue(
    "2400000",
  );
  await dialog
    .getByRole("combobox", { name: "RF gain", exact: true })
    .selectOption("manual");
  await expect(device).toContainText("25.0 dB gain");
  await dialog
    .getByRole("combobox", { name: "RF gain", exact: true })
    .selectOption("auto");
  await page.screenshot({ path: info.outputPath("device-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(device).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("source-tools-desktop.png") });
  await site.click();
  await expect(
    page.getByRole("dialog", { name: "Antenna site", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(site).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const source of ["rtl-sdr", "hackrf", "bladerf", "usrp-b205"]) {
    await page
      .getByRole("combobox", { name: "Signal source", exact: true })
      .selectOption(source);
    await openDeviceSettings(page);
    await expect(
      dialog.getByRole("button", {
        name: "Close Device details & settings",
        exact: true,
      }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeInViewport();
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
    await page.screenshot({
      path: info.outputPath(`device-${source}-phone.png`),
    });
    await closeDeviceSettings(page);
  }
});
