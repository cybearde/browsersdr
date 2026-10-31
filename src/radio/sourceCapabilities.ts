import { normalizeRtlInput, rtlDeviceFrequency } from "./rtlInput";
import { AIRSPY_SAMPLE_RATES, airspyChannelRate, isAirspyRate, DEFAULT_AIRSPY_SETTINGS, validateAirspySettings, type AirspySettings } from "./airspySettings";
import { DEFAULT_BLADERF_RX_SETTINGS, validateBladeRfRxSettings, type BladeRfRxSettings } from "./bladerfSettings";
import type { SourceKind } from "./types";
import { RTL_SAMPLE_RATES_HZ, RTL_EXPERIMENTAL_SAMPLE_RATE_HZ } from "./rtlSampleRate";
import {
  defaultModeSettings, normalizeGain, normalizeModeSettings, planChannelTune,
  RECEIVER_MODES, validateModeSampleRate, type ReceiverMode, type ReceiverModeSettings,
} from "./receiverConfig";
import {
  DEFAULT_USRP_B205_RX_SETTINGS,
  USRP_B205_EXPERIMENTAL_SAMPLE_RATE_HZ,
  USRP_B205_SAMPLE_RATE_HZ,
  USRP_B205_SAMPLE_RATES_HZ,
  validateUsrpB205RxSettings,
  type UsrpB205RxSettings,
} from "./usrpB205Capabilities";

/** Frozen step-01 profile, not a claim about the firmware shipped on a device. */
export const HACKRF_PROTOCOL_PROFILE = "hackrf-pro-standard-7f96cc8-v1" as const;
export const HACKRF_REFERENCE_COMMIT = "7f96cc8e3fa625c4263a71ba8dd44d1f6110e4fa" as const;
export const HACKRF_STABLE_PROFILE = "hackrf-pro-stable-2026-v1" as const;
export const HACKRF_STABLE_REFERENCE_COMMIT = "1cfe7dfe98d333450217d50e3f3a1ad0702e000f" as const;
export const HACKRF_ONE_PROFILE = "hackrf-one-stable-2026-v1" as const;
export type HackrfKind = "hackrf-pro" | "hackrf-one";
export const HACKRF_ONE_SAMPLE_RATES_HZ = [9_600_000] as const;
export const HACKRF_ONE_LNA_CODES = [0, 8, 16, 24, 32, 40] as const;
export const hackrfLabel = (kind?: HackrfKind): string => kind === "hackrf-one" ? "HackRF One" : kind === "hackrf-pro" ? "HackRF Pro" : "HackRF One / Pro";
export type HackrfProtocolProfile = typeof HACKRF_PROTOCOL_PROFILE | typeof HACKRF_STABLE_PROFILE | typeof HACKRF_ONE_PROFILE;
export type HackrfReferenceCommit = typeof HACKRF_REFERENCE_COMMIT | typeof HACKRF_STABLE_REFERENCE_COMMIT;
export const isStableHackrfApi = (api: number): boolean => api === 0x0109 || api === 0x0110;
export const isSupportedHackrfApi = (api: number): boolean => isStableHackrfApi(api) || api === 0x0113;
export const LIVE_SAMPLE_RATES_HZ = [1_024_000, 2_400_000] as const;
export const HACKRF_SAMPLE_RATES_HZ = [1_024_000, 2_400_000, 4_800_000, 9_600_000, 19_200_000] as const;
export const BLADERF_SAMPLE_RATES_HZ = [2_400_000, 4_800_000, 9_600_000, 19_200_000] as const;
export type BladeRfSampleRateHz = typeof BLADERF_SAMPLE_RATES_HZ[number];
export type HackrfSampleRateHz = typeof HACKRF_SAMPLE_RATES_HZ[number];
export const isWidebandRate = (rate: number): boolean => rate === 4_800_000 || rate === 9_600_000 || rate === 19_200_000 || isAirspyRate(rate);
export const channelSampleRate = (nativeRate: number): number => isAirspyRate(nativeRate) ? airspyChannelRate(nativeRate) : isWidebandRate(nativeRate) ? 2_400_000 : nativeRate;
export const hackrfDecimationExponent = (rate: number): number => rate === 1_024_000 ? 5 : rate === 2_400_000 ? 4 : rate === 4_800_000 ? 3 : rate === 9_600_000 ? 2 : 1;
export const hackrfDecimationFactor = (rate: number): 2 | 4 | 8 | 16 | 32 => rate === 1_024_000 ? 32 : rate === 2_400_000 ? 16 : rate === 4_800_000 ? 8 : rate === 9_600_000 ? 4 : 2;
export type HostResampling = { kind: "none"; numerator: 1; denominator: 1 }
  | { kind: "channel-fir-decimate-2-v1"; numerator: 1; denominator: 2 }
  | { kind: "channel-fir-decimate-4-v1"; numerator: 1; denominator: 4 }
  | { kind: "channel-fir-decimate-8-v1"; numerator: 1; denominator: 8 };
