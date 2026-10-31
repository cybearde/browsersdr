import { expect, test, type Locator } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };
function sameBox(actual: Box, expected: Box) {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(actual[key] - expected[key]), key).toBeLessThan(1.5);
}

async function finishMotion(dialog: Locator) {
  await dialog.evaluate((node) => {
    for (const animation of node.getAnimations({ subtree: true }))
      animation.finish();
  });
}

async function checkMorph(trigger: Locator, dialog: Locator, close: string) {
  await trigger.scrollIntoViewIfNeeded();
  const from = (await trigger.boundingBox())!;
  await trigger.click();
  await expect(dialog).toBeVisible();
  const first = await dialog.evaluate((node) => {
    const motion = node
      .getAnimations()
      .find(
        (animation) =>
          (animation as CSSAnimation).animationName === "overlay-arrive",
      )!;
    motion.pause();
    motion.currentTime = 0;
    const b = node.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  sameBox(first, from);
  await finishMotion(dialog);
  const final = (await dialog.boundingBox())!;
  const viewport = await dialog.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  expect(final.x).toBeGreaterThanOrEqual(7.5);
  expect(final.y).toBeGreaterThanOrEqual(7.5);
  expect(final.x + final.width).toBeLessThanOrEqual(viewport.width - 7.5);
  expect(final.y + final.height).toBeLessThanOrEqual(viewport.height - 7.5);
  expect(final.width * final.height).toBeGreaterThan(from.width * from.height);
  // Inspect the exit endpoint in the attribute-change microtask, before native
  // dismissal removes the top layer. Other suites exercise real click/Escape.
  const last = await dialog
    .getByRole("button", { name: close, exact: true })
    .first()
    .evaluate(
      (button) =>
        new Promise<Box>((resolve) => {
          const panel = button.closest("dialog")!;
          const observer = new MutationObserver(() => {
            if (!panel.hasAttribute("data-closing")) return;
            observer.disconnect();
            const motion = panel
              .getAnimations()
              .find(
                (animation) =>
                  (animation as CSSAnimation).animationName ===
                  "overlay-depart",
              )!;
            motion.pause();
            motion.currentTime = 200;
            const b = panel.getBoundingClientRect();
            resolve({ x: b.x, y: b.y, width: b.width, height: b.height });
          });
          observer.observe(panel, {
            attributes: true,
            attributeFilter: ["data-closing"],
          });
          (button as HTMLButtonElement).click();
        }),
    );
  sameBox(last, from);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

test("source tools and Display expand from and return to their own buttons", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?browser-test=1");
  for (const title of [
    "Device details & settings",
    "Reception health",
    "RF input & power",
    "Antenna site",
    "Display settings",
  ]) {
    await checkMorph(
      page.getByRole("button", {
        name:
          title === "Antenna site" || title === "Display settings"
            ? title
            : new RegExp(`^${title}`),
        exact: title === "Antenna site" || title === "Display settings",
      }),
      page.getByRole("dialog", { name: title, exact: true }),
      title === "Antenna site" ? "Close antenna site" : `Close ${title}`,
    );
  }
  await page.screenshot({ path: info.outputPath("workspace-spacing.png") });
});

for (const [button, title, close] of [
  ["Search", "Search stations & signals", "Close Search"],
  ["Favorites", "Favorites", "Close Favorites"],
  ["Antenna guide", "Antenna guide", "Close utility overlay"],
  ["More modes…", "Choose a decoder", "Close decoder chooser"],
] as const) {
  test(`${button} expands from and returns to its own launcher`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/?browser-test=1");
    await checkMorph(
      page.getByRole("button", {
        name: button === "Favorites" ? /^Favorites/ : button,
        exact: button !== "Favorites",
      }),
      page.getByRole("dialog", { name: title, exact: true }),
      close,
    );
  });
}

test("source padding and tuning columns stay aligned at desktop and phone densities", async ({
  page,
}) => {
  await page.goto("/?browser-test=1");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const compact of [true]) {
      void compact;
      await expect(page.locator(".app-shell")).toHaveClass(/density-compact/);
      const tune = (await page
        .getByRole("button", { name: "Tune", exact: true })
        .boundingBox())!;
      const fine = (await page
        .getByRole("button", { name: "Fine-tune signal", exact: true })
        .boundingBox())!;
      const search = (await page
        .getByRole("button", { name: "Search", exact: true })
        .boundingBox())!;
      const favorites = (await page
        .getByRole("button", { name: /^Favorites/ })
        .boundingBox())!;
      expect(Math.abs(tune.x - search.x)).toBeLessThan(1);
      expect(Math.abs(tune.width - search.width)).toBeLessThan(1);
      expect(Math.abs(fine.x - favorites.x)).toBeLessThan(1);
      expect(Math.abs(fine.width - favorites.width)).toBeLessThan(1);
      const padding = await page
        .locator(".device-settings-trigger")
        .evaluate((node) => {
          const b = node.getBoundingClientRect(),
            title = node.querySelector("strong")!.getBoundingClientRect(),
            subtitle = node.querySelector("small")!.getBoundingClientRect();
          return { top: title.top - b.top, bottom: b.bottom - subtitle.bottom };
        });
      expect(padding.top).toBeGreaterThanOrEqual(8);
      expect(padding.bottom).toBeGreaterThanOrEqual(8);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    }
  }
});

test("resizing and reduced motion preserve viewport bounds and immediate dismissal", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?browser-test=1");
  const trigger = page.getByRole("button", { name: /^Reception health/ });
  const dialog = page.getByRole("dialog", {
    name: "Reception health",
    exact: true,
  });
  await trigger.click();
  await finishMotion(dialog);
  await page.setViewportSize({ width: 390, height: 568 });
  await expect
    .poll(async () => {
      const b = (await dialog.boundingBox())!;
      return (
        b.x >= 7.5 &&
        b.y >= 7.5 &&
        b.x + b.width <= 382.5 &&
        b.y + b.height <= 560.5
      );
    })
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  await expect(dialog).toHaveCSS("animation-name", "none");
  await dialog
    .getByRole("button", { name: "Close Reception health", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Reception health",
      exact: true,
      includeHidden: true,
    }),
  ).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();
});
