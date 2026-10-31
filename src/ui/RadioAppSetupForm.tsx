import type { RadioAppId } from "../radio/radioApps";
import {
  ACARS_CHANNELS,
  defaultRadioAppSetup,
  fmBand,
  SENSOR_FAMILIES,
  type RadioAppSetup,
} from "../radio/radioAppSetup";
export const configurableRadioApp = (id: RadioAppId) =>
  ["fm", "aprs", "balloons", "acars", "sensors"].includes(id);
export function RadioAppSetupForm({
  app,
  setup,
  onChange,
}: {
  app: RadioAppId;
  setup: RadioAppSetup;
  onChange(setup: RadioAppSetup): void;
}) {
  const update = (value: Partial<RadioAppSetup>) =>
    onChange({ ...setup, ...value });
  return (
    <div className="radio-app-setup-fields">
      {["fm", "aprs", "acars"].includes(app) && (
        <label>
          {app === "fm" ? "Tuning grid" : "Channel region"}
          <select
            value={setup.region}
            onChange={(event) => {
              const region = event.currentTarget
                .value as RadioAppSetup["region"];
              update({
                region,
                frequencyHz:
                  app === "aprs"
                    ? region === "us"
                      ? 144.39e6
                      : 144.8e6
                    : app === "acars"
                      ? ACARS_CHANNELS[region][0]
                      : region === "us"
                        ? 99.9e6
                        : 100e6,
              });
            }}
          >
            <option value="eu">
              {app === "fm"
                ? "Common FM · 87.5–108 MHz / 100 kHz"
                : "Europe / Region 1"}
            </option>
            <option value="us">
              {app === "fm"
                ? "US FM · 88.1–107.9 MHz / 200 kHz"
                : "North America"}
            </option>
            {app === "acars" && <option value="jp">Japan</option>}
          </select>
        </label>
      )}
      {app === "sensors" && (
        <label>
          Sensor family
          <select
            value={setup.sensorProtocol}
            onChange={(event) =>
              update({
                sensorProtocol: event.currentTarget
                  .value as RadioAppSetup["sensorProtocol"],
              })
            }
          >
            {SENSOR_FAMILIES.map((family) => (
              <option key={family.id} value={family.id}>
                {family.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {app === "acars" && (
        <label>
          Common channel
          <select
            aria-label="Common ACARS channel"
            value={
              ACARS_CHANNELS[setup.region].some((f) => f === setup.frequencyHz)
                ? setup.frequencyHz
                : "custom"
            }
            onChange={(event) => {
              if (event.currentTarget.value !== "custom")
                update({ frequencyHz: Number(event.currentTarget.value) });
            }}
          >
            <option value="custom">Custom frequency</option>
            {ACARS_CHANNELS[setup.region].map((frequency) => (
              <option key={frequency} value={frequency}>
                {frequency / 1e6} MHz
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Channel frequency (MHz)
        <input
          type="number"
          step={app === "fm" ? fmBand(setup.region).stepHz / 1e6 : 0.001}
          value={
            Number.isFinite(setup.frequencyHz)
              ? Number((setup.frequencyHz / 1e6).toFixed(6))
              : ""
          }
          onChange={(event) =>
            update({
              frequencyHz: Math.round(event.currentTarget.valueAsNumber * 1e6),
            })
          }
        />
      </label>
      {app === "balloons" && (
        <fieldset>
          <legend>
            Balloon search window · 25 kHz steps, up to 64 channels
          </legend>
          <label>
            Search from (MHz)
            <input
              type="number"
              step="0.025"
              value={
                Number.isFinite(setup.scanStartHz)
                  ? setup.scanStartHz / 1e6
                  : ""
              }
              onChange={(event) =>
                update({
                  scanStartHz: Math.round(
                    event.currentTarget.valueAsNumber * 1e6,
                  ),
                })
              }
            />
          </label>
          <label>
            Search to (MHz)
            <input
              type="number"
              step="0.025"
              value={
                Number.isFinite(setup.scanEndHz) ? setup.scanEndHz / 1e6 : ""
              }
              onChange={(event) =>
                update({
                  scanEndHz: Math.round(
                    event.currentTarget.valueAsNumber * 1e6,
                  ),
                })
              }
            />
          </label>
        </fieldset>
      )}
      <small>
        {app === "sensors"
          ? "Choose the frequency printed for your device variant. 433.920 MHz is an example, not a device detection."
          : app === "balloons"
            ? "Example channel only. Search begins after reception is started and you select Find balloon."
            : "Preset channels are starting points. Choose the channel used near your receiving antenna."}
      </small>
    </div>
  );
}
export const appSetupDefault = defaultRadioAppSetup;
