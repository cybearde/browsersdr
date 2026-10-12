import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import fixture from "../src/testing/fixtures/atlas/browsersdr-public-station-search-v1.json" with { type: "json" };
const token = "invented-personal-credential-not-for-public-search";
const id = "00000000-0000-4000-8000-000000000001";
async function setup(page: Page, remembered = false) {
  if (remembered)
    await page.addInitScript(
      (token) => localStorage.setItem("browsersdr.atlas.user-token.v1", token),
      token,
    );
  const requests: Array<{ path: string; headers: Record<string, string> }> = [];
  let status = 200,
    malformed = false,
    offline = false,
    changed = false;
  let releaseSlow!: () => void;
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const first = structuredClone(fixture.queries[0]!.response);
  const last = { ...first, items: [first.items[1]!], next_cursor: null };
  await page
    .context()
    .addCookies([
      { name: "personal", value: "invented-session", url: "http://127.0.0.1" },
    ]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    requests.push({
      path: url.pathname + url.search,
      headers: await request.allHeaders(),
    });
    if (!url.pathname.startsWith("/api/v1/public/stations"))
      return route.fulfill({ status: 500, json: { unexpected: true } });
    if (offline) return route.abort("internetdisconnected");
    if (malformed)
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html>SPA fallback</html>",
      });
    if (status !== 200)
      return route.fulfill({
        status,
        headers: { "Retry-After": "1" },
        json: {
          error: {
            code: "synthetic",
            message: "DO NOT DISPLAY private server text",
          },
        },
      });
    if (url.pathname.includes("/stations/")) {
      const detail = structuredClone(fixture.details[id]);
      if (changed) {
        detail.station.publication_version++;
        detail.station.transmissions = [];
      }
      return route.fulfill({ json: detail });
    }
    if (url.searchParams.get("q") === "slow") {
      await slow;
      try {
        await route.fulfill({ json: last });
      } catch {
        /* Caller canceled. */
      }
      return;
    }
    return route.fulfill({
      json:
        url.searchParams.get("q") === "empty"
          ? { ...first, items: [], next_cursor: null }
          : url.searchParams.has("cursor")
            ? last
            : first,
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  const panel = page.getByRole("dialog", { name: "Search stations & signals" });
  const open = async () => {
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(panel).toBeVisible();
  };
  const close = async () => {
    await panel
      .getByRole("button", { name: "Close Search", exact: true })
      .first()
      .click();
    await expect(panel).not.toBeVisible();
  };
  const search = async (query = "energy") => {
    await panel.getByLabel("Search text, frequency or DAB block").fill(query);
    await panel
      .getByRole("button", { name: "Search Atlas", exact: true })
      .click();
  };
  return {
    panel,
    requests,
    errors,
    open,
    close,
    search,
    releaseSlow,
    status: (v: number) => {
      status = v;
    },
    malformed: () => {
      malformed = true;
    },
    offline: () => {
      offline = true;
    },
    changed: () => {
      changed = true;
    },
  };
}
test("public Atlas search needs no account and preserves personal credentials, cookies and manual Start", async ({
  page,
}, info) => {
  const p = await setup(page, true);
  await p.open();
  expect(p.requests).toEqual([]);
  const before = await page
    .getByLabel("Channel frequency", { exact: true })
    .inputValue();
  await p.search();
  await expect(
    p.panel.getByRole("heading", {
      name: "ENERGY Berlin (illustrative)",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.getByLabel("Channel frequency", { exact: true }).inputValue(),
  ).toBe(before);
  await p.panel
    .getByRole("button", { name: "Preview 103.4 MHz", exact: true })
    .click();
  await expect(
    p.panel.getByRole("region", { name: "Receiver preview" }),
  ).toContainText("150,000 Hz bandwidth");
  await p.panel
    .getByRole("button", { name: "Apply to receiver", exact: true })
    .click();
  await expect(p.panel).toContainText("Receiver candidate selected");
  await page.screenshot({ path: info.outputPath("public-search-desktop.png") });
  await p.close();
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue(/^103\.4/);
  await expect(
    page.getByRole("button", { name: "Start demo", exact: true }),
  ).toBeEnabled();
  expect(p.requests).toHaveLength(2);
  for (const request of p.requests) {
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers["x-csrf-token"]).toBeUndefined();
  }
  expect(
    await page.evaluate(() =>
      localStorage.getItem("browsersdr.atlas.user-token.v1"),
    ),
  ).toBe(token);
  expect(
    (await page.context().cookies()).find((c) => c.name === "personal")?.value,
  ).toBe("invented-session");
  expect(p.errors).toEqual([]);
});
test("local ADS aliases, decimal units, UAT status and DAB block previews never start or connect", async ({
  page,
}) => {
  const p = await setup(page);
  await p.open();
  const input = p.panel.getByLabel("Search text, frequency or DAB block");
  await input.fill("ads");
  await expect(
    p.panel.getByRole("heading", { name: "ADS-B / 1090ES", exact: true }),
  ).toBeVisible();
  await expect(p.panel).toContainText("Decoder unavailable in BrowserSDR");
  await p.panel
    .getByRole("button", { name: "Preview ADS-B / 1090ES", exact: true })
    .click();
  await expect(
    p.panel.getByRole("button", { name: "Apply to receiver", exact: true }),
  ).toBeDisabled();
  await p.close();
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("rtl-sdr");
  await p.open();
  await input.fill("ads");
  await p.panel
    .getByRole("button", { name: "Preview ADS-B / 1090ES", exact: true })
    .click();
  await expect(
    p.panel.getByRole("region", { name: "Receiver preview" }),
  ).toContainText("2.4 MS/s");
  await p.panel
    .getByRole("button", { name: "Apply to receiver", exact: true })
    .click();
  await expect(p.panel).toContainText("Start remains manual");
  await input.fill("11C");
  await p.panel
    .getByRole("button", { name: "Preview DAB block", exact: true })
    .click();
  await expect(
    p.panel.getByRole("region", { name: "Receiver preview" }),
  ).toContainText("220.352 MHz");
  await expect(p.panel).toContainText("No programme is selected by search");
  await p.panel
    .getByRole("button", { name: "Apply to receiver", exact: true })
    .click();
  await input.fill("103,4 MHz");
  await expect(p.panel).toContainText("103.4 MHz");
  await p.panel
    .getByRole("button", { name: "Search Atlas", exact: true })
    .click();
  await expect
    .poll(() => p.requests.at(-1)?.path)
    .toContain("min_frequency_hz=103399500&max_frequency_hz=103400500");
  await p.close();
  await expect(
    page.getByRole("button", { name: /^Connect/, exact: false }).first(),
  ).toBeEnabled();
  expect(
    p.requests.every((r) => r.path.startsWith("/api/v1/public/stations")),
  ).toBe(true);
  expect(p.errors).toEqual([]);
});
test("public pages, text/window drafts and stale requests are bounded and explicit", async ({
  page,
}) => {
  const p = await setup(page);
  await p.open();
  await p.search();
  await expect(p.panel.locator(".discovery-station")).toHaveCount(2);
  await p.panel
    .getByRole("button", { name: "Next stations", exact: true })
    .click();
  await expect(p.panel.locator(".discovery-station")).toHaveCount(1);
  expect(p.requests.at(-1)!.path).toContain("cursor=");
  await p.panel
    .getByRole("button", { name: "Previous stations", exact: true })
    .click();
  await expect(p.panel.locator(".discovery-station")).toHaveCount(2);
  await p.search("slow");
  await expect(p.panel).toContainText("Searching public Atlas");
  await p.search("empty");
  p.releaseSlow();
  await expect(p.panel).toContainText("No matching published stations");
  await expect(p.panel.locator(".discovery-station")).toHaveCount(0);
  await p.panel.getByLabel("Interpretation").selectOption("text");
  await p.panel
    .getByText("Optional Atlas frequency window", { exact: true })
    .click();
  await p.panel.getByLabel("Minimum frequency (MHz)").fill("99,5");
  await p.panel.getByLabel("Maximum frequency (MHz)").fill("104");
  await p.close();
  await p.open();
  await expect(p.panel.getByLabel("Minimum frequency (MHz)")).toHaveValue(
    "99,5",
  );
  await expect(p.panel.getByLabel("Interpretation")).toHaveValue("text");
  await expect(
    p.panel.getByLabel("Search text, frequency or DAB block"),
  ).toHaveValue("empty");
  expect(p.errors).toEqual([]);
});
test("changed public references never tune and digital references never offer an analog identity substitute", async ({
  page,
}) => {
  const p = await setup(page);
  await p.open();
  await p.search();
  await expect(p.panel).toContainText(
    "Station handoff unavailable for this declared format",
  );
  await expect(
    p.panel.getByRole("button", { name: "Preview 229.072 MHz", exact: true }),
  ).toHaveCount(0);
  const before = await page
    .getByLabel("Channel frequency", { exact: true })
    .inputValue();
  await p.panel
    .getByRole("button", { name: "Preview 103.4 MHz", exact: true })
    .click();
  p.changed();
  await p.panel
    .getByRole("button", { name: "Apply to receiver", exact: true })
    .click();
  await expect(p.panel).toContainText("changed or was retired");
  await p.close();
  expect(
    await page.getByLabel("Channel frequency", { exact: true }).inputValue(),
  ).toBe(before);
});
test("public unavailable, rate-limit, malformed and offline states never ask for login", async ({
  page,
}) => {
  const p = await setup(page);
  await p.open();
  p.status(429);
  await p.search();
  await expect(p.panel.getByRole("alert")).toContainText(
    "Retry after 1 seconds",
  );
  const count = p.requests.length;
  await p.panel
    .getByRole("button", { name: "Search Atlas", exact: true })
    .click();
  expect(p.requests.length).toBe(count);
  await page.waitForTimeout(1100);
  p.status(503);
  await p.search();
  await expect(p.panel.getByRole("alert")).toContainText("unavailable");
  await page.waitForTimeout(1100);
  p.status(200);
  p.malformed();
  await p.search();
  await expect(p.panel.getByRole("alert")).toContainText("Malformed");
  p.offline();
  await p.search();
  await expect(p.panel.getByRole("alert")).toContainText("unavailable");
  await expect(p.panel).not.toContainText("DO NOT DISPLAY");
  expect(p.requests.every((r) => r.path.startsWith("/api/v1/public/"))).toBe(
    true,
  );
});
test("Search contains keyboard focus, closes by Escape/backdrop, fits 320–390px and preserves navigation", async ({
  page,
}, info) => {
  const p = await setup(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await p.open();
    await expect(
      p.panel.getByLabel("Search text, frequency or DAB block"),
    ).toBeFocused();
    await p.search();
    const controls = p.panel.getByRole("button", {
      name: "Close Search",
      exact: true,
    });
    await controls.last().focus();
    await page.keyboard.press("Tab");
    await expect(controls.first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(controls.last()).toBeFocused();
    const bounds = await p.panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await p.panel.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`public-search-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(p.panel).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Search", exact: true }),
    ).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await p.open();
  await page.mouse.click(2, 2);
  await expect(p.panel).not.toBeVisible();
  await page.getByRole("tab", { name: "Explorer", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Explorer", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Receiver", exact: true }).click();
  await p.open();
  await expect(
    p.panel.getByLabel("Search text, frequency or DAB block"),
  ).toHaveValue("energy");
  expect(p.errors).toEqual([]);
});
test("public station favorites stay local and recall keeps reception stopped", async ({
  page,
}) => {
  const p = await setup(page);
  await p.open();
  await p.search();
  await p.panel
    .getByRole("button", { name: "Save station favorite", exact: true })
    .first()
    .click();
  await p.panel
    .getByRole("combobox", { name: "Show", exact: true })
    .selectOption("favorites");
  await p.panel
    .getByRole("button", {
      name: "Preview favorite ENERGY Berlin (illustrative)",
      exact: true,
    })
    .click();
  await p.panel
    .getByRole("button", { name: "Apply to receiver", exact: true })
    .click();
  await expect(p.panel).toContainText("has not been rechecked");
  await p.close();
  await page.getByRole("button", { name: /^Favorites/ }).click();
  await expect(
    page.locator(".favorites-panel:not(.discovery-panel)"),
  ).toContainText("ENERGY Berlin");
  expect(p.requests).toHaveLength(1);
});
test("public search is passive during recording and preserves capture-start candidate through download", async ({
  page,
}) => {
  test.setTimeout(45000);
  const p = await setup(page);
  await p.open();
  await p.search();
  await p.panel
    .getByRole("button", { name: "Preview 103.4 MHz", exact: true })
    .click();
  await p.panel
    .getByRole("button", { name: "Apply to receiver", exact: true })
    .click();
  await expect(p.panel).toContainText("Receiver candidate selected");
  await p.close();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page.getByLabel("Recording export format").selectOption("sigmf");
  await page
    .getByRole("button", { name: "Start I/Q recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }),
  ).toBeVisible();
  await p.open();
  await p.search();
  await p.panel
    .getByRole("button", { name: "Preview 93.3 MHz", exact: true })
    .click();
  await expect(
    p.panel.getByRole("button", { name: "Apply to receiver", exact: true }),
  ).toBeDisabled();
  await p.close();
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download ZIP", exact: true }),
  ).toBeVisible();
  await p.open();
  await p.search();
  await p.panel
    .getByRole("button", { name: "Preview 93.3 MHz", exact: true })
    .click();
  await expect(
    p.panel.getByRole("button", { name: "Apply to receiver", exact: true }),
  ).toBeDisabled();
  await p.close();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const download = await pending;
  const files = unzipSync(
    new Uint8Array(await readFile((await download.path())!)),
  );
  const metadata = JSON.parse(
    new TextDecoder().decode(
      Object.entries(files).find(([name]) => name.endsWith(".sigmf-meta"))![1],
    ),
  );
  expect(metadata.global["browsersdr:reception"]).toMatchObject({
    source_kind: "synthetic",
    candidate: {
      station_id: id,
      transmission_id: fixture.details[id].station.transmissions[0]!.id,
      bandwidth_hz: 150000,
    },
  });
  expect(p.errors).toEqual([]);
});
