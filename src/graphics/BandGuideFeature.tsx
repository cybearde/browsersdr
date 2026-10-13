import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useBandGuide } from "./BandGuide";
import { BandGuideControls } from "./BandGuideControls";
import { BandGuide } from "./BandGuideStrip";

export function BandGuideFeature({
  canvas,
  coordinates,
  width,
  selectedHz,
  onHeightChange,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  coordinates?: { center: number; rate: number; generation: number };
  width: number;
  selectedHz: number;
  onHeightChange: (height: number) => void;
}) {
  const guide = useBandGuide();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(canvas.current?.parentElement ?? null);
  }, [canvas]);
  const show = guide.enabled && Boolean(coordinates);
  useEffect(() => {
    onHeightChange(show ? guide.height : 0);
  }, [show, guide.height, onHeightChange]);
  return (
    <>
      <BandGuideControls guide={guide} available={show} />
      {show &&
        coordinates &&
        target &&
        createPortal(
          <BandGuide
            guide={guide}
            width={width}
            startHz={coordinates.center - coordinates.rate / 2}
            endHz={coordinates.center + coordinates.rate / 2}
            selectedHz={selectedHz}
          />,
          target,
        )}
    </>
  );
}
