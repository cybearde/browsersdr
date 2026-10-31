import { expect, test, type Locator } from "@playwright/test";

async function fullyInside(element: Locator, container: Locator) {
  const outer = (await container.boundingBox())!;
  const inner = (await element.boundingBox())!;
  expect(inner.y).toBeGreaterThanOrEqual(outer.y);
  expect(inner.y + inner.height).toBeLessThanOrEqual(
    outer.y + outer.height + 1,
  );
}

test("header layout controls and condensed docks keep primary actions fully visible", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const dock = page.locator(".receiver-dock");
  for (const viewport of [
    { width: 1686, height: 903 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".workspace-toolbar")).toHaveCount(0);
    for (const [tab, maximum] of [
      ["Audio & decode", 165],
      ["Session", 145],
    ] as const) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "Session") {
        await expect(
          dock.getByRole("button", { name: "Share settings", exact: true }),
        ).toBeVisible();
      }
      await expect
        .poll(async () => (await dock.boundingBox())!.height)
        .toBeLessThanOrEqual(maximum);
    }
    await page
      .getByRole("tab", { name: "Capture & replay", exact: true })
      .click();
    expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(205);
    for (const element of [
      page.getByRole("button", { name: "Start I/Q recording", exact: true }),
      page.getByLabel("Recording export format"),
      page.getByLabel("Timed capture seconds"),
      page.getByLabel("Capture current channel only"),
    ])
      await fullyInside(element, dock);
    await page
      .getByRole("tab", { name: "Open recording", exact: true })
      .click();
    await fullyInside(
      page.getByRole("button", { name: "Load files", exact: true }),
      dock,
    );
    expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(185);
    await page.getByRole("tab", { name: "Record", exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(viewport.height);
    expect(
      (await page.locator(".graphics-panel canvas").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(120);
  }
});

test("layout reset returns focus to Settings", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Settings", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page
      .locator(".header-utility-menu")
      .filter({ has: page.getByLabel("Settings", { exact: true }) }),
  ).not.toHaveAttribute("open");
  await expect(page.getByLabel("Settings", { exact: true })).toBeFocused();
  await page.getByLabel("Settings", { exact: true }).click();
  await page.getByRole("button", { name: "Reset layout", exact: true }).click();
  await expect(page.getByLabel("Settings", { exact: true })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Collapse", exact: true }),
  ).toBeVisible();
});

test("condensed recording keeps Stop, retained actions and reload warning visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  const dock = page.locator(".receiver-dock");
  await page
    .getByRole("button", { name: "Start I/Q recording", exact: true })
    .click();
  await fullyInside(
    page.getByRole("button", { name: "Stop recording", exact: true }),
    dock,
  );
  await expect(page.getByLabel("Recording export format")).toBeDisabled();
  await expect
    .poll(
      async () => (await page.locator(".recording-state").textContent()) ?? "",
    )
    .toMatch(/[1-9][\d.]* MiB/);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  const download = page.getByRole("button", {
    name: "Download ZIP",
    exact: true,
  });
  await expect(download).toBeEnabled();
  await fullyInside(download, dock);
  await fullyInside(page.locator(".capture-retention-warning"), dock);
  await expect(
    page.getByRole("button", { name: "Start I/Q recording", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Discard prepared capture", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start I/Q recording", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("compact audio controls open by keyboard and remain reachable without page overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const dock = page.locator(".receiver-dock");
  const panel = dock.locator(".audio-capture-panel");
  const summary = panel.locator("summary");
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page
      .getByRole("tab", { name: "Audio & decode", exact: true })
      .click();
    await summary.scrollIntoViewIfNeeded();
    await fullyInside(summary, dock);
    await summary.focus();
    await page.keyboard.press("Space");
    await expect(panel).toHaveAttribute("open", "");
    const record = panel.getByRole("button", {
      name: "Record audio",
      exact: true,
    });
    await expect(record).toBeEnabled();
    await record.focus();
    await expect(record).toBeFocused();
    await fullyInside(record, dock);
    const rewind = panel.getByRole("checkbox", {
      name: "Keep last 60 seconds for rewind",
    });
    await rewind.focus();
    await expect(rewind).toBeFocused();
    await fullyInside(rewind, dock);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width);
    await panel.screenshot({
      path: testInfo.outputPath(`audio-controls-${viewport.width}.png`),
    });
    await summary.focus();
    await page.keyboard.press("Space");
    await expect(panel).not.toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
    if (viewport.width === 1280) {
      expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(165);
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight),
      ).toBe(viewport.height);
    }
  }
});
