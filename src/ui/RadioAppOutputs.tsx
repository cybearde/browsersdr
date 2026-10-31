import { useState } from "react";
import type { ReceiverSnapshot } from "../radio/receiverController";
import type { RadioAppSession } from "../radio/radioAppSession";
import { fmBand, type RadioAppSetup } from "../radio/radioAppSetup";
import type { Bookmark } from "../radio/bookmarks";
import type { SrdSensorReading } from "../srd/types";
import { InstrumentButton } from "./InstrumentButton";
import { useRadioAppPageSize } from "./useRadioAppPageSize";
export function FmRadioOutput({
  receiver,
  session,
  setup,
  favorites,
  saveFavorite,
  favoriteMessage,
  compatible,
}: {
  receiver: ReceiverSnapshot;
  session: RadioAppSession;
  setup: RadioAppSetup;
  favorites: readonly Bookmark[];
  saveFavorite(name: string): void;
  favoriteMessage: string;
  compatible: boolean;
}) {
  const [frequency, setFrequency] = useState(String(setup.frequencyHz / 1e6)),
    [name, setName] = useState(""),
    [issue, setIssue] = useState(""),
    [favorite, setFavorite] = useState("");
  const band = fmBand(setup.region),
    state = session.getSnapshot(),
    running = compatible && receiver.lifecycle === "running",
    searching = session.searcher.getSnapshot().status === "searching";
  const disabled =
    !compatible ||
    state.busy ||
    searching ||
    receiver.session?.source === "replay";
  const tune = (hz: number) => {
    setIssue("");
    void session
      .launch("fm", "5C", { ...setup, frequencyHz: hz })
      .catch((error) => setIssue(error.message));
  };
  return (
    <section className="radio-app-fm-output" aria-label="FM radio player">
      <div className="radio-app-fm-station">
        <small>
          {setup.region === "us" ? "US FM" : "FM RADIO"} ·{" "}
          {receiver.fmStereoReception ??
            (running ? "Checking stereo" : "Ready")}
        </small>
        <h3>
          {(setup.frequencyHz / 1e6).toFixed(2)} <small>MHz</small>
        </h3>
        <strong>
          {receiver.rds?.programmeService || "No station name received"}
        </strong>
        <p>
          {receiver.rds?.radioText ||
            "Waiting for RDS RadioText. Audio can be available without RDS."}
        </p>
        <small>
          PI {receiver.rds?.pi ?? "unknown"} · {receiver.rds?.validGroups ?? 0}{" "}
          validated groups
        </small>
      </div>
      <form
        className="radio-app-fm-tuning"
        onSubmit={(event) => {
          event.preventDefault();
          tune(Math.round(Number(frequency) * 1e6));
        }}
      >
        <label>
          FM frequency (MHz)
          <input
            type="number"
            min={band.minimumHz / 1e6}
            max={band.maximumHz / 1e6}
            step="0.001"
            value={frequency}
            onChange={(event) => setFrequency(event.currentTarget.value)}
          />
        </label>
        <InstrumentButton type="submit" disabled={disabled}>
          Tune FM
        </InstrumentButton>
        <InstrumentButton
          type="button"
          className="secondary"
          disabled={
            disabled || setup.frequencyHz - band.stepHz < band.minimumHz
          }
          onClick={() => tune(setup.frequencyHz - band.stepHz)}
        >
          Step down
        </InstrumentButton>
        <InstrumentButton
          type="button"
          className="secondary"
          disabled={
            disabled || setup.frequencyHz + band.stepHz > band.maximumHz
          }
          onClick={() => tune(setup.frequencyHz + band.stepHz)}
        >
          Step up
        </InstrumentButton>
      </form>
      <div className="radio-app-fm-seek">
        <InstrumentButton
          type="button"
          className="secondary"
          disabled={!running || disabled}
          onClick={() =>
            void session.search(-1).catch((error) => setIssue(error.message))
          }
        >
          Seek down
        </InstrumentButton>
        <InstrumentButton
          type="button"
          className="secondary"
          disabled={!running || disabled}
          onClick={() =>
            void session.search(1).catch((error) => setIssue(error.message))
          }
        >
          Seek up
        </InstrumentButton>
      </div>
      <details className="radio-app-favourites">
        <summary>FM favourites · {favorites.length}</summary>
        <div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                saveFavorite(
                  name.trim() ||
                    receiver.rds?.programmeService ||
                    `${setup.frequencyHz / 1e6} MHz FM`,
                );
                setIssue("");
              } catch (error) {
                setIssue((error as Error).message);
              }
            }}
          >
            <label>
              Favourite name
              <input
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <InstrumentButton type="submit" disabled={disabled}>
              Save FM favourite
            </InstrumentButton>
          </form>
          <label>
            Saved FM station
            <select
              value={favorite}
              onChange={(event) => setFavorite(event.currentTarget.value)}
            >
              <option value="">Choose a favourite</option>
              {favorites.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.frequencyHz / 1e6} MHz
                </option>
              ))}
            </select>
          </label>
          <InstrumentButton
            type="button"
            className="secondary"
            disabled={disabled || !favorite}
            onClick={() => {
              const item = favorites.find((item) => item.id === favorite);
              if (item) tune(item.frequencyHz);
            }}
          >
            Recall FM favourite
          </InstrumentButton>
          {favoriteMessage && <p>{favoriteMessage}</p>}
        </div>
      </details>
      {issue && <p role="alert">{issue}</p>}
    </section>
  );
}
export function sensorReadingFields(
  reading: SrdSensorReading,
): readonly (readonly [string, string])[] {
  const fields: [string, string][] = [];
  if ("temperatureC" in reading)
    fields.push(["Temperature", `${reading.temperatureC} °C`]);
  else fields.push(["Soil moisture", `${reading.moisturePercent}%`]);
  if ("humidityPercent" in reading && reading.humidityPercent !== undefined)
    fields.push(["Humidity", `${reading.humidityPercent}%`]);
  if ("batteryOk" in reading)
    fields.push(
      ["Battery", reading.batteryOk ? "OK" : "Low"],
      ["Channel", reading.channel],
    );
  if ("batteryMillivolts" in reading)
    fields.push(["Battery", `${reading.batteryMillivolts} mV`]);
  return fields;
}
export function WeatherSensorOutput({
  receiver,
  compatible,
}: {
  receiver: ReceiverSnapshot;
  compatible: boolean;
}) {
  const size = useRadioAppPageSize(),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string>(),
    [historyPage, setHistoryPage] = useState(0);
  const devices = receiver.srd?.devices ?? [],
    pages = Math.max(1, Math.ceil(devices.length / size)),
    current = Math.min(page, pages - 1);
  const device = devices.find((d) => d.key === selected),
    history = (receiver.srd?.recentReadings ?? [])
      .filter(
        (r) =>
          device &&
          r.protocol === device.reading.protocol &&
          r.deviceId === device.reading.deviceId,
      )
      .slice()
      .reverse();
  const historyPages = Math.max(1, Math.ceil(history.length / size)),
    historyAt = Math.min(historyPage, historyPages - 1);
  return (
    <section
      className="radio-app-sensor-output"
      aria-label="Weather sensor readings"
    >
      <div className="radio-app-sensor-heading">
        <h3>
          {device
            ? `Sensor ${device.reading.deviceId}`
            : "Your received sensors"}
        </h3>
        <small>
          {receiver.srd?.counters.validatedReadings ?? 0} validated ·{" "}
          {receiver.srd?.counters.rejectedProtocolFrames ?? 0} rejected
        </small>
      </div>
      {device ? (
        <>
          <InstrumentButton
            type="button"
            className="secondary"
            onClick={() => setSelected(undefined)}
          >
            All sensors
          </InstrumentButton>
          <div className="radio-app-sensor-history">
            {history
              .slice(historyAt * size, (historyAt + 1) * size)
              .map((reading, index) => (
                <article
                  key={`${reading.provenance.lastInputSampleIndex}:${index}`}
                >
                  <dl>
                    {sensorReadingFields(reading).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <small>
                    {reading.integrity} · input samples{" "}
                    {reading.provenance.firstInputSampleIndex}–
                    {reading.provenance.lastInputSampleIndex} · generation{" "}
                    {reading.provenance.generation}
                  </small>
                </article>
              ))}
          </div>
          <nav
            className="radio-app-pagination"
            aria-label="Reading history pages"
          >
            <InstrumentButton
              className="secondary"
              disabled={!historyAt}
              onClick={() => setHistoryPage(historyAt - 1)}
            >
              Previous
            </InstrumentButton>
            <small>
              {historyAt + 1}/{historyPages} · {history.length} recent readings
            </small>
            <InstrumentButton
              className="secondary"
              disabled={historyAt + 1 >= historyPages}
              onClick={() => setHistoryPage(historyAt + 1)}
            >
              Next
            </InstrumentButton>
          </nav>
        </>
      ) : (
        <>
          <div className="radio-app-sensor-cards">
            {devices.slice(current * size, (current + 1) * size).map((d) => (
              <article key={d.key}>
                <div>
                  <h4>{d.reading.deviceId}</h4>
                  <small>
                    {d.reading.protocol} · {d.readings} accepted readings
                  </small>
                </div>
                <dl>
                  {sensorReadingFields(d.reading).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <small>
                  {d.reading.integrity} · sample {d.lastInputSampleIndex} ·
                  generation {d.reading.provenance.generation}
                </small>
                <InstrumentButton
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setSelected(d.key);
                    setHistoryPage(0);
                  }}
                >
                  Reading history
                </InstrumentButton>
              </article>
            ))}
          </div>
          {!devices.length && (
            <div className="radio-app-sensor-empty">
              <h4>
                {!compatible
                  ? "Review receiver setup"
                  : receiver.lifecycle === "running"
                    ? "Waiting for validated readings"
                    : "Ready for your sensors"}
              </h4>
              <p>
                {!compatible
                  ? "Open App setup in App tools to prepare this sensor app again."
                  : receiver.lifecycle === "running"
                    ? "Choose the exact sensor family and frequency in App setup. Unknown bursts are available in protocol tools."
                    : "Start receiving above. Choose the exact sensor family and frequency in App setup. Unknown bursts are available in protocol tools."}
              </p>
            </div>
          )}
          <nav className="radio-app-pagination" aria-label="Sensor pages">
            <InstrumentButton
              className="secondary"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </InstrumentButton>
            <small>
              {current + 1}/{pages} · {devices.length} devices
            </small>
            <InstrumentButton
              className="secondary"
              disabled={current + 1 >= pages}
              onClick={() => setPage(current + 1)}
            >
              Next
            </InstrumentButton>
          </nav>
        </>
      )}
    </section>
  );
}
