import { expect, type Page } from "@playwright/test";
/** Paced generated I/Q through the real RTL adapter and actual decoder workers.
 * Browser USB/DSP lifecycle evidence, never physical RF reception. */
export async function installSource(
  page: Page,
  encoded = "",
  expectedFrequency = 0,
  options: { permissionDelayMs?: number; openFailures?: number } = {},
) {
  await page.addInitScript(
    ({ encoded, expectedFrequency, options }) => {
      const binary = atob(encoded),
        data = new Uint8Array(binary.length);
      // Avoid TypedArray.from's temporary iterable list for multi-megabyte I/Q.
      // Every byte is identical; this changes fixture allocation, not RF or assertions.
      for (let n = 0; n < binary.length; n++) data[n] = binary.charCodeAt(n);
      const state = { opens: 0, starts: 0, centers: [] as number[] };
      (
        window as unknown as { radioAppsFixture: typeof state }
      ).radioAppsFixture = state;
      Object.defineProperty(navigator, "usb", {
        configurable: true,
        value: { getDevices: async () => [] },
      });
      let rate = 1_024_000,
        frequency = 100e6,
        at = 0,
        nextAt = 0;
      const config = {
        rtlDependencies: {
          createSourceProvider: (
            permission: () => void,
            capture: (bytes: ArrayBuffer) => void,
          ) => ({
            get: async () => {
              state.opens++;
              if (options.permissionDelayMs)
                await new Promise((resolve) =>
                  setTimeout(resolve, options.permissionDelayMs),
                );
              if (state.opens <= (options.openFailures ?? 0))
                throw new Error("Test receiver permission cancelled");
              permission();
              return {
                setSampleRate: async (value: number) => {
                  rate = value;
                  return value;
                },
                setCenterFrequency: async (value: number) => {
                  frequency = value;
                  at = 0;
                  state.centers.push(value);
                  return value;
                },
                setParameter: async <V>(_name: string, value: V) => value,
                startReceiving: async () => {
                  state.starts++;
                  nextAt = performance.now();
                },
                readSamples: (count: number) => {
                  const center = frequency;
                  nextAt =
                    Math.max(nextAt, performance.now()) + (count / rate) * 1000;
                  return new Promise((resolve) =>
                    setTimeout(
                      () => {
                        const bytes = new Uint8Array(count * 2),
                          I = new Float32Array(count),
                          Q = new Float32Array(count);
                        for (let n = 0; n < count; n++) {
                          bytes[n * 2] =
                            data.length && center === expectedFrequency
                              ? data[at++ % data.length]!
                              : 128;
                          bytes[n * 2 + 1] =
                            data.length && center === expectedFrequency
                              ? data[at++ % data.length]!
                              : 128;
                          I[n] = (bytes[n * 2]! - 127.5) / 128;
                          Q[n] = (bytes[n * 2 + 1]! - 127.5) / 128;
                        }
                        capture(bytes.buffer);
                        resolve({ I, Q, frequency: center });
                      },
                      Math.max(0, nextAt - performance.now()),
                    ),
                  );
                },
                close: async () => {},
              };
            },
          }),
        },
      };
      (
        window as unknown as { __BROWSERSDR_TEST_CONFIG__: unknown }
      ).__BROWSERSDR_TEST_CONFIG__ = config;
    },
    { encoded, expectedFrequency, options },
  );
}
export async function launch(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Radio Apps", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Radio Apps", exact: true });
  await dialog
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "Open app" })
    .click();
  await dialog
    .getByRole("button", {
      name: /^(Use settings & open|Stop & prepare app|Open current reception)$/,
    })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("tab", { name: "Decoder", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}
export async function start(page: Page) {
  const app = page.getByRole("region", { name: "Active Radio App" });
  await app
    .getByRole("button", { name: "Start receiving", exact: true })
    .click();
  await expect(
    app.getByRole("button", { name: "Stop receiving", exact: true }),
  ).toBeEnabled();
}
export async function expectAppFits(page: Page) {
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [768, 950],
    [390, 844],
    [320, 760],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      const layout = await page.evaluate(
        ({ width, height }) => {
          const root = document.querySelector(".radio-app-view")!;
          const overflow = [
            ...root.querySelectorAll<HTMLElement>(
              ".decoder-record-list, .radio-app-dab, .radio-app-programmes, .decoder-stage, .radio-app-media",
            ),
          ]
            .filter(
              (el) => el.clientHeight && el.scrollHeight > el.clientHeight + 2,
            )
            .map((el) => ({
              name: el.className,
              client: el.clientHeight,
              scroll: el.scrollHeight,
            }));
          const outside = [
            ...document.querySelectorAll<HTMLElement>(
              ".radio-app-context, .decoder-stage, .decoder-footer, .radio-app-pagination",
            ),
          ]
            .filter(
              (el) =>
                el.clientHeight && el.getBoundingClientRect().bottom > height,
            )
            .map((el) => el.className);
          const boxes = [
            ...document.querySelectorAll<HTMLElement>(
              ".radio-apps-entry button, .workspace-controls > button, .workspace-controls > details > summary, .receiver-status-menu > summary",
            ),
          ].map((el) => el.getBoundingClientRect());
          let overlaps = 0;
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i]!,
                b = boxes[j]!;
              if (
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
              )
                overlaps++;
            }
          return {
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
            expectedWidth: width,
            expectedHeight: height,
            overflow,
            outside,
            overlaps,
          };
        },
        { width, height },
      );
      expect(layout).toEqual({
        width,
        height,
        expectedWidth: width,
        expectedHeight: height,
        overflow: [],
        outside: [],
        overlaps: 0,
      });
    }).toPass({ timeout: 4000 });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