export const hostResamplingForRate = (rate: number): HostResampling => rate === 19_200_000
  ? { kind: "channel-fir-decimate-8-v1", numerator: 1, denominator: 8 }
  : rate === 9_600_000
  ? { kind: "channel-fir-decimate-4-v1", numerator: 1, denominator: 4 }
  : rate === 4_800_000
  ? { kind: "channel-fir-decimate-2-v1", numerator: 1, denominator: 2 }
  : { kind: "none", numerator: 1, denominator: 1 };
export type HackrfLnaGainCode = 0 | 8 | 16 | 24 | 32 | 33 | 40;

export interface HackrfRxSettings {
  kind: "hackrf";
  rxLnaGainCode: HackrfLnaGainCode;
  rxVgaGainDb: number;
  rfAmplifierEnabled: boolean;
  antennaPowerEnabled: boolean;
}
export const DEFAULT_HACKRF_RX_SETTINGS: Readonly<HackrfRxSettings> = Object.freeze({
  kind: "hackrf", rxLnaGainCode: 16, rxVgaGainDb: 12,
  rfAmplifierEnabled: false, antennaPowerEnabled: false,
});

export interface HackrfIdentity {
  kind: HackrfKind;
  vendorId: number;
  productId: number;
  boardId: number;
  boardRevisionRaw: number;
  usbApiVersion: number;
  firmwareVersion: string;
  partIdWords: readonly [number, number];
  serialWords: readonly [number, number, number, number];
  platformSupport: number;
}

/** Only the adapter may supply these results after checking actual transfers. */
export interface HackrfRuntimeEvidence {
  identity: HackrfIdentity;
  descriptorLayoutVerified: boolean;
  mandatoryQueriesVerified: boolean;
  standardImageIndex: number | null;
  standardImageSelectionAcknowledged: boolean;
}
export interface HackrfDiscoveredCapabilities {
  source: "hackrf";
  phase: "discovered";
  protocolProfile: HackrfProtocolProfile;
  referenceCommit: HackrfReferenceCommit;
  identity: HackrfIdentity;
  nativeEncoding: "ci8";
  standardImageIndex: 0 | null;
  formatEvidence: "standard-image-selection-acknowledged" | "firmware-standard-ci8";
  /** Probes are not firmware authentication or physical validation. */
  firmwareBuildValidation: "unvalidated";
  hardwareValidation: "pending";
}

export interface HackrfCaptureSettings extends HackrfRxSettings {
  requestedCenterFrequencyHz: number;
  requestedSampleRateHz: HackrfSampleRateHz;
  appliedRateFixed36: string | null;
  appliedRfFixed24: string | null;
  appliedRotation: number | null;
  reportedBasebandBandwidthHz: number | null;
  reportedAnalogLpfTargetHz: number | null;
  settingsEvidence: "accepted-and-firmware-reported" | "usb-acknowledged";
  /** SPI readback of the stable gateware control byte; not an RF/rate readback. */
  stableFpgaControl?: number;
  /** Nominal One analog filter request; not a measured/read-back bandwidth. */
  requestedBasebandBandwidthHz?: number;
}

/** Optional on legacy sessions; mandatory for the forthcoming HackRF backend. */
export interface HackrfSessionDetails {
  capabilities: HackrfDiscoveredCapabilities;
  nativeEncoding: "ci8";
  nativeSampleRateHz: number;
  effectiveSampleRateHz: number;
  adcSampleRateHz: number;
  fpgaDecimationFactor: 1 | 2 | 4 | 8 | 16 | 32;
  hostResampling: HostResampling;
  rateEvidence: "firmware-reported" | "requested-and-acknowledged";
  captureSettings: HackrfCaptureSettings;
}

