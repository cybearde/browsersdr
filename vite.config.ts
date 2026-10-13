import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { signalsWasmCompatibility } from "./src/dsp/signalsWasmPlugin.ts";
import { seoAssets } from "./scripts/seo-site.mjs";

const LOCAL_USRP_PREFIX = "/local/usrp-b205/";
const LOCAL_USRP_ARTIFACTS = new Set(["ad9364-no-os.js", "ad9364-no-os.wasm"]);
const localUsrpDirectory = fileURLToPath(new URL("./.local/usrp-b205/", import.meta.url));
const ASYNCIFY_READY_MARKER = "wasmExports=await (createWasm());run();";

// Ship the same terms shown in About with every static build, without
// maintaining separate copies in public/ that can drift from the originals.
function staticSiteDocuments(): Record<string, string> {
  return {
    ...seoAssets(),
    "LICENSE.txt": readFileSync(new URL("./LICENSE", import.meta.url), "utf8"),
    "SIGNALS-LICENSE.txt": readFileSync(new URL("./src/dsp/signals-APACHE-LICENSE.txt", import.meta.url), "utf8"),
    "NOTICE.txt": readFileSync(new URL("./NOTICE", import.meta.url), "utf8"),
    "THIRD_PARTY_NOTICES.txt": readFileSync(
      new URL("./THIRD_PARTY_NOTICES.md", import.meta.url), "utf8",
    ),
  };
}

function prepareLocalNoOsJavascript(bytes: Buffer): Buffer {
  const source = bytes.toString("utf8");
  if (!source.includes(ASYNCIFY_READY_MARKER)) {
    throw new Error("Local USRP no-OS module does not have the pinned Asyncify wrapper shape.");
  }
  return Buffer.from(source.replace(
    ASYNCIFY_READY_MARKER,
    `${ASYNCIFY_READY_MARKER}Module["awaitAsyncify"]=(result)=>Asyncify.currData?Asyncify.whenDone():Promise.resolve(result);`,
  ));
}

export default defineConfig({
  // Keep the app, stylesheet and module worker relocatable as one static directory.
  base: "./",
  // A worktree must not rewrite another checkout's development dependency cache.
  cacheDir: ".local/vite",
  // The DAB worker is loaded on demand, outside the initial page import scan.
  // Prebundle its DSP imports before serving worker modules to avoid stale
  // optimized dependency URLs on the first DAB startup.
  optimizeDeps: {
    rolldownOptions: { plugins: [signalsWasmCompatibility()] },
    include: [
      "@jtarrio/signals/dsp/fft.js",
      "@jtarrio/signals/dsp/resamplers.js",
    ],
  },
  worker: { plugins: () => [signalsWasmCompatibility()] },
  plugins: [
    react(),
    signalsWasmCompatibility(),
    {
      name: "static-site-documents",
      generateBundle() {
        for (const [fileName, source] of Object.entries(staticSiteDocuments())) {
          this.emitFile({ type: "asset", fileName, source });
        }
      },
      configureServer(server) {
        const assets = staticSiteDocuments();
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          const key = url.pathname.slice(1);
          const fileName = url.pathname.endsWith("/") ? `${key}index.html` : key;
          const source = assets[fileName];
          if (source === undefined) {
            if (assets[`${key}/index.html`] !== undefined) {
              response.writeHead(308, { Location: `${url.pathname}/${url.search}` });
              response.end();
              return;
            }
            next();
            return;
          }
          const type = fileName.endsWith(".html") ? "text/html" : fileName.endsWith(".css") ? "text/css" : fileName.endsWith(".xml") ? "application/xml" : "text/plain";
          response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-cache" });
          response.end(request.method === "HEAD" ? undefined : source);
        });
      },
    },
    {
      name: "local-usrp-b205-no-os",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
          if (!pathname.startsWith(LOCAL_USRP_PREFIX)) return next();
          const artifact = pathname.slice(LOCAL_USRP_PREFIX.length);
          if (!LOCAL_USRP_ARTIFACTS.has(artifact)) return next();
          void readFile(new URL(artifact, `file://${localUsrpDirectory}`)).then(
            (bytes) => {
              const body = artifact.endsWith(".js") ? prepareLocalNoOsJavascript(bytes) : bytes;
              response.statusCode = 200;
              response.setHeader(
                "Content-Type",
                artifact.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8",
              );
              response.setHeader("Cache-Control", "no-store");
              response.end(body);
            },
            () => {
              response.statusCode = 404;
              response.end("Local USRP test artifact not built.");
            },
          );
        });
      },
    },
  ],
});
