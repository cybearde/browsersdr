import { expect, test, type Page } from "@playwright/test";
import {
  installSource,
  launch,
  start,
  expectAppFits,
} from "./radio-app-fixture";

// Each review case covers multiple navigation/transport states and six viewports.
// Existing cases keep their original deadlines and assertions.
test.describe.configure({ timeout: 60_000 });
const apps = [
  "Track aircraft",
  "Track ships",
  "Listen to DAB+",
  "FM Radio",
  "APRS",
  "Weather Balloons",
  "Aircraft Messages",
  "Weather Sensors",
];
const fixture = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          radioAppsFixture: {
            opens: number;
            starts: number;
            centers: number[];
          };
        }
      ).radioAppsFixture,
  );
for (const name of apps) {
  test(`${name}: app and Receiver transport agree across return navigation and restart`, async ({
    page,
  }) => {
    await installSource(page);
    await page.goto("/?browser-test=1");
    await launch(page, name);
    const app = page.getByRole("region", { name: "Active Radio App" });
    await expect(app.getByRole("heading", { name, exact: true })).toBeFocused();
    expect((await fixture(page)).opens).toBe(0);
    await start(page);
    await expect(app).toContainText("Receiving");
    const receiving = await fixture(page);
    await app.locator(".radio-app-tools > summary").click();
    await app
      .getByRole("button", { name: "App setup", exact: true })
      .press("Escape");
    await expect(app.locator(".radio-app-tools")).not.toHaveAttribute(
      "open",
      "",
    );
    await expect(app.locator(".radio-app-tools > summary")).toBeFocused();
    await app
      .getByRole("button", { name: "Receiver settings", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Receiver", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("button", { name: `Return to ${name}`, exact: true })
      .click();
    await expect(app.getByRole("heading", { name, exact: true })).toBeFocused();
    expect(await fixture(page)).toEqual(receiving);
    await app
      .getByRole("button", { name: "Receiver settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Stop receiving", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Return to ${name}`, exact: true })
      .click();
    await expect(
      app.getByRole("button", { name: "Start receiving", exact: true }),
    ).toBeEnabled();
    await start(page);
    await app
      .getByRole("button", { name: "Stop receiving", exact: true })
      .click();
    await expect(
      app.getByRole("button", { name: "Start receiving", exact: true }),
    ).toBeEnabled();
    expect((await fixture(page)).starts).toBe(2);
    await expectAppFits(page);
  });
}
test("switching all eight stopped apps preserves the original setup and Restore stays passive", async ({
  page,
}) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  for (const name of apps) await launch(page, name);
  const app = page.getByRole("region", { name: "Active Radio App" });
  await app.locator(".radio-app-tools > summary").click();
  await app
    .getByRole("button", { name: "Restore previous setup", exact: true })
    .click();
  await expect(app).toHaveCount(0);
  await expect(page.locator(".radio-app-shortcut")).toHaveCount(0);
  await page.getByRole("tab", { name: "Receiver", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("WBFM");
  await expect(
    page.getByRole("spinbutton", { name: "Channel frequency", exact: true }),
  ).toHaveValue("100.000");
  expect((await fixture(page)).opens).toBe(0);
  expect((await fixture(page)).starts).toBe(0);
});
test("catalog, setup, Escape and Receiver handoffs preserve keyboard focus", async ({
  page,
}) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  const trigger = page.getByRole("button", { name: "Radio Apps", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Radio Apps", exact: true });
  await dialog
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "Weather Sensors", exact: true }),
    })
    .getByRole("button", { name: "Open app" })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Weather Sensors", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "All Radio Apps", exact: true })
    .click();
  await expect(
    dialog.getByRole("searchbox", { name: "Find a radio app" }),
  ).toBeFocused();
  await dialog.getByRole("searchbox").press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "FM Radio", exact: true }),
    })
    .getByRole("button", { name: "Open app" })
    .click();
  await dialog
    .getByRole("button", { name: "Receiver settings", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeFocused();
  expect((await fixture(page)).opens).toBe(0);
});
test("a cancelled permission request stays stopped after its late completion", async ({
  page,
}) => {
  await installSource(page, "", 0, { permissionDelayMs: 1500 });
  await page.goto("/?browser-test=1");
  await launch(page, "FM Radio");
  const app = page.getByRole("region", { name: "Active Radio App" });
  await app
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await app.getByRole("button", { name: "Cancel start", exact: true }).click();
  await expect(
    app.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeEnabled();
  // Observe beyond the controlled permission delay without issuing another Start.
  await expect.poll(async () => (await fixture(page)).opens).toBe(1);
  await page.waitForTimeout(1700);
  await expect(
    app.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeEnabled();
  expect((await fixture(page)).starts).toBe(0);
  await expect(app.getByRole("alert")).toHaveCount(0);
});
test("a permission failure is visible and supports an explicit retry", async ({
  page,
}) => {
  await installSource(page, "", 0, { openFailures: 1 });
  await page.goto("/?browser-test=1");
  await launch(page, "APRS");
  const app = page.getByRole("region", { name: "Active Radio App" });
  await app
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(app.getByRole("alert")).toContainText("permission cancelled");
  await expect(app).toContainText("Receiver error");
  await start(page);
  await expect(app.getByRole("alert")).toHaveCount(0);
  await app
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
});
test("custom FM settings explain the disabled controls and setup repairs them", async ({
  page,
}) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  await launch(page, "FM Radio");
  const app = page.getByRole("region", { name: "Active Radio App" });
  await app
    .getByRole("button", { name: "Receiver settings", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Channel frequency", exact: true })
    .fill("101.1");
  await page
    .getByRole("spinbutton", { name: "Channel frequency", exact: true })
    .press("Tab");
  await page
    .getByRole("button", { name: "Return to FM Radio", exact: true })
    .click();
  await expect(app).toContainText("Custom setup");
  await expect(app).toContainText("Open App setup");
  await expect(
    app.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Tune FM", exact: true }),
  ).toBeDisabled();
  await app.locator(".radio-app-tools > summary").click();
  await app.getByRole("button", { name: "App setup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Radio Apps", exact: true });
  await dialog
    .getByRole("button", { name: "Use settings & open", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    app.getByRole("button", { name: "Start receiving", exact: true }),
  ).toBeEnabled();
  expect((await fixture(page)).starts).toBe(0);
});
test.describe("coarse pointer app controls", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  for (const name of ["FM Radio", "Weather Sensors"]) {
    test(`${name} retains usable touch targets and a fitted primary view`, async ({
      page,
    }) => {
      await installSource(page);
      await page.goto("/?browser-test=1");
      await launch(page, name);
      await expect
        .poll(() =>
          page
            .locator(".radio-app-view button:visible")
            .evaluateAll((buttons) =>
              buttons
                .filter((b) => b.getBoundingClientRect().height < 44)
                .map((b) => b.textContent),
            ),
        )
        .toEqual([]);
      await expectAppFits(page);
    });
  }
});
