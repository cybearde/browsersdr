import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { signalsWasmCompatibility } from "./src/dsp/signalsWasmPlugin.ts";

export default defineConfig({
  plugins: [react(), signalsWasmCompatibility()],
  test: {
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "standard",
          // Release/validation snapshots under .local are reference material.
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/dsp/signalCenter.test.ts"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "native-fine-tuning",
          include: ["src/dsp/signalCenter.test.ts"],
          // Native-rate fixtures process millions of IQ samples. Give them
          // a separate phase instead of competing with another DSP worker.
          maxWorkers: 1,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
