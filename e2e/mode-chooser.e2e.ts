import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import {
  chooseReceiverMode,
  openApplicationView,
} from "./application-navigation";

test("decoder browsing is passive and explicit selection preserves mode IDs and source setup", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const quick = page.getByRole("combobox", { name: "Mode", exact: true });
  const trigger = page.getByRole("button", {
    name: "More modes…",
    exact: true,
  });
  await expect(quick.locator("option")).toHaveCount(7);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Choose a decoder" });
  const search = dialog.getByRole("searchbox", {
    name: "Search modes or decoders",
  });
  await expect(search).toBeFocused();
  await search.fill("adsb");
  await expect(dialog.locator(".mode-chooser-card")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Select ADS-B 1090ES", exact: true })
    .click();
  await expect(dialog.locator(".mode-chooser-footer")).toContainText(
    "1,090 MHz",
  );
  await expect(quick).toHaveValue("WBFM");
  await expect(
    page.getByRole("spinbutton", { name: "Channel frequency", exact: true }),
  ).toHaveValue("100.000");
  await search.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(quick).toHaveValue("WBFM");
  await chooseReceiverMode(page, "ADS-B");
  await expect(quick).toHaveValue("ADS-B");
  await expect(quick.locator("option")).toHaveCount(8);
  await expect(
    page.getByRole("spinbutton", { name: "Channel frequency", exact: true }),
  ).toHaveValue("1090.000");
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("pin replacement is deliberate, bounded and survives reload with an unpinned current mode", async ({
  page,
}) => {
  await page.goto("/");
  const quick = page.getByRole("combobox", { name: "Mode", exact: true });
  const trigger = page.getByRole("button", {
    name: "More modes…",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Choose a decoder" });
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Pin DAB / DAB+ to quick list", exact: true })
    .click();
  await expect(quick.locator('option[value="DAB"]')).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "Quick mode to replace" })
    .selectOption("OFF");
  await dialog
    .getByRole("button", { name: "Replace pin", exact: true })
    .click();
  await expect(quick.locator("option")).toHaveCount(7);
  await expect(quick).toHaveValue("WBFM");
  await dialog
    .getByRole("button", { name: "Select DAB / DAB+", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Use mode", exact: true }).click();
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Unpin DAB / DAB+", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(quick).toHaveValue("DAB");
  await expect(quick.locator('option[value="DAB"]')).toContainText("current");
  await page.reload();
  await expect(quick).toHaveValue("DAB");
  await expect(quick.locator("option")).toHaveCount(7);
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Reset quick list", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(quick.locator("option")).toHaveCount(8);
  await expect(quick).toHaveValue("DAB");
});

test("incompatible demo modes are inspectable and chooser browsing retains active reception", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
  await page.getByRole("button", { name: "More modes…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a decoder" });
  await dialog
    .getByRole("button", { name: "Select DAB / DAB+", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Use mode", exact: true }),
  ).toBeDisabled();
  await expect(dialog.locator(".mode-chooser-footer")).toContainText(
    "Unavailable with",
  );
  await dialog.getByRole("button", { name: "Broadcast", exact: true }).click();
  await expect(dialog.locator(".mode-chooser-card")).toHaveCount(3);
  await dialog.getByRole("searchbox").fill("xyz");
  await expect(
    dialog.getByText("No modes match. Try another search or category."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("WBFM");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("active recording blocks mode changes and completed captures survive decoder changes unchanged", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start I/Q recording", exact: true })
    .click();
  const quick = page.getByRole("combobox", { name: "Mode", exact: true });
  await expect(quick).toBeDisabled();
  const captureMode = await quick.inputValue();
  await page.getByRole("button", { name: "More modes…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a decoder" });
  await dialog.getByRole("button", { name: "Select AM", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Use mode", exact: true }),
  ).toBeDisabled();
  await expect(dialog.locator(".mode-chooser-footer")).toContainText(
    "Finish the recording",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download ZIP", exact: true }),
  ).toBeEnabled();
  await expect(quick).toBeEnabled();
  await quick.selectOption("AM");
  await expect(quick).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Start I/Q recording", exact: true }),
  ).toHaveCount(0);
  const firstDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const before = unzipSync(
    await readFile((await (await firstDownload).path())!),
  );
  const sidecar = Object.entries(before).find(
    ([name]) => name.endsWith(".sigmf-meta") || name.endsWith(".json"),
  )!;
  const metadata = JSON.parse(new TextDecoder().decode(sidecar[1]));
  expect(metadata.mode ?? metadata.annotations?.[0]?.["core:label"]).toBe(
    captureMode,
  );
  await quick.selectOption("NBFM");
  await expect(quick).toHaveValue("NBFM");
  await expect(quick).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Start I/Q recording", exact: true }),
  ).toHaveCount(0);
  const secondDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const after = unzipSync(
    await readFile((await (await secondDownload).path())!),
  );
  expect(Object.keys(after)).toEqual(Object.keys(before));
  for (const name of Object.keys(before))
    expect(after[name]).toEqual(before[name]);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("chooser fits desktop and phone, traps focus and follows all themes", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "More modes…",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Choose a decoder" });
  for (const width of [1920, 1366, 820, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 740 : 1000 });
    const quickBox = (await page
      .getByRole("combobox", { name: "Mode", exact: true })
      .boundingBox())!;
    const moreBox = (await trigger.boundingBox())!;
    expect(Math.abs(quickBox.y - moreBox.y)).toBeLessThan(2);
    await trigger.click();
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(width < 500 ? 740 : 1000);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Select DAB / DAB+", exact: true })
      .click();
    if (width === 1920 || width === 390)
      await page.screenshot({
        path: `.local/decoder-picker-implementation-2026-10-14/chooser-${testInfo.project.name}-${width}.png`,
      });
    await dialog.getByRole("button", { name: "Use mode", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close decoder chooser" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Use mode", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of [
    "Amber Field Deck",
    "Vice Afterglow",
    "Midnight Observatory",
  ]) {
    await page.getByLabel("Settings", { exact: true }).click();
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption({ label: theme });
    await page.getByLabel("Settings", { exact: true }).press("Escape");
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("searchbox").fill("sonde");
    await expect(dialog.locator(".mode-chooser-card")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await openApplicationView(page, "Decoder");
  await openApplicationView(page, "Receiver");
  await expect(trigger).toBeVisible();
});
