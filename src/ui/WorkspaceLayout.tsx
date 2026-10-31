import { InstrumentButton, InstrumentFace } from "./InstrumentButton";
import {
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { AppIcon, type AppIconName } from "./AppIcon";
import { ThemePicker } from "./ThemePicker";
import "./appInstallation";
const InstallAppControl = lazy(() =>
  import("./InstallAppControl").then((module) => ({
    default: module.InstallAppControl,
  })),
);
export const WORKSPACE_KEY = "browsersdr.workspace.v1";
export interface WorkspaceLayout {
  compact: boolean;
  sourceCollapsed: boolean;
  channelCollapsed: boolean;
  dockExpanded: boolean;
  dockLarge: boolean;
}
export const DEFAULT_WORKSPACE: WorkspaceLayout = {
  compact: true,
  sourceCollapsed: false,
  channelCollapsed: false,
  dockExpanded: true,
  dockLarge: false,
};
export function readWorkspace(
  storage: Pick<Storage, "getItem">,
): WorkspaceLayout {
  try {
    const value = JSON.parse(
      storage.getItem(WORKSPACE_KEY) ?? "null",
    ) as Partial<WorkspaceLayout> | null;
    if (!value) return { ...DEFAULT_WORKSPACE };
    return { ...Object.fromEntries(
      Object.entries(DEFAULT_WORKSPACE).map(([key, fallback]) => [
        key,
        typeof value[key as keyof WorkspaceLayout] === "boolean"
          ? value[key as keyof WorkspaceLayout]
          : fallback,
      ]),
    ) as unknown as WorkspaceLayout, compact: true, dockLarge: false };
  } catch {
    return { ...DEFAULT_WORKSPACE };
  }
}
export function useWorkspaceLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      return readWorkspace(localStorage);
    } catch {
      return { ...DEFAULT_WORKSPACE };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(layout));
    } catch {
      /* Optional appearance preference. */
    }
  }, [layout]);
  return [layout, setLayout] as const;
}
function HeaderMenu({
  label,
  icon,
  active,
  children,
  onOpen,
}: {
  label: string;
  icon: AppIconName;
  active: boolean;
  children: ReactNode;
  onOpen?: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        menu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <details
      className={`header-utility-menu${active ? " is-active" : ""}`}
      ref={menu}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen?.();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          menu.current?.removeAttribute("open");
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          menu.current?.removeAttribute("open");
          menu.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary id={label === "Help" ? "help-menu-trigger" : "settings-menu-trigger"} aria-label={label} title={label}>
        <InstrumentFace><AppIcon name={icon} /></InstrumentFace>
      </summary>
      <div
        className="header-utility-content"
        aria-label={`${label} options`}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button"))
            menu.current?.removeAttribute("open");
        }}
      >
        <p className="eyebrow">{label}</p>
        {children}
      </div>
    </details>
  );
}

export function WorkspaceControls({
  onChange,
  onSettings,
  onHelp,
  onAntenna,
  onCompatibility,
  onAbout,
  activeView,
}: {
  layout: WorkspaceLayout;
  onChange: Dispatch<SetStateAction<WorkspaceLayout>>;
  onSettings: () => void;
  onHelp: () => void;
  onAntenna?: (triggerId?: string) => void;
  onCompatibility: () => void;
  onAbout: () => void;
  activeView: string;
}) {
  const [settingsOpened, setSettingsOpened] = useState(false);
  return (
    <div
      className="workspace-controls"
      aria-label="Layout and application options"
    >
      {onAntenna && <InstrumentButton id="antenna-guide-trigger" type="button" className="secondary header-antenna-guide" aria-haspopup="dialog" onClick={() => onAntenna("antenna-guide-trigger")}><AppIcon name="radio" />Antenna guide</InstrumentButton>}
      <HeaderMenu
        label="Settings"
        icon="settings"
        active={activeView === "settings"}
        onOpen={() => setSettingsOpened(true)}
      >
        <ThemePicker />
        {settingsOpened && (
          <Suspense fallback={<span>Loading app options…</span>}>
            <InstallAppControl />
          </Suspense>
        )}
        <InstrumentButton
          type="button"
          className="secondary"
          aria-controls="settings-view"
          onClick={onSettings}
        >
          <AppIcon name="plug" />
          Integration settings
        </InstrumentButton>
        <InstrumentButton
          type="button"
          className="secondary"
          title="Reset panel layout; receiver settings stay unchanged"
          onClick={() => {
            onChange({ ...DEFAULT_WORKSPACE });
            document.getElementById("settings-menu-trigger")?.focus();
          }}
        >
          <AppIcon name="retry" />
          Reset layout
        </InstrumentButton>
      </HeaderMenu>
      <HeaderMenu
        label="Help"
        icon="help"
        active={
          activeView === "help" ||
          activeView === "antenna" ||
          activeView === "compatibility" ||
          activeView === "about"
        }
      >
        {onAntenna && (
          <InstrumentButton
            id="antenna-help-trigger"
            type="button"
            className="secondary"
            onClick={() => onAntenna("help-menu-trigger")}
          >
            <AppIcon name="radio" />
            Antenna guide
          </InstrumentButton>
        )}
        <InstrumentButton
          type="button"
          className="secondary"
          aria-controls="compatibility-view"
          onClick={onCompatibility}
        >
          <AppIcon name="activity" />
          Compatibility &amp; tests
        </InstrumentButton>
        <InstrumentButton
          type="button"
          className="secondary"
          aria-controls="help-view"
          onClick={onHelp}
        >
          <AppIcon name="help" />
          Help &amp; setup
        </InstrumentButton>
        <InstrumentButton
          type="button"
          className="secondary"
          aria-controls="about-view"
          onClick={onAbout}
        >
          <AppIcon name="info" />
          About BrowserSDR
        </InstrumentButton>
      </HeaderMenu>
    </div>
  );
}
