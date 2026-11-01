import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createDeterministicRecordingFixture } from "../src/testing/recordingFixture";

async function startCapture(page: Page) {
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source" })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start I/Q recording", exact: true })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        try {
          const library = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle("browsersdr-library-v1");
          for await (const handle of (
            library as FileSystemDirectoryHandle & {
              values(): AsyncIterable<FileSystemDirectoryHandle>;
            }
          ).values()) {
            if (handle.kind !== "directory") continue;
            try {
              if (
                (await (await handle.getFileHandle("manifest.json")).getFile())
                  .size > 0
              )
                return true;
            } catch {
              /* First checkpoint pending. */
            }
          }
        } catch {
          /* Library creation pending. */
        }
        return false;
      }),
    )
    .toBe(true);
}

test("a completed capture survives reload and can be downloaded and explicitly deleted", async ({
  page,
}) => {
  await startCapture(page);
  expect(
    await page.evaluate(() =>
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(page.locator(".capture-retention-warning")).toContainText(
    "local recording library",
  );
  await page.reload();
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page.getByRole("tab", { name: "Local library", exact: true }).click();
  await page.locator(".recording-library summary").click();
  const entry = page.locator(".recording-library-entry");
  await expect(entry).toContainText("ready");
  await entry
    .getByRole("button", { name: "Prepare retained download" })
    .click();
  await expect(
    page.getByRole("button", { name: "Discard prepared capture", exact: true }),
  ).toBeEnabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const files = unzipSync(await readFile((await (await download).path())!));
  const data = Object.entries(files).find(([name]) =>
    name.endsWith(".sigmf-data"),
  )![1];
  const sidecar = JSON.parse(
    new TextDecoder().decode(
      Object.entries(files).find(([name]) => name.endsWith(".sigmf-meta"))![1],
    ),
  );
  expect(createHash("sha512").update(data).digest("hex")).toBe(
    sidecar.global["core:sha512"],
  );
  expect(
    await page.evaluate(() =>
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await page.getByRole("tab", { name: "Local library", exact: true }).click();
  await page.locator(".recording-library summary").click();
  await page.getByRole("button", { name: "Refresh library" }).click();
  await expect(entry).toContainText("ready");
  await entry
    .getByRole("button", { name: "Delete retained recording" })
    .click();
  await expect(entry).toHaveCount(1);
  await entry
    .getByRole("button", { name: "Confirm delete recording", exact: true })
    .click();
  await expect(entry).toHaveCount(0);
});

test("renderer interruption recovers a committed prefix and another tab cannot delete active capture", async ({
  page,
  context,
}) => {
  await startCapture(page);
  let other = await context.newPage();
  await other.goto("/?browser-test=1");
  await other
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await other.getByRole("tab", { name: "Local library", exact: true }).click();
  await other.locator(".recording-library summary").click();
  await expect(other.locator(".recording-library-entry")).toContainText(
    "in-use",
  );
  await expect(
    other.getByRole("button", { name: "Delete retained recording" }),
  ).toBeDisabled();
  await other.close();
  const cdp = await context.newCDPSession(page);
  const crashed = page.waitForEvent("crash");
  void cdp.send("Page.crash").catch(() => undefined);
  await crashed;
  await page.close();
  other = await context.newPage();
  await other.goto("/?browser-test=1");
  await other
    .getByRole("tab", { name: "Capture & replay", exact: true })
    .click();
  await other.getByRole("tab", { name: "Local library", exact: true }).click();
  await other.locator(".recording-library summary").click();
  await other.getByRole("button", { name: "Refresh library" }).click();
  await expect(other.locator(".recording-library-entry")).toContainText(
    "interrupted",
  );
  await other
    .getByRole("button", { name: "Replay retained recording" })
    .click();
  await expect(other.locator(".file-message")).toContainText(
    "committed prefix",
  );
  await other.getByRole("button", { name: "Close replay" }).click();
  await other.getByRole("tab", { name: "Local library", exact: true }).click();
  await other.getByRole("button", { name: "Refresh library" }).click();
  await other
    .getByRole("button", { name: "Delete retained recording" })
    .click();
  await other
    .getByRole("button", { name: "Confirm delete recording", exact: true })
    .click();
  await expect(other.locator(".recording-library-entry")).toHaveCount(0);
});

test("large SigMF import keeps the UI responsive, supports cancellation, range and pause", async ({
  page,
}, testInfo) => {
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source" })
    .selectOption("replay");
  await page
    .getByRole("combobox", { name: "Replay pair format" })
    .selectOption("sigmf");
  const bytes = Buffer.alloc(33 * 1024 * 1024, 127);
  const metadata = {
    global: {
      "core:datatype": "cu8",
      "core:version": "1.2.6",
      "core:sample_rate": 1024000,
      "core:sha512": createHash("sha512").update(bytes).digest("hex"),
    },
    captures: [
      {
        "core:sample_start": 0,
        "core:frequency": 100000000,
        "core:datetime": "2026-10-12T00:00:00.000Z",
      },
    ],
    annotations: [],
  };
  await page
    .getByRole("combobox", { name: "SigMF replay mode" })
    .selectOption("OFF");
  const binaryPath = testInfo.outputPath("large.sigmf-data");
  await writeFile(binaryPath, bytes);
  await page.locator(".file-picker-input").nth(0).setInputFiles(binaryPath);
  await page
    .locator(".file-picker-input")
    .nth(1)
    .setInputFiles({
      name: "large.sigmf-meta",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(metadata)),
    });
  const cdp = await page.context().newCDPSession(page);
  const before = await cdp.send("Runtime.getHeapUsage");
  await page.getByRole("button", { name: "Load SigMF pair" }).click();
  await expect(page.getByRole("progressbar", { name: /SigMF/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel replay import" }).click();
  await expect(page.locator(".replay-import-progress")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Load SigMF pair" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Load SigMF pair" }).click();
  await expect(page.locator(".file-message")).toContainText(
    "Loaded SigMF replay",
  );
  await expect(page.locator(".replay-import-progress")).toBeHidden();
  const rangeFields = await page
    .locator(".replay-range-controls > label")
    .evaluateAll((labels) =>
      labels.map((label) => {
        const rect = label.getBoundingClientRect();
        return { width: rect.width, top: rect.top };
      }),
    );
  expect(rangeFields).toHaveLength(2);
  expect(rangeFields.every((field) => field.width <= 210)).toBe(true);
  expect(Math.abs(rangeFields[0]!.top - rangeFields[1]!.top)).toBeLessThan(1);
  await page.getByRole("button", { name: "Start replay", exact: true }).click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume replay" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start I/Q recording", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Open recording", exact: true }).click();
  const paused = await cdp.send("Runtime.getHeapUsage");
  await testInfo.attach("file-replay-memory.json", {
    body: JSON.stringify({
      fileBytes: bytes.length,
      before,
      paused,
      scope:
        "Main renderer snapshots, not peak usage or worker/browser Blob storage.",
    }),
    contentType: "application/json",
  });
  await page.getByRole("button", { name: "Resume replay" }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByLabel("Replay start seconds", { exact: true }).fill("16");
  await page.getByLabel("Replay end seconds", { exact: true }).fill("16.1");
  await page.getByRole("button", { name: "Start replay", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start replay", exact: true }),
  ).toBeEnabled();
});

test("invalid replacement preserves the previously valid replay", async ({
  page,
}) => {
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source" })
    .selectOption("replay");
  await page.getByRole("button", { name: "Open example recording" }).click();
  const fixture = createDeterministicRecordingFixture();
  await page
    .locator(".file-picker-input")
    .nth(0)
    .setInputFiles({
      name: "invalid.cu8",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(fixture.data),
    });
  await page
    .locator(".file-picker-input")
    .nth(1)
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
  await page.getByRole("button", { name: "Load files", exact: true }).click();
  await expect(page.locator(".file-message")).not.toContainText("Loaded");
  await expect(
    page.getByRole("button", { name: "Start replay", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start replay", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start replay", exact: true }),
  ).toBeEnabled();
});

test("replay player seeks without replacing the spectrum and preserves paused position", async ({
  page,
}) => {
  const recording = createDeterministicRecordingFixture(48_000 * 30);
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source" })
    .selectOption("replay");
  await page
    .locator(".file-picker-input")
    .nth(0)
    .setInputFiles({
      name: "player.cu8",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(recording.data),
    });
  await page
    .locator(".file-picker-input")
    .nth(1)
    .setInputFiles({
      name: "player.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recording.metadata)),
    });
  await page.getByRole("button", { name: "Load files", exact: true }).click();
  const player = page.getByLabel("Recording playback", { exact: true });
  const timeline = player.getByRole("slider", { name: "Recording timeline" });
  await expect(page.getByLabel("Playback time", { exact: true })).toHaveText(
    "00:00.0 / 00:30.0",
  );
  const geometry = await page.evaluate(() => {
    const source = document
      .querySelector('select[aria-label="Signal source"]')!
      .getBoundingClientRect();
    const actions = document
      .querySelector(".source-replay-actions")!
      .getBoundingClientRect();
    const transport = document
      .querySelector(".acquire-controls .transport")!
      .getBoundingClientRect();
    return [
      Math.abs(actions.left - source.left),
      Math.abs(actions.right - source.right),
      Math.abs(transport.left - source.left),
      Math.abs(transport.right - source.right),
    ];
  });
  expect(geometry.every((delta) => delta < 1)).toBe(true);
  await player
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect
    .poll(async () => Number(await timeline.inputValue()))
    .toBeGreaterThan(0);
  await player
    .getByRole("button", { name: "Pause replay", exact: true })
    .click();
  const canvas = await page.locator("canvas").first().elementHandle();
  const bounds = await timeline.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 8, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.8,
    bounds!.y + bounds!.height / 2,
    { steps: 20 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await timeline.inputValue()))
    .toBeGreaterThan(20);
  await expect(player.getByText("Paused", { exact: true })).toBeVisible();
  const draggedPosition = await timeline.inputValue();
  await page.waitForTimeout(500);
  await expect(timeline).toHaveValue(draggedPosition);
  await timeline.fill("15");
  await expect(timeline).toHaveValue("15");
  await page.waitForTimeout(500);
  await expect(timeline).toHaveValue("15");
  await expect(
    player.getByRole("button", { name: "Resume replay", exact: true }),
  ).toBeEnabled();
  await player.getByRole("button", { name: "↶ 10 s", exact: true }).click();
  await expect(timeline).toHaveValue("5");
  await player.getByRole("button", { name: "10 s ↷", exact: true }).click();
  await expect(timeline).toHaveValue("15");
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  await player
    .getByRole("button", { name: "Resume replay", exact: true })
    .click();
  await expect
    .poll(async () => Number(await timeline.inputValue()))
    .toBeGreaterThan(15);
  await timeline.fill("30");
  await expect(player.getByText("Finished", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Playback time", { exact: true })).toHaveText(
    "00:30.0 / 00:30.0",
  );
  await player
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect
    .poll(async () => Number(await timeline.inputValue()))
    .toBeLessThan(5);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});