export interface SourceCapabilities {
  readonly source: SourceKind;
  readonly label: string;
  readonly requiresUsb: boolean;
  readonly persistentConnection: boolean;
  readonly frequency: { readonly minimumHz: number; readonly maximumHz: number; readonly integerHz: boolean; readonly limitsDiscoveredAtTune: boolean };
  readonly rates: { readonly kind: "choices"; readonly valuesHz: readonly number[]; readonly defaultHz: number; readonly experimentalHz?: readonly number[] }
    | { readonly kind: "recording"; readonly minimumHz: number; readonly maximumHz: number };
  readonly modes: readonly ReceiverMode[];
  readonly gain: { readonly kind: "rtl-auto-manual"; readonly minimumDb: number; readonly maximumDb: number }
    | { readonly kind: "hackrf-stages"; readonly lnaCodes: readonly HackrfLnaGainCode[]; readonly vgaMinimumDb: number; readonly vgaMaximumDb: number; readonly vgaStepDb: number; readonly antennaPowerEnabled: false }
    | { readonly kind: "usrp-fixed-agc"; readonly mode: "slow_agc"; readonly exposedGainDb: false }
    | { readonly kind: "bladerf-rx" }
    | { readonly kind: "airspy-stages" }
    | { readonly kind: "none" };
}

const legacyFrequency = { minimumHz: Number.MIN_VALUE, maximumHz: Number.MAX_SAFE_INTEGER, integerHz: false, limitsDiscoveredAtTune: false };
const sourceDefaults: Record<SourceKind, SourceCapabilities> = {
  airspy: {
    source: "airspy", label: "Airspy R2 / Mini", requiresUsb: true, persistentConnection: true,
    frequency: { minimumHz: 24_000_000, maximumHz: 1_800_000_000, integerHz: true, limitsDiscoveredAtTune: false },
    rates: { kind: "choices", valuesHz: AIRSPY_SAMPLE_RATES, defaultHz: 2_500_000 }, modes: RECEIVER_MODES,
    gain: { kind: "airspy-stages" },
  },
  "rtl-sdr": {
    source: "rtl-sdr", label: "RTL-SDR", requiresUsb: true, persistentConnection: true,
    frequency: { ...legacyFrequency, limitsDiscoveredAtTune: true },
    rates: { kind: "choices", valuesHz: RTL_SAMPLE_RATES_HZ, defaultHz: 1_024_000, experimentalHz: [RTL_EXPERIMENTAL_SAMPLE_RATE_HZ] }, modes: RECEIVER_MODES,
    gain: { kind: "rtl-auto-manual", minimumDb: 0, maximumDb: 49.6 },
  },
  hackrf: {
    source: "hackrf", label: "HackRF One / Pro", requiresUsb: true, persistentConnection: true,
    frequency: { minimumHz: 100_000, maximumHz: 6_000_000_000, integerHz: true, limitsDiscoveredAtTune: false },
    rates: { kind: "choices", valuesHz: HACKRF_SAMPLE_RATES_HZ, defaultHz: 9_600_000 }, modes: RECEIVER_MODES,
    gain: { kind: "hackrf-stages", lnaCodes: [0, 16, 33], vgaMinimumDb: 0, vgaMaximumDb: 62, vgaStepDb: 2, antennaPowerEnabled: false },
  },
  bladerf: {
    source: "bladerf", label: "bladeRF 2.0 Micro", requiresUsb: true, persistentConnection: true,
    frequency: { minimumHz: 70_000_000, maximumHz: 6_000_000_000, integerHz: true, limitsDiscoveredAtTune: false },
    rates: { kind: "choices", valuesHz: BLADERF_SAMPLE_RATES_HZ, defaultHz: 2_400_000, experimentalHz: [19_200_000] }, modes: RECEIVER_MODES,
    gain: { kind: "bladerf-rx" },
  },
  "usrp-b205": {
    source: "usrp-b205", label: "USRP B205-mini", requiresUsb: true, persistentConnection: true,
    frequency: { minimumHz: 70_000_000, maximumHz: 6_000_000_000, integerHz: true, limitsDiscoveredAtTune: false },
    rates: { kind: "choices", valuesHz: USRP_B205_SAMPLE_RATES_HZ, defaultHz: USRP_B205_SAMPLE_RATE_HZ,
      experimentalHz: [USRP_B205_EXPERIMENTAL_SAMPLE_RATE_HZ] }, modes: RECEIVER_MODES,
    gain: { kind: "usrp-fixed-agc", mode: "slow_agc", exposedGainDb: false },
  },
  synthetic: {
    source: "synthetic", label: "Synthetic spectrum demo", requiresUsb: false, persistentConnection: false,
    frequency: legacyFrequency,
    rates: { kind: "choices", valuesHz: [1_024_000], defaultHz: 1_024_000 },
    modes: ["OFF", "WBFM", "NBFM", "AM", "USB", "LSB"], gain: { kind: "none" },
  },
  replay: {
    source: "replay", label: "I/Q replay", requiresUsb: false, persistentConnection: false,
    frequency: legacyFrequency, rates: { kind: "recording", minimumHz: 8_000, maximumHz: 19_200_000 },
    modes: RECEIVER_MODES, gain: { kind: "none" },
  },
};

