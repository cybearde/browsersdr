import { expect, test } from "@playwright/test";
import { openApplicationView } from "./application-navigation";
import { CONVOLVER } from "@jtarrio/signals/wasm/wasm-bytes.js";

// Reproduce the owner's missing feature without depending on a runner's CPU or
// Safari version. Only the exact upstream relaxed-SIMD kernel is rejected; the
// standard replacement and every other WASM module execute in the real engine.
test("starts and demodulates when relaxed SIMD is unavailable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((upstreamBytes: number[]) => {
    const originalValidate = WebAssembly.validate.bind(WebAssembly);
    const rejects = (source: BufferSource) => {
      const bytes = ArrayBuffer.isView(source)
        ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
        : new Uint8Array(source);
      return (
        bytes.length === upstreamBytes.length &&
        bytes.every((value, i) => value === upstreamBytes[i])
      );
    };
    WebAssembly.validate = (source) =>
      rejects(source) ? false : originalValidate(source);
    WebAssembly.Module = new Proxy(WebAssembly.Module, {
      construct(target, args, newTarget) {
        if (rejects(args[0] as BufferSource))
          throw new WebAssembly.CompileError(
            "relaxed simd instructions not supported",
          );
        return Reflect.construct(target, args, newTarget);
      },
    });
  }, Array.from(CONVOLVER));
  await page.goto("/");
  await expect(
    page.getByRole("tab", { name: "Receiver", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Signal source", exact: true })
    .selectOption("synthetic");
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
  await openApplicationView(page, "Diagnostics");
  const analysisBlocks = page
    .getByText("Analysis blocks", { exact: true })
    .locator("xpath=following-sibling::dd");
  await expect
    .poll(async () =>
      Number((await analysisBlocks.textContent())?.replaceAll(",", "") ?? 0),
    )
    .toBeGreaterThan(0);
  await openApplicationView(page, "Receiver");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await expect(page.locator(".receiver-status")).toContainText(
    "Synthetic RF demo running",
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(errors).toEqual([]);
});
