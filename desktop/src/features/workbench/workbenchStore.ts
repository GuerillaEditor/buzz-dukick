export const WORKBENCH_STORAGE_KEY = "buzz-dukick.workbench";
export const WORKBENCH_MIN_WIDTH = 320;
export const WORKBENCH_MAX_WIDTH = 720;
export const WORKBENCH_DEFAULT_WIDTH = 380;

export type WorkbenchTab = "browser" | "terminal" | "files";

export type WorkbenchState = {
  activeTab: WorkbenchTab;
  isOpen: boolean;
  width: number;
};

export const DEFAULT_WORKBENCH_STATE: WorkbenchState = {
  activeTab: "browser",
  isOpen: true,
  width: WORKBENCH_DEFAULT_WIDTH,
};

const tabs = new Set<WorkbenchTab>(["browser", "terminal", "files"]);

function clampWidth(width: number) {
  return Math.min(WORKBENCH_MAX_WIDTH, Math.max(WORKBENCH_MIN_WIDTH, width));
}

export function loadWorkbenchState(storage?: Storage | null): WorkbenchState {
  if (!storage) return DEFAULT_WORKBENCH_STATE;
  try {
    const raw = storage.getItem(WORKBENCH_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKBENCH_STATE;
    const parsed = JSON.parse(raw) as Partial<WorkbenchState>;
    return {
      activeTab: tabs.has(parsed.activeTab as WorkbenchTab)
        ? (parsed.activeTab as WorkbenchTab)
        : DEFAULT_WORKBENCH_STATE.activeTab,
      isOpen: typeof parsed.isOpen === "boolean" ? parsed.isOpen : true,
      width:
        typeof parsed.width === "number" && Number.isFinite(parsed.width)
          ? clampWidth(parsed.width)
          : DEFAULT_WORKBENCH_STATE.width,
    };
  } catch {
    return DEFAULT_WORKBENCH_STATE;
  }
}

export function saveWorkbenchState(
  state: WorkbenchState,
  storage?: Storage | null,
) {
  try {
    storage?.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in private/embedded webviews. The dock still
    // works for the current session when persistence is unavailable.
  }
}

export function normalizeWorkbenchWidth(width: number) {
  return clampWidth(width);
}
