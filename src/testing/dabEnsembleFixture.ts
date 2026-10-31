import { FFT } from "@jtarrio/signals/dsp/fft.js";
import { getRealResampler } from "@jtarrio/signals/dsp/resamplers.js";
import { dabCrc16, dabDescramble } from "../dab/dabChannelCoding";
import { DAB_MODE_I_CARRIERS, DAB_MODE_I_FFT, DAB_MODE_I_GUARD, DAB_MODE_I_NULL, DAB_MODE_I_SYMBOL, DAB_MODE_I_SYMBOLS, createDabCarrierMap, createDabPrsReference } from "../dab/dabModeI";
const POLYNOMIALS = [109, 79, 83, 109];
const COUNTS: Record<number, readonly number[]> = {
  7: [2, 2, 2, 2, 2, 2, 2, 1],
  8: [2, 2, 2, 2, 2, 2, 2, 2],
  15: [3, 3, 3, 3, 3, 3, 3, 2],
  16: [3, 3, 3, 3, 3, 3, 3, 3],
  0: [2, 2, 2, 2, 2, 2],
};

function parity(value: number): number {
  let result = 0;
  while (value) {
    result ^= value & 1;
    value >>>= 1;
  }
  return result;
}
function motherEncode(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array((bytes.length * 8 + 6) * 4);
  let state = 0;
  for (let index = 0; index < bytes.length * 8 + 6; index += 1) {
    const input =
      index < bytes.length * 8
        ? (bytes[index >> 3]! >> (7 - (index & 7))) & 1
        : 0;
    const register = (state << 1) | input;
    for (let code = 0; code < 4; code += 1)
      output[index * 4 + code] = parity(register & POLYNOMIALS[code]!);
    state = register & 63;
  }
  return output;
}
function puncture(
  mother: Uint8Array,
  segments: readonly { vector: number; motherBits: number }[],
): Uint8Array {
  const output: number[] = [];
  let offset = 0;
  for (const segment of segments) {
    const counts = COUNTS[segment.vector]!;
    for (let group = 0; group < segment.motherBits / 4; group += 1)
      for (let bit = 0; bit < counts[group % counts.length]!; bit += 1)
        output.push(mother[offset + group * 4 + bit]!);
    offset += segment.motherBits;
  }
  return Uint8Array.from(output);
}
function fib(body: Uint8Array): Uint8Array {
  const output = new Uint8Array(32).fill(0xff);
  output.set(body);
  const crc = dabCrc16(output.subarray(0, 30));
  output[30] = crc >> 8;
  output[31] = crc;
  return output;
}
function ficBits(twoStations = false, labels = false): Uint8Array {
  const configuration = Uint8Array.of(
    0x05,
    0x01,
    0x00,
    0x00,
    0x88,
    0x06, // subchannel 0, 6 CU, EEP 3-A
    0x06,
    0x02,
    0x12,
    0x34,
    0x01,
    0x3f,
    0x02, // DAB+ primary
    0xff,
  );
  const decoded = new Uint8Array(96);
  decoded.set(
    fib(
      twoStations
        ? Uint8Array.of(
            9,
            1,
            0,
            0,
            0x88,
            6,
            4,
            6,
            0x88,
            6,
            11,
            2,
            0x12,
            0x34,
            1,
            0x3f,
            2,
            0x12,
            0x35,
            1,
            0x3f,
            6,
          )
        : configuration,
    ),
    0,
  );
  decoded.set(fib(Uint8Array.of(0xff)), 32);
  decoded.set(fib(Uint8Array.of(0xff)), 64);
  if (labels) {
    const label = (extension: number, id: number, text: string) => Uint8Array.from([0x35, extension, id >> 8, id & 255, ...new TextEncoder().encode(text.padEnd(16).slice(0, 16)), 0xff, 0xff]);
    decoded.set(fib(label(0, 0xcafe, "Test Ensemble")), 32);
    decoded.set(fib(label(1, 0x1234, "Test Radio")), 64);
  }
  const group = puncture(motherEncode(dabDescramble(decoded)), [
    { vector: 16, motherBits: 128 * 21 },
    { vector: 15, motherBits: 128 * 3 },
    { vector: 0, motherBits: 24 },
  ]);
  const output = new Uint8Array(9_216);
  for (let index = 0; index < 4; index += 1)
    output.set(group, index * group.length);
  return output;
}
function mscBits(logical: Uint8Array): Uint8Array {
  const encoded = puncture(motherEncode(dabDescramble(logical)), [
    { vector: 8, motherBits: 384 },
    { vector: 7, motherBits: 384 },
    { vector: 0, motherBits: 24 },
  ]);
  const output = new Uint8Array(221_184);
  for (let cif = 0; cif < 4; cif += 1) output.set(encoded, cif * 55_296);
  return output;
}
function transmissionBody(fic: Uint8Array, msc: Uint8Array) {
  const fft = FFT.ofLength(DAB_MODE_I_FFT),
    map = createDabCarrierMap(),
    previous = createDabPrsReference(),
    bodyI = new Float32Array(DAB_MODE_I_SYMBOL * DAB_MODE_I_SYMBOLS),
    bodyQ = new Float32Array(bodyI.length);
  for (let symbol = 0; symbol < DAB_MODE_I_SYMBOLS; symbol += 1) {
    let spectrumI: Float32Array, spectrumQ: Float32Array;
    if (symbol === 0) {
      spectrumI = previous[0];
      spectrumQ = previous[1];
    } else {
      spectrumI = new Float32Array(DAB_MODE_I_FFT);
      spectrumQ = new Float32Array(DAB_MODE_I_FFT);
      const source = symbol <= 3 ? fic : msc,
        sourceOffset = (symbol <= 3 ? symbol - 1 : symbol - 4) * 3_072;
      for (let logical = 0; logical < DAB_MODE_I_CARRIERS; logical += 1) {
        const physical = map[logical]!,
          carrier = physical < 768 ? physical - 768 : physical - 767,
          bin = (DAB_MODE_I_FFT + carrier) % DAB_MODE_I_FFT,
          deltaI = source[sourceOffset + logical]! ? -1 : 1,
          deltaQ = source[sourceOffset + logical + DAB_MODE_I_CARRIERS]!
            ? -1
            : 1;
        spectrumI[bin] =
          (previous[0][bin]! * deltaI - previous[1][bin]! * deltaQ) *
          Math.SQRT1_2;
        spectrumQ[bin] =
          (previous[0][bin]! * deltaQ + previous[1][bin]! * deltaI) *
          Math.SQRT1_2;
      }
      previous[0].set(spectrumI);
      previous[1].set(spectrumQ);
    }
    const [timeI, timeQ] = fft.reverse(spectrumI, spectrumQ),
      start = symbol * DAB_MODE_I_SYMBOL;
    bodyI.set(timeI.subarray(DAB_MODE_I_FFT - DAB_MODE_I_GUARD), start);
    bodyQ.set(timeQ.subarray(DAB_MODE_I_FFT - DAB_MODE_I_GUARD), start);
    bodyI.set(timeI, start + DAB_MODE_I_GUARD);
    bodyQ.set(timeQ, start + DAB_MODE_I_GUARD);
  }
  return { I: bodyI, Q: bodyQ };
}

