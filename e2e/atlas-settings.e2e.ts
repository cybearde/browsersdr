import { openApplicationView } from "./application-navigation";
import { expect, test, type Page } from "@playwright/test";

const token = "settings-browser-test-credential-".repeat(2);
const key = "browsersdr.atlas.user-token.v1";
async function peer(page: Page, role = "operator") {
  let logins = 0;
  const requests: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    requests.push(path);
    if (path === "/api/v1/session" && request.method() === "DELETE") {
      expect(request.headers()["x-csrf-token"]).toBe("settings-csrf");
      await route.fulfill({ status: 204 });
    } else if (path === "/api/v1/session") {
      logins++;
      await route.fulfill({
        status: 201,
        json: {
          operator_id: "settings-user",
          expires_at: "2030-01-01T00:00:00Z",
          csrf_token: "settings-csrf",
        },
      });
    } else if (path === "/api/v1/me") {
      await route.fulfill({
        status: 200,
        json: {
          id: "settings-user",
          display_name: "Settings user",
          role,
          token_id: null,
          bootstrap: false,
        },
      });
    } else {
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "storage_unavailable",
            message: "IQ storage unavailable",
          },
        },
      });
    }
  });
  return { requests, logins: () => logins };
}
async function settings(page: Page) {
  await openApplicationView(page, "Settings");
  await expect(
    page.getByRole("heading", { name: "SigIntAtlas", exact: true }),
  ).toBeVisible();
  return page.locator(".atlas-settings-panel");
}

test("SigIntAtlas settings configure credentials before capture, reload, disconnect and forget", async ({
  page,
}) => {
  const atlas = await peer(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?browser-test=1");
  let panel = await settings(page);
  expect(atlas.requests).toEqual([]);
  await panel.getByLabel("Settings SigIntAtlas user token").fill(token);
  await panel.getByRole("button", { name: "Save token", exact: true }).click();
  expect(atlas.requests).toEqual([]);
  await panel.getByRole("button", { name: "Test connection" }).click();
  await expect(
    panel.getByText("Connected as Settings user", { exact: false }),
  ).toBeVisible();
  expect(atlas.logins()).toBe(1);
  expect(atlas.requests).not.toContain("/api/v1/capabilities");
  await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    panel.getByText("Session: disconnected.", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel("Settings SigIntAtlas user token")).toHaveValue(
    token,
  );
  await page.reload();
  panel = await settings(page);
  await expect(panel.getByLabel("Settings SigIntAtlas user token")).toHaveValue(
    token,
  );
  expect(atlas.logins()).toBe(1);
  await panel.getByRole("button", { name: "Forget token" }).click();
  await expect(panel.getByLabel("Settings SigIntAtlas user token")).toHaveValue(
    "",
  );
  await page.reload();
  panel = await settings(page);
  await expect(panel.getByLabel("Settings SigIntAtlas user token")).toHaveValue(
    "",
  );
  expect(errors).toEqual([]);
});

test("SigIntAtlas memory-only credentials, viewer state and keyboard Settings fit 390 px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const atlas = await peer(page, "viewer");
  await page.goto("/?browser-test=1");
  await page.getByRole("tab", { name: /^Explorer/ }).click();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Receiver", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Radio Apps", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Settings", { exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("combobox", { name: "Theme", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".install-app-control")).toBeVisible();
  await page.keyboard.press("Tab");
  const integration = page.getByRole("button", {
    name: "Integration settings",
    exact: true,
  });
  for (
    let step = 0;
    step < 3 &&
    !(await integration.evaluate((node) => node === document.activeElement));
    step++
  )
    await page.keyboard.press("Tab");
  await expect(integration).toBeFocused();
  await page.keyboard.press("Enter");
  const panel = page.locator(".atlas-settings-panel");
  await panel.getByLabel("Settings SigIntAtlas user token").fill(token);
  await panel.getByLabel("Remember on this browser").uncheck();
  await panel.getByRole("button", { name: "Save token", exact: true }).click();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
  await panel.getByRole("button", { name: "Test connection" }).click();
  await expect(panel.getByText(/Viewer access is read-only/)).toBeVisible();
  expect(atlas.requests).not.toContain("/api/v1/capabilities");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("atlas-settings-mobile.png"),
    fullPage: true,
  });
  await page.reload();
  await settings(page);
  await expect(panel.getByLabel("Settings SigIntAtlas user token")).toHaveValue(
    "",
  );
});

test("SigIntAtlas settings honor legacy tokens and synchronize replacement and Forget across tabs", async ({
  page,
  context,
}) => {
  await page.goto("/?browser-test=1");
  await page.evaluate(({ key, token }) => localStorage.setItem(key, token), {
    key,
    token,
  });
  await page.reload();
  const first = await settings(page);
  await expect(first.getByLabel("Settings SigIntAtlas user token")).toHaveValue(
    token,
  );
  const secondPage = await context.newPage();
  await secondPage.goto("/?browser-test=1");
  const second = await settings(secondPage);
  const next = "replacement-browser-test-".repeat(2);
  await second.getByLabel("Settings SigIntAtlas user token").fill(next);
  await second.getByRole("button", { name: "Save token", exact: true }).click();
  await expect(first.getByLabel("Settings SigIntAtlas user token")).toHaveValue(
    next,
  );
  await second.getByRole("button", { name: "Forget token" }).click();
  await expect(first.getByLabel("Settings SigIntAtlas user token")).toHaveValue(
    "",
  );
  expect(page.url()).not.toContain(next);
  await secondPage.close();
});
