import { expect, test } from "@playwright/test";

test("site overlay retains drafts, wraps keyboard focus and cancels a late location fix on dismissal", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: (value: unknown) => void) {
          setTimeout(
            () =>
              success({
                coords: { latitude: 49, longitude: 12, accuracy: 20 },
                timestamp: Date.now(),
              }),
            500,
          );
        },
      },
    }),
  );
  await page.goto("/?browser-test=1");
  const trigger = page.getByRole("button", {
    name: "Antenna site",
    exact: true,
  });
  const panel = page.getByRole("dialog", { name: "Antenna site", exact: true });
  await trigger.click();
  await expect(panel.getByLabel("Site name", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    panel.getByRole("button", { name: "Use my location" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    panel.getByRole("button", { name: "Close antenna site" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(panel.getByRole("button", { name: "Apply site" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    panel.getByRole("button", { name: "Close antenna site" }),
  ).toBeFocused();
  await panel
    .getByLabel("Site name", { exact: true })
    .fill("Unfinished rooftop site");
  await panel.getByRole("button", { name: "Use my location" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(panel.getByLabel("Site name", { exact: true })).toHaveValue(
    "Unfinished rooftop site",
  );
  await page.waitForTimeout(550); // Deliberately deliver a callback after dismissal/reopening.
  await expect(panel.locator(".antenna-site-status")).toHaveText(
    "Antenna location unknown.",
  );
  await expect(panel).toContainText("Request cancelled");
  await page.mouse.click(0, 0);
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const reduced of [false, true]) {
  test(`site and local/remote Favorites motion respects reduced motion=${reduced}`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.goto("/?browser-test=1");
    for (const name of ["Antenna site", "Favorites", "Remote favorites"]) {
      if (name === "Remote favorites")
        await page
          .getByRole("combobox", { name: "Signal source", exact: true })
          .selectOption("remote");
      const trigger = page.getByRole("button", {
        name: name === "Antenna site" ? name : new RegExp(`^${name}`),
        exact: name === "Antenna site",
      });
      const panel = page.getByRole("dialog", { name, exact: true });
      await trigger.click();
      await expect(panel).toHaveCSS(
        "animation-name",
        reduced ? "none" : "overlay-arrive",
      );
      await panel
        .getByRole("button", {
          name: `Close ${name === "Antenna site" ? "antenna site" : name}`,
          exact: true,
        })
        .click();
      if (!reduced) await expect(panel).toHaveAttribute("data-closing", "true");
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(panel).toBeVisible();
      await expect(panel).not.toHaveAttribute("data-closing", "true");
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    }
  });
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 640 },
  { width: 320, height: 568 },
]) {
  test(`antenna overlay keeps its header/footer reachable at ${size.width}×${size.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(size);
    await page.goto("/?browser-test=1");
    await page
      .getByRole("button", { name: "Antenna site", exact: true })
      .click();
    const panel = page.getByRole("dialog", {
      name: "Antenna site",
      exact: true,
    });
    if (size.width === 1440 && process.env.OVERLAY_REVIEW) {
      await page.screenshot({
        path: testInfo.outputPath("antenna-site-overlay.png"),
        animations: "disabled",
      });
    }
    const longName = "Roof antenna with a deliberately long site label ".repeat(
      2,
    );
    await panel.getByLabel("Site name", { exact: true }).fill(longName);
    await panel.getByLabel("Latitude", { exact: true }).fill("48.1");
    await panel.getByLabel("Longitude", { exact: true }).fill("11.7");
    await panel.getByText("How this site is used", { exact: true }).click();
    // ResizeObserver places expanded content after the current layout pass.
    await panel.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      );
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
    await expect(
      panel.getByRole("button", { name: "Close antenna site" }),
    ).toBeInViewport();
    await expect(
      panel.getByRole("button", { name: "Apply site" }),
    ).toBeInViewport();
    await panel.getByRole("button", { name: "Apply site" }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator(".antenna-site-summary")).toContainText(
      longName.trim(),
    );
    const overflow = await page
      .locator(".antenna-site")
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
  });
}