export function sourceCapabilities(source: SourceKind, identity?: HackrfIdentity): SourceCapabilities {
  if (!Object.hasOwn(sourceDefaults, source)) throw new Error(`Unsupported signal source: ${String(source)}`);
  const caps = sourceDefaults[source];
  if (source === "hackrf" && identity?.kind === "hackrf-one") return {
    ...caps, label: "HackRF One", frequency: { ...caps.frequency, minimumHz: 1_000_000 },
    rates: { kind: "choices", valuesHz: HACKRF_ONE_SAMPLE_RATES_HZ, defaultHz: 9_600_000, experimentalHz: HACKRF_ONE_SAMPLE_RATES_HZ },
    gain: { kind: "hackrf-stages", lnaCodes: HACKRF_ONE_LNA_CODES, vgaMinimumDb: 0, vgaMaximumDb: 62, vgaStepDb: 2, antennaPowerEnabled: false },
  };
  if (source === "hackrf" && !identity && caps.gain.kind === "hackrf-stages") return { ...caps, gain: { ...caps.gain, lnaCodes: [0, 8, 16, 24, 32, 33, 40] } };
  return identity?.kind === "hackrf-pro" && source === "hackrf" ? { ...caps, label: "HackRF Pro" } : caps;
}

export function validateHackrfRxSettings(settings: HackrfRxSettings, kind: HackrfKind | "unknown" = "hackrf-pro"): HackrfRxSettings {
  const codes: readonly number[] = kind === "hackrf-one" ? HACKRF_ONE_LNA_CODES : kind === "unknown" ? [0, 8, 16, 24, 32, 33, 40] : [0, 16, 33];
  if (settings.kind !== "hackrf" || !codes.includes(settings.rxLnaGainCode)) throw new Error(`${hackrfLabel(kind === "unknown" ? undefined : kind)} RX LNA gain code must be ${codes.join(", ")}.`);
  if (!Number.isInteger(settings.rxVgaGainDb) || settings.rxVgaGainDb < 0 || settings.rxVgaGainDb > 62 || settings.rxVgaGainDb % 2 !== 0) throw new Error("HackRF RX VGA gain must be an even integer from 0 to 62 dB.");
  if (typeof settings.rfAmplifierEnabled !== "boolean" || typeof settings.antennaPowerEnabled !== "boolean") throw new Error("HackRF RF amplifier must be boolean and antenna power must be boolean.");
  return { ...settings };
}

