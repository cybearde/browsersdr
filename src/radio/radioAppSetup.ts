import {
  defaultModeSettings,
  normalizeModeSettings,
  type ReceiverModeSettings,
} from "./receiverConfig";
import type { SrdProtocol } from "../srd/types";

export type SensorProtocol = Exclude<SrdProtocol, "none">;
export interface RadioAppSetup {
  region: "eu" | "us" | "jp";
  frequencyHz: number;
  sensorProtocol: SensorProtocol;
  scanStartHz: number;
  scanEndHz: number;
}
export const SENSOR_FAMILIES: readonly { id: SensorProtocol; label: string }[] =
  [
    { id: "fineoffset-wh2", label: "Fine Offset WH2 / TFA30.3157 · OOK" },
    { id: "acurite-592txr", label: "Acurite 592TXR · OOK" },
    { id: "fineoffset-wh51", label: "Fine Offset / Ecowitt WH51 · 2FSK" },
  ];
export const ACARS_CHANNELS = {
  eu: [131_725_000, 131_525_000, 131_825_000],
  us: [131_550_000, 130_025_000, 129_125_000],
  jp: [131_450_000],
} as const;
export const fmBand = (region: RadioAppSetup["region"]) =>
  region === "us"
    ? { minimumHz: 88_100_000, maximumHz: 107_900_000, stepHz: 200_000 }
    : { minimumHz: 87_500_000, maximumHz: 108_000_000, stepHz: 100_000 };
export function defaultRadioAppSetup(
  id: string,
  currentFrequencyHz = 100e6,
): RadioAppSetup {
  return {
    region: "eu",
    frequencyHz:
      id === "fm"
        ? currentFrequencyHz >= 87.5e6 && currentFrequencyHz <= 108e6
          ? currentFrequencyHz
          : 100e6
        : id === "aprs"
          ? 144.8e6
          : id === "balloons"
            ? 402e6
            : id === "acars"
              ? 131.725e6
              : 433.92e6,
    sensorProtocol: "fineoffset-wh2",
    scanStartHz: 402e6,
    scanEndHz: 403e6,
  };
}
export function normalizeRadioAppSetup(
  id: string,
  input: RadioAppSetup,
): RadioAppSetup {
  if (
    !input ||
    !["eu", "us", "jp"].includes(input.region) ||
    !SENSOR_FAMILIES.some((f) => f.id === input.sensorProtocol)
  )
    throw new Error("Choose a supported region and sensor family.");
  const band =
    id === "fm"
      ? fmBand(input.region)
      : id === "balloons"
        ? { minimumHz: 400.15e6, maximumHz: 406e6 }
        : id === "aprs"
          ? { minimumHz: 144e6, maximumHz: 148e6 }
          : id === "acars"
            ? { minimumHz: 118e6, maximumHz: 136.975e6 }
            : { minimumHz: 300e6, maximumHz: 1e9 };
  if (
    !Number.isSafeInteger(input.frequencyHz) ||
    input.frequencyHz < band.minimumHz ||
    input.frequencyHz > band.maximumHz
  )
    throw new Error(
      `Enter a channel between ${band.minimumHz / 1e6} and ${band.maximumHz / 1e6} MHz.`,
    );
  if (
    !Number.isSafeInteger(input.scanStartHz) ||
    !Number.isSafeInteger(input.scanEndHz) ||
    input.scanStartHz < 400.15e6 ||
    input.scanEndHz > 406e6 ||
    input.scanEndHz < input.scanStartHz ||
    Math.floor((input.scanEndHz - input.scanStartHz) / 25_000) + 1 > 64
  )
    throw new Error(
      "Balloon search needs 1–64 channels inside 400.15–406 MHz, in 25 kHz steps.",
    );
  return {
    region: input.region,
    frequencyHz: input.frequencyHz,
    sensorProtocol: input.sensorProtocol,
    scanStartHz: input.scanStartHz,
    scanEndHz: input.scanEndHz,
  };
}
export function appModeSettings(
  mode: ReceiverModeSettings["mode"],
  setup?: RadioAppSetup,
): ReceiverModeSettings {
  const settings = defaultModeSettings(mode);
  if (mode === "SRD") {
    settings.srd!.protocol = setup?.sensorProtocol ?? "fineoffset-wh2";
    settings.srd!.modulation =
      settings.srd!.protocol === "fineoffset-wh51" ? "2fsk" : "ook";
  }
  return settings;
}
export const sameAppModeSettings = (
  a: ReceiverModeSettings,
  b: ReceiverModeSettings,
) =>
  JSON.stringify(normalizeModeSettings(a)) ===
  JSON.stringify(normalizeModeSettings(b));
export function searchFrequencies(
  id: "fm" | "balloons",
  setup: RadioAppSetup,
  direction: 1 | -1 = 1,
): number[] {
  const valid = normalizeRadioAppSetup(id, setup);
  if (id === "balloons")
    return Array.from(
      {
        length: Math.floor((valid.scanEndHz - valid.scanStartHz) / 25_000) + 1,
      },
      (_, n) => valid.scanStartHz + n * 25_000,
    );
  const band = fmBand(valid.region),
    count = Math.floor((band.maximumHz - band.minimumHz) / band.stepHz) + 1;
  const at =
    direction === 1
      ? Math.floor((valid.frequencyHz - band.minimumHz) / band.stepHz)
      : Math.ceil((valid.frequencyHz - band.minimumHz) / band.stepHz);
  return Array.from(
    { length: count },
    (_, n) =>
      band.minimumHz +
      ((at + direction * (n + 1) + count * 2) % count) * band.stepHz,
  );
}
