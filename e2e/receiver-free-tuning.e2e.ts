import { expect, test } from "@playwright/test";
import { installSource } from "./radio-app-fixture";
import { installHackrfUsb } from "./hackrf-usb-fixture";
import { chooseReceiverMode } from "./application-navigation";
import {
  openDeviceSettings,
  closeDeviceSettings,
} from "./device-settings-navigation";

test("synthetic capture exploration supports Spectrum only Stop and restart", async ({
  page,
}) => {
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  await center.fill("110");
  await center.press("Enter");
  await expect(center).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("OFF");
  await expect(page.locator(".receiver-tuning")).toContainText(
    "Switched to Spectrum only",
  );
  await center.fill("120");
  await center.press("Enter");
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("120.000");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("120.000");
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("OFF");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("HF capture exploration honors declared Q-branch limits without locking valid moves", async ({
  page,
}) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  await page.getByRole("button", { name: /^RF input & power/ }).click();
  await page.getByLabel("Declared RTL board").selectOption("nesdr-smart-v5");
  await page.getByLabel("HF input", { exact: true }).selectOption("q");
  await page
    .getByRole("dialog", { name: "RF input & power", exact: true })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "RF input & power", exact: true }),
  ).toBeHidden();
  const channel = page.getByLabel("Channel frequency", { exact: true });
  await channel.fill("4.583");
  await channel.blur();
  await expect(channel).toHaveValue("4.583");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  await center.fill("80");
  await expect(
    page.getByRole("button", { name: "Set", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".receiver-tuning")).toContainText("0.1–24 MHz");
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("WBFM");
  await center.fill("6");
  await expect(
    page.getByRole("button", { name: "Set", exact: true }),
  ).toBeEnabled();
  await center.press("Enter");
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("6.000");
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("OFF");
  const centers = await page.evaluate(
    () =>
      (window as unknown as { radioAppsFixture: { centers: number[] } })
        .radioAppsFixture.centers,
  );
  expect(centers).toContain(6e6);
  expect(centers).not.toContain(80e6);
  await page
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
});

test("capture exploration keeps fitting audio, clears incompatible VFOs and permits further tuning", async ({
  page,
}, info) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  await page.getByLabel("Channel frequency", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  const mode = page.getByRole("combobox", { name: "Mode", exact: true });
  const channel = page.getByLabel("Channel frequency", { exact: true });
  await center.fill("100.2");
  await center.press("Enter");
  await expect(center).toBeEnabled();
  await expect(channel).toHaveValue("100.000");
  await expect(mode).toHaveValue("WBFM");
  await page.getByText("Second audio channel · VFO B", { exact: true }).click();
  await page.getByLabel("VFO B mode").selectOption("AM");
  await page.getByLabel("VFO B frequency (MHz)").fill("100.1");
  await page.getByRole("button", { name: "Enable VFO B", exact: true }).click();
  await expect(page.locator(".receiver-vfo-tools")).toContainText(
    "VFO B receiving",
  );
  await center.fill("110");
  await expect(
    page.getByRole("button", { name: "Set", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".receiver-tuning")).toContainText(
    "switches to Spectrum only",
  );
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("110.000");
  await expect(mode).toHaveValue("OFF");
  await expect(page.locator(".receiver-tuning")).toContainText(
    "Channel 100.000000 MHz cannot play",
  );
  await expect(page.locator(".receiver-vfo-tools")).not.toContainText(
    "VFO B receiving",
  );
  await expect(
    page.getByRole("button", { name: "Stop receiving", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath("exploration-warning.png") });
  await page
    .getByRole("switch", { name: "Follow channel", exact: true })
    .uncheck();
  await center.fill("120");
  await center.press("Enter");
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("120.000");
  await expect(mode).toHaveValue("OFF");
  await chooseReceiverMode(page, "WBFM");
  await expect(mode).toHaveValue("WBFM");
  await expect(channel).toHaveValue("120.000");
  await expect(page.locator(".receiver-tuning")).not.toContainText(
    "cannot play",
  );
  expect(
    await page.evaluate(
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
    ),
  ).toMatchObject({
    opens: 1,
    starts: 1,
    centers: expect.arrayContaining([110e6, 120e6]),
  });
  await page
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
});

test("pending and invalid channel drafts never lock capture center exploration", async ({
  page,
}) => {
  await installSource(page);
  await page.goto("/?browser-test=1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  const channel = page.getByLabel("Channel frequency", { exact: true });
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  await channel.fill("101");
  await center.fill("110");
  await center.press("Enter");
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("110.000");
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("OFF");
  await channel.fill("-1");
  await center.fill("130");
  await center.press("Enter");
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("130.000");
  await expect(channel).toHaveValue("130.000");
  await page
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
});

test("a low-rate centered decoder yields to explicit capture exploration", async ({
  page,
}) => {
  await installHackrfUsb(page);
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("hackrf");
  await chooseReceiverMode(page, "ADS-B");
  await openDeviceSettings(page);
  await page
    .getByRole("combobox", { name: "Sample rate", exact: true })
    .selectOption("2400000");
  await closeDeviceSettings(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  const center = page.getByLabel("Receiver center frequency", { exact: true });
  await center.fill("1090.1");
  await expect(
    page.getByRole("button", { name: "Set", exact: true }),
  ).toBeEnabled();
  await center.press("Enter");
  await expect(center).toBeEnabled();
  await expect(center).toHaveValue("1090.100");
  await expect(
    page.getByRole("combobox", { name: "Mode", exact: true }),
  ).toHaveValue("OFF");
  await expect(page.locator(".receiver-tuning")).toContainText(
    "Switched to Spectrum only",
  );
  await page
    .getByRole("button", { name: "Stop receiving", exact: true })
    .click();
});