export function validateHackrfIdentity(id: HackrfIdentity): void {
  const word = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
  const revision = id.boardRevisionRaw & 0x7f;
  const one = id.kind === "hackrf-one";
  const variantValid = one
    ? id.usbApiVersion === 0x0110 && ((id.boardId === 2 && [0, 1, 2, 3].includes(revision) && (id.platformSupport & 2) !== 0)
      || (id.boardId === 4 && [4, 5].includes(revision) && (id.platformSupport & 8) !== 0))
    : id.kind === "hackrf-pro" && id.boardId === 5 && [9, 10, 11].includes(revision)
      && isSupportedHackrfApi(id.usbApiVersion) && (id.platformSupport & 0x10) !== 0;
  if (!variantValid || id.vendorId !== 0x1d50 || id.productId !== 0x6089
    || !Number.isInteger(id.boardRevisionRaw) || id.boardRevisionRaw < 0 || id.boardRevisionRaw > 255
    || !word(id.platformSupport) || !/^[\x20-\x7e]{1,31}$/.test(id.firmwareVersion)
    || id.partIdWords.length !== 2 || !id.partIdWords.every(word) || id.serialWords.length !== 4 || !id.serialWords.every(word)) {
    throw new Error(`Incompatible ${hackrfLabel(id.kind)} identity requires a supported profile: board ${id.boardId}, revision ${id.boardRevisionRaw}, API 0x${id.usbApiVersion.toString(16)}, firmware ${id.firmwareVersion}. One requires USB API 0x0110 (official v2026.01.3 baseline), recognized pre-r9/r9+ hardware; Pro requires production revision 9–11 and API 0x0109/0x0110 or 0x0113.`);
  }
}
export function discoverHackrfCapabilities(evidence: HackrfRuntimeEvidence): HackrfDiscoveredCapabilities {
  const id = evidence.identity;
  validateHackrfIdentity(id);
  const one = id.kind === "hackrf-one";
  if (evidence.descriptorLayoutVerified !== true || evidence.mandatoryQueriesVerified !== true
    || (one ? evidence.standardImageIndex !== null || evidence.standardImageSelectionAcknowledged !== false
      : evidence.standardImageIndex !== 0 || evidence.standardImageSelectionAcknowledged !== true)) throw new Error("Invalid HackRF format/profile evidence.");
  return {
    source: "hackrf", phase: "discovered",
    protocolProfile: one ? HACKRF_ONE_PROFILE : isStableHackrfApi(id.usbApiVersion) ? HACKRF_STABLE_PROFILE : HACKRF_PROTOCOL_PROFILE,
    referenceCommit: one || isStableHackrfApi(id.usbApiVersion) ? HACKRF_STABLE_REFERENCE_COMMIT : HACKRF_REFERENCE_COMMIT,
    identity: structuredClone(id), nativeEncoding: "ci8", standardImageIndex: one ? null : 0,
    formatEvidence: one ? "firmware-standard-ci8" : "standard-image-selection-acknowledged",
    firmwareBuildValidation: "unvalidated", hardwareValidation: "pending",
  };
}

export function validateSourceFrequency(source: SourceKind, frequencyHz: number, bandwidthHz = 0, identity?: HackrfIdentity): void {
  const { frequency, label } = sourceCapabilities(source, identity);
  if (!Number.isFinite(frequencyHz)) throw new Error("Enter a valid channel frequency.");
  if (frequencyHz <= 0) throw new Error("Choose a channel frequency above 0 Hz; the connected tuner's limits are detected when tuning.");
  if (!Number.isSafeInteger(Math.round(frequencyHz))) throw new Error("Choose a channel frequency that can be represented safely in integer Hz.");
  if (frequency.integerHz && !Number.isSafeInteger(frequencyHz)) throw new Error(`${label} requires integer Hz.`);
  if (!Number.isFinite(bandwidthHz) || bandwidthHz < 0) throw new Error("Enter a valid channel bandwidth.");
  if (frequencyHz - bandwidthHz / 2 < frequency.minimumHz || frequencyHz + bandwidthHz / 2 > frequency.maximumHz) throw new Error(`${label} frequency and channel passband must fit ${frequency.minimumHz}–${frequency.maximumHz} Hz.`);
}

