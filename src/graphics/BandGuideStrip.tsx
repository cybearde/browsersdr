import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BAND_GUIDE_PLANS,
  BAND_GUIDE_SOURCES,
  guideSegments,
  segmentLabel,
  type GuideSegment,
} from "./bandGuide";
import { formatFrequencyMHz } from "../ui/frequencyFormat";
import type { BandGuidePreferences } from "./BandGuide";
const frequency = (hz: number) => `${formatFrequencyMHz(hz)} MHz`;
export function BandGuide({
  startHz,
  endHz,
  selectedHz,
  guide,
  width,
}: {
  startHz: number;
  endHz: number;
  selectedHz: number;
  guide: BandGuidePreferences;
  width: number;
}) {
  const id = useId();
  const { setDetailsOpen } = guide;
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const [detail, setDetail] = useState<GuideSegment>();
  const segments = useMemo(
    () => guideSegments(startHz, endHz, guide.plan),
    [startHz, endHz, guide.plan],
  );
  // Retuning or switching country dismisses stale reference details.
  useEffect(() => {
    setDetail(undefined);
    setDetailsOpen(false);
  }, [startHz, endHz, guide.plan, guide.enabled, setDetailsOpen]);
  useEffect(() => {
    const element = dialog.current;
    if ((detail || guide.detailsOpen) && element && !element.open)
      element.showModal();
  }, [detail, guide.detailsOpen]);
  const close = () => {
    dialog.current?.close();
    setDetail(undefined);
    setDetailsOpen(false);
    if (!guide.detailsOpen) returnFocus.current?.focus();
  };
  return (
    <>
      <div
        className="band-guide-strip"
        aria-label="Band guide frequency uses"
        style={{ height: guide.height }}
      >
        {segments.map((segment) => {
          const label = segmentLabel(segment);
          const showLabel =
            (segment.widthPercent * width) / 100 >=
            Math.max(85, label.length * 6.2 + 16);
          const selected =
            selectedHz >= segment.startHz && selectedHz < segment.endHz;
          const tiny =
            (segment.widthPercent * width) / 100 <
            (guide.height === 44 ? 44 : 20);
          if (tiny)
            return (
              <span
                key={`${segment.startHz}-${segment.endHz}`}
                aria-hidden="true"
                className={`band-guide-segment band-guide-${segment.bands[0]?.category ?? "unknown"}`}
                style={{
                  left: `${segment.leftPercent}%`,
                  width: `${segment.widthPercent}%`,
                }}
              />
            );
          return (
            <button
              key={`${segment.startHz}-${segment.endHz}`}
              type="button"
              className={`band-guide-segment band-guide-${segment.bands[0]?.category ?? "unknown"}${selected ? " is-channel" : ""}`}
              aria-label={`${label}, ${frequency(segment.startHz)} to ${frequency(segment.endHz)}; show band details`}
              title={`${label} · ${frequency(segment.startHz)}–${frequency(segment.endHz)}`}
              style={{
                left: `${segment.leftPercent}%`,
                width: `${segment.widthPercent}%`,
              }}
              onClick={(e) => {
                returnFocus.current = e.currentTarget;
                setDetail(segment);
              }}
            >
              {showLabel && <span>{label}</span>}
            </button>
          );
        })}
      </div>
      {(detail || guide.detailsOpen) &&
        createPortal(
          <dialog
            ref={dialog}
            className="band-guide-dialog"
            aria-labelledby={`${id}-heading`}
            onCancel={(e) => {
              e.preventDefault();
              close();
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <header>
              <h2 id={`${id}-heading`}>
                {detail ? segmentLabel(detail) : "Band guide details"}
              </h2>
              <button type="button" className="secondary" onClick={close}>
                Close
              </button>
            </header>
            <p className="band-guide-context">
              {guide.plan === "DE"
                ? "Germany · curated allocation guide"
                : `${BAND_GUIDE_PLANS[guide.plan].label} · curated reference guide`}
            </p>
            <p>{BAND_GUIDE_PLANS[guide.plan].scope}</p>
            <p className="band-guide-context">
              Selected reference intervals only; this guide does not cover every
              allocation.
            </p>
            <p>
              Visible interval: {frequency(detail?.startHz ?? startHz)}–
              {frequency(detail?.endHz ?? endHz)}
            </p>
            {(detail ? [detail] : segments).map((segment) => (
              <section key={segment.startHz}>
                {segment.bands.length ? (
                  segment.bands.map((band) => (
                    <div key={band.id}>
                      <h3>{band.label}</h3>
                      <p>
                        Full interval: {frequency(band.startHz)}–
                        {frequency(band.endHz)}
                      </p>
                      <p>{band.notes}</p>
                      {band.references.map((reference) => {
                        const source = BAND_GUIDE_SOURCES[reference.sourceId];
                        return (
                          source && (
                            <p
                              key={`${reference.sourceId}-${reference.section}`}
                              className="band-guide-context"
                            >
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {source.title}
                              </a>
                              <br />
                              {reference.section}
                              <br />
                              {source.edition} · inspected {source.inspected}
                            </p>
                          )
                        );
                      })}
                    </div>
                  ))
                ) : (
                  <>
                    <h3>No guide data</h3>
                    <p>
                      {frequency(segment.startHz)}–{frequency(segment.endHz)}.{" "}
                      {guide.plan === "general"
                        ? "Select a country or common profile in the spectrum controls to show its curated uses."
                        : "This interval has no entry in the curated guide. It may have allocated or active uses."}
                    </p>
                  </>
                )}
              </section>
            ))}
            <p className="band-guide-context">
              Reference use only. This does not identify a received signal or
              establish occupancy, reception or decoder support.
            </p>
          </dialog>,
          document.body,
        )}
    </>
  );
}
