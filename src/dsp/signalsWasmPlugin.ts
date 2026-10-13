import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const adapter = fileURLToPath(
  new URL("./signalsWasmBytes.ts", import.meta.url),
);

/** Use the compatibility bytes only inside the pinned Signals WASM wrappers. */
export function signalsWasmCompatibility(): Plugin {
  return {
    name: "signals-wasm-compatibility",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        source === "./wasm-bytes.js" &&
        importer?.replaceAll("\\", "/").includes("/@jtarrio/signals/dist/wasm/")
      ) {
        return adapter;
      }
    },
  };
}