/** Validate effective rates (including fractional firmware readback), before routing samples. */
export function validateSourceRoute(source: SourceKind, settings: ReceiverModeSettings, sampleRateHz: number, channelFrequencyHz: number, identity?: HackrfIdentity): void {
  const caps = sourceCapabilities(source, identity);
  if (!caps.modes.includes(settings.mode)) throw new Error(`${settings.mode} is unavailable with ${caps.label}.`);
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) throw new Error("Enter a valid sample rate.");
  if (source === "airspy" && settings.bandwidthHz > channelSampleRate(sampleRateHz) * .9) throw new Error("Airspy decimation leaves too little filtered channel bandwidth for this mode. Reduce decimation.");
  validateModeSampleRate(settings.mode, source === "airspy" || source === "hackrf" || source === "bladerf" || source === "usrp-b205" || source === "replay" ? channelSampleRate(sampleRateHz) : sampleRateHz);
  if (source === "hackrf" && identity?.kind === "hackrf-one" && sampleRateHz !== 9_600_000) throw new Error("HackRF One requires 9.6 MS/s native acquisition.");
  // Keep legacy analog behavior; hardware routes require the full guarded passband.
  if (source === "airspy" || source === "hackrf" || source === "bladerf" || source === "usrp-b205") {
    if (source === "airspy" && !isAirspyRate(sampleRateHz)) throw new Error("Unsupported Airspy acquisition/decimation rate.");
    if (source === "bladerf" && !BLADERF_SAMPLE_RATES_HZ.includes(sampleRateHz as BladeRfSampleRateHz)) throw new Error("bladeRF 2.0 Micro rate must be 2.4, 4.8, 9.6 or 19.2 MS/s.");
    if (source === "hackrf" && !HACKRF_SAMPLE_RATES_HZ.some((rate) => Math.abs(rate - sampleRateHz) <= 1)) throw new Error("HackRF acquisition rate must match a supported nominal rate within 1 Hz.");
    if (source === "usrp-b205" && !USRP_B205_SAMPLE_RATES_HZ.includes(sampleRateHz as 4_800_000 | 9_600_000 | 19_200_000))
      throw new Error("USRP B205-mini native rate must be 4800000, 9600000 or 19200000 samples/s.");
    validateSourceFrequency(source, channelFrequencyHz, settings.bandwidthHz, identity);
    planChannelTune(channelFrequencyHz, channelFrequencyHz, sampleRateHz, settings.bandwidthHz);
  } else validateSourceFrequency(source, channelFrequencyHz);
}

export interface SourceConfiguration {
  airspySettings?: AirspySettings;
  source?: SourceKind;
  hackrfIdentity?: HackrfIdentity;
  channelFrequencyHz: number;
  modeSettings?: ReceiverModeSettings;
  sampleRateHz?: number;
  gainDb?: number | null;
  hardwareSettings?: HackrfRxSettings;
  usrpSettings?: UsrpB205RxSettings;
  bladerfSettings?: BladeRfRxSettings;
  rtlInput?: import("./rtlInput").RtlInputSettings;
}

export function validateSourceConfiguration(options: SourceConfiguration): void {
  const source = options.source ?? "rtl-sdr";
  if (source !== "airspy" && options.airspySettings !== undefined) throw new Error("Airspy settings require the Airspy source.");
  if (options.rtlInput && source !== "rtl-sdr") throw new Error("RTL input settings require an RTL source.");
  if (source === "rtl-sdr") rtlDeviceFrequency(options.channelFrequencyHz, normalizeRtlInput(options.rtlInput));
  const caps = sourceCapabilities(source, options.hackrfIdentity);
  if (source !== "bladerf" && options.bladerfSettings !== undefined) throw new Error("bladeRF settings require the bladeRF source.");
  const mode = normalizeModeSettings(options.modeSettings ?? defaultModeSettings("WBFM"));
  validateSourceFrequency(source, options.channelFrequencyHz, options.hackrfIdentity ? mode.bandwidthHz : 0, options.hackrfIdentity);
    if (source === "airspy") {
    if (options.gainDb !== undefined || options.hardwareSettings !== undefined || options.bladerfSettings !== undefined || options.usrpSettings !== undefined) throw new Error("Airspy uses its own RX settings.");
    validateAirspySettings(options.airspySettings ?? DEFAULT_AIRSPY_SETTINGS);
    } else if (source === "hackrf") {
    if (options.gainDb !== undefined) throw new Error("HackRF uses RX stage settings, not RTL auto/manual gainDb.");
    if (options.usrpSettings !== undefined) throw new Error("USRP RX settings require the USRP B205-mini source.");
    validateHackrfRxSettings(options.hardwareSettings ?? DEFAULT_HACKRF_RX_SETTINGS, options.hackrfIdentity?.kind ?? "unknown");
    } else if (source === "usrp-b205") {
    if (options.gainDb !== undefined) throw new Error("USRP B205-mini uses fixed slow-attack AGC, not RTL gainDb.");
    if (options.hardwareSettings !== undefined) throw new Error("HackRF RX settings require the HackRF source.");
    validateUsrpB205RxSettings(options.usrpSettings ?? DEFAULT_USRP_B205_RX_SETTINGS);
    } else if (source === "bladerf") {
    if (options.hardwareSettings !== undefined || options.usrpSettings !== undefined || options.gainDb !== undefined) throw new Error("bladeRF uses its own RX gain/input settings.");
    validateBladeRfRxSettings(options.bladerfSettings ?? DEFAULT_BLADERF_RX_SETTINGS, options.channelFrequencyHz);
    } else {
    if (options.hardwareSettings !== undefined || options.usrpSettings !== undefined) throw new Error("Source-specific RX settings require the matching hardware source.");
    // Existing demo/replay callers carry the legacy scalar; it controls no hardware.
    normalizeGain(options.gainDb ?? null);
  }
  const rate = options.sampleRateHz ?? (caps.rates.kind === "choices" ? caps.rates.defaultHz : undefined);
  if (rate !== undefined) {
    if (caps.rates.kind === "recording") {
      if (!Number.isFinite(rate) || rate < caps.rates.minimumHz || rate > caps.rates.maximumHz || (rate > 3_200_000 && !isWidebandRate(rate))) throw new Error("Replay sample rate must be 8000–3200000 samples/s, or CI8 at 4800000, 9600000 or 19200000 samples/s.");
    } else if (!(source === "synthetic" ? LIVE_SAMPLE_RATES_HZ : caps.rates.valuesHz).includes(rate)) {
      throw new Error(`Choose a supported ${caps.label} sample rate (${caps.rates.valuesHz.join(" or ")} samples/s).`);
    }
    // The demo ignores the legacy UI rate preference and always generates 1.024 MS/s.
    // Replay start reads mode/rate from the validated recording, not these UI
    // preferences. ReplayBackend validates that route before routing any block.
    if (source !== "replay") validateSourceRoute(source, mode, source === "synthetic" ? 1_024_000 : source === "airspy" ? rate / (options.airspySettings?.decimation ?? 1) : rate, options.channelFrequencyHz);
  } else if (!caps.modes.includes(mode.mode)) throw new Error(`${mode.mode} is unavailable with ${caps.label}.`);
}

