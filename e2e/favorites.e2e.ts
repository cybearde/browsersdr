import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("compact view and panel choices persist, enlarge the plot and reset", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  const plot = page.locator(".graphics-panel");
  const original = (await plot.boundingBox())!;
  await page.getByRole("button", { name: "Compact", exact: true }).click();
  expect((await plot.boundingBox())!.width).toBeGreaterThan(original.width);
  expect(
    (await plot.locator("canvas").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(120);
  await page
    .getByRole("button", { name: "Collapse source panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse channel panel", exact: true })
    .click();
  expect((await plot.boundingBox())!.width).toBeGreaterThan(
    original.width + 350,
  );
  await expect(
    page.getByRole("combobox", { name: "Signal source", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Expand source panel" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collapse", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Compact", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Expand source panel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Expand", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    768,
  );
  await page.getByLabel("Settings", { exact: true }).click();
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Signal source", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compact", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  for (const width of [820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page
      .getByRole("button", { name: "Collapse source panel", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Expand source panel" }),
    ).toBeVisible();
    await page.getByLabel("Settings", { exact: true }).click();
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
  }
});

test("favorites save, edit, search, reorder, recall and round trip JSON without starting reception", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  const panel = page.getByRole("dialog", { name: "Favorites", exact: true });
  await page.getByRole("button", { name: /^Favorites/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    1440,
  );
  for (const [name, frequency, tag] of [
    ["Local FM", "101.1", "local"],
    ["Second", "99.5", "travel"],
  ]) {
    await panel.getByRole("button", { name: "Save current channel" }).click();
    await panel.getByLabel("Favorite name", { exact: true }).fill(name!);
    await panel
      .getByLabel("Favorite frequency (MHz)", { exact: true })
      .fill(frequency!);
    await panel.getByLabel("Tags (comma separated)").fill(tag!);
    await panel
      .getByRole("button", { name: "Save favorite", exact: true })
      .click();
  }
  await panel.getByText("Details & order for Second", { exact: true }).click();
  await panel
    .getByRole("button", { name: "Move Second up", exact: true })
    .click();
  expect(await panel.locator("li strong").allTextContents()).toEqual([
    "Second",
    "Local FM",
  ]);
  await panel.getByLabel("Search favorites").fill("local");
  await expect(panel.locator("li")).toHaveCount(1);
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Favorite notes", exact: true })
    .fill("Personal reception note");
  await panel
    .getByRole("button", { name: "Save favorite", exact: true })
    .click();
  await panel.getByLabel("Search favorites").fill("");
  await page.reload();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  expect(await panel.locator("li strong").allTextContents()).toEqual([
    "Second",
    "Local FM",
  ]);
  await expect(panel).toContainText("Personal reception note");
  await panel
    .getByRole("button", { name: "Recall Local FM", exact: true })
    .click();
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue("101.100");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: /^Favorites/ })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Start demo", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await expect(panel).toContainText("Start remains manual.");
  const downloadEvent = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Export favorites" }).click();
  const download = await downloadEvent;
  const path = testInfo.outputPath("favorites.json");
  await download.saveAs(path);
  const backup = await readFile(path, "utf8");
  expect(JSON.parse(backup).bookmarks).toHaveLength(2);
  expect(backup).not.toMatch(/token|password/);
  await panel
    .getByText("Details & order for Local FM", { exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Delete Local FM", exact: true })
    .click();
  await panel.getByLabel("Favorite backup file").setInputFiles(path);
  await expect(panel.locator("li")).toHaveCount(2);
  const before = await page.evaluate(() =>
    localStorage.getItem("browsersdr.bookmarks.v1"),
  );
  await panel.getByLabel("Favorite backup file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schema":"future","bookmarks":[]}'),
  });
  await expect(panel).toContainText("Unsupported favorite backup version.");
  expect(
    await page.evaluate(() => localStorage.getItem("browsersdr.bookmarks.v1")),
  ).toBe(before);
  await panel.getByLabel("Favorite backup file").setInputFiles(path);
  await expect(panel.locator("li")).toHaveCount(2);
});

test("unreadable favorites are preserved until explicit valid backup restoration", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("browsersdr.bookmarks.v1", "invalid prior data"),
  );
  await page.goto("/");
  const panel = page.getByRole("dialog", { name: "Favorites", exact: true });
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await expect(panel).toContainText(
    "Existing browser data has been preserved.",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("browsersdr.bookmarks.v1")),
  ).toBe("invalid prior data");
  await panel.getByLabel("Favorite backup file").setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schema: "browsersdr-bookmarks-v1",
        bookmarks: [
          {
            id: "00000000-0000-4000-8000-000000000002",
            name: "Restored",
            frequencyHz: 100e6,
            settings: { mode: "WBFM", bandwidthHz: 150000, squelch: 0 },
            tags: [],
            notes: "",
          },
        ],
      }),
    ),
  });
  await expect(
    panel.getByRole("button", { name: "Recall Restored" }),
  ).toBeVisible();
  await expect(panel).not.toContainText(
    "Existing browser data has been preserved.",
  );
});

