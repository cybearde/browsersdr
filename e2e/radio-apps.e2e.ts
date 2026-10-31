import { expect, test } from "@playwright/test";
import { createDabEnsembleFixture } from "../src/testing/dabEnsembleFixture";
import { targetRecordingFixture } from "../src/testing/targetRecordingFixture";

import {
  installSource,
  launch,
  start,
  expectAppFits,
} from "./radio-app-fixture";

test("Radio Apps browsing is passive, prepares settings, restores and wraps accessibly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installSource(page);
  await page.goto("/?browser-test=1");
  await page
    .getByRole("button", { name: "Radio Apps", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Radio Apps", exact: true });
  await expect(dialog.locator("article")).toHaveCount(8);
  await dialog.getByRole("searchbox").fill("boats");
  await expect(dialog.locator("article")).toHaveCount(1);
  await dialog.getByRole("searchbox").fill("");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await expect(
      dialog.getByRole("button", { name: "Close Radio Apps" }),
    ).toBeVisible();
  }
  await dialog.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Radio Apps", exact: true }).first(),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { radioAppsFixture: { opens: number } })
          .radioAppsFixture.opens,
    ),
  ).toBe(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await launch(page, "Track aircraft");
  const context = page.getByRole("region", { name: "Active Radio App" });
  await expect(context).toContainText("Ready");
  await expectAppFits(page);
  await context.getByText("App tools", { exact: true }).click();
  await context.getByRole("button", { name: "Restore previous setup" }).click();
  await expect(context).toHaveCount(0);
  await page.getByRole("tab", { name: "Receiver", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Channel frequency" }),
  ).toHaveValue("100.000");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { radioAppsFixture: { opens: number } })
          .radioAppsFixture.opens,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});
test("Search finds Radio Apps and hands off without tuning", async ({
  page,
}) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("dialog", {
    name: "Search stations & signals",
  });
  await search.getByRole("searchbox").fill("planes");
  await search
    .getByRole("button", { name: "Open Track aircraft", exact: true })
    .click();
  await expect(search).toBeHidden();
  const app = page.getByRole("dialog", { name: "Radio Apps", exact: true });
  await expect(
    app.getByRole("heading", { name: "Track aircraft", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { radioAppsFixture: { opens: number } })
          .radioAppsFixture.opens,
    ),
  ).toBe(0);
  await app.getByRole("button", { name: "Close Radio Apps" }).click();
});
for (const [id, name, mode] of [
  ["aircraft", "Track aircraft", "ADS-B"],
  ["ships", "Track ships", "AIS"],
] as const) {
  test(`${name} uses actual generated live I/Q, opens the map and retains manual Stop`, async ({
    page,
  }) => {
    const fixture = targetRecordingFixture(mode, id === "aircraft");
    await installSource(
      page,
      Buffer.from(fixture.data).toString("base64"),
      fixture.metadata.centerFrequencyHz,
    );
    await page.goto("/?browser-test=1");
    await launch(page, name);
    await start(page);
    const context = page.getByRole("region", { name: "Active Radio App" });
    await expect(context).toContainText("Receiving");
    await expect(page.locator(".decoder-record-list")).toContainText(
      id === "aircraft" ? "KLM1023" : "211234567",
    );
    await expect(
      page.locator("#decoder-view .decoder-map svg.map-overlay"),
    ).toBeVisible();
    await expect(async () => {
      const footer = await page
        .locator("#decoder-view .decoder-footer")
        .boundingBox();
      expect(footer).not.toBeNull();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(1000);
    }).toPass({ timeout: 7000 });
    if (id === "aircraft") {
      await expect(
        page.getByRole("navigation", { name: "Result pages" }),
      ).toContainText("2 results");
      await page.setViewportSize({ width: 390, height: 844 });
      const pagination = page.getByRole("navigation", { name: "Result pages" });
      await expect(pagination).toContainText("1 / 2");
      await pagination
        .getByRole("button", { name: "Next", exact: true })
        .click();
      await expect(pagination).toContainText("2 / 2");
      await page.locator(".decoder-export-menu > summary").click();
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export retained results", exact: true })
        .click();
      const file = await (await download).path();
      const { readFile } = await import("node:fs/promises");
      expect(JSON.parse(await readFile(file!, "utf8")).records).toHaveLength(2);
    }
    await expectAppFits(page);
    await context.getByRole("button", { name: "Receiver settings" }).click();
    const starts = await page.evaluate(
      () =>
        (window as unknown as { radioAppsFixture: { starts: number } })
          .radioAppsFixture.starts,
    );
    await page
      .getByRole("button", { name: `Return to ${name}`, exact: true })
      .click();
    await expect(context).toContainText("Receiving");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { radioAppsFixture: { starts: number } })
            .radioAppsFixture.starts,
      ),
    ).toBe(starts);
    await context
      .getByRole("button", { name: "Stop receiving", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start receiving", exact: true }),
    ).toBeEnabled();
  });
}
test("DAB scans decoded ensembles through the real worker, revalidates Play and cancels on global Stop", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const waveform = createDabEnsembleFixture(2_400_000, true),
    bytes = new Uint8Array(waveform.I.length * 2);
  for (let n = 0; n < waveform.I.length; n++) {
    bytes[n * 2] = Math.max(
      0,
      Math.min(255, Math.round(waveform.I[n]! * 128 + 127.5)),
    );
    bytes[n * 2 + 1] = Math.max(
      0,
      Math.min(255, Math.round(waveform.Q[n]! * 128 + 127.5)),
    );
  }
  await installSource(page, Buffer.from(bytes).toString("base64"), 178_352_000);
  await page.goto("/?browser-test=1");
  await launch(page, "Listen to DAB+");
  await start(page);
  const app = page.getByRole("region", { name: "DAB programmes and scan" });
  await expect(page.locator("#decoder-view")).toContainText("Test Radio");
  await expectAppFits(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Now playing", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Station live text and slideshow" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    844,
  );
  await page.getByRole("button", { name: "Programmes", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await app
    .getByRole("combobox", { name: "Scan blocks" })
    .selectOption("current");
  await app
    .getByRole("button", { name: "Start station scan", exact: true })
    .click();
  await expect(app.getByRole("status")).toContainText("Scan finished", {
    timeout: 15_000,
  });
  await expect(app).toContainText("Audio suppressed");
  await expect(app.getByLabel("Discovered DAB programmes")).toContainText(
    "Test Radio",
  );
  await app.getByRole("button", { name: "Play", exact: true }).click();
  await expect(app).not.toContainText("Audio suppressed");
  await expect(app.getByRole("alert")).toHaveCount(0);
  await app.getByRole("combobox", { name: "Scan blocks" }).selectOption("all");
  await app
    .getByRole("button", { name: "Start station scan", exact: true })
    .click();
  await expect(
    app.getByRole("button", { name: "Stop scan", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Receiver", exact: true }).click();
  await expect(page.locator(".radio-app-scan-indicator")).toBeVisible();
  await page
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
  await expect(page.locator(".radio-app-scan-indicator")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeEnabled();
});

test("Every app fits before reception and keeps its return shortcut", async ({
  page,
}) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  for (const name of ["Track aircraft", "Track ships", "Listen to DAB+"]) {
    await launch(page, name);
    await expectAppFits(page);
    await page
      .getByRole("region", { name: "Active Radio App" })
      .getByRole("button", { name: "Receiver settings" })
      .click();
    await page
      .getByRole("button", { name: `Return to ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Active Radio App" }),
    ).toContainText("Ready");
  }
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { radioAppsFixture: { opens: number } })
          .radioAppsFixture.opens,
    ),
  ).toBe(0);
});