/** Check metadata consistency, not the hardware probes performed by the adapter. */
export function validateHackrfSessionDetails(details: HackrfSessionDetails): void {
  const { capabilities: caps, captureSettings: settings } = details;
  validateHackrfRxSettings(settings, caps.identity.kind);
  validateSourceFrequency("hackrf", settings.requestedCenterFrequencyHz, 0, caps.identity);
  if (caps.identity.kind === "hackrf-one") {
    const expected = discoverHackrfCapabilities({ identity: caps.identity, descriptorLayoutVerified: true, mandatoryQueriesVerified: true, standardImageIndex: null, standardImageSelectionAcknowledged: false });
    if (caps.source !== expected.source || caps.phase !== expected.phase || caps.protocolProfile !== expected.protocolProfile || caps.referenceCommit !== expected.referenceCommit
      || caps.nativeEncoding !== "ci8" || caps.standardImageIndex !== null || caps.formatEvidence !== "firmware-standard-ci8"
      || settings.requestedSampleRateHz !== 9_600_000 || details.nativeSampleRateHz !== 9_600_000 || details.adcSampleRateHz !== 9_600_000
      || details.effectiveSampleRateHz !== 2_400_000 || details.fpgaDecimationFactor !== 1 || details.nativeEncoding !== "ci8"
      || details.hostResampling.kind !== "channel-fir-decimate-4-v1" || details.hostResampling.numerator !== 1 || details.hostResampling.denominator !== 4
      || details.rateEvidence !== "requested-and-acknowledged" || settings.settingsEvidence !== "usb-acknowledged"
      || settings.appliedRateFixed36 !== null || settings.appliedRfFixed24 !== null || settings.appliedRotation !== null
      || settings.reportedBasebandBandwidthHz !== null || settings.reportedAnalogLpfTargetHz !== null || settings.stableFpgaControl !== undefined
      || settings.requestedBasebandBandwidthHz !== 7_000_000) throw new Error("Invalid HackRF One nominal rate/settings/format evidence.");
    return;
  }
  const factor = hackrfDecimationFactor(settings.requestedSampleRateHz);
  const u64 = (value: string) => {
    if (!/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 0xffff_ffff_ffff_ffffn) throw new Error("Invalid HackRF applied unsigned 64-bit value.");
    return BigInt(value);
  };
  const fixed = (value: string, bits: bigint) => {
    const raw = u64(value);
    const scale = 2n ** bits;
    return Number(raw / scale) + Number(raw % scale) / Number(scale);
  };
  const stable = isStableHackrfApi(caps.identity.usbApiVersion);
  if (caps.source !== "hackrf" || caps.phase !== "discovered" || caps.protocolProfile !== (stable ? HACKRF_STABLE_PROFILE : HACKRF_PROTOCOL_PROFILE)
    || caps.referenceCommit !== (stable ? HACKRF_STABLE_REFERENCE_COMMIT : HACKRF_REFERENCE_COMMIT) || caps.nativeEncoding !== "ci8"
    || caps.standardImageIndex !== 0 || caps.formatEvidence !== "standard-image-selection-acknowledged") throw new Error("Invalid HackRF discovered profile.");
  discoverHackrfCapabilities({ identity: caps.identity, descriptorLayoutVerified: true,
    mandatoryQueriesVerified: true, standardImageIndex: caps.standardImageIndex, standardImageSelectionAcknowledged: true });
  if (!HACKRF_SAMPLE_RATES_HZ.includes(settings.requestedSampleRateHz)
    || ![details.nativeSampleRateHz, details.effectiveSampleRateHz, details.adcSampleRateHz].every(Number.isFinite)
    || Math.abs(details.nativeSampleRateHz - settings.requestedSampleRateHz) > 1
    || Math.abs(details.effectiveSampleRateHz - channelSampleRate(details.nativeSampleRateHz)) > 1e-6
    || details.fpgaDecimationFactor !== factor
    || Math.abs(details.adcSampleRateHz - details.nativeSampleRateHz * factor) > 1
    || details.nativeEncoding !== "ci8" || details.rateEvidence !== (stable ? "requested-and-acknowledged" : "firmware-reported")
    || details.hostResampling.kind !== hostResamplingForRate(details.nativeSampleRateHz).kind || details.hostResampling.numerator !== 1 || details.hostResampling.denominator !== hostResamplingForRate(details.nativeSampleRateHz).denominator
    ) throw new Error("HackRF reported settings/rates do not match the standard profile.");
  if (settings.requestedBasebandBandwidthHz !== undefined) throw new Error("One filter evidence is unavailable on the Pro profile.");
  if (stable) {
    if (settings.settingsEvidence !== "usb-acknowledged" || details.nativeSampleRateHz !== settings.requestedSampleRateHz
      || settings.appliedRateFixed36 !== null || settings.appliedRfFixed24 !== null || settings.appliedRotation !== null
      || settings.reportedBasebandBandwidthHz !== null || settings.reportedAnalogLpfTargetHz !== null
      || ![1, 3, 7].includes(settings.stableFpgaControl!)) throw new Error("Invalid stable HackRF acknowledgement/FPGA evidence; RF/rate readbacks are unavailable.");
  } else if (settings.settingsEvidence !== "accepted-and-firmware-reported"
    || typeof settings.appliedRateFixed36 !== "string" || typeof settings.appliedRfFixed24 !== "string"
    || Math.abs(fixed(settings.appliedRateFixed36, 36n) - details.nativeSampleRateHz) > 1e-6
    || Math.abs(fixed(settings.appliedRfFixed24, 24n) - settings.requestedCenterFrequencyHz) > 1_000
    || ![0, 0x40000000, 0xc0000000].includes(settings.appliedRotation!)
    || ![settings.reportedBasebandBandwidthHz, settings.reportedAnalogLpfTargetHz].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    || settings.stableFpgaControl !== undefined) throw new Error("HackRF reported settings/rates do not match the standard profile.");
}


/** User-facing recording descriptions share one capability definition across Help. */
export const SOURCE_RECORDING_DESCRIPTIONS = {
  airspy: "12-bit real ADC converted/filtered to 16-bit complex I/Q; processed SigMF pairs",
  "rtl-sdr": "Native unsigned 8-bit CU8 I/Q; BrowserSDR and SigMF pairs",
  hackrf: "Native signed 8-bit CI8 I/Q; BrowserSDR and SigMF pairs",
  bladerf: "Native SC16 Q11 I/Q; SigMF ci16_le pairs with Q11 scale and model provenance",
  "usrp-b205": "Losslessly reordered CI16 I/Q; SigMF ci16_le pairs with hardware provenance",
  synthetic: "Quantized CU8 I/Q; BrowserSDR and SigMF pairs",
  replay: "Original imported encoding or processed channel I/Q; compatible paired exports",
} as const;
