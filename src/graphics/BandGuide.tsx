import { useEffect, useState } from "react";
import { isBandGuidePlan, type BandGuidePlan } from "./bandGuide";
import "./BandGuide.css";

const STORAGE_KEY = "browsersdr.band-guide.v1";
export function useBandGuide() {
  const [preferences, setPreferences] = useState<{
    enabled: boolean;
    plan: BandGuidePlan;
  }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      return {
        enabled: typeof stored?.enabled === "boolean" ? stored.enabled : true,
        plan: isBandGuidePlan(stored?.plan) ? stored.plan : "DE",
      };
    } catch {
      return { enabled: true, plan: "DE" as BandGuidePlan };
    }
  });
  const [storageError, setStorageError] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      setStorageError(true);
    }
  }, [preferences]);
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(pointer: coarse)");
    if (!query) return;
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return {
    ...preferences,
    storageError,
    detailsOpen,
    setDetailsOpen,
    height: touch ? 44 : 20,
    setEnabled: (enabled: boolean) =>
      setPreferences((old) => ({ ...old, enabled })),
    setPlan: (plan: BandGuidePlan) =>
      setPreferences((old) => ({ ...old, plan })),
  };
}

export type BandGuidePreferences = ReturnType<typeof useBandGuide>;
