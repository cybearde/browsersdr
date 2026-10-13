import { expect, test } from "@playwright/test";

async function startGuide(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByLabel("Channel frequency", { exact: true }).fill("108.1");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page.locator(".band-guide-strip")).toBeVisible();
}

test("band guide follows accepted RF coordinates and inspection never tunes", async ({
  page,
}) => {
  await startGuide(page);
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  const accepted = await center.inputValue();
  const strip = page.locator(".band-guide-strip");
  const fm = strip.getByRole("button", { name: /^FM broadcast/ });
  const air = strip.getByRole("button", { name: /^Air navigation/ });
  const frame = page.locator(".canvas-frame");
  const before = (await frame.boundingBox())!;
  const bar = (await strip.boundingBox())!;
  expect(bar.height).toBe(20);
  expect(Math.abs(bar.y - before.y - before.height * 0.38)).toBeLessThan(2);
  const fmBounds = (await fm.boundingBox())!;
  await fm.hover();
  expect((await fm.boundingBox())!.y).toBe(fmBounds.y);
  await air.hover();
  expect((await fm.boundingBox())!.y).toBe(fmBounds.y);
  expect((await strip.boundingBox())!.y).toBe(bar.y);
  await page.mouse.move(0, 0);
  expect((await fm.boundingBox())!.y).toBe(fmBounds.y);
  expect(fmBounds.width / bar.width).toBeCloseTo(0.412 / 1.024, 2);
  await air.focus();
  await air.press("Enter");
  const details = page.getByRole("dialog", {
    name: "Air navigation",
    exact: true,
  });
  await expect(details).toBeVisible();
  await expect(details).toContainText("117.975 MHz");
  await expect(center).toHaveValue(accepted);
  await details.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(air).toBeFocused();
  await page
    .getByRole("button", { name: "Pause display", exact: true })
    .click();
  const frozen = await strip.textContent();
  await center.fill("145");
  await expect(strip).toHaveText(frozen!);
  await center.press("Escape");
  await page.getByRole("switch", { name: "Band guide", exact: true }).uncheck();
  await expect(strip).toHaveCount(0);
  await expect(center).toHaveValue(accepted);
  expect((await frame.boundingBox())!.height).toBe(before.height);
  await page.getByRole("switch", { name: "Band guide", exact: true }).check();
  await expect(strip).toBeVisible();
  await page
    .getByRole("button", { name: "Resume display", exact: true })
    .click();
  await page.getByText("Display settings", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Display renderer", exact: true })
    .selectOption("canvas2d");
  await expect(strip).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Display renderer", exact: true }),
  ).toHaveValue("canvas2d");
  await expect(
    strip.getByRole("button", { name: /^FM broadcast/ }),
  ).toBeVisible();
});

test("band guide preference persists and uncovered ranges remain honest", async ({
  page,
}) => {
  await startGuide(page);
  const toggle = page.getByRole("switch", { name: "Band guide", exact: true });
  await page
    .getByRole("combobox", { name: "Band guide plan" })
    .selectOption("general");
  await expect(page.locator(".band-guide-strip")).toHaveText("No guide data");
  await toggle.uncheck();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Band guide plan" }),
  ).toHaveValue("general");
  await expect(page.locator(".band-guide-strip")).toHaveCount(0);
});

test("grouped national profiles persist and their details retain the correct sources", async ({
  page,
}) => {
  await startGuide(page);
  const plan = page.getByRole("combobox", { name: "Band guide plan" });
  await expect(plan.locator("optgroup")).toHaveCount(6);
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  const accepted = await center.inputValue();
  for (const [id, context, source] of [
    [
      "CEPT",
      "Europe (CEPT common)",
      "CEPT / ECO application frequency directory",
    ],
    ["US", "United States", "FCC FM broadcast band"],
    ["CA", "Canada", "ISED FM broadcasting rules"],
    ["FR", "France (metropolitan)", "ANFR TNRBF"],
    ["AU", "Australia", "ACMA Australian Radiofrequency Spectrum Plan"],
    ["NZ", "New Zealand", "RSM Table of Radio Spectrum Usage"],
    ["CN", "China (mainland)", "MIIT Radio Frequency Allocation Provisions"],
    ["BR", "Brazil", "Anatel Frequency Allocation and Destination Plan"],
    ["ZA", "South Africa", "ICASA National Radio Frequency Plan"],
  ]) {
    await plan.selectOption(id!);
    await page
      .getByRole("button", { name: "Band guide details", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Band guide details",
      exact: true,
    });
    await expect(dialog).toContainText(context!);
    await expect(
      dialog.getByRole("link", { name: source!, exact: true }).first(),
    ).toBeVisible();
    await expect(dialog).not.toContainText("German frequency allocation table");
    await expect(dialog).toContainText("does not cover every allocation");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(center).toHaveValue(accepted);
  }
  await plan.selectOption("GB");
  await page.reload();
  await expect(plan).toHaveValue("GB");
});

test("invalid stored profile falls back without treating it as a worldwide plan", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "browsersdr.band-guide.v1",
      JSON.stringify({ enabled: true, plan: "__proto__" }),
    ),
  );
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "Band guide plan" }),
  ).toHaveValue("DE");
});

test("band guide details and controls stay reachable on small touch screens", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await startGuide(page);
  const strip = page.locator(".band-guide-strip");
  expect((await strip.boundingBox())!.height).toBe(44);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .getByRole("combobox", { name: "Band guide plan" })
      .selectOption("CEPT");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page
      .getByRole("button", { name: "Band guide details", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Band guide details",
      exact: true,
    });
    await expect(dialog).toContainText("FM broadcast");
    await expect(dialog).toContainText("Air navigation");
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  await context.close();
});
