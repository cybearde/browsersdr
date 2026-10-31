import { expect, test } from "@playwright/test";

// New full-DSP workflows include acquisition plus multiple viewport/favorite/detail actions.
// Existing Radio Apps/Decoder/header case deadlines remain unchanged.
test.describe.configure({ timeout: 60_000 });
import {
  installSource,
  launch,
  start,
  expectAppFits,
} from "./radio-app-fixture";
import { packetRecordingFixture } from "../src/testing/packetRecordingFixture";
import {
  acarsRadioAppFixture,
  fmRadioAppFixture,
  sensorRadioAppFixture,
} from "../src/testing/radioAppSignalFixture";

for (const name of [
  "FM Radio",
  "APRS",
  "Weather Balloons",
  "Aircraft Messages",
  "Weather Sensors",
]) {
  test(`${name} opens passively and fits before reception`, async ({
    page,
  }) => {
    await installSource(page);
    await page.goto("/?browser-test=1");
    await launch(page, name);
    await expectAppFits(page);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { radioAppsFixture: { opens: number } })
            .radioAppsFixture.opens,
      ),
    ).toBe(0);
  });
}
test("FM plays generated RF/RDS and saves shared Favorites", async ({
  page,
}) => {
  await installSource(
    page,
    Buffer.from(fmRadioAppFixture()).toString("base64"),
    100e6,
  );
  await page.goto("/?browser-test=1");
  await launch(page, "FM Radio");
  await start(page);
  const player = page.getByRole("region", { name: "FM radio player" });
  await expect(player).toContainText("TEST FM", { timeout: 15000 });
  await expectAppFits(page);
  await player.locator(".radio-app-favourites > summary").click();
  await player
    .getByRole("textbox", { name: "Favourite name" })
    .fill("My test FM");
  await player.getByRole("button", { name: "Save FM favourite" }).click();
  await expect(
    player.getByRole("combobox", { name: "Saved FM station" }),
  ).toContainText("My test FM");
  await player.locator(".radio-app-favourites > summary").click();
  await player.getByRole("button", { name: "Step up", exact: true }).click();
  await player.locator(".radio-app-favourites > summary").click();
  await player
    .getByRole("combobox", { name: "Saved FM station" })
    .selectOption({ label: "My test FM · 100 MHz" });
  await player.getByRole("button", { name: "Recall FM favourite" }).click();
  await expect(player.getByRole("heading")).toContainText("100.00");

  await page
    .getByRole("region", { name: "Active Radio App" })
    .getByRole("button", { name: "Stop receiving" })
    .click();
});
test("FM tuning and seek cancellation preserve the selected channel", async ({
  page,
}) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  await launch(page, "FM Radio");
  await start(page);
  const player = page.getByRole("region", { name: "FM radio player" });
  await player.getByRole("button", { name: "Step up", exact: true }).click();
  await expect(player.getByRole("heading")).toContainText("100.10");
  await player.getByRole("button", { name: "Seek up", exact: true }).click();
  await page
    .getByRole("region", { name: "Active Radio App" })
    .getByRole("button", { name: "Cancel search", exact: true })
    .click();
  await expect(player.getByRole("heading")).toContainText("100.10");
  await page
    .getByRole("region", { name: "Active Radio App" })
    .getByRole("button", { name: "Stop receiving" })
    .click();
});
for (const [name, mode] of [
  ["APRS", "APRS"],
  ["Weather Balloons", "RS41"],
] as const) {
  test(`${name} displays actual generated packets and preserves return navigation`, async ({
    page,
  }) => {
    const fixture = packetRecordingFixture(mode, 1_024_000, 0);
    await installSource(
      page,
      Buffer.from(fixture.data).toString("base64"),
      mode === "APRS" ? 144.8e6 : 402e6,
    );
    await page.goto("/?browser-test=1");
    await launch(page, name);
    await start(page);
    await expect(page.locator(".decoder-record-list")).toContainText(
      mode === "APRS" ? "N0CALL-1" : "K1930293",
      { timeout: 15000 },
    );
    await expect(page.locator(".decoder-map svg.map-overlay")).toBeVisible();
    if (mode === "APRS") {
      await page
        .getByRole("combobox", { name: "APRS view" })
        .selectOption("packets");
      await expect(page.locator(".decoder-record-list")).toContainText(
        "literal text",
      );
      expect(await page.locator("#decoder-view script").count()).toBe(0);
      await page
        .getByRole("combobox", { name: "APRS view" })
        .selectOption("stations");
    }
    await expectAppFits(page);
    await page
      .getByRole("region", { name: "Active Radio App" })
      .getByRole("button", { name: "Receiver settings" })
      .click();
    await page.getByRole("button", { name: `Return to ${name}` }).click();
    await expect(
      page.getByRole("region", { name: "Active Radio App" }),
    ).toContainText("Receiving");
    if (mode === "RS41") {
      await page.locator(".radio-app-tools > summary").click();
      await page
        .getByRole("spinbutton", { name: "Search to (MHz)" })
        .fill("402");
      await page
        .getByRole("button", { name: "Find balloon", exact: true })
        .click();
      await expect(
        page.locator(".radio-app-popover [role=status]"),
      ).toContainText("Validated RS41 identity", { timeout: 15000 });
      await page.locator(".radio-app-tools > summary").click();
    }
    await page
      .getByRole("region", { name: "Active Radio App" })
      .getByRole("button", { name: "Stop receiving" })
      .click();
  });
}
test("Aircraft Messages accepts generated ACARS, filters safe text and exports retained messages", async ({
  page,
}) => {
  await installSource(
    page,
    Buffer.from(acarsRadioAppFixture()).toString("base64"),
    131.725e6,
  );
  await page.goto("/?browser-test=1");
  await launch(page, "Aircraft Messages");
  await start(page);
  await expect(page.locator(".decoder-record-list")).toContainText(
    "TEST FLIGHT",
    { timeout: 15000 },
  );
  expect(await page.locator("#decoder-view script").count()).toBe(0);
  await page.getByRole("searchbox", { name: "Filter results" }).fill("N123AB");
  await expect(page.locator(".decoder-record-list")).toContainText(
    "TEST FLIGHT",
  );
  await expectAppFits(page);
  await page.locator(".decoder-export-menu > summary").click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export retained results", exact: true })
    .click();
  const { readFile } = await import("node:fs/promises");
  const exported = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(exported.records.length).toBeGreaterThan(0);
  expect(exported.records.length).toBeLessThanOrEqual(16);
  expect(exported.records[0].summary).toContain("<script>literal</script>");
  await page.locator(".decoder-record-list button").first().click();
  await expect(
    page.getByRole("complementary", { name: "Selected decoded record" }),
  ).toContainText("literal");
});
for (const [protocol, id, value] of [
  ["fineoffset-wh2", "d1", "24.6"],
  ["acurite-592txr", "2f15", "26.7"],
  ["fineoffset-wh51", "00c4f2", "0%"],
] as const) {
  test(`Weather Sensors ${protocol} shows validated readings, units and bounded history`, async ({
    page,
  }) => {
    await installSource(
      page,
      Buffer.from(sensorRadioAppFixture(protocol)).toString("base64"),
      433.92e6,
    );
    await page.goto("/?browser-test=1");
    await page.getByRole("button", { name: "Radio Apps", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Radio Apps",
      exact: true,
    });
    await dialog
      .locator("article")
      .filter({
        has: page.getByRole("heading", {
          name: "Weather Sensors",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Open app" })
      .click();
    await dialog
      .getByRole("combobox", { name: "Sensor family" })
      .selectOption(protocol);
    await dialog.getByRole("button", { name: "Use settings & open" }).click();
    await expect(dialog).toBeHidden();
    await start(page);
    const output = page.getByRole("region", {
      name: "Weather sensor readings",
    });
    await expect(output).toContainText(id, { timeout: 15000 });
    await expect(output).toContainText(value);
    await expectAppFits(page);
    await output.getByRole("button", { name: "Reading history" }).click();
    await expect(
      output.getByRole("navigation", { name: "Reading history pages" }),
    ).toBeVisible();
    await expect(output).toContainText("input samples");
    await expectAppFits(page);
  });
}
