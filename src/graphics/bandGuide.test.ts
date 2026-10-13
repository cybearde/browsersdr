import { expect, it } from "vitest";
import {
  BAND_GUIDE_PLANS,
  BAND_GUIDE_SOURCES,
  GERMAN_GUIDE_BANDS,
  guideBands,
  guideSegments,
  isBandGuidePlan,
  segmentLabel,
  type BandGuidePlan,
} from "./bandGuide";

it("clips an actual band boundary to proportional RF coordinates", () => {
  const segments = guideSegments(107e6, 109.4e6, "DE");
  expect(segments.map(segmentLabel)).toEqual([
    "FM broadcast",
    "Air navigation",
  ]);
  expect(segments[0]!.endHz).toBe(108e6);
  expect(segments[0]!.widthPercent).toBeCloseTo(100 / 2.4);
  expect(segments[1]!.leftPercent).toBeCloseTo(100 / 2.4);
  expect(segments[1]!.bands[0]!.endHz).toBe(117.975e6);
});

it("keeps country bounds independent of the common European profile", () => {
  const amateur = (plan: BandGuidePlan, start: number, end: number) =>
    guideSegments(start * 1e6, end * 1e6, plan).some((s) =>
      s.bands.some((b) => b.label.includes("amateur")),
    );
  expect(amateur("CEPT", 146, 148)).toBe(false);
  for (const plan of ["DE", "GB", "FR", "CH", "ES", "IN", "ZA"] as const)
    expect(amateur(plan, 146, 148)).toBe(false);
  for (const plan of ["US", "CA", "AU", "NZ", "CN", "BR"] as const)
    expect(amateur(plan, 146, 148)).toBe(true);
  expect(amateur("US", 420, 430)).toBe(true);
  expect(amateur("CA", 420, 430)).toBe(false);
  expect(amateur("GB", 420, 430)).toBe(false);
});

it("uses application bounds instead of translating Canada's allocation to FM", () => {
  expect(guideSegments(87e6, 89e6, "CA").map(segmentLabel)).toEqual([
    "No guide data",
    "FM broadcast",
  ]);
  expect(guideSegments(87e6, 89e6, "US").map(segmentLabel)).toEqual([
    "No guide data",
    "FM broadcast",
  ]);
  expect(guideSegments(87e6, 89e6, "CEPT")[0]!.endHz).toBe(87.5e6);
  const brazil = guideSegments(76e6, 89e6, "BR");
  expect(brazil.some((s) => s.startHz === 87.4e6 && !s.bands.length)).toBe(
    true,
  );
  expect(guideSegments(7e6, 8e6, "GB").every((s) => !s.bands.length)).toBe(
    true,
  );
});

it("retains inspectable provenance for every curated interval and excludes proposals", () => {
  for (const [id, plan] of Object.entries(BAND_GUIDE_PLANS)) {
    expect(isBandGuidePlan(id)).toBe(true);
    expect(plan.scope).not.toBe("");
    const bands = guideBands(id as BandGuidePlan);
    expect(new Set(bands.map((b) => b.id)).size).toBe(bands.length);
    for (const band of bands) {
      expect(Number.isSafeInteger(band.startHz)).toBe(true);
      expect(Number.isSafeInteger(band.endHz)).toBe(true);
      expect(band.endHz).toBeGreaterThan(band.startHz);
      expect(["broadcast", "navigation", "amateur", "shared"]).toContain(
        band.category,
      );
      expect(band.references.length).toBeGreaterThan(0);
      for (const ref of band.references) {
        expect(ref.section).not.toBe("");
        const source = BAND_GUIDE_SOURCES[ref.sourceId]!;
        expect(source).toBeDefined();
        expect(new URL(source.url).protocol).toBe("https:");
        expect(source.edition).not.toBe("");
        expect(source.inspected).toMatch(/^2026-10-1[34]$/);
        if (source.sha256) expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  }
  expect(BAND_GUIDE_SOURCES.CA!.edition).toContain("2022");
  expect(BAND_GUIDE_SOURCES.BR!.edition).toContain("789");
  for (const bad of [
    null,
    1,
    "world",
    "JP",
    "NL",
    "toString",
    "__proto__",
    "constructor",
  ])
    expect(isBandGuidePlan(bad)).toBe(false);
});
it("preserves gaps and gives the upper band ownership at an exact boundary", () => {
  expect(guideSegments(108e6, 109e6, "DE").map(segmentLabel)).toEqual([
    "Air navigation",
  ]);
  expect(guideSegments(143e6, 147e6, "DE").map(segmentLabel)).toEqual([
    "No guide data",
    "2 m amateur",
    "No guide data",
  ]);
  expect(guideSegments(144e6, 146e6, "general").map(segmentLabel)).toEqual([
    "No guide data",
  ]);
});
it("retains overlapping entries rather than assigning one identity", () => {
  const base = GERMAN_GUIDE_BANDS[0]!;
  const segments = guideSegments(0, 30, "DE", [
    { ...base, startHz: 0, endHz: 20 },
    { ...base, id: "other", startHz: 10, endHz: 30 },
  ]);
  expect(segments.map((s) => s.bands.length)).toEqual([1, 2, 1]);
  expect(segmentLabel(segments[1]!)).toBe("Shared uses");
  expect(segments.reduce((sum, s) => sum + s.widthPercent, 0)).toBeCloseTo(100);
});
it("rejects invalid windows and retains unique valid source intervals", () => {
  expect(guideSegments(NaN, 10, "DE")).toEqual([]);
  expect(guideSegments(20, 10, "DE")).toEqual([]);
  expect(new Set(GERMAN_GUIDE_BANDS.map((b) => b.id)).size).toBe(
    GERMAN_GUIDE_BANDS.length,
  );
  for (const band of GERMAN_GUIDE_BANDS) {
    expect(band.startHz).toBeLessThan(band.endHz);
    expect(Number.isInteger(band.startHz)).toBe(true);
    expect(band.notes).not.toBe("");
  }
});
