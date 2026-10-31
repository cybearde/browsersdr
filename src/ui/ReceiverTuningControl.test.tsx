// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReceiverTuningControl } from "./ReceiverTuningControl";
import { SYNTHETIC_DEMO_SESSION } from "../testing/syntheticTone";

let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function setup(replay = false, channelPending = false, centerHz = 100e6) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const tune = vi.fn(
    async (_frequencyHz: number): Promise<string | undefined> => undefined,
  );
  const auto = vi.fn();
  const session = {
    ...SYNTHETIC_DEMO_SESSION,
    source: replay ? ("replay" as const) : ("synthetic" as const),
    hardwareCenterFrequencyHz: centerHz,
    selectedChannelFrequencyHz: 100.1e6,
    channelBandwidthHz: 150_000,
  };
  await act(async () =>
    root.render(
      <ReceiverTuningControl
        session={session}
        configuredFrequencyHz={100e6}
        disabled={false}
        autoRecenter
        channelPending={channelPending}
        onAutoRecenter={auto}
        onTuneCenter={tune}
      />,
    ),
  );
  const input = host.querySelector('input[type="number"]') as HTMLInputElement;
  const button = (text: string) =>
    Array.from(host.querySelectorAll("button")).find(
      (node) => node.textContent === text,
    )!;
  const edit = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  return { host, tune, auto, input, button, edit };
}
it("validates receiver edits before tuning, supports Escape/Enter and centers on the accepted channel", async () => {
  const ui = await setup();
  expect(ui.input.value).toBe("100.000");
  await ui.edit("101");
  expect(ui.button("Set").disabled).toBe(false);
  expect(ui.input.getAttribute("aria-invalid")).toBe("false");
  expect(ui.host.textContent).toContain("switches to Spectrum only");
  await act(async () =>
    ui.input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(ui.input.value).toBe("100.000");
  expect(ui.input.getAttribute("aria-invalid")).toBe("false");
  await ui.edit("100.2");
  await act(async () =>
    ui.input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(ui.tune).toHaveBeenLastCalledWith(100.2e6);
  await act(async () => ui.button("To channel").click());
  expect(ui.tune).toHaveBeenLastCalledWith(100.1e6);
});
it("allows Set and Enter outside the channel window while rejecting invalid hardware frequencies", async () => {
  const ui = await setup();
  await ui.edit("110");
  await act(async () => ui.button("Set").click());
  expect(ui.tune).toHaveBeenLastCalledWith(110e6);
  await ui.edit("120");
  await act(async () => ui.input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true})));
  expect(ui.tune).toHaveBeenLastCalledWith(120e6);
  await ui.edit("-1");
  expect(ui.button("Set").disabled).toBe(true);
  expect(ui.input.getAttribute("aria-invalid")).toBe("true");
});
it("keeps receiver center read-only for replay", async () => {
  const ui = await setup(true);
  expect(ui.input.disabled).toBe(true);
  expect(ui.button("To channel").disabled).toBe(true);
  expect(ui.host.textContent).toContain("fixed during replay");
});
it("keeps accepted whole-Hz hardware precision visible while editing", async () => {
  const ui = await setup(false, false, 100e6 - 17);
  expect(ui.input.value).toBe("99.999983");
  await act(async () => ui.input.focus());
  expect(ui.input.value).toBe("99.999983");
  expect(ui.button("Set").disabled).toBe(true);
  await act(async () => ui.input.blur());
  expect(ui.input.value).toBe("99.999983");
  expect(ui.tune).not.toHaveBeenCalled();
  await ui.edit("100.123456");
  await act(async () => ui.button("Set").click());
  expect(ui.tune).toHaveBeenCalledWith(100_123_456);
});
it("lets users enable auto re-center while a channel edit is pending", async () => {
  const ui = await setup(false, true);
  expect(ui.input.disabled).toBe(false);
  const checkbox = ui.host.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement;
  expect(checkbox.disabled).toBe(false);
  await act(async () => checkbox.click());
  expect(ui.auto).toHaveBeenCalledWith(false);
});
it("applies the pending channel with an explicit center instead of locking both controls", async () => {
  const ui = await setup(false, true, 101e6);
  expect(ui.button("To channel").disabled).toBe(false);
  await act(async () => ui.button("To channel").click());
  expect(ui.tune).toHaveBeenLastCalledWith(100e6);
  await ui.edit("100.05");
  expect(ui.button("Set").disabled).toBe(false);
  await act(async () => ui.button("Set").click());
  expect(ui.tune).toHaveBeenLastCalledWith(100.05e6);
});
