import { createRdsMultiplexFixture } from "./rdsFixture";
import { textModemSignal } from "./textModemSignal";
import {
  ACURITE_592_VECTOR,
  FINEOFFSET_WH2_VECTOR,
  FINEOFFSET_WH51_VECTOR,
} from "../srd/fixtures/rtl433Vectors";
import type { SensorProtocol } from "../radio/radioAppSetup";
/** Generated RF from specification/reference vectors; never physical reception evidence. */
export function cu8Signal(I: Float32Array, Q: Float32Array) {
  const bytes = new Uint8Array(I.length * 2);
  for (let n = 0; n < I.length; n++) {
    bytes[n * 2] = Math.max(0, Math.min(255, Math.round(I[n]! * 128 + 127.5)));
    bytes[n * 2 + 1] = Math.max(
      0,
      Math.min(255, Math.round(Q[n]! * 128 + 127.5)),
    );
  }
  return bytes;
}
export function fmRadioAppFixture(rate = 1_024_000) {
  const multiplex = createRdsMultiplexFixture({
    sampleRate: 336_000,
    programmeService: "TEST FM",
    radioText: "Radio Apps generated fixture",
    pilotAmplitude: 0.08,
  });
  const I = new Float32Array(Math.ceil((multiplex.length * rate) / 336_000)),
    Q = new Float32Array(I.length);
  let phase = 0;
  for (let n = 0; n < I.length; n++) {
    phase +=
      (2 * Math.PI * 75_000 * multiplex[Math.floor((n * 336_000) / rate)]!) /
      rate;
    I[n] = 0.65 * Math.cos(phase);
    Q[n] = 0.65 * Math.sin(phase);
  }
  return cu8Signal(I, Q);
}
export function acarsRadioAppFixture(rate = 1_024_000, corrupt = false) {
  const signal = textModemSignal(
    "ACARS",
    "TEST FLIGHT <script>literal</script>",
    rate,
    { offsetHz: 0, corrupt },
  );
  return cu8Signal(signal.I, signal.Q);
}
export function sensorRadioAppFixture(
  protocol: SensorProtocol,
  rate = 1_024_000,
) {
  const I: number[] = [],
    Q: number[] = [];
  let phase = 0;
  const tone = (us: number, amplitude: number, frequency = 0) => {
    for (let n = 0; n < Math.round((us * rate) / 1e6); n++) {
      phase += (2 * Math.PI * frequency) / rate;
      I.push(amplitude * Math.cos(phase));
      Q.push(amplitude * Math.sin(phase));
    }
  };
  tone(10_000, 0);
  const bytes =
    protocol === "fineoffset-wh51"
      ? Uint8Array.from([
          0xaa,
          0xaa,
          0xaa,
          0xaa,
          0x2d,
          0xd4,
          ...FINEOFFSET_WH51_VECTOR.bytes,
        ])
      : protocol === "fineoffset-wh2"
        ? Uint8Array.from([0xff, ...FINEOFFSET_WH2_VECTOR.bytes])
        : ACURITE_592_VECTOR.bytes;
  for (const byte of bytes)
    for (let bit = 7; bit >= 0; bit--) {
      const value = Boolean(byte & (1 << bit));
      if (protocol === "fineoffset-wh51")
        tone(58, 0.65, value ? 7_000 : -7_000);
      else if (protocol === "fineoffset-wh2") {
        tone(value ? 544 : 1524, 0.65);
        tone(1036, 0);
      } else {
        const high = value ? 408 : 220;
        tone(high, 0.65);
        tone(612 - high, 0);
      }
    }
  tone(100_000, 0);
  return cu8Signal(Float32Array.from(I), Float32Array.from(Q));
}
