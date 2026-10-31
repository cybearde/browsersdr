import {
  openDisplaySettings,
  closeDisplaySettings,
} from "./display-settings-navigation";
import {
  openApplicationView,
  chooseReceiverMode,
} from "./application-navigation";
import { expect, test } from "@playwright/test";

test("desktop receiver fills the window with all primary panels in view", async ({
  page,
}) => {
  await page.goto("/");
  for (const viewport of [
    { width: 1181, height: 900 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByLabel("Settings", { exact: true }).click();
    await page
      .getByRole("button", { name: "Reset layout", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        })),
      )
      .toEqual(viewport);
    const shell = (await page.locator(".app-shell").boundingBox())!;
    expect(shell.width).toBe(viewport.width - 24);
    for (const selector of [
      ".app-topbar",
      ".acquire-stage",
      ".demodulate-stage",
      ".graphics-panel",
      ".receiver-status-menu",
      ".receiver-dock",
    ]) {
      const panel = page.locator(selector);
      const box = (await panel.boundingBox())!;
      expect(box.y, selector).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
      // Optional settings may scroll internally; primary controls stay in view.
      if (
        selector === ".acquire-stage" ||
        selector === ".demodulate-stage" ||
        selector === ".graphics-panel"
      ) {
        expect(
          await panel.evaluate(
            (element) => getComputedStyle(element).overflowY,
          ),
        ).toBe("auto");
        if (selector !== ".graphics-panel")
          await expect(panel.locator("select").first()).toBeInViewport();
        else
          expect(
            (await panel.locator("canvas").boundingBox())!.height,
          ).toBeGreaterThanOrEqual(viewport.height < 900 ? 120 : 1);
      } else {
        expect(
          await panel.evaluate(
            (element) => element.scrollHeight <= element.clientHeight + 1,
          ),
          selector,
        ).toBe(true);
      }
    }
  }
  const plot = page.locator(".graphics-panel canvas");
  const large = (await plot.boundingBox())!;
  await page.setViewportSize({ width: 1920, height: 1080 });
  const smaller = (await plot.boundingBox())!;
  expect(large.width).toBeGreaterThan(smaller.width);
  expect(large.height).toBeGreaterThan(smaller.height);
  await page.getByRole("button", { name: "Collapse", exact: true }).click();
  expect((await plot.boundingBox())!.height).toBeGreaterThan(smaller.height);
});

test("desktop keeps expanded tools reachable and utilities in their own scroll layer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  const record = page.getByRole("button", { name: "Start I/Q recording" });
  await record.scrollIntoViewIfNeeded();
  await expect(record).toBeInViewport();
  await openDisplaySettings(page);
  expect(
    (await page.locator(".graphics-panel canvas").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(120);
  for (const toggle of await page
    .locator('.display-settings input[type="checkbox"]')
    .all()) {
    // The transparent input covers the label; measure the visible switch itself.
    await expect(toggle).toHaveCSS("opacity", "0");
    const track = toggle.locator("xpath=following-sibling::*[1]");
    await expect(track).toHaveClass("receiver-switch-track");
    const box = (await track.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(24);
    expect(box.height).toBeLessThanOrEqual(24);
  }
  await closeDisplaySettings(page);
  await page
    .getByRole("button", { name: "FFT & display details", exact: true })
    .click();
  const details = page.locator(".spectrum-info-panel .display-note").last();
  await details.scrollIntoViewIfNeeded();
  await expect(details).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    900,
  );
  await openApplicationView(page, "Help");
  await expect(page.locator(".app-shell")).toHaveClass(/receiver-workspace/);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    900,
  );
  await openApplicationView(page, "Receiver");
  await expect(page.locator(".app-shell")).toHaveClass(/receiver-workspace/);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    900,
  );
});

test("laptop windows fit primary panels and retain reachable internal tools", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 768 });
  await page.goto("/");
  expect((await page.locator(".app-shell").boundingBox())!.width).toBe(1896);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    768,
  );
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  const record = page.getByRole("button", { name: "Start I/Q recording" });
  await record.scrollIntoViewIfNeeded();
  await expect(record).toBeInViewport();
});

test("mobile keeps source and tuning controls before the spectrum and output", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const panels = [
      ".acquire-stage",
      ".demodulate-stage",
      ".graphics-panel",
      ".receiver-dock",
    ];
    const tops: number[] = [];
    for (const selector of panels) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      tops.push(box!.y);
    }
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const toolbar = page.locator(".spectrum-toolbar");
    const pause = toolbar.getByRole("button", { name: "Pause display" });
    await expect(
      toolbar.getByRole("button", { name: "Auto scale", exact: true }),
    ).toBeVisible();
    // Viewport changes can move the whole toolbar between protocol calls.
    // Compare the same layout snapshot, retaining the original 1px tolerance.
    const { outer, inner } = await pause.evaluate((node) => {
      const actions = node.closest(".spectrum-actions");
      if (!actions?.getClientRects().length || !node.getClientRects().length)
        throw new Error("Spectrum actions and pause control must be laid out");
      const outer = actions.getBoundingClientRect();
      const inner = node.getBoundingClientRect();
      return {
        outer: { y: outer.y, height: outer.height },
        inner: { y: inner.y, height: inner.height },
      };
    });
    expect(
      Math.abs(
        inner.y - outer.y - (outer.y + outer.height - inner.y - inner.height),
      ),
    ).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("dialog", { name: "Display settings", exact: true }),
    ).toBeHidden();
  }
});

