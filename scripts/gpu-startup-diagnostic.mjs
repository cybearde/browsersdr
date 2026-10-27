/* global document */
import { chromium } from "@playwright/test";
import http from "node:http";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
console.log(
  "HOST",
  JSON.stringify({
    node: process.version,
    cpus: os.cpus().map((c) => c.model),
    memory: os.totalmem(),
    gpuEnv: Object.fromEntries(
      [
        "VK_ICD_FILENAMES",
        "VK_DRIVER_FILES",
        "LIBGL_ALWAYS_SOFTWARE",
        "DISPLAY",
        "XDG_RUNTIME_DIR",
        "ANGLE_DEFAULT_PLATFORM",
        "XDG_SESSION_TYPE",
      ].map((k) => [k, process.env[k] ?? null]),
    ),
  }),
);
console.log(
  "VULKAN_PACKAGES",
  execFileSync("dpkg-query", ["-W", "libvulkan1", "mesa-vulkan-drivers"], {
    encoding: "utf8",
  }),
);
for (const name of readdirSync("/usr/share/vulkan/icd.d"))
  console.log(
    "ICD",
    name,
    readFileSync("/usr/share/vulkan/icd.d/" + name, "utf8"),
  );

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/plain");
  res.end("GPU environment diagnostic only");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/robots.txt`;
const base = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan",
  "--use-angle=vulkan",
  "--use-vulkan=swiftshader",
  "--use-webgpu-adapter=swiftshader",
  "--disable-vulkan-surface",
];
const modes = {
  baseline: [],
  gpu_in_tests: ["--use-gpu-in-tests"],
  unblocked: ["--ignore-gpu-blocklist"],
  watchdog: ["--disable-gpu-watchdog"],
  upstream_dawn: [
    "--use-gpu-in-tests",
    "--enable-dawn-features=allow_unsafe_apis",
    "--disable-dawn-features=use_dxc",
    "--enable-webgpu-developer-features",
    "--enable-accelerated-2d-canvas",
  ],
};
const order = Object.entries(modes);
const first = order.findIndex(
  ([name]) => name === process.env.GPU_DIAGNOSTIC_FIRST,
);
if (first > 0) order.push(...order.splice(0, first));
let failures = 0;
try {
  for (const [mode, extra] of order)
    for (let attempt = 1; attempt <= 5; attempt++) {
      const started = Date.now();
      let browser;
      try {
        browser = await chromium.launch({
          channel: "chromium",
          headless: true,
          args: [...base, ...extra],
          env: { ...process.env, LP_NUM_THREADS: "2" },
        });
        const page = await browser.newPage();
        page.on("console", (m) =>
          console.log("PAGE_CONSOLE", mode, attempt, m.type(), m.text()),
        );
        await page.goto(url);
        const result = await page.evaluate(async () => {
          const c = document.createElement("canvas");
          c.width = c.height = 1;
          const gl = c.getContext("webgl2");
          if (gl) {
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.finish();
          }
          try {
            const a = await navigator.gpu?.requestAdapter();
            if (!a) return { gl: !!gl, adapter: false, info: null };
            const device = await a.requestDevice();
            const errors = [];
            device.addEventListener("uncapturederror", (e) =>
              errors.push(e.error.message),
            );
            const c2 = document.createElement("canvas");
            c2.width = c2.height = 1;
            const target = c2.getContext("webgpu");
            target.configure({
              device,
              format: navigator.gpu.getPreferredCanvasFormat(),
            });
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: target.getCurrentTexture().createView(),
                  loadOp: "clear",
                  storeOp: "store",
                  clearValue: { r: 1, g: 0, b: 0, a: 1 },
                },
              ],
            });
            pass.end();
            device.queue.submit([encoder.finish()]);
            await device.queue.onSubmittedWorkDone();
            const copy = document.createElement("canvas");
            copy.width = copy.height = 1;
            const ctx = copy.getContext("2d");
            ctx.drawImage(c2, 0, 0);
            const pixels = [...ctx.getImageData(0, 0, 1, 1).data];
            const red =
              pixels[0] > 200 &&
              pixels[1] < 30 &&
              pixels[2] < 30 &&
              pixels[3] > 200;
            target.unconfigure();
            device.destroy();
            return {
              gl: !!gl,
              adapter: true,
              pixels,
              red,
              errors,
              info: {
                vendor: a.info.vendor,
                architecture: a.info.architecture,
              },
            };
          } catch (e) {
            return { gl: !!gl, error: String(e) };
          }
        });
        if (!result.adapter || !result.red || result.errors?.length) failures++;
        const cdp = await browser.newBrowserCDPSession();
        const info = await cdp.send("SystemInfo.getInfo");
        console.log(
          "GPU_RESULT",
          JSON.stringify({
            mode,
            attempt,
            seconds: (Date.now() - started) / 1000,
            result,
            featureStatus: info.gpu.featureStatus,
            aux: info.gpu.auxAttributes,
            devices: info.gpu.devices,
          }),
        );
      } catch (e) {
        failures++;
        console.log(
          "GPU_RESULT",
          JSON.stringify({ mode, attempt, error: String(e) }),
        );
      } finally {
        await browser?.close();
      }
    }
} finally {
  server.close();
}
console.log(
  "DIAGNOSTIC_SUMMARY",
  JSON.stringify({ node: process.version, failures, coldLaunches: 25 }),
);

process.exitCode = failures ? 1 : 0;