test("favorites overlay traps focus, preserves unfinished edits and returns to tuning", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: /^Favorites/ });
  const panel = page.getByRole("dialog", { name: "Favorites", exact: true });
  await expect(panel).toBeHidden();
  const tune = (await page
    .getByRole("button", { name: "Tune", exact: true })
    .boundingBox())!;
  expect((await trigger.boundingBox())!.y).toBeGreaterThanOrEqual(
    tune.y + tune.height,
  );
  await page
    .getByRole("group", { name: "Fine-tune signal", exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await trigger.click();
  await expect(panel.getByLabel("Search favorites")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    panel.getByRole("button", { name: "Close Favorites" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    panel.getByRole("button", { name: "Import favorites" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    panel.getByRole("button", { name: "Close Favorites" }),
  ).toBeFocused();
  await panel.getByRole("button", { name: "Save current channel" }).click();
  await panel
    .getByLabel("Favorite name", { exact: true })
    .fill("Unfinished edit");
  await panel
    .getByRole("textbox", { name: "Favorite notes", exact: true })
    .fill("Keep this draft when dismissed.");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(panel.getByLabel("Favorite name", { exact: true })).toHaveValue(
    "Unfinished edit",
  );
  await expect(
    panel.getByRole("textbox", { name: "Favorite notes", exact: true }),
  ).toHaveValue("Keep this draft when dismissed.");
  await panel
    .getByRole("button", { name: "Save favorite", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Recall Unfinished edit" }),
  ).toBeVisible();
  await page.mouse.click(0, 0);
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Collapse channel panel" }).click();
  await expect(trigger).toBeHidden();
  await page.getByRole("button", { name: "Expand channel panel" }).click();
  await trigger.click();
  await expect(
    panel.getByRole("button", { name: "Recall Unfinished edit" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Close Favorites" }).click();
  await expect(trigger).toBeFocused();
});

test.describe("touch layout", () => {
  test.use({ hasTouch: true });
  test("large favorites overlay keeps actions reachable on desktop and narrow touch screens", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "browsersdr.bookmarks.v1",
        JSON.stringify({
          schema: "browsersdr-bookmarks-v1",
          bookmarks: Array.from({ length: 200 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            name: `Favorite ${index + 1} with a long descriptive channel name`,
            frequencyHz: 100e6 + index * 1000,
            settings: { mode: "WBFM", bandwidthHz: 150000, squelch: 0 },
            tags: ["local"],
            notes: "A saved reception note.",
          })),
        }),
      ),
    );
    await page.goto("/");
    const panel = page.getByRole("dialog", { name: "Favorites", exact: true });
    for (const width of [1366, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 640 });
      await page.getByRole("button", { name: /^Favorites/ }).click();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(640);
      expect(
        await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await panel
          .locator(".favorites-body")
          .evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);
      await expect(
        panel.getByRole("button", { name: "Import favorites" }),
      ).toBeInViewport();
      await expect(
        panel.getByRole("button", { name: "Export favorites" }),
      ).toBeInViewport();
      const last = panel.getByRole("button", {
        name: "Recall Favorite 200 with a long descriptive channel name",
        exact: true,
      });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await panel.getByRole("button", { name: "Close Favorites" }).click();
    }
  });
});
