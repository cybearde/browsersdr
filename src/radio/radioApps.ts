import {
  appModeSettings,
  defaultRadioAppSetup,
  normalizeRadioAppSetup,
  sameAppModeSettings,
  type RadioAppSetup,
} from "./radioAppSetup";
import { DAB_BAND_III_CHANNELS } from "../dab/channels";
import { defaultModeSettings } from "./receiverConfig";
import { compatibleSourceRate } from "./sourcePreferences";
import {
  validateSourceConfiguration,
  validateSourceRoute,
  type SourceConfiguration,
} from "./sourceCapabilities";
import type { ReceiverSnapshot } from "./receiverController";

export type RadioAppId =
  | "aircraft"
  | "ships"
  | "dab"
  | "fm"
  | "aprs"
  | "balloons"
  | "acars"
  | "sensors";
export const RADIO_APPS = [
  {
    id: "aircraft",
    name: "Track aircraft",
    description: "See aircraft received by your antenna on a live map.",
    subtitle: "ADS-B · 1090 MHz",
    mode: "ADS-B",
    frequencyHz: 1_090_000_000,
    aliases: [
      "aircraft",
      "planes",
      "plane",
      "flight tracking",
      "flights",
      "adsb",
      "ads-b",
    ],
    help: "Use an antenna suitable for 1090 MHz. Coverage depends on your antenna and surroundings. This app decodes 1090ES; 978 UAT is a separate, unavailable decoder.",
  },
  {
    id: "ships",
    name: "Track ships",
    description: "See vessels broadcasting AIS within reception range.",
    subtitle: "AIS · two channels",
    mode: "AIS",
    frequencyHz: 162_000_000,
    aliases: ["ships", "ship", "vessels", "vessel", "boats", "ais"],
    help: "Use a marine VHF antenna. AIS 1 at 161.975 MHz and AIS 2 at 162.025 MHz are received together. Not every vessel transmits AIS; names can arrive after positions.",
  },
  {
    id: "dab",
    name: "Listen to DAB+",
    description:
      "Find digital radio programmes, live text and broadcast images.",
    subtitle: "DAB+ · Band III",
    mode: "DAB",
    frequencyHz: 178_352_000,
    aliases: ["dab", "dab+", "digital radio", "digital programmes"],
    help: "Use an antenna suitable for DAB Band III. Choose a block or explicitly scan for stations. Audio needs browser AAC support; legacy MP2 and encrypted services are unsupported.",
  },
  {
    id: "fm",
    name: "FM Radio",
    description:
      "Listen to FM stations, read RDS text and save your favourites.",
    subtitle: "FM stereo · RDS",
    mode: "WBFM",
    frequencyHz: 100e6,
    aliases: ["fm", "fm radio", "broadcast radio", "rds", "music"],
    help: "Choose a tuning grid and channel. Seek looks for validated RDS or stereo evidence; mono stations may need manual tuning. Received names do not identify a transmitter site.",
  },
  {
    id: "aprs",
    name: "APRS",
    description:
      "Explore locally received stations, messages and weather reports.",
    subtitle: "APRS · Map & messages",
    mode: "APRS",
    frequencyHz: 144.8e6,
    aliases: ["aprs", "packet radio", "ham map", "amateur positions"],
    help: "Choose the channel used near your receiving antenna. Ambiguous positions are not plotted. Retained fields may come from earlier packets; no APRS-IS connection or transmission is made.",
  },
  {
    id: "balloons",
    name: "Weather Balloons",
    description: "Find and follow compatible RS41 radiosondes on a map.",
    subtitle: "RS41 · Position & motion",
    mode: "RS41",
    frequencyHz: 402e6,
    aliases: [
      "balloon",
      "balloons",
      "weather balloons",
      "radiosonde",
      "sonde",
      "rs41",
    ],
    help: "Tune a known channel or explicitly search a narrow window. Supports unencrypted RS41 position, motion and battery. Calibrated temperature, humidity and pressure, other sonde families and landing predictions are unavailable.",
  },
  {
    id: "acars",
    name: "Aircraft Messages",
    description:
      "Read received VHF ACARS message blocks and aircraft addresses.",
    subtitle: "ACARS · Aviation text",
    mode: "ACARS",
    frequencyHz: 131.725e6,
    aliases: [
      "acars",
      "aircraft messages",
      "aviation messages",
      "aircraft text",
    ],
    help: "Choose a common regional channel or enter a local VHF ACARS frequency. CRC and parity gate accepted blocks. Reported addresses are not joined to ADS-B tracks; VDL2 is unsupported.",
  },
  {
    id: "sensors",
    name: "Weather Sensors",
    description:
      "See validated readings from selected weather and soil sensors.",
    subtitle: "WH2 · Acurite 592TXR · WH51",
    mode: "SRD",
    frequencyHz: 433.92e6,
    aliases: [
      "weather sensors",
      "sensor",
      "sensors",
      "soil",
      "moisture",
      "wh2",
      "wh51",
      "acurite",
    ],
    help: "Select your exact sensor family and actual frequency. WH51 has 433/868/915 MHz variants; a region does not determine the exact carrier. Unknown bursts never become identified sensors.",
  },
] as const;
export function radioApp(id: RadioAppId) {
  return RADIO_APPS.find((app) => app.id === id)!;
}
export function matchingRadioApps(query: string) {
  const normalize = (s: string) =>
    s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const q = normalize(query);
  return RADIO_APPS.filter(
    (app) =>
      !q || [app.name, ...app.aliases].some((s) => normalize(s).includes(q)),
  );
}
export interface RadioAppPlan {
  id: RadioAppId;
  configuration: SourceConfiguration;
  action: "navigate" | "prepare" | "live" | "stop" | "replay";
  summary: string;
  setup?: RadioAppSetup;
}
export function profileMatches(
  snapshot: ReceiverSnapshot,
  config: SourceConfiguration,
): boolean {
  const s = snapshot.session;
  return Boolean(
    s &&
    s.source === config.source &&
    s.mode === config.modeSettings?.mode &&
    s.selectedChannelFrequencyHz === config.channelFrequencyHz &&
    config.modeSettings &&
    sameAppModeSettings(
      {
        mode: s.mode,
        bandwidthHz: s.channelBandwidthHz,
        squelch: s.squelch,
        beatToneHz: s.beatToneHz,
        srd: s.srd,
        textModem: s.textModem,
        pocsag: s.pocsag,
      },
      config.modeSettings,
    ) &&
    s.requestedSampleRateHz === config.sampleRateHz,
  );
}
export function planRadioApp(
  id: RadioAppId,
  config: SourceConfiguration,
  snapshot: ReceiverSnapshot,
  block = "5C",
  inputSetup?: RadioAppSetup,
): RadioAppPlan {
  const app = radioApp(id),
    source = config.source ?? "rtl-sdr";
  if (source === "synthetic")
    throw new Error(
      "The generated demo has no received digital data. Choose hardware or a compatible I/Q recording in Receiver.",
    );
  const configurable = ["fm", "aprs", "balloons", "acars", "sensors"].includes(
    id,
  );
  const setup = configurable
    ? normalizeRadioAppSetup(
        id,
        inputSetup ?? defaultRadioAppSetup(id, config.channelFrequencyHz),
      )
    : undefined;
  const settings = appModeSettings(app.mode, setup);
  const frequency =
    id === "dab"
      ? DAB_BAND_III_CHANNELS.find((c) => c.label === block)?.frequencyHz
      : (setup?.frequencyHz ?? app.frequencyHz);
  if (!frequency) throw new Error("Choose a supported DAB block.");
  if (source === "replay") {
    const s = snapshot.session;
    if (!s || s.mode !== app.mode)
      throw new Error(
        "Open a compatible recording in Receiver. This app cannot retune a recording to a different band or mode.",
      );
    if (
      id === "sensors" &&
      !["fineoffset-wh2", "fineoffset-wh51", "acurite-592txr"].includes(
        s.srd?.protocol ?? "none",
      )
    )
      throw new Error(
        "This recording has no supported sensor family configured. Open it in Receiver first.",
      );
    validateSourceRoute(
      source,
      defaultModeSettings(app.mode),
      s.actualSampleRateHz,
      s.selectedChannelFrequencyHz,
    );
    return {
      id,
      action: "replay",
      setup: setup
        ? {
            ...setup,
            frequencyHz: s.selectedChannelFrequencyHz,
            ...(id === "sensors"
              ? {
                  sensorProtocol: s.srd!
                    .protocol as RadioAppSetup["sensorProtocol"],
                }
              : {}),
          }
        : undefined,
      configuration: {
        ...config,
        channelFrequencyHz: s.selectedChannelFrequencyHz,
        sampleRateHz: s.requestedSampleRateHz,
        modeSettings: {
          mode: s.mode,
          bandwidthHz: s.channelBandwidthHz,
          squelch: s.squelch,
          beatToneHz: s.beatToneHz,
          srd: s.srd,
          textModem: s.textModem,
          pocsag: s.pocsag,
        },
      },
      summary:
        "View this recording. Capture settings and replay Start remain unchanged.",
    };
  }
  const rate = compatibleSourceRate(
    source,
    app.mode,
    config.sampleRateHz ?? 1_024_000,
  );
  if (rate === undefined)
    throw new Error(
      "This source has no compatible I/Q rate for this app. Choose another receiver.",
    );
  const target = {
    ...config,
    source,
    channelFrequencyHz: frequency,
    sampleRateHz: rate,
    modeSettings: settings,
  };
  validateSourceConfiguration(target);
  let action: RadioAppPlan["action"] = "prepare";
  if (snapshot.lifecycle === "running") {
    if (profileMatches(snapshot, target)) action = "navigate";
    else {
      // A live transition is admitted only at the current rate and after both
      // the old route at the new frequency and the final route validate.
      action = "stop";
      const s = snapshot.session!;
      if (s.source === source && s.requestedSampleRateHz === rate) {
        try {
          validateSourceRoute(
            source,
            {
              mode: s.mode,
              bandwidthHz: s.channelBandwidthHz,
              squelch: s.squelch,
              beatToneHz: s.beatToneHz,
              srd: s.srd,
              textModem: s.textModem,
              pocsag: s.pocsag,
            },
            s.actualSampleRateHz,
            frequency,
            s.hackrf?.capabilities.identity,
          );
          validateSourceRoute(
            source,
            target.modeSettings,
            s.actualSampleRateHz,
            frequency,
            s.hackrf?.capabilities.identity,
          );
          action = "live";
        } catch {
          /* Explicit stop-and-prepare avoids an invalid intermediate route. */
        }
      }
    }
  }
  return {
    id,
    configuration: target,
    setup,
    action,
    summary: `${frequency / 1e6} MHz · ${app.mode} · ${target.modeSettings.bandwidthHz.toLocaleString()} Hz bandwidth · ${rate / 1e6} MS/s input. ${action === "stop" ? "Reception will stop; restart remains manual." : action === "live" ? "Active reception will be reconfigured." : action === "navigate" ? "Open current reception without retuning." : "Settings only. Use Start receiving in the app when ready."}`,
  };
}
const KEY = "browsersdr.radio-apps.v1";
export interface RadioAppPreferences {
  lastApp?: RadioAppId;
  block: string;
  serviceKey?: string;
  ensembleId?: number;
  setups?: Partial<Record<RadioAppId, RadioAppSetup>>;
}
export function loadRadioAppPreferences(
  storage: Pick<Storage, "getItem">,
): RadioAppPreferences {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "null");
    if (value?.version !== 1) return { block: "5C" };
    const setups: Partial<Record<RadioAppId, RadioAppSetup>> = {};
    for (const app of RADIO_APPS) {
      try {
        if (
          ["fm", "aprs", "balloons", "acars", "sensors"].includes(app.id) &&
          value.setups?.[app.id]
        )
          setups[app.id] = normalizeRadioAppSetup(app.id, value.setups[app.id]);
      } catch {
        /* Ignore invalid optional setup. */
      }
    }
    return {
      ...(Object.keys(setups).length ? { setups } : {}),
      block: DAB_BAND_III_CHANNELS.some((c) => c.label === value.block)
        ? value.block
        : "5C",
      lastApp: RADIO_APPS.some((a) => a.id === value.lastApp)
        ? value.lastApp
        : undefined,
      serviceKey:
        typeof value.serviceKey === "string" &&
        /^\d+:\d+$/.test(value.serviceKey) &&
        value.serviceKey.length < 40
          ? value.serviceKey
          : undefined,
      ensembleId:
        Number.isSafeInteger(value.ensembleId) &&
        value.ensembleId >= 0 &&
        value.ensembleId <= 65535
          ? value.ensembleId
          : undefined,
    };
  } catch {
    return { block: "5C" };
  }
}
export function saveRadioAppPreferences(
  storage: Pick<Storage, "setItem">,
  prefs: RadioAppPreferences,
): void {
  try {
    storage.setItem(KEY, JSON.stringify({ version: 1, ...prefs }));
  } catch {
    /* Preferences are optional; never block reception. */
  }
}
