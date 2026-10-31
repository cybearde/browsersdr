import { expect, test, type Page } from "@playwright/test";

test.use({ video: "on" });
async function openInstrument(page: Page) {
  await page.goto("/?browser-test=1");
  await page.getByLabel("Settings", { exact: true }).click();
  await page
    .getByLabel("Theme", { exact: true })
    .selectOption("graphite-studio");
  await page.getByLabel("Settings", { exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
}

test("physical keys travel within a stationary native hit area for pointer and keyboard", async ({
  page,
}, info) => {
  await openInstrument(page);
  const button = page.getByRole("button", {
    name: /^(Collapse|Expand) source panel$/,
    exact: true,
  });
  const face = button.locator(".instrument-key-face");
  const base = (await button.boundingBox())!;
  const restingFace = (await face.boundingBox())!;
  const restingOffsetY = restingFace.y - base.y;
  await page.mouse.move(base.x + base.width / 2, base.y + base.height / 2);
  await page.mouse.down();
  await expect
    .poll(async () => (await face.boundingBox())!.y)
    .toBeGreaterThan(restingFace.y + 1);
  expect(await button.boundingBox()).toEqual(base);
  await page.screenshot({ path: info.outputPath("key-held.png") });
  await page.mouse.up();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  // Releasing the key changes the panel layout. Its cap must return to the
  // same position inside the native hit box, even if that box moves afterward.
  await expect
    .poll(
      async () =>
        (await face.boundingBox())!.y - (await button.boundingBox())!.y,
    )
    .toBeLessThan(restingOffsetY + 1);
  await button.focus();
  const keyboardBase = (await button.boundingBox())!;
  const keyboardFace = (await face.boundingBox())!;
  await page.keyboard.down("Space");
  await expect
    .poll(async () => (await face.boundingBox())!.y)
    .toBeGreaterThan(keyboardFace.y + 1);
  expect(await button.boundingBox()).toEqual(keyboardBase);
  await page.keyboard.up("Space");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeDisabled();
  await page.locator(".device-settings-trigger").click();
  const dialog = page.getByRole("dialog", {
    name: "Device details & settings",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath("device-module.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".device-settings-trigger")).toBeFocused();
});

test("native fader follows drag and keyboard values without starting hardware", async ({
  page,
}, info) => {
  await openInstrument(page);
  const slider = page.getByRole("slider", { name: "Volume", exact: true });
  const fader = slider.locator("..");
  const cap = fader.locator(".instrument-range-cap");
  const box = (await fader.boundingBox())!;
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await expect
    .poll(async () => (await cap.boundingBox())!.x)
    .toBeCloseTo(box.x, 0);
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("1");
  await expect
    .poll(
      async () =>
        (await cap.boundingBox())!.x + (await cap.boundingBox())!.width,
    )
    .toBeCloseTo(box.x + box.width, 0);
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue("0.99");
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  await expect(fader).toHaveAttribute("data-gripped", "true");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, {
    steps: 10,
  });
  const value = Number(await slider.inputValue());
  expect(value).toBeGreaterThan(0.2);
  expect(value).toBeLessThan(0.3);
  const capBox = (await cap.boundingBox())!;
  expect(
    Math.abs(capBox.x - (box.x + (box.width - capBox.width) * value)),
  ).toBeLessThan(2);
  await page.mouse.up();
  await expect(fader).not.toHaveAttribute("data-gripped", "true");
  await expect(
    page.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Signal source", exact: true }),
  ).toHaveValue("rtl-sdr");
  await page.screenshot({ path: info.outputPath("receiver-fader.png") });
});

test("material controls respect reduced motion, forced colors and other themes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openInstrument(page);
  const slider = page.getByRole("slider", { name: "Volume", exact: true });
  await expect(page.locator(".instrument-range-cap").first()).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await expect(
    page
      .getByRole("button", {
        name: /^(Collapse|Expand) source panel$/,
        exact: true,
      })
      .locator(".instrument-key-face"),
  ).toHaveCSS("transition-duration", "0s");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(slider).toHaveCSS("opacity", "1");
  await expect(page.locator(".instrument-tabs-indicator").first()).toHaveCSS(
    "display",
    "none",
  );
  await expect(
    page.getByRole("tab", { name: "Receiver", exact: true }),
  ).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await page.emulateMedia({ forcedColors: "none" });
  await page.getByLabel("Settings", { exact: true }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("classic");
  await page.getByLabel("Settings", { exact: true }).click();
  await expect(page.locator(".instrument-key")).toHaveCount(0);
  await expect(page.locator(".instrument-range")).toHaveCount(0);
  await expect(slider).toHaveValue("0");
});

for (const width of [1440, 390]) {
  test(`instrument bays retain usable workspace and dialog geometry at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openInstrument(page);
    for (const view of ["Receiver", "Decoder", "Explorer"]) {
      await page.getByRole("tab", { name: view, exact: true }).click();
      await expect(
        page.getByRole("tabpanel", { name: view, exact: true }),
      ).toBeVisible();
      if (view === "Receiver") {
        const plot = (await page.locator(".canvas-frame").boundingBox())!;
        const details = (await page
          .getByRole("button", { name: "FFT & display details", exact: true })
          .boundingBox())!;
        expect(details.x).toBeGreaterThan(plot.x + plot.width / 2);
        expect(details.y).toBeGreaterThan(plot.y + plot.height / 2);
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBe(width);
      await page.screenshot({
        path: info.outputPath(`${view.toLowerCase()}-${width}.png`),
      });
    }
  });
}

for (const width of [1440, 820, 390, 320]) {
  test(`sliding selectors keep the cap aligned and native tabs usable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openInstrument(page);
    const statusOverflow = await page
      .locator(".receiver-status-label")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(statusOverflow).toBeLessThanOrEqual(1);
    const matchSelectedCap = async (name: string) => {
      const rail = page.getByRole("tablist", { name, exact: true });
      const cap = rail.locator(".instrument-tabs-indicator");
      const selected = rail.locator('[role="tab"][aria-selected="true"]');
      await expect
        .poll(async () => {
          const a = (await cap.boundingBox())!;
          const b = (await selected.boundingBox())!;
          return Math.max(
            Math.abs(a.x - b.x),
            Math.abs(a.y - b.y),
            Math.abs(a.width - b.width),
            Math.abs(a.height - b.height),
          );
        })
        .toBeLessThan(1.1);
      await expect(selected).toBeVisible();
      expect(await rail.locator(".instrument-tabs-indicator").count()).toBe(1);
    };
    for (const name of ["Decoder", "Explorer", "Receiver"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await matchSelectedCap("BrowserSDR views");
    }
    const views = page.getByRole("tablist", {
      name: "BrowserSDR views",
      exact: true,
    });
    await views.getByRole("tab", { name: "Receiver", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(
      views.getByRole("tab", { name: "Explorer", exact: true }),
    ).toBeFocused();
    await matchSelectedCap("BrowserSDR views");
    await page.keyboard.press("Home");
    await expect(
      views.getByRole("tab", { name: "Receiver", exact: true }),
    ).toBeFocused();
    await matchSelectedCap("BrowserSDR views");
    for (const name of [
      "Capture & replay",
      "Watch",
      "Session",
      "Audio & decode",
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await matchSelectedCap("Receiver tool panels");
    }
    await page.getByLabel("Settings", { exact: true }).click();
    const key = page.getByLabel("Settings", { exact: true });
    const baseOffset = await key.evaluate((element) => {
      const base = getComputedStyle(element, "::after");
      return { transform: base.transform, top: parseFloat(base.top) };
    });
    expect(baseOffset.transform).toBe("none");
    expect(baseOffset.top).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(key).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await page.screenshot({
      path: info.outputPath(`sliding-selector-${width}.png`),
      fullPage: true,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(views.locator(".instrument-tabs-indicator")).toHaveCSS(
      "transition-duration",
      "0s",
    );
  });
}

// Lazy launchers must not silently fall back to the older native-button skin.
test("Search and Favorites retain the same key finish after opening and closing their lazy panels", async ({
  page,
}, info) => {
  await openInstrument(page);
  const finish = async (selector: string) =>
    page.locator(selector).evaluate((element) => ({
      cap: getComputedStyle(element, "::before").backgroundImage,
      bevel: getComputedStyle(element, "::before").boxShadow,
      edge: getComputedStyle(element, "::before").borderColor,
      base: getComputedStyle(element, "::after").boxShadow,
      legend: getComputedStyle(element.querySelector(".instrument-key-face")!)
        .color,
    }));
  const standard = await finish(".device-settings-trigger");
  for (const [name, dialogName, selector] of [
    ["Search", "Search stations & signals", ".discovery-trigger"],
    ["Favorites 0", "Favorites", ".favorite-launcher, .favorites-trigger"],
  ]) {
    const launcher = page.getByRole("button", { name: name!, exact: true });
    const before = (await launcher.boundingBox())!;
    await expect(launcher.locator(".instrument-key-face")).toHaveCount(1);
    expect(await finish(selector!)).toEqual(standard);
    for (let visit = 0; visit < 2; visit++) {
      await launcher.click();
      const dialog = page.getByRole("dialog", {
        name: dialogName!,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(launcher).toBeFocused();
      await expect(launcher.locator(".instrument-key-face")).toHaveCount(1);
      expect(await finish(selector!)).toEqual(standard);
      const after = (await launcher.boundingBox())!;
      expect(Math.abs(after.width - before.width)).toBeLessThan(1);
      expect(Math.abs(after.height - before.height)).toBeLessThan(1);
    }
  }
  await page.screenshot({
    path: info.outputPath("utility-keys-after-open.png"),
  });
});
