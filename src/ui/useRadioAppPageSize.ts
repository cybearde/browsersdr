import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
};
const pageSize = () =>
  window.innerWidth <= 600
    ? 1
    : window.innerHeight < 850
      ? 1
      : window.innerHeight < 950
        ? 2
        : 3;

/** Keep the primary app view bounded; the map and retained export still use all records. */
export function useRadioAppPageSize() {
  return useSyncExternalStore(subscribe, pageSize, () => 3);
}