test("recording tabs support keyboard navigation and keep replay separate", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  const record = page.getByRole("tab", { name: "Record", exact: true });
  const open = page.getByRole("tab", { name: "Open recording", exact: true });
  await expect(record).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".recording-state")).toContainText(
    "Start reception before recording",
  );
  await expect(
    page.getByRole("button", { name: "Download ZIP" }),
  ).not.toBeVisible();
  await record.focus();
  await page.keyboard.press("ArrowRight");
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Open example recording" }),
  ).toBeVisible();
  await page.keyboard.press("Home");
  await expect(record).toBeFocused();
  await expect(page.locator("#record-panel")).toBeVisible();
});

test("receiver tools support arrow keys, Home and End even when collapsed", async ({
  page,
}) => {
  await page.goto("/");
  const audio = page.getByRole("tab", { name: "Audio & decode", exact: true });
  const capture = page.getByRole("tab", {
    name: "Capture & replay",
    exact: true,
  });
  const session = page.getByRole("tab", { name: "Session", exact: true });
  await page.getByRole("button", { name: "Collapse", exact: true }).click();
  await audio.focus();
  await page.keyboard.press("ArrowRight");
  await expect(capture).toBeFocused();
  await expect(capture).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#capture-panel")).toBeVisible();
  await page.keyboard.press("End");
  await expect(session).toBeFocused();
  await expect(page.locator("#session-panel")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(audio).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(session).toBeFocused();
  await expect(audio).toHaveAttribute("tabindex", "-1");
});

test("unavailable actions explain prerequisites and readiness reflects connection", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  const recording = page.getByRole("button", {
    name: "Start I/Q recording",
    exact: true,
  });
  await expect(recording).toBeDisabled();
  await recording.locator("..").focus();
  await expect(
    page.getByRole("tooltip", { name: "Start reception before recording." }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Explorer", exact: true }).click();
  await expect(page.locator(".explorer-heading .status-pill")).toHaveText(
    "Connect receiver",
  );
  await page
    .getByRole("button", { name: "Resume", exact: true })
    .locator("..")
    .focus();
  await expect(
    page.getByRole("tooltip", { name: "Pause a scan before resuming it." }),
  ).toBeVisible();
  await openApplicationView(page, "Diagnostics");
  await expect(page.locator(".receiver-health")).toContainText(
    "Connect a receiver to record",
  );
  await page
    .getByRole("button", { name: "Create diagnostic report", exact: true })
    .click();
  const textarea = page.getByRole("dialog").locator("textarea").first();
  await expect(textarea).toBeVisible();
  expect(
    await textarea.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe("rgb(255, 255, 255)");
});

test("SRD choices are primary controls and hardware details have one home", async ({
  page,
}) => {
  await page.goto("/");
  await chooseReceiverMode(page, "SRD");
  await expect(page.locator(".mode-primary-controls")).toBeVisible();
  await expect(page.locator(".mode-primary-controls select")).toHaveCount(2);
  await expect(page.locator(".channel-advanced-settings")).not.toHaveAttribute(
    "open",
  );
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
  await expect(page.locator(".receiver-status-menu")).not.toHaveAttribute(
    "open",
  );
  await page.getByRole("tab", { name: "Session", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Session details", exact: true }),
  ).toBeVisible();
  await page.getByText("Hardware & signal details", { exact: true }).click();
  await expect(page.locator(".receiver-session-details p")).toBeVisible();
  await expect(page.locator(".receiver-session-details p")).toContainText(
    "Precise center",
  );
});

test("prerequisite hints stay inside the viewport and dismiss with Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page.getByRole("tab", { name: "Open recording", exact: true }).click();
  await page
    .getByRole("button", { name: "Load files", exact: true })
    .locator("..")
    .focus();
  const hint = page.getByRole("tooltip", {
    name: "Choose both the I/Q data file and its metadata file.",
  });
  await expect(hint).toBeVisible();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(async () => {
        const box = await hint.boundingBox();
        return Boolean(
          box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width &&
          box.y + box.height <= 900,
        );
      })
      .toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(hint).not.toBeVisible();
});

test("all application views fit narrow screens without page-wide overflow", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of [
      "Receiver",
      "Explorer",
      "Diagnostics",
      "Help",
      "Compatibility",
      "About",
    ] as const) {
      await openApplicationView(page, view);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBe(width);
    }
  }
});

test("legacy layout migrates and dock toggles persist across reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("layout-seeded")) {
      localStorage.setItem(
        "browsersdr.workspace.v1",
        JSON.stringify({ compact: false, dockLarge: true, dockExpanded: true }),
      );
      localStorage.setItem("layout-seeded", "yes");
    }
  });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveClass(/density-compact/);
  await expect(
    page.getByRole("button", { name: "Compact", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Less space|More space)$/ }),
  ).toHaveCount(0);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Collapse", exact: true }).click();
    await expect(page.locator(".receiver-dock")).toHaveClass(/is-collapsed/);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Expand", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await page
      .getByRole("tab", { name: "Capture & replay", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Collapse", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Collapse", exact: true }).click();
    await page.getByRole("button", { name: "Expand", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Start I/Q recording" }),
    ).toBeVisible();
  }
});
