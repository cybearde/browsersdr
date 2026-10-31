import { InstrumentButton } from "./InstrumentButton";
import { lazy, memo, Suspense, useMemo, useRef, useState } from "react";
import { AppIcon } from "./AppIcon";
import type { SearchOverlayProps } from "./SearchOverlayFeature";
export type { SearchOverlayProps } from "./SearchOverlayFeature";
const Feature = lazy(() =>
  import("./SearchOverlayFeature").then((module) => ({
    default: module.SearchOverlayFeature,
  })),
);

const StableFeature = memo(Feature, (a, b) => {
  const left = a.antennaContext,
    right = b.antennaContext;
  return (
    a.favorites === b.favorites &&
    a.frequencyHz === b.frequencyHz &&
    a.mode === b.mode &&
    a.contextKey === b.contextKey &&
    a.blockedReason === b.blockedReason &&
    a.validationKey === b.validationKey &&
    a.client === b.client &&
    left?.kind === right?.kind &&
    left?.sourceLabel === right?.sourceLabel &&
    left?.frequencyHz === right?.frequencyHz &&
    left?.mode === right?.mode &&
    left?.range?.minimumHz === right?.range?.minimumHz &&
    left?.range?.maximumHz === right?.range?.maximumHz &&
    left?.range?.limitsDiscoveredAtTune === right?.range?.limitsDiscoveredAtTune
  );
});

/** Keep catalog clients and result UI dormant until Search is deliberately opened. Retain drafts thereafter. */
export function SearchOverlay(props: SearchOverlayProps) {
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const actions = useMemo(
    () => ({
      onPreview: (...args: Parameters<SearchOverlayProps["onPreview"]>) =>
        latest.current.onPreview(...args),
      onRecall: (...args: Parameters<SearchOverlayProps["onRecall"]>) =>
        latest.current.onRecall(...args),
      onUseStation: (...args: Parameters<SearchOverlayProps["onUseStation"]>) =>
        latest.current.onUseStation(...args),
      onFavorite: (...args: Parameters<SearchOverlayProps["onFavorite"]>) =>
        latest.current.onFavorite(...args),
      onRadioApp: (app: Parameters<NonNullable<SearchOverlayProps["onRadioApp"]>>[0]) => latest.current.onRadioApp?.(app),
    }),
    [],
  );
  const trigger = (
    <InstrumentButton
      type="button"
      className="secondary discovery-trigger"
      aria-haspopup="dialog"
      aria-expanded={loaded}
      disabled={loaded}
      onClick={() => setLoaded(true)}
    >
      <AppIcon name="search" />
      {loaded ? " Opening search…" : " Search"}
    </InstrumentButton>
  );
  return loaded ? (
    <Suspense fallback={trigger}>
      {props.validationKey === undefined ? (
        <Feature {...props} />
      ) : (
        <StableFeature {...props} {...actions} />
      )}
    </Suspense>
  ) : (
    trigger
  );
}
