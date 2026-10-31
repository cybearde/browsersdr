import { expect, test } from "@playwright/test";

test("spectrum controls fit in coherent groups and plot info does not resize or retune", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1686, height: 903 });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByLabel("Channel frequency", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  const toolbar = page.locator(".spectrum-toolbar");
  const frame = page.locator(".canvas-frame");
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  const follow = page.getByRole("switch", {
    name: "Follow channel",
    exact: true,
  });
  const info = page.getByRole("button", {
    name: "FFT & display details",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "FFT & display details",
    exact: true,
  });
  await expect(center).toBeEnabled();
  await expect(page.locator(".graphics-panel > .spectrum-details")).toHaveCount(
    0,
  );
  await expect(toolbar.locator(".display-units, .receiver-offset")).toHaveCount(
    0,
  );
  await expect(page.locator(".plot-metadata")).toContainText("not dBm");
  await follow.focus();
  await follow.press("Space");
  await expect(follow).not.toBeChecked();
  await expect(page.locator(".receiver-switch-state")).toHaveText("Off");
  await follow.press("Space");
  await expect(follow).toBeChecked();

  for (const viewport of [
    { width: 1686, height: 903 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = (await toolbar.boundingBox())!;
    const groups = await toolbar
      .locator(
        ".spectrum-display-tools, .receiver-frequency-controls, .receiver-tuning-actions",
      )
      .all();
    const rects = await Promise.all(groups.map((group) => group.boundingBox()));
    for (const rect of rects) {
      expect(rect!.x).toBeGreaterThanOrEqual(bounds.x);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1,
      );
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(
        bounds.y + bounds.height + 1,
      );
    }
    if (viewport.width === 1686) {
      expect(
        Math.max(...rects.map((rect) => rect!.y)) -
          Math.min(...rects.map((rect) => rect!.y)),
      ).toBeLessThan(2);
      expect(bounds.height).toBeLessThan(55);
    }
    const frequency = (await center.boundingBox())!;
    const set = (await toolbar
      .getByRole("button", { name: "Set", exact: true })
      .boundingBox())!;
    expect(Math.abs(frequency.y - set.y)).toBeLessThan(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width);
    await info.scrollIntoViewIfNeeded();
    const before = (await frame.boundingBox())!;
    const accepted = await center.inputValue();
    await info.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Hann FFT");
    await expect(dialog).toBeFocused();
    const overlay = (await dialog.boundingBox())!;
    const after = (await frame.boundingBox())!;
    expect(after.height).toBeCloseTo(before.height, 1);
    expect(overlay.x).toBeGreaterThanOrEqual(after.x);
    expect(overlay.y).toBeGreaterThanOrEqual(after.y);
    expect(overlay.x + overlay.width).toBeLessThanOrEqual(
      after.x + after.width,
    );
    expect(overlay.y + overlay.height).toBeLessThanOrEqual(
      after.y + after.height,
    );
    await expect(center).toHaveValue(accepted);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(info).toBeFocused();
  }
  await info.click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(info).toBeFocused();
  await info.click();
  await page
    .getByRole("heading", { name: "Spectrum & waterfall", exact: true })
    .click();
  await expect(dialog).toBeHidden();
});

test("spectrum switch and info retain touch targets on narrow screens", async ({
  page,
}) => {
  await page.emulateMedia({ media: "screen" });
  // A fresh context exposes an actual coarse pointer, rather than only resizing CSS.
  const touch = await page
    .context()
    .browser()!
    .newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const tab = await touch.newPage();
  await tab.goto(test.info().project.use.baseURL!);
  expect(
    await tab.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);
  for (const selector of [
    ".receiver-auto-center",
    ".receiver-center-field .unit-input",
    ".spectrum-info-button",
    ".spectrum-toolbar button",
  ]) {
    for (const element of await tab.locator(selector).all())
      expect((await element.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await tab.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await tab
    .getByRole("button", { name: "FFT & display details", exact: true })
    .click();
  await expect(
    tab.getByRole("dialog", { name: "FFT & display details", exact: true }),
  ).toBeVisible();
  await touch.close();
});
