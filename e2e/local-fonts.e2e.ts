import { expect, test } from "@playwright/test";

test("real UI fonts load locally with external font services unavailable", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  const localFonts: string[] = [];
  await page.route(
    /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
    (route) => {
      externalRequests.push(route.request().url());
      return route.abort();
    },
  );
  page.on("request", (request) => {
    if (request.resourceType() === "font") localFonts.push(request.url());
  });
  await page.goto("/");
  const loaded = await page.evaluate(async () => {
    const styles = [
      '400 16px "Manrope"',
      '500 16px "Manrope"',
      '600 16px "Manrope"',
      '700 16px "Manrope"',
      '400 16px "IBM Plex Mono"',
      '500 16px "IBM Plex Mono"',
    ];
    const faces = await Promise.all(
      styles.map((style) => document.fonts.load(style, "BrowserSDR ŽЙế")),
    );
    await document.fonts.ready;
    return faces.map(
      (group) =>
        group.length > 0 && group.every((face) => face.status === "loaded"),
    );
  });
  expect(loaded).toEqual([true, true, true, true, true, true]);
  expect(externalRequests).toEqual([]);
  expect(localFonts.length).toBeGreaterThan(0);
  expect(
    localFonts.every(
      (url) => new URL(url).origin === new URL(page.url()).origin,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "BrowserSDR", exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`receiver typography retains readable field sizes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?browser-test=1");
    for (const theme of [
      "classic",
      "field-deck",
      "vice-afterglow",
      "graphite-studio",
    ]) {
      await page.getByLabel("Settings", { exact: true }).click();
      await page
        .getByRole("combobox", { name: "Theme", exact: true })
        .selectOption(theme);
      await page.getByLabel("Settings", { exact: true }).click();
      for (const compact of [true]) {
        void compact;
        await expect(page.locator(".app-shell")).toHaveClass(/density-compact/);
        const frequency = page.getByLabel("Channel frequency", { exact: true });
        await expect(frequency).toHaveCSS("font-size", "14.4px");
        await expect(frequency).toHaveCSS("font-weight", "500");
        await expect(frequency).toHaveCSS("font-family", /IBM Plex Mono/);
        await expect(page.locator(".receiver-center-field input")).toHaveCSS(
          "font-size",
          "12.8px",
        );
        await expect(
          page.getByRole("combobox", { name: "Signal source", exact: true }),
        ).toHaveCSS("font-size", "13px");
        await expect(
          page.locator(".channel-tune-actions button").first(),
        ).toHaveCSS("font-size", "12.16px");
        await expect(
          page.locator(".channel-utility-actions button").first(),
        ).toHaveCSS("font-size", "12.16px");
        await page.locator(".device-settings-trigger").click();
        const device = page.getByRole("dialog", {
          name: "Device details & settings",
          exact: true,
        });
        await expect(
          device.getByRole("combobox", { name: "RF gain", exact: true }),
        ).toHaveCSS("font-size", width < 600 ? "16px" : "13px");
        await expect(
          device.getByLabel("Sample rate", { exact: true }),
        ).toHaveCSS("font-size", width < 600 ? "16px" : "13px");
        await expect(
          device.getByRole("heading", {
            name: "Device details & settings",
            exact: true,
          }),
        ).toHaveCSS("font-size", "15.2px");
        await page.keyboard.press("Escape");
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(width);
      }
    }
  });
}
