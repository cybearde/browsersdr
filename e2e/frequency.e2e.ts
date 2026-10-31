import { expect, test as base } from "@playwright/test";

// Keep this long tuning/reload workflow in a fresh normal browser, rather than
// inheriting resources from the preceding decoder/Explorer context cycles.
// Keep the tuning/reload workflow and its 20-second deadline; manual capture
// exploration is now allowed outside the currently selected channel.
const test = base.extend<object, { isolatedTuningWorker: boolean }>({
  isolatedTuningWorker: [true, { scope: "worker", auto: true }],
});

test("receiver window and channel tune independently, with guarded automatic re-centering", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  const channel = page.getByLabel("Channel frequency", { exact: true });
  await channel.fill("100");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  const auto = page.getByRole("switch", { name: "Follow channel" });
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("100.000");
  await expect(auto).toBeChecked();
  await expect(page.locator(".graphics-panel .receiver-tuning")).toBeVisible();
  await channel.fill("100.1");
  await channel.press("Enter");
  await expect(center).toHaveValue("100.000");
  await expect(channel).toHaveValue("100.100");
  await expect(page.locator(".marker-label")).toHaveText("Channel 100.100 MHz");
  await expect(page.locator(".receiver-offset")).toHaveText(
    "Channel offset +100.000 kHz",
  );
  await center.fill("100.2");
  await center.press("Enter");
  await expect(center).toHaveValue("100.200");
  await expect(channel).toHaveValue("100.100");
  await expect(page.locator(".receiver-offset")).toHaveText(
    "Channel offset -100.000 kHz",
  );
  await center.fill("101");
  await expect(center).toHaveAttribute("aria-invalid", "false");
  await expect(
    page.getByRole("button", { name: "Set", exact: true }),
  ).toBeEnabled();
  await center.press("Escape");
  await expect(center).toHaveValue("100.200");
  await expect(channel).toHaveValue("100.100");
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("WBFM");
  await page.getByRole("button", { name: "To channel", exact: true }).click();
  await expect(center).toHaveValue("100.100");
  await auto.uncheck();
  await channel.fill("101");
  await channel.press("Enter");
  await expect(page.locator("#frequency-state")).toContainText(
    "complete channel does not fit",
  );
  await expect(center).toHaveValue("100.100");
  await expect(auto).toBeEnabled();
  await page.getByRole("button", { name: "To channel", exact: true }).click();
  await expect(center).toHaveValue("101.000");
  await expect(channel).toHaveValue("101.000");
  await expect(auto).not.toBeChecked();
  await channel.fill("102.2");
  await channel.press("Enter");
  await expect(page.locator("#frequency-state")).toContainText(
    "complete channel does not fit",
  );
  await center.fill("102.1");
  await center.press("Enter");
  await expect(center).toHaveValue("102.100");
  await expect(channel).toHaveValue("102.200");
  await expect(auto).not.toBeChecked();
  await channel.fill("103");
  await channel.press("Enter");
  await channel.press("Escape");
  await expect(channel).toHaveValue("102.200");
  await channel.fill("101");
  await auto.check();
  await channel.press("Enter");
  await expect(center).toHaveValue("101.000");
  await expect(page.locator(".receiver-offset")).toHaveText(
    "Channel offset +0.000 kHz",
  );
  await auto.uncheck();
  await page.reload();
  await expect(auto).not.toBeChecked();
  expect(errors).toEqual([]);
});