export { ficBits, mscBits, transmissionBody };

export function createDabEnsembleFixture(sampleRateHz = 2_400_000, labels = false) {
  const body = transmissionBody(ficBits(false, labels), mscBits(new Uint8Array(24).fill(0x31)));
  let peak = 0;
  for (let n = 0; n < body.I.length; n++) peak = Math.max(peak, Math.abs(body.I[n]!), Math.abs(body.Q[n]!));
  const gain = 0.8 / peak;
  const I = body.I.map(value => value * gain), Q = body.Q.map(value => value * gain);
  const piecesI: Float32Array[] = [I.slice(0, 8192)], piecesQ: Float32Array[] = [Q.slice(0, 8192)];
  for (let frame = 0; frame < 12; frame++) {
    piecesI.push(new Float32Array(DAB_MODE_I_NULL), I);
    piecesQ.push(new Float32Array(DAB_MODE_I_NULL), Q);
  }
  piecesI.push(I.slice(0, 8192)); piecesQ.push(Q.slice(0, 8192));
  const join = (pieces: Float32Array[]) => {
    const result = new Float32Array(pieces.reduce((sum, part) => sum + part.length, 0));
    let offset = 0; for (const part of pieces) { result.set(part, offset); offset += part.length; }
    return result;
  };
  const nativeI = join(piecesI), nativeQ = join(piecesQ);
  if (sampleRateHz === 2_048_000) return { I: nativeI, Q: nativeQ };
  const resampler = getRealResampler(2_048_000, sampleRateHz), qResampler = resampler.clone();
  return { I: resampler.resample(nativeI), Q: qResampler.resample(nativeQ) };
}
