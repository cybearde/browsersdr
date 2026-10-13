import { AppIcon } from "../ui/AppIcon";
import type { BandGuidePreferences } from "./BandGuide";
import {
  BAND_GUIDE_GROUPS,
  BAND_GUIDE_PLANS,
  isBandGuidePlan,
} from "./bandGuide";
export function BandGuideControls({
  guide,
  available,
}: {
  guide: BandGuidePreferences;
  available: boolean;
}) {
  return (
    <div className="band-guide-controls">
      <label className="receiver-auto-center band-guide-toggle">
        <input
          type="checkbox"
          role="switch"
          aria-label="Band guide"
          checked={guide.enabled}
          onChange={(e) => guide.setEnabled(e.currentTarget.checked)}
        />
        <span className="receiver-switch-track" aria-hidden="true" />
        <span>Band guide</span>
        <span className="band-guide-switch-state" aria-hidden="true">
          {guide.enabled ? "On" : "Off"}
        </span>
      </label>
      <select
        aria-label="Band guide plan"
        value={guide.plan}
        onChange={(e) => {
          const plan = e.currentTarget.value;
          if (isBandGuidePlan(plan)) guide.setPlan(plan);
        }}
      >
        {BAND_GUIDE_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {Object.entries(BAND_GUIDE_PLANS)
              .filter(([, plan]) => plan.group === group)
              .map(([id, plan]) => (
                <option key={id} value={id}>
                  {plan.label}
                </option>
              ))}
          </optgroup>
        ))}
        <option value="general">No country</option>
      </select>
      <button
        type="button"
        className="secondary display-action"
        aria-label="Band guide details"
        disabled={!available}
        onClick={() => guide.setDetailsOpen(true)}
      >
        <AppIcon name="info" />
      </button>
      {guide.storageError && (
        <small role="status">Guide preference stays in this tab.</small>
      )}
    </div>
  );
}
