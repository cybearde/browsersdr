import { expect, test, type Page } from "@playwright/test";
import { publicStationFixture as fixture } from "../src/testing/publicStationFixture";
const header = { ...fixture.selected, transmission_count: 61 };
const { transmissions: unused, ...station } = header;
void unused;
const rows = Array.from({ length: 61 }, (_, n) => ({
  ...fixture.references.items[0]!,
  id: `00000000-0000-4000-8000-${String(n + 100).padStart(12, "0")}`,
  frequency_hz: 100e6 + n * 1e5,
}));
async function setup(page: Page) {
  const requests: string[] = [];
  let fault = 0,
    changed = false,
    slow = false;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v2/public/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    const headers = await route.request().allHeaders();
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers["x-csrf-token"]).toBeUndefined();
    if (url.pathname.endsWith("/transmissions")) {
      if (slow) await delayed;
      if (fault)
        return route.fulfill({
          status: fault,
          json: {
            error: {
              code: "cursor_expired",
              message: "PRIVATE SENTINEL",
              details: {},
              request_id: "synthetic",
            },
          },
        });
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      return route.fulfill({
        json: {
          ...fixture.references,
          station_id: station.id,
          publication_version: changed ? 2 : 1,
          total: 61,
          items: rows.slice(offset, offset + 25),
          next_cursor: offset + 25 < 61 ? String(offset + 25) : null,
        },
      });
    }
    if (url.pathname.endsWith(station.id))
      return route.fulfill({
        json: {
          ...fixture.details[station.id],
          station: { ...station, publication_version: changed ? 2 : 1 },
        },
      });
    return route.fulfill({
      json: {
        ...fixture.queries[0]!.response,
        items: [
          {
            station,
            match: {
              station_fields: ["name"],
              matching_transmission_count: 61,
            },
          },
        ],
        next_cursor: url.searchParams.has("cursor") ? null : "headers_next",
      },
    });
  });
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Search stations & signals" });
  await panel.getByLabel("Search text, frequency or DAB block").fill("energy");
  await panel
    .getByRole("button", { name: "Search Atlas", exact: true })
    .click();
  await expect(panel).toContainText("61 matching references");
  const show = () =>
    panel
      .getByRole("button", {
        name: `Show references for ${station.name}`,
        exact: true,
      })
      .click();
  return {
    panel,
    requests,
    show,
    release,
    fault: (status: number) => {
      fault = status;
    },
    changed: () => {
      changed = true;
    },
    slow: () => {
      slow = true;
    },
  };
}
test("v2 lazy headers and three reference pages preserve filters, later UUID links, selection and deliberate tuning", async ({
  page,
}, info) => {
  const p = await setup(page);
  expect(p.requests).toHaveLength(1);
  await p.show();
  await expect(p.panel).toContainText("Reference page 1 · 25 of 61");
  await p.panel
    .getByRole("button", { name: "Next references", exact: true })
    .click();
  await expect(p.panel).toContainText("Reference page 2 · 25 of 61");
  await p.panel
    .getByRole("button", { name: "Next references", exact: true })
    .click();
  await expect(p.panel).toContainText("Reference page 3 · 11 of 61");
  await expect(
    p.panel.getByRole("button", { name: "Next references", exact: true }),
  ).toBeDisabled();
  const link = p.panel
    .getByRole("link", { name: "Open exact Atlas reference", exact: true })
    .last();
  await expect(link).toHaveAttribute(
    "href",
    new RegExp(`station_id=${station.id}&transmission_id=${rows[60]!.id}$`),
  );
  expect(
    p.requests
      .filter((url) => url.includes("/transmissions?"))
      .every((url) => url.includes("q=energy") && url.includes("limit=50")),
  ).toBe(true);
  await p.panel
    .getByRole("button", { name: "Preview 106 MHz", exact: true })
    .click();
  await p.panel
    .getByRole("button", { name: "Apply to receiver", exact: true })
    .click();
  await expect(p.panel).toContainText("Receiver candidate selected");
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue(/^106/);
  await expect(
    page.getByRole("button", { name: "Start demo", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath("v2-later-reference.png") });
});
test("reference failure retries its continuation; expired cursor clears references and refreshes headers", async ({
  page,
}) => {
  const p = await setup(page);
  await p.show();
  await expect(p.panel).toContainText("Reference page 1");
  p.fault(500);
  await p.panel
    .getByRole("button", { name: "Next references", exact: true })
    .click();
  await expect(p.panel.getByRole("alert")).toContainText("unavailable");
  await expect(p.panel).not.toContainText("PRIVATE SENTINEL");
  p.fault(0);
  await p.panel
    .getByRole("button", { name: "Retry references", exact: true })
    .click();
  await expect(p.panel).toContainText("Reference page 2");
  expect(p.requests.at(-1)).toContain("cursor=25");
  p.fault(409);
  await p.panel
    .getByRole("button", { name: "Next references", exact: true })
    .click();
  await expect(p.panel).toContainText("Search Atlas again to refresh");
  await expect(p.panel.locator(".discovery-reference")).toHaveCount(0);
  p.fault(0);
  await p.panel
    .getByRole("button", { name: "Search Atlas", exact: true })
    .click();
  await p.show();
  await expect(p.panel).toContainText("Reference page 1");
});
test("station changes during apply never tune and late reference responses cannot repopulate an edited search", async ({
  page,
}) => {
  const p = await setup(page);
  const before = await page
    .getByLabel("Channel frequency", { exact: true })
    .inputValue();
  await p.show();
  await p.panel
    .getByRole("button", { name: "Preview 100 MHz", exact: true })
    .click();
  p.changed();
  await p.panel
    .getByRole("button", { name: "Apply to receiver", exact: true })
    .click();
  await expect(p.panel).toContainText("changed or was retired");
  await expect(
    page.getByLabel("Channel frequency", { exact: true }),
  ).toHaveValue(before);
  await p.panel
    .getByRole("button", { name: "Search Atlas", exact: true })
    .click();
  p.slow();
  await p.show();
  await expect(p.panel).toContainText("Loading published references");
  await p.panel
    .getByLabel("Search text, frequency or DAB block")
    .fill("changed query");
  p.release();
  await expect(p.panel.locator(".discovery-reference")).toHaveCount(0);
  await expect(p.panel).toContainText("Choose Search Atlas");
});
test("reference controls and exact UUID links fit keyboard and phone layouts", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const p = await setup(page);
  await p.show();
  await expect(p.panel).toContainText("Reference page 1");
  expect(await p.panel.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await p.panel
    .getByRole("button", { name: "Next references", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(p.panel).toContainText("Reference page 2");
  await page.screenshot({ path: info.outputPath("v2-phone.png") });
  await page.keyboard.press("Escape");
  await expect(p.panel).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeFocused();
});
