import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
const address = "https://receiver.example/";
const config = {
  center_freq: 10000000,
  samp_rate: 192000,
  fft_size: 128,
  audio_compression: "none",
  fft_compression: "none",
  start_freq: 10000000,
  start_mod: "am",
  sdr_id: "radio",
  profile_id: "hf",
};
async function fixture(page: Page, confirmProfiles = true) {
  const commands: string[] = [],
    connections: WebSocketRoute[] = [],
    closed: string[] = [];
  await page.routeWebSocket("wss://receiver.example/ws/", (socket) => {
    connections.push(socket);
    socket.onClose(() => closed.push("closed"));
    socket.onMessage((message) => {
      if (typeof message !== "string") return;
      commands.push(message);
      if (message.startsWith("SERVER DE CLIENT")) {
        socket.send("CLIENT DE SERVER server=openwebrx version=v1.2.126");
        socket.send(JSON.stringify({ type: "config", value: config }));
        socket.send(
          JSON.stringify({
            type: "profiles",
            value: [
              { id: "radio|hf", name: "HF" },
              { id: "radio|vhf", name: "VHF" },
            ],
          }),
        );
        socket.send(
          JSON.stringify({
            type: "modes",
            value: [
              { modulation: "am" },
              { modulation: "nfm" },
              { modulation: "usb" },
              { modulation: "cw" },
            ],
          }),
        );
        const fft = Buffer.alloc(513);
        fft[0] = 1;
        for (let i = 0; i < 128; i++)
          fft.writeFloatLE(
            -80 + 40 * Math.exp(-(((i - 64) / 4) ** 2)),
            1 + i * 4,
          );
        socket.send(fft);
      } else {
        const request = JSON.parse(message) as {
          type: string;
          action?: string;
          params?: { profile?: string };
        };
        if (request.type === "dspcontrol" && request.action === "start") {
          const pcm = Buffer.alloc(2401);
          pcm[0] = 2;
          for (let i = 0; i < 1200; i++)
            pcm.writeInt16LE(
              Math.round(8000 * Math.sin((i * Math.PI) / 6)),
              1 + i * 2,
            );
          socket.send(pcm);
        }
        if (request.type === "selectprofile") {
          // Literal receiver-detach shape observed on VK4DL/SDR1.
          socket.send(
            JSON.stringify({
              type: "config",
              value: {
                center_freq: null,
                samp_rate: null,
                start_freq: null,
                start_mod: null,
                sdr_id: "radio",
                profile_id: null,
              },
            }),
          );
          if (confirmProfiles)
            socket.send(
              JSON.stringify({
                type: "config",
                value: {
                  center_freq: 144000000,
                  samp_rate: 2400000,
                  start_freq: 144500000,
                  profile_id: "vhf",
                },
              }),
            );
        }
      }
    });
  });
  return { commands, connections, closed };
}
async function enter(page: Page) {
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("remote");
  await expect(
    page.getByRole("heading", { name: "OpenWebRX", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Receiver website", { exact: true }).fill(address);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Listen", exact: true }),
  ).toBeEnabled();
}
test("native remote audio and spectrum require explicit listening and leave local RF controls untouched", async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (e) => errors.push(e));
  const { commands, closed } = await fixture(page);
  await enter(page);
  expect(commands.some((c) => c.includes('"action":"start"'))).toBe(false);
  await expect(
    page.getByRole("combobox", { name: "Remote mode", exact: true }),
  ).toHaveValue("am");
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.locator(".remote-header-status")).toContainText(
    "listening",
  );
  await page.getByText("Stream details", { exact: true }).click();
  await expect(page.locator(".remote-footer")).toContainText(
    "1,200 audio samples",
  );
  await expect(page.locator(".remote-footer")).toContainText("audio running");
  await page
    .getByRole("textbox", { name: "Remote channel MHz", exact: true })
    .fill("20");
  const count = commands.length;
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("fit inside");
  expect(commands).toHaveLength(count);
  await page
    .getByRole("textbox", { name: "Remote channel MHz", exact: true })
    .fill("10.02");
  await page
    .getByRole("combobox", { name: "Remote mode", exact: true })
    .selectOption("usb");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect.poll(() => commands.at(-1)).toContain('"offset_freq":20000');
  await page
    .getByRole("combobox", { name: "Remote mode", exact: true })
    .selectOption("cw");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect.poll(() => commands.at(-1)).toContain('"offset_freq":19300');
  await expect(page.locator(".remote-requested")).toContainText(
    "10.020000 MHz · CW",
  );
  await page
    .getByRole("button", { name: "Stop listening", exact: true })
    .click();
  await expect.poll(() => closed.length).toBe(1);
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("rtl-sdr");
  await expect(
    page.getByRole("combobox", { name: "Signal source", exact: true }),
  ).toHaveValue("rtl-sdr");
  expect(errors).toEqual([]);
});
test("remote profile confirmation, keyboard controls, narrow layout and retained utility listening", async ({
  page,
}) => {
  const { closed } = await fixture(page);
  await enter(page);
  await page
    .getByRole("combobox", { name: "Remote band", exact: true })
    .selectOption("radio|vhf");
  await expect(
    page.getByRole("textbox", { name: "Remote channel MHz", exact: true }),
  ).toHaveValue("144.5");
  await expect(
    page.getByRole("button", { name: "Listen", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Remote channel MHz", exact: true })
    .press("Enter");
  await expect(page.locator(".remote-header-status")).toContainText(
    "listening",
  );
  await expect(
    page.getByRole("combobox", { name: "Remote band", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(page.getByRole("tab", { name: /Explorer/ })).toBeDisabled();
  await page.locator("summary[aria-label=Settings]").click();
  await page
    .getByRole("button", { name: "Integration settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(closed).toHaveLength(0);
  await expect(page.locator("#remote-view")).toBeVisible();
  await page
    .getByRole("button", { name: "Back to Receiver", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop listening", exact: true })
    .click();
  await expect.poll(() => closed.length).toBe(1);
  await expect(page.locator("#remote-view")).toBeVisible();
});
test("local active reception and retained capture block remote entry without discarding data", async ({
  page,
}) => {
  await page.goto("/?browser-test=1");
  const source = page.getByRole("combobox", {
    name: "Signal source",
    exact: true,
  });
  await source.selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(source.locator("option[value=remote]")).toHaveAttribute(
    "disabled",
    "",
  );
  await page.getByRole("tab", { name: "Capture & replay" }).click();
  await page
    .getByRole("button", { name: "Start I/Q recording", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await page.locator(".recording-state").textContent())?.includes("MiB"),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Discard prepared capture", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(source.locator("option[value=remote]")).toHaveAttribute(
    "disabled",
    "",
  );
  await expect(
    page.getByRole("button", { name: "Discard prepared capture", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Discard prepared capture", exact: true })
    .click();
  await expect(source.locator("option[value=remote]")).not.toHaveAttribute(
    "disabled",
  );
});
test("unavailable remote receiver reports an actionable failure without starting acquisition", async ({
  page,
}) => {
  await page.routeWebSocket("wss://receiver.example/ws/", (socket) => {
    socket.onMessage(() => socket.close({ code: 1008, reason: "Busy" }));
  });
  await page.goto("/?browser-test=1");
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("remote");
  await page.getByLabel("Receiver website", { exact: true }).fill(address);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".remote-message")).toContainText("disconnected");
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Listen", exact: true }),
  ).toBeDisabled();
});

test("waterfall history survives repeated configuration and pause freezes the rendered display", async ({
  page,
}) => {
  const { connections } = await fixture(page);
  await enter(page);
  const canvas = page.getByRole("img", {
    name: "Remote server spectrum and waterfall, relative power",
  });
  const newestRow = () =>
    canvas.evaluate((element: HTMLCanvasElement) =>
      Array.from(element.getContext("2d")!.getImageData(20, 112, 1, 1).data),
    );
  const fft = Buffer.alloc(513);
  fft[0] = 1;
  for (let i = 0; i < 28; i++) {
    const before = await newestRow();
    // Alternate visible levels and wait for each rendered frame. Fixed delays
    // can coalesce frames under load, leaving the historical row unfilled.
    for (let bin = 0; bin < 128; bin++)
      fft.writeFloatLE(i % 2 ? -60 : -50, 1 + bin * 4);
    connections[0]!.send(
      JSON.stringify({
        type: "config",
        value: { fft_size: 128, waterfall_levels: { min: -120, max: 0 } },
      }),
    );
    connections[0]!.send(fft);
    await expect.poll(newestRow).not.toEqual(before);
  }
  const row = await canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext("2d")!.getImageData(20, 135, 1, 1).data),
  );
  expect(row.slice(0, 3)).not.toEqual([7, 19, 33]);
  await page
    .getByRole("button", { name: "Pause display", exact: true })
    .click();
  const before = await canvas.evaluate((element: HTMLCanvasElement) =>
    element.toDataURL(),
  );
  for (let i = 0; i < 3; i++) connections[0]!.send(fft);
  await page.waitForTimeout(100);
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()),
  ).toBe(before);
  await page
    .getByRole("button", { name: "Resume display", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Remote band", exact: true })
    .selectOption("radio|vhf");
  await expect(
    page.getByRole("textbox", { name: "Remote channel MHz", exact: true }),
  ).toHaveValue("144.5");
  const cleared = await canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext("2d")!.getImageData(20, 135, 1, 1).data),
  );
  expect(cleared.slice(0, 3)).toEqual([7, 19, 33]);
});

test("compressed FFT/audio and a standard-to-HD mode change preserve the continuous decoder", async ({
  page,
}) => {
  let started = false;
  await page.routeWebSocket("wss://receiver.example/ws/", (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== "string") return;
      if (message.startsWith("SERVER DE CLIENT")) {
        socket.send("CLIENT DE SERVER server=openwebrx version=v1.2.126");
        socket.send(
          JSON.stringify({
            type: "config",
            value: {
              ...config,
              audio_compression: "adpcm",
              fft_compression: "adpcm",
            },
          }),
        );
        socket.send(
          JSON.stringify({
            type: "modes",
            value: [{ modulation: "am" }, { modulation: "wfm" }],
          }),
        );
        const fft = Buffer.alloc(70);
        fft[0] = 1;
        socket.send(fft);
      } else {
        const request = JSON.parse(message) as {
          type: string;
          action?: string;
          params?: { mod?: string };
        };
        if (request.type === "dspcontrol" && request.action === "start") {
          started = true;
          socket.send(Buffer.from([2, 83, 89, 78, 67, 0, 0, 232, 3, 0x77]));
        }
        if (
          started &&
          request.type === "dspcontrol" &&
          request.params?.mod === "wfm"
        )
          socket.send(Buffer.from([4, 0x88]));
      }
    });
  });
  await enter(page);
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await page.getByText("Stream details", { exact: true }).click();
  await expect(page.locator(".remote-footer")).toContainText("2 audio samples");
  await page
    .getByRole("combobox", { name: "Remote mode", exact: true })
    .selectOption("wfm");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(page.locator(".remote-footer")).toContainText("4 audio samples");
  await expect(page.locator(".remote-footer")).toContainText("audio running");
  await expect(page.locator(".remote-footer")).toContainText(
    "1 spectrum frames",
  );
  await expect(page.locator(".remote-footer")).toContainText(
    "audio adpcm, spectrum adpcm",
  );
});

test("incoming local settings links cannot change the hidden local receiver during remote listening", async ({
  page,
}) => {
  await fixture(page);
  await enter(page);
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  const proposal = {
    schema: "browsersdr-settings-v1",
    frequencyHz: 91400000,
    settings: { mode: "AM", bandwidthHz: 10000, squelch: 0 },
    display: { compact: true, floorDb: -99, rangeDb: 73 },
  };
  const hash =
    "#settings=" + Buffer.from(JSON.stringify(proposal)).toString("base64url");
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  const dialog = page.getByRole("dialog", {
    name: "Shared settings",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply shared settings", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText(
    "Return to the local receiver before applying shared settings.",
  );
  await dialog
    .getByRole("button", { name: "Close settings share", exact: true })
    .click();
  await expect(page.locator(".remote-header-status")).toContainText(
    "listening",
  );
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("rtl-sdr");
  await expect(page.getByRole("combobox", { name: /^Mode/ })).toHaveValue(
    "WBFM",
  );
  await expect(
    page.getByRole("spinbutton", { name: "Channel frequency", exact: true }),
  ).toHaveValue("100.000");
});

test("unified remote workspace shares compact layout, panel hiding and source selection with local reception", async ({
  page,
}) => {
  const { closed } = await fixture(page);
  await enter(page);
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Back to Receiver", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Explorer/ })).toBeDisabled();
  await expect(
    page.getByRole("tab", { name: "Capture & replay", exact: true }),
  ).toHaveCount(0);
  const source = await page
    .locator("#remote-view .acquire-stage")
    .boundingBox();
  const spectrum = await page
    .locator("#remote-view .graphics-panel")
    .boundingBox();
  const channel = await page
    .locator("#remote-view .demodulate-stage")
    .boundingBox();
  expect(source!.x + source!.width).toBeLessThanOrEqual(spectrum!.x);
  expect(spectrum!.x + spectrum!.width).toBeLessThanOrEqual(channel!.x);
  expect(Math.abs(source!.y - spectrum!.y)).toBeLessThan(2);
  expect(Math.abs(channel!.y - spectrum!.y)).toBeLessThan(2);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(1000);
  await page.getByRole("tab", { name: /Receiver/ }).click();
  await page.getByRole("tab", { name: /Receiver/ }).press("End");
  await expect(page.locator(".remote-header-status")).toContainText(
    "listening",
  );
  expect(closed).toHaveLength(0);
  await expect(
    page.getByRole("tab", { name: "Decoder", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#remote-view")).toBeHidden();
  await expect(page.locator("#decoder-view")).toContainText(
    "Remote audio/FFT does not provide the raw I/Q",
  );
  await expect(page.locator("#decoder-view")).toContainText("No raw I/Q rate");
  await page.getByRole("tab", { name: "Receiver", exact: true }).click();
  await expect(page.locator("#remote-view")).toBeVisible();
  expect(closed).toHaveLength(0);
  await page
    .getByRole("button", { name: "Collapse source panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse channel panel", exact: true })
    .click();
  await expect(
    page.getByLabel("Receiver website", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByLabel("Remote channel MHz", { exact: true }),
  ).toBeHidden();
  await expect(page.locator(".remote-header-status")).toContainText(
    "listening",
  );
  await page
    .getByRole("button", { name: "Expand source panel", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await expect.poll(() => closed.length).toBe(1);
  await expect(page.getByRole("tab", { name: /Explorer/ })).toBeEnabled();
  await expect(page.locator(".app-shell")).toHaveClass(/density-compact/);
  await expect(
    page.getByRole("button", { name: "Expand channel panel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveClass(/density-compact/);
  await expect(
    page.getByRole("button", { name: "Expand channel panel", exact: true }),
  ).toBeVisible();
});

test("utility overlays preserve the remote stream and explicit disconnect preserves settings", async ({
  page,
}) => {
  const { connections, closed } = await fixture(page);
  await enter(page);
  await page.getByLabel("Remote channel MHz", { exact: true }).fill("10.02");
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await page.getByRole("tab", { name: "Session", exact: true }).click();
  await expect(page.locator("#remote-session-panel")).toContainText(
    "does not provide raw I/Q",
  );
  await page.locator("summary[aria-label=Settings]").click();
  await page
    .getByRole("button", { name: "Integration settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#remote-view")).toBeVisible();
  expect(closed).toHaveLength(0);
  await page
    .getByRole("button", { name: "Back to Receiver", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop listening", exact: true }),
  ).toBeVisible();
  expect(connections).toHaveLength(1);
  await page
    .getByRole("button", { name: "Stop listening", exact: true })
    .click();
  await expect.poll(() => closed.length).toBe(1);
  await expect(page.locator("#remote-view")).toBeVisible();
  await expect(
    page.getByLabel("Receiver website", { exact: true }),
  ).toHaveValue(address);
  await expect(
    page.getByLabel("Remote channel MHz", { exact: true }),
  ).toHaveValue("10.02");
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Listen", exact: true }),
  ).toBeDisabled();
  expect(connections).toHaveLength(1);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Listen", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".remote-header-status")).toContainText(
    "connected",
  );
  expect(connections).toHaveLength(2);
});

test("unified remote filters reject invalid passbands and narrow controls remain reachable", async ({
  page,
}) => {
  const { commands } = await fixture(page);
  await enter(page);
  await page.getByText("Filter settings", { exact: true }).click();
  await page.getByLabel("Low cut · Hz", { exact: true }).fill("9000");
  await page.getByLabel("High cut · Hz", { exact: true }).fill("-9000");
  const count = commands.length;
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("filter");
  expect(commands).toHaveLength(count);
  await page.getByLabel("Low cut · Hz", { exact: true }).fill("-3000");
  await page.getByLabel("High cut · Hz", { exact: true }).fill("3000");
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.locator(".remote-header-status")).toContainText(
    "listening",
  );
  for (const width of [1024, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(
      page.getByRole("button", { name: "Tune", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("slider", { name: "Volume", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Remote favorites/ }).click();
    const dialog = page.getByRole("dialog", {
      name: "Remote favorites",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.press("Escape");
    await expect(
      page.getByRole("button", { name: /^Remote favorites/ }),
    ).toBeFocused();
  }
});

test("band switches wait through null detach and partial acknowledgements without stale tuning or autoplay", async ({
  page,
}) => {
  const { commands, connections, closed } = await fixture(page, false);
  await enter(page);
  const band = page.getByRole("combobox", { name: "Remote band", exact: true });
  const listen = page.getByRole("button", { name: "Listen", exact: true });
  const channel = page.getByRole("textbox", {
    name: "Remote channel MHz",
    exact: true,
  });
  const spectrum = page.locator("#remote-view .remote-spectrum-toolbar");
  const reply = (value: Record<string, unknown>) =>
    connections[0]!.send(JSON.stringify({ type: "config", value }));
  await band.selectOption("radio|vhf");
  await expect(band).toBeDisabled();
  await expect(listen).toBeDisabled();
  await expect(spectrum).toContainText("Connect to view the receiver band");
  expect(closed).toHaveLength(0);
  reply({ sdr_id: "radio", profile_id: "vhf" });
  await expect(listen).toBeDisabled();
  reply({
    center_freq: 144000000,
    samp_rate: 2400000,
    start_freq: 144500000,
    start_mod: "nfm",
  });
  await expect(band).toBeEnabled();
  await expect(band).toHaveValue("radio|vhf");
  await expect(channel).toHaveValue("144.5");
  await expect(spectrum).toContainText("144.000000 MHz · 2.400 MHz span");
  await expect(listen).toBeEnabled();
  expect(commands.some((c) => c.includes('"action":"start"'))).toBe(false);
  // Switch back on the same socket; stale old coordinates cannot confirm the target.
  await band.selectOption("radio|hf");
  reply({ center_freq: 144000000, samp_rate: 2400000, profile_id: "vhf" });
  await expect(listen).toBeDisabled();
  reply({ sdr_id: "radio", profile_id: "hf" });
  await expect(listen).toBeDisabled();
  reply(config);
  await expect(channel).toHaveValue("10");
  await expect(band).toHaveValue("radio|hf");
  await listen.click();
  await expect(page.locator(".remote-header-status")).toContainText(
    "listening",
  );
  expect(connections).toHaveLength(1);
  expect(closed).toHaveLength(0);
  expect(commands.filter((c) => c.includes('"action":"start"'))).toHaveLength(
    1,
  );
});

test("remote dock has one reliable collapse control and no size mode", async ({
  page,
}) => {
  await fixture(page);
  await enter(page);
  await expect(
    page.getByRole("button", { name: /^(Less space|More space)$/ }),
  ).toHaveCount(0);
  const dock = page.locator(".remote-footer");
  await dock.getByRole("button", { name: "Collapse", exact: true }).click();
  await expect(dock).toHaveClass(/is-collapsed/);
  await dock.getByRole("button", { name: "Expand", exact: true }).click();
  await expect(dock).toHaveClass(/is-expanded/);
  await dock.getByRole("button", { name: "Collapse", exact: true }).click();
  await dock.getByRole("tab", { name: "Session", exact: true }).click();
  await expect(
    dock.getByRole("button", { name: "Collapse", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});
